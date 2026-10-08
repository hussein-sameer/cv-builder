import io
import json
import zipfile
from pathlib import Path

import pytest
from docx import Document
from pypdf import PdfReader

from app.layout import build_document, format_date, years_of_experience
from app.models import CV

SAMPLE = json.loads((Path(__file__).parent / "sample_cv.json").read_text())


def _cv(template="international") -> dict:
    data = json.loads(json.dumps(SAMPLE))
    data["design"]["template"] = template
    return data


@pytest.mark.parametrize("template", ["international", "europass"])
def test_pdf_is_text_based_and_complete(client, template):
    r = client.post("/api/export/pdf", json=_cv(template))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-page-count"] == "1"
    assert "Alex_Morgan_CV.pdf" in r.headers["content-disposition"]
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
    for needle in ("Alex Morgan", "alex.morgan@example.com", "Northwind Fibre",
                   "cutting mean time to repair by 30%", "Python, Kafka", "German"):
        assert needle in text
    assert "Hidden section" not in text  # invisible sections are skipped
    if template == "europass":
        assert "WORK EXPERIENCE" in text and "Nationality" in text and "03/2021" in text
    else:
        assert "EXPERIENCE" in text and "Nationality" not in text and "Mar 2021" in text


@pytest.mark.parametrize("template", ["international", "europass"])
def test_docx_is_ats_safe(client, template):
    r = client.post("/api/export/docx", json=_cv(template))
    assert r.status_code == 200
    doc = Document(io.BytesIO(r.content))
    assert len(doc.tables) == 0, "ATS-safe DOCX must not use tables"
    for s in doc.sections:  # nothing hidden in header/footer
        assert not any(p.text.strip() for p in s.header.paragraphs)
        assert not any(p.text.strip() for p in s.footer.paragraphs)
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        xml = z.read("word/document.xml").decode()
    assert "txbxContent" not in xml and "<w:drawing" not in xml  # no text boxes / images
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Alex Morgan" in text and "Northwind Fibre" in text
    headings = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
    assert headings[0] in ("PROFESSIONAL SUMMARY", "PROFILE")
    bullets = [p.text for p in doc.paragraphs if p.style.name == "List Bullet"]
    assert len(bullets) == 5
    assert "alex.morgan@example.com" in xml  # hyperlinked text still in the body


def test_custom_heading_and_order():
    data = _cv()
    data["sections"][1]["title"] = "Career History"
    data["sections"].insert(0, data["sections"].pop(3))  # skills first
    doc = build_document(CV.model_validate(data))
    assert [b.heading for b in doc.blocks][:2] == ["Skills", "Professional Summary"]
    assert "Career History" in [b.heading for b in doc.blocks]


def test_empty_cv_renders(client):
    r = client.post("/api/export/pdf", json={})
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    r = client.post("/api/export/docx", json={"sections": [{"type": "custom", "items": [{}]}]})
    assert r.status_code == 200


def test_unicode_text_survives(client):
    data = _cv()
    data["personal"]["fullName"] = "Zoë Łukasiewicz-Müller"
    r = client.post("/api/export/pdf", json=data)
    text = PdfReader(io.BytesIO(r.content)).pages[0].extract_text()
    assert "Zoë Łukasiewicz-Müller" in text


def test_validation_rejects_bad_template(client):
    data = _cv()
    data["design"]["template"] = "fancy-two-column"
    assert client.post("/api/export/pdf", json=data).status_code == 422


def test_dates_and_years():
    assert format_date("2021-03", "month_name") == "Mar 2021"
    assert format_date("2021-03", "numeric") == "03/2021"
    assert format_date("2021", "numeric") == "2021"
    assert format_date("Summer 2020", "numeric") == "Summer 2020"
    from datetime import date
    yrs = years_of_experience(CV.model_validate(SAMPLE), today=date(2026, 3, 1))
    assert 8.0 <= yrs <= 8.3


def test_meta_and_health(client):
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert {t["key"] for t in meta["templates"]} == {"international", "europass"}


def test_exports_require_login(anon):
    assert anon.post("/api/export/pdf", json=_cv()).status_code == 401
    assert anon.post("/api/export/docx", json=_cv()).status_code == 401
