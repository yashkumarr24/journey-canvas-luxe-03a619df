"""Read a DOCX with the standard library only: paragraphs, tables, images.

Blocks are returned in document order so section headings stay attached to
the paragraphs/tables that follow them. Text is preserved verbatim (only
whitespace inside a paragraph is collapsed).
"""

from __future__ import annotations

import hashlib
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
TXBX = W + "txbxContent"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".emf", ".wmf", ".tif", ".tiff"}


@dataclass
class Paragraph:
    text: str
    style: str = ""
    bold: bool = False

    @property
    def is_heading_like(self) -> bool:
        return self.style.lower().startswith(("heading", "title")) or (
            self.bold and 0 < len(self.text) <= 80
        )


@dataclass
class Table:
    rows: list[list[str]]


@dataclass
class DocImage:
    name: str
    data: bytes
    sha256: str

    @property
    def ext(self) -> str:
        return Path(self.name).suffix.lower()


@dataclass
class DocxContent:
    filename: str
    checksum: str
    blocks: list[Paragraph | Table] = field(default_factory=list)
    images: list[DocImage] = field(default_factory=list)


def _walk(el: ET.Element, skip_textboxes: bool = False):
    """Depth-first walk that skips mc:Fallback (a duplicate rendering of the
    same content) and, optionally, text boxes (read as their own paragraphs)."""
    for child in el:
        if child.tag == MC + "Fallback" or (skip_textboxes and child.tag == TXBX):
            continue
        yield child
        yield from _walk(child, skip_textboxes)


def _para(p: ET.Element) -> Paragraph:
    parts: list[str] = []
    bold_chars = 0
    total_chars = 0
    for node in _walk(p, skip_textboxes=True):
        if node.tag == W + "t" and node.text:
            parts.append(node.text)
        elif node.tag in (W + "tab",):
            parts.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            parts.append("\n")
    for r in (n for n in _walk(p, skip_textboxes=True) if n.tag == W + "r"):
        txt = "".join(t.text or "" for t in r.iter(W + "t"))
        total_chars += len(txt.strip())
        rpr = r.find(W + "rPr")
        if rpr is not None and rpr.find(W + "b") is not None:
            b = rpr.find(W + "b")
            if b.get(W + "val") not in ("0", "false"):
                bold_chars += len(txt.strip())
    style_el = p.find(f"{W}pPr/{W}pStyle")
    style = style_el.get(W + "val", "") if style_el is not None else ""
    text = "\n".join(re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in "".join(parts).split("\n"))
    return Paragraph(text=text.strip(), style=style, bold=total_chars > 0 and bold_chars == total_chars)


def _table(t: ET.Element) -> Table:
    rows: list[list[str]] = []
    for tr in t.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            paras = [n for n in _walk(tc) if n.tag == W + "p"]
            cells.append("\n".join(x for x in (_para(p).text for p in paras) if x))
        rows.append(cells)
    return Table(rows=rows)


def _collect(container: ET.Element, out: list[Paragraph | Table]) -> None:
    """Body-level blocks in order, descending into content controls (w:sdt)
    and emitting text-box paragraphs right after their anchor paragraph."""
    for child in container:
        if child.tag == W + "p":
            para = _para(child)
            if para.text:
                out.append(para)
            for box in (n for n in _walk(child) if n.tag == TXBX):
                _collect(box, out)
        elif child.tag == W + "tbl":
            tbl = _table(child)
            if any(any(c for c in r) for r in tbl.rows):
                out.append(tbl)
        elif child.tag in (W + "sdt", W + "sdtContent", W + "customXml", MC + "AlternateContent", MC + "Choice"):
            _collect(child, out)


def read_docx(path: Path) -> DocxContent:
    raw = path.read_bytes()
    content = DocxContent(filename=path.name, checksum=hashlib.sha256(raw).hexdigest())
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
        body = root.find(W + "body")
        if body is not None:
            _collect(body, content.blocks)
        for name in sorted(z.namelist()):
            if name.startswith("word/media/") and Path(name).suffix.lower() in IMAGE_EXT:
                data = z.read(name)
                content.images.append(
                    DocImage(name=Path(name).name, data=data, sha256=hashlib.sha256(data).hexdigest())
                )
    return content
