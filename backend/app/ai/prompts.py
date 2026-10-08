"""Prompt builders and output cleaners for the AI writing helpers.

The rules mirror what a careful recruiter would ask for: use only facts that
are in the CV, plain and credible wording, no keyword stuffing, no invented
metrics. Anything the model *suggests* measuring is left as a [bracketed]
placeholder so the user has to fill it in (the ATS check flags leftovers).
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from ..layout import SECTION_KIND, TEMPLATES, format_range, years_of_experience
from ..models import CV, Item

BANNED = (
    "results-driven, dynamic, passionate, synergy, go-getter, detail-oriented, team player, "
    "hard-working, self-starter, leverage, spearheaded, rockstar, ninja, guru, cutting-edge, "
    "proven track record, think outside the box, best-in-class, seasoned"
)

LENGTH = {
    "short": "2–3 sentences, about 40–60 words",
    "medium": "3–4 sentences, about 60–90 words",
    "long": "4–5 sentences, about 90–120 words (never more than 6 lines)",
}


class GenerateOptions(BaseModel):
    length: Literal["short", "medium", "long"] = "medium"
    tone: Literal["professional", "confident", "warm", "technical"] = "professional"
    language: str = Field(default="English", max_length=40)
    instructions: str = Field(default="", max_length=2000)
    sectionId: str = ""
    itemId: str = ""
    allowPlaceholders: bool = True


# --------------------------------------------------------------------------- #
# CV -> compact plain text for the prompt
# --------------------------------------------------------------------------- #
def cv_to_text(cv: CV, skip_summary: bool = False) -> str:
    spec = TEMPLATES.get(cv.design.template, TEMPLATES["international"])
    p = cv.personal
    out: list[str] = []
    for label, val in (
        ("Name", p.fullName), ("Headline", p.headline), ("Location", p.location),
        ("Nationality", p.nationality), ("Work permit / relocation", p.workPermit),
    ):
        if val.strip():
            out.append(f"{label}: {val.strip()}")
    yrs = years_of_experience(cv)
    if yrs:
        out.append(f"Total professional experience computed from dates: ~{yrs} years")

    for s in cv.sections:
        if not s.visible or (skip_summary and s.type == "summary"):
            continue
        kind = SECTION_KIND.get(s.type, "entries")
        title = s.title or spec.headings.get(s.type, s.type)
        if kind == "text":
            if s.content.strip():
                out.append(f"\n## {title}\n{s.content.strip()}")
            continue
        lines = []
        for it in s.items:
            lines.extend(_item_lines(s.type, kind, it, spec))
        if lines:
            out.append(f"\n## {title}\n" + "\n".join(lines))
    return "\n".join(out).strip()


def _item_lines(stype: str, kind: str, it: Item, spec) -> list[str]:
    if kind == "groups":
        tags = ", ".join(t for t in it.tags if t.strip())
        return [f"- {it.title}: {tags}" if it.title else f"- {tags}"] if tags else []
    if kind == "languages":
        return [f"- {it.title}: {it.level}"] if it.title else []
    if not (it.title or it.organization):
        return []
    head = " at ".join(x for x in (it.title.strip(), it.organization.strip()) if x)
    meta = ", ".join(x for x in (it.location.strip(), format_range(it, spec) or it.date) if x)
    lines = [f"- {head}" + (f" ({meta})" if meta else "")]
    if it.grade.strip():
        lines.append(f"  Grade: {it.grade.strip()}")
    if it.description.strip():
        lines.append(f"  {it.description.strip()}")
    lines += [f"  • {b.strip()}" for b in it.bullets if b.strip()]
    if it.tags:
        lines.append("  Tools: " + ", ".join(it.tags))
    return lines


def _target_text(cv: CV) -> str:
    parts = []
    if cv.target.role.strip():
        parts.append(f"Target role: {cv.target.role.strip()}")
    if cv.target.jobDescription.strip():
        parts.append("Job description (use its language only where the CV genuinely supports it):\n"
                     + cv.target.jobDescription.strip()[:8000])
    return "\n\n".join(parts)


def _market(cv: CV) -> str:
    return "UK/European" if cv.design.template == "europass" else "international"


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #
def summary_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    system = f"""You are a senior recruiter and CV writer for the {_market(cv)} job market.
Write the Profile / Professional Summary section of the candidate's CV.

Rules:
- Use ONLY facts present in the CV data. Never invent employers, years, metrics, tools, certifications or achievements.
- Length: {LENGTH[o.length]}. One paragraph.
- Cover, where the CV supports it: professional identity (aligned with the target role if given), years of relevant experience, the most relevant skills/areas of expertise, 1–2 concrete evidence-based achievements, and relocation / work-location information if provided.
- If a job description is given, prioritise what it asks for and mirror its wording only where it truthfully matches the CV. Do not keyword-stuff.
- Tone: {o.tone}, natural, specific and credible — like an experienced professional wrote it, not an AI.
- Write in implied first person (no "I", "my", no third-person name). Use plain verbs.
- Avoid buzzwords and clichés such as: {BANNED}.
- Write in {o.language}.
- Output ONLY the summary text: no heading, no quotes, no markdown, no commentary."""
    current = next((s.content.strip() for s in cv.sections if s.type == "summary" and s.content.strip()), "")
    user = "CV data:\n" + cv_to_text(cv, skip_summary=True)
    tgt = _target_text(cv)
    if tgt:
        user += "\n\n" + tgt
    if current:
        user += f"\n\nCurrent summary (improve on it, keep any true facts it adds):\n{current}"
    if o.instructions.strip():
        user += f"\n\nExtra instructions from the candidate:\n{o.instructions.strip()}"
    return system, user


# --------------------------------------------------------------------------- #
# Bullets for one entry
# --------------------------------------------------------------------------- #
def find_item(cv: CV, section_id: str, item_id: str):
    for s in cv.sections:
        if s.id == section_id:
            for it in s.items:
                if it.id == item_id:
                    return s, it
    return None, None


def bullets_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    section, item = find_item(cv, o.sectionId, o.itemId)
    if item is None:
        raise ValueError("Entry not found — save the entry and try again.")
    present = item.current
    placeholder_rule = (
        "- If a number would make a bullet much stronger but none is given, you MAY insert a clearly marked "
        "placeholder in square brackets, e.g. [X%] or [N users], for the candidate to replace. Never present a guess as fact."
        if o.allowPlaceholders
        else "- Do not add any numbers that are not in the source."
    )
    system = f"""You are a senior recruiter and CV writer for the {_market(cv)} job market.
Rewrite the bullet points for ONE entry of the candidate's CV.

Rules:
- Use ONLY information in the entry and the rest of the CV. Do not invent responsibilities, tools, scope or results.
- Each bullet: action verb + what was done + scope/context + result/impact where the evidence exists.
- Use {'present' if present else 'past'} tense. No "I"/"my". Max ~25 words per bullet.
- Keep the strongest, most relevant points first; merge or drop repetitive, low-value ones. Return 3–6 bullets.
- Do not turn a plain responsibility into an achievement when there is no evidence of an outcome.
- Keep tool names out of bullets where possible (they are listed separately), unless essential.
{placeholder_rule}
- If a job description is given, prioritise matching points and mirror its wording only where truthful.
- Avoid buzzwords and clichés such as: {BANNED}.
- Write in {o.language}. Tone: {o.tone}.
- Output ONLY the bullets, one per line, each starting with "- ". No heading or commentary."""
    head = " at ".join(x for x in (item.title, item.organization) if x)
    entry = [f"Entry type: {section.type}", f"Entry: {head}"]
    if item.description.strip():
        entry.append(f"Description: {item.description.strip()}")
    if item.bullets:
        entry.append("Current bullets:\n" + "\n".join(f"- {b}" for b in item.bullets if b.strip()))
    if item.tags:
        entry.append("Tools: " + ", ".join(item.tags))
    user = "\n".join(entry) + "\n\nRest of the CV for context:\n" + cv_to_text(cv)
    tgt = _target_text(cv)
    if tgt:
        user += "\n\n" + tgt
    if o.instructions.strip():
        user += f"\n\nExtra instructions from the candidate:\n{o.instructions.strip()}"
    return system, user


# --------------------------------------------------------------------------- #
# Output cleaning
# --------------------------------------------------------------------------- #
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.M)
_PREAMBLE = re.compile(
    r"^\s*(here(?:'s| is| are)\b[^\n]*:|sure[,!][^\n]*|certainly[,!][^\n]*|(?:\*\*)?(?:professional\s+)?(?:summary|profile)(?:\*\*)?:?)\s*$",
    re.I,
)


def _strip_common(text: str) -> str:
    text = _THINK.sub("", text or "")
    text = _FENCE.sub("", text).strip()
    lines = text.splitlines()
    while lines and (not lines[0].strip() or _PREAMBLE.match(lines[0])):
        lines.pop(0)
    return "\n".join(lines).strip()


def clean_summary(text: str) -> str:
    text = _strip_common(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.M)
    text = text.strip().strip('"“”').strip()
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return "\n\n".join(paras)


def clean_bullets(text: str) -> list[str]:
    text = _strip_common(text)
    out = []
    for line in text.splitlines():
        m = re.match(r"^\s*(?:[-•*▪●–]|\d+[.)])\s+(.*\S)", line)
        if m:
            b = re.sub(r"\*\*(.+?)\*\*", r"\1", m.group(1)).strip()
            if b:
                out.append(b.rstrip())
    if not out:  # model ignored the format: fall back to non-empty lines
        out = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return out[:8]
