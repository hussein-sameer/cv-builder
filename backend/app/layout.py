"""Template definitions and the intermediate representation (IR) shared by
the DOCX and PDF renderers.

``build_document(cv)`` turns the user's CV into a ``RenderDoc``: an ordered
list of plain blocks (paragraphs, entries, label/value pairs, lines). Both
renderers only know how to draw those blocks, so the two output formats stay
identical in content and order — which is what an ATS cares about.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from .models import CV, Item, Section

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class TemplateSpec:
    key: str
    name: str
    description: str
    default_font: str
    date_style: Literal["month_name", "numeric"]
    present_word: str
    entry_style: Literal["title_first", "dates_first"]
    show_personal_details: bool
    headings: dict[str, str]


_COMMON_HEADINGS = {
    "certifications": "Certifications",
    "projects": "Projects",
    "volunteering": "Volunteering",
    "awards": "Awards",
    "publications": "Publications",
    "courses": "Courses & Training",
    "interests": "Interests",
    "references": "References",
    "custom": "Additional Information",
    "customText": "Additional Information",
}

TEMPLATES: dict[str, TemplateSpec] = {
    "international": TemplateSpec(
        key="international",
        name="International ATS",
        description="Single column, standard headings, no photo or personal data. "
        "Safest choice for applicant tracking systems in the US, Gulf and most global employers.",
        default_font="Calibri",
        date_style="month_name",
        present_word="Present",
        entry_style="title_first",
        show_personal_details=False,
        headings={
            "summary": "Professional Summary",
            "experience": "Experience",
            "education": "Education",
            "skills": "Skills",
            "languages": "Languages",
            **_COMMON_HEADINGS,
        },
    ),
    "europass": TemplateSpec(
        key="europass",
        name="EU / UK",
        description="European-style CV: profile, personal details block (nationality, work "
        "permit, driving licence), dates-first entries and CEFR language levels. Still single column and ATS-safe.",
        default_font="Arial",
        date_style="numeric",
        present_word="Present",
        entry_style="dates_first",
        show_personal_details=True,
        headings={
            "summary": "Profile",
            "experience": "Work Experience",
            "education": "Education and Training",
            "skills": "Skills",
            "languages": "Language Skills",
            **_COMMON_HEADINGS,
        },
    ),
}

# How each section type is laid out, and labels for tag lists.
SECTION_KIND: dict[str, str] = {
    "summary": "text",
    "interests": "text",
    "references": "text",
    "customText": "text",
    "experience": "entries",
    "education": "entries",
    "projects": "entries",
    "volunteering": "entries",
    "custom": "entries",
    "skills": "groups",
    "languages": "languages",
    "certifications": "lines",
    "awards": "lines",
    "publications": "lines",
    "courses": "lines",
}

TAGS_LABEL = {"experience": "Tools", "projects": "Technologies", "volunteering": "Skills", "custom": "Keywords"}


# --------------------------------------------------------------------------- #
# IR
# --------------------------------------------------------------------------- #
@dataclass
class Link:
    text: str
    url: str = ""


@dataclass
class Entry:
    title: str = ""
    subtitle: str = ""
    dates: str = ""
    location: str = ""
    link: Link | None = None
    extra_lines: list[str] = field(default_factory=list)
    description: list[str] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)
    tags_label: str = ""
    tags: str = ""


@dataclass
class Line:
    bold: str
    rest: str = ""
    sub: str = ""
    link: Link | None = None


@dataclass
class Block:
    heading: str
    kind: Literal["paragraphs", "entries", "pairs", "lines"]
    paragraphs: list[str] = field(default_factory=list)
    entries: list[Entry] = field(default_factory=list)
    pairs: list[tuple[str, str]] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)


@dataclass
class RenderDoc:
    template: TemplateSpec
    name: str
    headline: str
    contacts: list[Link]
    details: list[tuple[str, str]]
    blocks: list[Block]
    font: str
    font_size: float
    accent: str
    page_size: str


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
_DATE_RE = re.compile(r"^\s*(\d{4})(?:-(\d{1,2}))?\s*$")


def format_date(value: str, style: str) -> str:
    """'2021-03' -> 'Mar 2021' or '03/2021'; '2021' -> '2021'; free text kept as-is."""
    if not value:
        return ""
    m = _DATE_RE.match(value)
    if not m:
        return value.strip()
    year, month = m.group(1), m.group(2)
    if not month:
        return year
    mi = int(month)
    if not 1 <= mi <= 12:
        return year
    return f"{MONTHS[mi - 1]} {year}" if style == "month_name" else f"{mi:02d}/{year}"


def format_range(item: Item, spec: TemplateSpec) -> str:
    start = format_date(item.startDate, spec.date_style)
    end = spec.present_word if item.current else format_date(item.endDate, spec.date_style)
    if start and end:
        return start if start == end else f"{start} – {end}"
    return start or end


def _clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", (text or "").replace("\r", "")).strip()


def _paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n", (text or "").replace("\r", ""))
    return [" ".join(_clean(line) for line in p.split("\n") if line.strip()) for p in parts if p.strip()]


def _bullets(items: list[str]) -> list[str]:
    out = []
    for b in items:
        b = _clean(re.sub(r"^\s*[-•*▪●◦]\s*", "", b or ""))
        if b:
            out.append(b)
    return out


def _display_url(url: str) -> str:
    return re.sub(r"^(https?://)?(www\.)?", "", url.strip()).rstrip("/")


def _href(url: str) -> str:
    url = url.strip()
    if not url:
        return ""
    if url.startswith(("http://", "https://", "mailto:", "tel:")):
        return url
    return "https://" + url


def heading_for(section: Section, spec: TemplateSpec) -> str:
    return _clean(section.title) or spec.headings.get(section.type, section.type.title())


# --------------------------------------------------------------------------- #
# Builder
# --------------------------------------------------------------------------- #
def _entry_from_item(section: Section, item: Item, spec: TemplateSpec) -> Entry | None:
    if not any([item.title, item.organization, item.description, item.bullets]):
        return None
    e = Entry(
        title=_clean(item.title),
        subtitle=_clean(item.organization),
        dates=format_range(item, spec),
        location=_clean(item.location),
        description=_paragraphs(item.description),
        bullets=_bullets(item.bullets),
    )
    if item.link.strip():
        e.link = Link(_display_url(item.link), _href(item.link))
    if item.grade.strip():
        e.extra_lines.append(_clean(item.grade))
    tags = [t.strip() for t in item.tags if t.strip()]
    if tags:
        e.tags_label = TAGS_LABEL.get(section.type, "Keywords")
        e.tags = ", ".join(tags)
    return e


def _line_from_item(section: Section, item: Item, spec: TemplateSpec) -> Line | None:
    if not item.title.strip():
        return None
    rest = []
    if item.organization.strip():
        rest.append(_clean(item.organization))
    d = format_date(item.date, spec.date_style) if item.date else format_range(item, spec)
    if d:
        rest.append(d)
    line = Line(bold=_clean(item.title), rest=", ".join(rest))
    if item.link.strip():
        line.link = Link(_display_url(item.link), _href(item.link))
    if item.description.strip():
        line.sub = " ".join(_paragraphs(item.description))
    return line


def build_block(section: Section, spec: TemplateSpec) -> Block | None:
    kind = SECTION_KIND.get(section.type, "entries")
    heading = heading_for(section, spec)

    if kind == "text":
        paras = _paragraphs(section.content)
        return Block(heading, "paragraphs", paragraphs=paras) if paras else None

    if kind == "entries":
        entries = [e for it in section.items if (e := _entry_from_item(section, it, spec))]
        return Block(heading, "entries", entries=entries) if entries else None

    if kind == "groups":
        pairs = []
        for it in section.items:
            tags = ", ".join(t.strip() for t in it.tags if t.strip())
            if tags or it.title.strip():
                pairs.append((_clean(it.title), tags))
        return Block(heading, "pairs", pairs=pairs) if pairs else None

    if kind == "languages":
        pairs = [(_clean(it.title), _clean(it.level)) for it in section.items if it.title.strip()]
        return Block(heading, "pairs", pairs=pairs) if pairs else None

    lines = [ln for it in section.items if (ln := _line_from_item(section, it, spec))]
    return Block(heading, "lines", lines=lines) if lines else None


def build_document(cv: CV) -> RenderDoc:
    spec = TEMPLATES.get(cv.design.template, TEMPLATES["international"])
    p = cv.personal

    contacts: list[Link] = []
    if p.location.strip():
        contacts.append(Link(_clean(p.location)))
    if p.phone.strip():
        contacts.append(Link(_clean(p.phone)))
    if p.email.strip():
        contacts.append(Link(p.email.strip(), "mailto:" + p.email.strip()))
    for url in (p.linkedin, p.github, p.website):
        if url.strip():
            contacts.append(Link(_display_url(url), _href(url)))

    details: list[tuple[str, str]] = []
    if spec.show_personal_details:
        for label, value in (
            ("Nationality", p.nationality),
            ("Date of birth", p.dateOfBirth),
            ("Work permit", p.workPermit),
            ("Driving licence", p.drivingLicence),
        ):
            if value.strip():
                details.append((label, _clean(value)))

    blocks = [b for s in cv.sections if s.visible and (b := build_block(s, spec))]

    return RenderDoc(
        template=spec,
        name=_clean(p.fullName),
        headline=_clean(p.headline),
        contacts=contacts,
        details=details,
        blocks=blocks,
        font=cv.design.fontFamily or spec.default_font,
        font_size=cv.design.fontSize,
        accent=cv.design.accentColor,
        page_size=cv.design.pageSize,
    )


def file_stem(cv: CV) -> str:
    name = re.sub(r"[^\w\- ]", "", cv.personal.fullName, flags=re.UNICODE).strip()
    name = re.sub(r"\s+", "_", name)
    return f"{name}_CV" if name else "CV"


def years_of_experience(cv: CV, today: date | None = None) -> float | None:
    """Merged span of all experience items, in years (overlaps counted once)."""
    today = today or date.today()
    spans = []
    for s in cv.sections:
        if s.type != "experience":
            continue
        for it in s.items:
            start = _to_date(it.startDate)
            if not start:
                continue
            end = today if it.current else (_to_date(it.endDate, end=True) or today)
            if end > start:
                spans.append((start, end))
    if not spans:
        return None
    spans.sort()
    total, (cur_s, cur_e) = 0, spans[0]
    for s, e in spans[1:]:
        if s <= cur_e:
            cur_e = max(cur_e, e)
        else:
            total += (cur_e - cur_s).days
            cur_s, cur_e = s, e
    total += (cur_e - cur_s).days
    return round(total / 365.25, 1)


def _to_date(value: str, end: bool = False) -> date | None:
    m = _DATE_RE.match(value or "")
    if not m:
        return None
    y = int(m.group(1))
    mo = int(m.group(2)) if m.group(2) else (12 if end else 1)
    mo = min(max(mo, 1), 12)
    return date(y, mo, 28 if end else 1)
