"""Prompt builders and output cleaners for the AI writing helpers.

The rules mirror what a careful recruiter would ask for: use only facts that
are in the CV, plain and credible wording, no keyword stuffing, no invented
metrics. Anything the model *suggests* measuring is left as a [bracketed]
placeholder so the user has to fill it in (the ATS check flags leftovers).
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, Field

from ..layout import SECTION_KIND, TEMPLATES, format_range, years_of_experience
from ..models import CV, Item, JobReport, Keyword, Requirement

BANNED = (
    "results-driven, dynamic, passionate, synergy, go-getter, detail-oriented, team player, "
    "hard-working, self-starter, leverage, spearheaded, rockstar, ninja, guru, cutting-edge, "
    "proven track record, think outside the box, best-in-class, seasoned"
)

LENGTH = {
    "short": "3–4 sentences, about 50–70 words",
    "medium": "4–5 sentences, about 70–95 words",
    "long": "5–6 sentences, about 90–120 words (never more than 6 lines)",
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
# Job match report (the recruiter check against the target job)
# --------------------------------------------------------------------------- #
def _require_job(cv: CV) -> None:
    if not cv.target.jobDescription.strip():
        raise ValueError("Paste the job description into Target job first.")


def tailor_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    _require_job(cv)
    system = f"""You are a senior recruiter for the {_market(cv)} job market. Read the candidate's CV against the job \
description the way an applicant tracking system and then a recruiter would, and report how well they match.

Rules:
- Use ONLY facts in the CV. Never assume the candidate has a skill, tool, certification or experience the CV doesn't show, and don't over-claim.
- "keywords": the 10–25 terms the posting screens on: hard skills, tools, certifications, industry terms and soft skills. Copy each with the posting's exact spelling and wording (e.g. "Project Management", not "project mgmt."), 1–4 words each, no duplicates. "kind" is "must" for an essential requirement and "nice" for a desirable extra.
- "requirements": the posting's main requirements (at most 12), each with its "kind" and "evidence": a short pointer to where the CV shows it (role, project, skill or certificate), or "" if the CV doesn't show it.
- "strengths": the 2–4 strongest selling points for this role, each backed by the CV.
- "gaps": the biggest gaps between the CV and the posting.
- "questions": for each important requirement the CV doesn't show, ask whether the candidate genuinely has it, so they add only what is true. Also ask for numbers worth adding (team size, %, time saved), marking where they would go with a placeholder such as [X%].
- "nextSteps": 2–5 practical edits for this application: which experience to lead with, what to rephrase in the posting's wording where it is true, what to cut.
- "estimate": your overall match estimate from 0 to 100.
- Write in {o.language}, but keep keywords in the posting's own language and spelling. Plain, specific words; no buzzwords.
- Output ONLY one JSON object with exactly these keys, no markdown and no commentary:
{{"estimate": 0, "keywords": [{{"term": "", "kind": "must"}}], "requirements": [{{"text": "", "kind": "must", "evidence": ""}}], "strengths": [""], "gaps": [""], "questions": [""], "nextSteps": [""]}}"""
    user = "CV data:\n" + cv_to_text(cv) + "\n\n" + _target_text(cv)
    if o.instructions.strip():
        user += f"\n\nExtra instructions from the candidate:\n{o.instructions.strip()}"
    return system, user


# --------------------------------------------------------------------------- #
# Skills: regrouped and ordered for the target job, from skills the CV already shows
# --------------------------------------------------------------------------- #
def skills_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    tgt = _target_text(cv)
    system = f"""You are a senior recruiter and CV writer for the {_market(cv)} job market.
Reorganise the Skills section of the candidate's CV{" for the target job" if tgt else ""}.

Rules:
- Use ONLY skills the CV already shows: the current Skills section, the tools listed under roles and projects, and skills clearly named in the bullets. Never add a skill the CV doesn't show.
- 3–6 groups with short, standard names (e.g. "Programming", "Networking", "Cloud & DevOps", "Tools", "Soft skills"), 3–12 skills each.
- {"Order groups and skills by relevance to the target job, what the job description asks for first. Where a skill in the CV is the same as a term in the job description, use the posting's spelling." if tgt else "Order groups and skills by how central they are to the candidate's experience."}
- Each skill is 1–4 words: no sentences, levels, years or ratings. No duplicates across groups.
- Keep every relevant skill; drop only ones that are clearly irrelevant, and only when there are more than about 30.
- Output ONLY one JSON object, no markdown and no commentary:
{{"groups": [{{"title": "", "skills": [""]}}]}}"""
    user = "CV data:\n" + cv_to_text(cv)
    if tgt:
        user += "\n\n" + tgt
    if o.instructions.strip():
        user += f"\n\nExtra instructions from the candidate:\n{o.instructions.strip()}"
    return system, user


def cv_plain_text(cv: CV) -> str:
    """Every value printed on the CV (visible sections), without labels: what a skill must appear in."""
    parts = [cv.personal.headline]
    for s in cv.sections:
        if not s.visible:
            continue
        parts.append(s.content)
        for it in s.items:
            parts += [it.title, it.organization, it.description, it.grade, it.level, *it.bullets, *it.tags]
    return "\n".join(x for x in parts if x and x.strip())


def mentions(text: str, term: str) -> bool:
    """Whole-word, case-insensitive match: "Project Management" matches across spacing, "Go" isn't "good",
    and a trailing + or # counts as part of the word, so "C" isn't found in "C++" or "C#". Mirrors atsCheck.countTerm.
    """
    words = term.split()
    return bool(words) and re.search(r"(?<!\w)" + r"\s+".join(map(re.escape, words)) + r"(?![\w+#])", text, re.I) is not None


# --------------------------------------------------------------------------- #
# Cover letter
# --------------------------------------------------------------------------- #
def letter_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    if not (cv.target.role.strip() or cv.target.jobDescription.strip()):
        raise ValueError("Add the target role or job description first, so the letter is about a real job.")
    name = cv.personal.fullName.strip() or "the candidate's name"
    system = f"""You are a senior recruiter and career coach for the {_market(cv)} job market.
Write a cover letter for the candidate's application to the target job.

Rules:
- Use ONLY facts in the CV and the job description. Never invent employers, years, metrics, tools, certifications, achievements or facts about the company.
- Three short paragraphs, about 250–350 words in total:
  1. Motivation and hook: why this role at this company. Link the candidate's drive to what the job description says about the company (its mission, work, a recent achievement or its culture). If it says nothing about the company, write a clearly marked placeholder such as [what draws you to the company] for the candidate to fill in.
  2. Value fit and proof: the experience that best matches the role's main requirements, with 1–2 results from the CV. Where a number would help but the CV has none, use a placeholder such as [X%]. Don't repeat the CV line by line.
  3. Call to action: restate interest and invite a call or interview.
- Mention relocation or work permit only if the CV states it and it matters for this job.
- Open with "Dear <name>," if the recipient names a person, otherwise "Dear Hiring Manager,". Close with "Kind regards," and {name} on the next line.
- Don't write a letter header (contact details, date, address): the app adds it.
- First person, plain and specific, like an experienced professional wrote it, not an AI. Tone: {o.tone}. Avoid buzzwords and clichés such as: {BANNED}.
- Write in {o.language}.
- Output ONLY the letter: paragraphs separated by a blank line, no markdown, no commentary."""
    user = "CV data:\n" + cv_to_text(cv) + "\n\n" + _target_text(cv)
    if cv.target.recipient.strip():
        user += f"\n\nRecipient:\n{cv.target.recipient.strip()}"
    if cv.target.coverLetter.strip():
        user += f"\n\nCurrent draft (improve on it, keep any true facts it adds):\n{cv.target.coverLetter.strip()}"
    if o.instructions.strip():
        user += f"\n\nExtra instructions from the candidate:\n{o.instructions.strip()}"
    return system, user


# --------------------------------------------------------------------------- #
# LinkedIn headline and About
# --------------------------------------------------------------------------- #
HEADLINE_MAX, ABOUT_MAX = 220, 2600  # LinkedIn's limits


def linkedin_prompts(cv: CV, o: GenerateOptions) -> tuple[str, str]:
    system = f"""You are a senior recruiter who sources candidates on LinkedIn for the {_market(cv)} job market.
Write the candidate's LinkedIn headline and About section from their CV{", aimed at the target job" if _target_text(cv) else ""}.

Rules:
- Use ONLY facts in the CV. Never invent employers, years, metrics, tools, certifications or achievements.
- Headline (at most {HEADLINE_MAX} characters): job title + specialisation + top skills + location, with 3–5 keywords recruiters search for, separated by " | ". Use a standard, recognisable job title. Add relocation readiness if the CV states it.
- About (1,200–2,000 characters, never more than {ABOUT_MAX}): first person. Put the core keywords and who the candidate is in the first 2–3 lines, before LinkedIn's "See more" fold. Then: the problem they solve and their expertise, 2–3 achievements with the CV's numbers (a placeholder such as [X%] where a number would help but the CV has none), and what they are looking for with a call to action. Short paragraphs separated by a blank line.
- Work in 3–5 keywords naturally; no keyword lists. No vague lines such as "motivated professional looking for a challenging role". Avoid buzzwords such as: {BANNED}.
- Tone: {o.tone}. Write in {o.language}.
- Output ONLY one JSON object, no markdown and no commentary:
{{"headline": "", "about": ""}}"""
    user = "CV data:\n" + cv_to_text(cv)
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


def parse_json_object(text: str) -> dict:
    """The JSON object in a model's reply. Tolerates <think> blocks, code fences, text around it and trailing commas."""
    text = _THINK.sub("", text or "")
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S | re.I)
    body = fenced.group(1) if fenced else text
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in the reply")
    body = body[start : end + 1]
    for candidate in (body, re.sub(r",\s*([}\]])", r"\1", body)):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    raise ValueError("the reply's JSON is invalid")


_NOT_SHOWN = re.compile(r"(none|no|n/?a|-+|—|no evidence[^\n]*|not (shown|mentioned|found|stated|evident|in (the )?cv)[^\n]*)\.?", re.I)


def _line(value: object, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().strip("\"'“”")[:limit].strip()


def _kind(value: object) -> str:
    return "nice" if re.search(r"nice|desir|optional|plus|prefer|bonus", str(value or ""), re.I) else "must"


def _lines(value: object, limit: int) -> list[str]:
    out: list[str] = []
    for v in value if isinstance(value, list) else []:
        line = _line(v.get("text", "") if isinstance(v, dict) else v, 600)
        if line and line not in out:
            out.append(line)
    return out[:limit]


def parse_report(text: str) -> JobReport:
    """Validate the model's job match report, trimming it to the stored shape. ValueError if unusable."""
    data = parse_json_object(text)
    keywords: list[Keyword] = []
    seen: set[str] = set()
    for k in data.get("keywords") if isinstance(data.get("keywords"), list) else []:
        term = _line(k.get("term") if isinstance(k, dict) else k, 80)
        if term and term.lower() not in seen:
            seen.add(term.lower())
            keywords.append(Keyword(term=term, kind=_kind(k.get("kind") if isinstance(k, dict) else "")))
    requirements: list[Requirement] = []
    for r in data.get("requirements") if isinstance(data.get("requirements"), list) else []:
        item = r if isinstance(r, dict) else {"text": r}
        req = _line(item.get("text") or item.get("requirement"), 400)
        evidence = _line(item.get("evidence"), 400)
        if req:
            requirements.append(Requirement(text=req, kind=_kind(item.get("kind")), evidence="" if _NOT_SHOWN.fullmatch(evidence) else evidence))
    if not keywords and not requirements:
        raise ValueError("the report has no keywords or requirements")
    try:
        estimate: int | None = min(max(round(float(data.get("estimate"))), 0), 100)
    except (TypeError, ValueError, OverflowError):
        estimate = None
    return JobReport(
        estimate=estimate,
        keywords=keywords[:40],
        requirements=requirements[:20],
        strengths=_lines(data.get("strengths"), 6),
        gaps=_lines(data.get("gaps"), 6),
        questions=_lines(data.get("questions"), 8),
        nextSteps=_lines(data.get("nextSteps"), 6),
    )


def parse_skills(text: str, cv: CV) -> tuple[list[dict], list[str]]:
    """(groups, dropped): the model's skill groups, keeping only skills the CV shows. ValueError if none remain.

    This is the "only skills you have" rule enforced in code: a skill the model adds (often one the job
    description asks for) is dropped and reported back, so the editor can tell the user to add it to a role first.
    """
    data = parse_json_object(text)
    source = cv_plain_text(cv)
    groups: list[dict] = []
    seen: set[str] = set()
    dropped: list[str] = []
    for g in data.get("groups") if isinstance(data.get("groups"), list) else []:
        if not isinstance(g, dict):
            continue
        skills = []
        for raw in g.get("skills") or g.get("tags") or []:
            skill = _line(raw, 80)
            if not skill or skill.lower() in seen:
                continue
            seen.add(skill.lower())
            (skills if mentions(source, skill) else dropped).append(skill)
        if skills:
            groups.append({"title": _line(g.get("title"), 80), "tags": skills[:30]})
    if not groups:
        raise ValueError("no skill groups in the reply")
    return groups[:8], dropped[:20]


def _prose(text: str) -> str:
    """Paragraphs separated by one blank line, markdown removed, hard-wrapped lines rejoined.

    A line break is kept after punctuation or a short line, so a sign-off ("Kind regards,\\nAlex") or an
    address stays on its own lines while a paragraph the model wrapped at ~80 characters becomes one.
    """
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.M)
    paras = []
    for p in re.split(r"\n\s*\n", text.replace("\r", "").strip().strip('"“”').strip()):
        lines = [ln.strip() for ln in p.split("\n") if ln.strip()]
        out = lines[:1]
        for ln in lines[1:]:
            last = out[-1].rsplit("\n", 1)[-1]
            out[-1] += (" " if len(last) > 60 and not re.search(r"[.,:;!?]$", last) else "\n") + ln
        if out:
            paras.append(out[0])
    return "\n\n".join(paras)


def clean_letter(text: str) -> str:
    text = _strip_common(text)
    text = re.sub(r"^\s*(?:\*\*)?cover letter(?:\*\*)?:?\s*\n", "", text, flags=re.I)
    return _prose(text)


def _fit(text: str, limit: int) -> str:
    """Cut to the limit at a separator or sentence end rather than mid-word."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in ("\n\n", ". ", " | ", " · ", ", ", " "):
        i = cut.rfind(sep)
        if i > limit * 0.6:
            return cut[: i + (1 if sep == ". " else 0)].rstrip(" |·,")
    return cut


def parse_linkedin(text: str) -> dict:
    """{"headline", "about"} within LinkedIn's limits. ValueError if the reply has neither."""
    data = parse_json_object(text)
    headline = _fit(_line(data.get("headline"), 1000).strip(" |"), HEADLINE_MAX)
    about = _fit(_prose(str(data.get("about") or "")), ABOUT_MAX)
    if not headline and not about:
        raise ValueError("no headline or About text in the reply")
    return {"headline": headline, "about": about}
