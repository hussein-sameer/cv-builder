"""Locate TrueType fonts for the PDF renderer.

PDFs must embed real fonts so the text layer is extractable (ATS) and
non-ASCII characters render. We look for the Microsoft font first, then a
metric-compatible open font (Carlito ≈ Calibri, Liberation ≈ Arial/Times,
Caladea ≈ Cambria), then DejaVu, and finally ReportLab's built-in Helvetica.

Extra font folders can be added with PDF_FONT_DIRS (os.pathsep separated).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from reportlab.lib.fonts import addMapping
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

STYLES = ("regular", "bold", "italic", "bolditalic")

# family -> list of candidate file sets (regular, bold, italic, bolditalic)
CANDIDATES: dict[str, list[tuple[str, str, str, str]]] = {
    "Calibri": [
        ("calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"),
        ("Carlito-Regular.ttf", "Carlito-Bold.ttf", "Carlito-Italic.ttf", "Carlito-BoldItalic.ttf"),
    ],
    "Arial": [
        ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
        ("Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf", "Arial Bold Italic.ttf"),
        ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"),
    ],
    "Cambria": [
        ("Caladea-Regular.ttf", "Caladea-Bold.ttf", "Caladea-Italic.ttf", "Caladea-BoldItalic.ttf"),
    ],
    "Times New Roman": [
        ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"),
        ("Times New Roman.ttf", "Times New Roman Bold.ttf", "Times New Roman Italic.ttf", "Times New Roman Bold Italic.ttf"),
        ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-BoldItalic.ttf"),
    ],
    "Georgia": [
        ("georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"),
        ("Georgia.ttf", "Georgia Bold.ttf", "Georgia Italic.ttf", "Georgia Bold Italic.ttf"),
        ("Gelasio-Regular.ttf", "Gelasio-Bold.ttf", "Gelasio-Italic.ttf", "Gelasio-BoldItalic.ttf"),
    ],
}
SANS_FALLBACK = [
    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"),
    ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"),
]
SERIF_FAMILIES = {"Cambria", "Times New Roman", "Georgia"}
SERIF_FALLBACK = [
    ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-BoldItalic.ttf"),
    ("DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf"),
]


def _search_dirs() -> list[Path]:
    home = Path.home()
    dirs = [Path(__file__).parent / "fonts"]
    dirs += [Path(p) for p in os.environ.get("PDF_FONT_DIRS", "").split(os.pathsep) if p]
    dirs += [
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        home / ".fonts",
        home / ".local/share/fonts",
        Path("/Library/Fonts"),
        Path("/System/Library/Fonts"),
        home / "Library/Fonts",
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
    ]
    if os.environ.get("LOCALAPPDATA"):
        dirs.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft/Windows/Fonts")
    return [d for d in dirs if d.is_dir()]


@lru_cache(maxsize=1)
def _font_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for d in _search_dirs():
        for root, _dirs, files in os.walk(d):
            for f in files:
                if f.lower().endswith(".ttf"):
                    index.setdefault(f.lower(), os.path.join(root, f))
    return index


@dataclass(frozen=True)
class ResolvedFont:
    family: str  # registered ReportLab family name
    source: str  # human readable: which files were used
    embedded: bool


def _find_set(candidates: list[tuple[str, str, str, str]]) -> tuple[str, ...] | None:
    idx = _font_index()
    for names in candidates:
        paths = [idx.get(n.lower()) for n in names]
        if paths[0] and paths[1]:  # regular + bold are required; italics fall back
            regular, bold = paths[0], paths[1]
            italic = paths[2] or regular
            bolditalic = paths[3] or bold
            return (regular, bold, italic, bolditalic)
    return None


@lru_cache(maxsize=16)
def resolve_font(family: str) -> ResolvedFont:
    serif = family in SERIF_FAMILIES
    chain = CANDIDATES.get(family, []) + (SERIF_FALLBACK if serif else []) + SANS_FALLBACK
    found = _find_set(chain)
    if not found:
        return ResolvedFont("Times-Roman" if serif else "Helvetica", "built-in (Latin-1 only)", False)

    reg_name = "CV-" + Path(found[0]).stem
    names = [reg_name + s for s in ("", "-B", "-I", "-BI")]
    for name, path in zip(names, found):
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, path))
    addMapping(reg_name, 0, 0, names[0])
    addMapping(reg_name, 1, 0, names[1])
    addMapping(reg_name, 0, 1, names[2])
    addMapping(reg_name, 1, 1, names[3])
    return ResolvedFont(reg_name, Path(found[0]).name, True)


def font_report() -> dict[str, str]:
    return {fam: resolve_font(fam).source for fam in CANDIDATES}
