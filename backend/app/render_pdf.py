"""Text-based, single-column PDF renderer (ReportLab).

No images, no text-as-graphics: every character lives in the PDF text layer
with an embedded TrueType font, so ATS parsers and copy/paste both work.
"""

from __future__ import annotations

import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .fonts import resolve_font
from .layout import Block, Entry, Line, Link, RenderDoc

MUTED = colors.HexColor("#444444")


def _e(text: str) -> str:
    return escape(text or "")


def _link(link: Link, color: str | None = None) -> str:
    if not link.url:
        return _e(link.text)
    href = escape(link.url, {'"': "&quot;"})
    c = f' color="{color}"' if color else ""
    return f'<a href="{href}"{c}>{_e(link.text)}</a>'


class _Styles:
    def __init__(self, doc: RenderDoc):
        font = resolve_font(doc.font).family
        fs = doc.font_size
        accent = colors.HexColor(doc.accent)
        centered = doc.template.entry_style == "title_first"
        self.accent_hex = doc.accent
        self.body = ParagraphStyle("body", fontName=font, fontSize=fs, leading=fs * 1.28, textColor=colors.black)
        self.name = ParagraphStyle(
            "name", parent=self.body, fontSize=fs * 2.1, leading=fs * 2.5,
            alignment=TA_CENTER if centered else TA_LEFT,
        )
        self.headline = ParagraphStyle(
            "headline", parent=self.body, fontSize=fs * 1.15, leading=fs * 1.5, textColor=accent,
            alignment=self.name.alignment,
        )
        self.contact = ParagraphStyle(
            "contact", parent=self.body, fontSize=fs * 0.95, leading=fs * 1.3, textColor=MUTED,
            alignment=self.name.alignment,
        )
        self.heading = ParagraphStyle(
            "heading", parent=self.body, fontSize=fs * 1.1, leading=fs * 1.35, textColor=accent,
            spaceBefore=fs * 1.0, spaceAfter=1, keepWithNext=1,
        )
        self.entry_title = ParagraphStyle("entry_title", parent=self.body, keepWithNext=1)
        self.dates = ParagraphStyle("dates", parent=self.body, alignment=TA_RIGHT)
        self.meta = ParagraphStyle("meta", parent=self.body, textColor=MUTED, keepWithNext=1)
        self.bullet = ParagraphStyle("bullet", parent=self.body)
        self.sub = ParagraphStyle("sub", parent=self.body, fontSize=fs * 0.95, leading=fs * 1.22, textColor=MUTED, leftIndent=8)


def _entry_flowables(e: Entry, st: _Styles, width: float, dates_first: bool) -> list:
    out: list = []
    title_html = f"<b>{_e(e.title)}</b>" if e.title else ""
    org_loc = " – ".join(x for x in (_e(e.subtitle), _e(e.location)) if x)

    if dates_first:
        meta = " | ".join(x for x in (_e(e.dates), _e(e.location)) if x)
        if meta:
            out.append(Paragraph(meta, st.meta))
        line = " – ".join(x for x in (title_html, _e(e.subtitle)) if x)
        if line:
            out.append(Paragraph(line, st.entry_title))
    else:
        left = Paragraph(title_html or _e(e.subtitle), st.entry_title)
        if e.dates:
            t = Table([[left, Paragraph(_e(e.dates), st.dates)]], colWidths=[width * 0.7, width * 0.3])
            t.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            t.keepWithNext = True
            out.append(t)
        else:
            out.append(left)
        if title_html and org_loc:
            out.append(Paragraph(org_loc, st.meta))

    if e.link:
        out.append(Paragraph(_link(e.link, st.accent_hex), st.meta))
    for extra in e.extra_lines:
        out.append(Paragraph(_e(extra), st.body))
    for para in e.description:
        out.append(Paragraph(_e(para), st.body))
    if e.bullets:
        out.append(
            ListFlowable(
                [ListItem(Paragraph(_e(b), st.bullet), leftIndent=12) for b in e.bullets],
                bulletType="bullet", start="•", leftIndent=12, bulletFontSize=st.body.fontSize,
                bulletFontName=st.body.fontName,
            )
        )
    if e.tags:
        out.append(Paragraph(f"<b>{_e(e.tags_label)}:</b> {_e(e.tags)}", st.body))
    out.append(Spacer(1, st.body.fontSize * 0.55))
    # keep the header with at least its first line of content
    head_len = min(len(out), 3)
    return [KeepTogether(out[:head_len])] + out[head_len:]


def _line_flowables(ln: Line, st: _Styles) -> list:
    html = f"<b>{_e(ln.bold)}</b>"
    if ln.rest:
        html += f" – {_e(ln.rest)}"
    if ln.link:
        html += f" | {_link(ln.link, st.accent_hex)}"
    out = [Paragraph(html, st.body)]
    if ln.sub:
        out.append(Paragraph(_e(ln.sub), st.sub))
    out.append(Spacer(1, 2))
    return out


def _block_flowables(b: Block, st: _Styles, width: float, dates_first: bool) -> list:
    out: list = [
        Paragraph(f"<b>{_e(b.heading.upper())}</b>", st.heading),
        HRFlowable(width="100%", thickness=0.6, color=st.heading.textColor, spaceBefore=1, spaceAfter=4),
    ]
    if b.kind == "paragraphs":
        for p in b.paragraphs:
            out.append(Paragraph(_e(p), st.body))
            out.append(Spacer(1, 3))
    elif b.kind == "entries":
        for e in b.entries:
            out.extend(_entry_flowables(e, st, width, dates_first))
    elif b.kind == "pairs":
        for label, value in b.pairs:
            html = f"<b>{_e(label)}:</b> {_e(value)}" if label and value else _e(label or value)
            out.append(Paragraph(html, st.body))
            out.append(Spacer(1, 1.5))
    elif b.kind == "lines":
        for ln in b.lines:
            out.extend(_line_flowables(ln, st))
    return out


def render_pdf(doc: RenderDoc) -> tuple[bytes, int]:
    """Return (pdf_bytes, page_count)."""
    buf = io.BytesIO()
    pagesize = LETTER if doc.page_size == "Letter" else A4
    margin_x, margin_y = 17 * mm, 14 * mm
    pdf = SimpleDocTemplate(
        buf,
        pagesize=pagesize,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=margin_y,
        bottomMargin=margin_y,
        title=f"{doc.name} – CV" if doc.name else "CV",
        author=doc.name or "",
        subject="Curriculum Vitae",
        creator="CV Builder",
    )
    width = pdf.width - 12  # Frame has 6pt padding on each side
    st = _Styles(doc)
    dates_first = doc.template.entry_style == "dates_first"

    story: list = []
    if doc.name:
        story.append(Paragraph(f"<b>{_e(doc.name)}</b>", st.name))
    if doc.headline:
        story.append(Paragraph(_e(doc.headline), st.headline))
    if doc.contacts:
        story.append(Paragraph(" | ".join(_link(c) for c in doc.contacts), st.contact))
    if doc.details:
        story.append(
            Paragraph(" | ".join(f"<b>{_e(k)}:</b> {_e(v)}" for k, v in doc.details), st.contact)
        )
    story.append(Spacer(1, 4))

    for block in doc.blocks:
        story.extend(_block_flowables(block, st, width, dates_first))

    if len(story) == 1:  # nothing filled in yet
        story.append(Paragraph("Start filling in your details to see the preview.", st.meta))

    pdf.build(story)
    return buf.getvalue(), pdf.page
