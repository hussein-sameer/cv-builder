"""Pydantic schema for a CV document.

The frontend and backend share this shape. Every section stores generic
items whose meaning depends on the section ``type`` (see ``layout.SECTION_TYPES``),
which keeps "add any section on demand" simple on both sides.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TemplateKey = Literal["international", "europass"]
PageSize = Literal["A4", "Letter"]
FontFamily = Literal["Calibri", "Arial", "Cambria", "Times New Roman", "Georgia"]

SectionType = Literal[
    "summary",
    "experience",
    "education",
    "skills",
    "languages",
    "certifications",
    "projects",
    "volunteering",
    "awards",
    "publications",
    "courses",
    "interests",
    "references",
    "custom",
    "customText",
]

_S = Field(default="", max_length=5000)


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class Personal(_Base):
    fullName: str = Field(default="", max_length=200)
    headline: str = Field(default="", max_length=300)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=100)
    location: str = Field(default="", max_length=200)
    linkedin: str = Field(default="", max_length=300)
    github: str = Field(default="", max_length=300)
    website: str = Field(default="", max_length=300)
    # EU-style personal details (rendered by the EU layout only)
    nationality: str = Field(default="", max_length=200)
    dateOfBirth: str = Field(default="", max_length=50)
    workPermit: str = Field(default="", max_length=300)
    drivingLicence: str = Field(default="", max_length=100)
    # Optional photo as a data URL (the editor sends a ~50 KB 7:9 JPEG). Printed top right in both layouts.
    photo: str = Field(default="", max_length=1_500_000, pattern=r"^(data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2})?$")


class Item(_Base):
    """A generic section entry. Unused fields stay empty."""

    id: str = ""
    title: str = _S  # job title / degree / project / certificate / language / skill group
    organization: str = _S  # company / institution / issuer / role context
    location: str = _S
    startDate: str = Field(default="", max_length=20)  # "YYYY" or "YYYY-MM"
    endDate: str = Field(default="", max_length=20)
    current: bool = False
    date: str = Field(default="", max_length=20)  # single date (certifications, awards...)
    description: str = _S
    bullets: list[str] = Field(default_factory=list, max_length=60)
    tags: list[str] = Field(default_factory=list, max_length=120)  # tools / skills in group
    grade: str = Field(default="", max_length=300)
    link: str = Field(default="", max_length=500)
    level: str = Field(default="", max_length=100)  # language level


class Section(_Base):
    id: str = ""
    type: SectionType
    title: str = Field(default="", max_length=120)  # empty = template default heading
    visible: bool = True
    content: str = Field(default="", max_length=10000)  # for text sections
    items: list[Item] = Field(default_factory=list, max_length=100)


class Design(_Base):
    template: TemplateKey = "international"
    fontFamily: FontFamily | None = None  # None = template default
    fontSize: float = Field(default=10.5, ge=8, le=13)
    accentColor: str = Field(default="#1F3864", pattern=r"^#[0-9a-fA-F]{6}$")
    pageSize: PageSize = "A4"


class Target(_Base):
    role: str = Field(default="", max_length=300)
    jobDescription: str = Field(default="", max_length=20000)


class CV(_Base):
    personal: Personal = Field(default_factory=Personal)
    sections: list[Section] = Field(default_factory=list, max_length=40)
    design: Design = Field(default_factory=Design)
    target: Target = Field(default_factory=Target)
