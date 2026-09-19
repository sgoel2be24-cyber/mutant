#!/usr/bin/env python3
"""Post-pass for the Mutant deck.

Fixes what python-pptx inherits from the light default theme (near-black title,
subtitle, footer and table text on dark slides; table banding overriding custom
fills), sets explicit type sizes, then runs a WRAPPING-aware fit check and a
bounds check. PowerPoint-visible bugs are cheaper to catch here than in front of
a judge.

Usage: python3 scripts/deck_postpass.py deck.pptx
"""
from __future__ import annotations

import math
import sys
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Pt
from pptx.oxml.ns import qn

FG = RGBColor(0xE8, 0xEC, 0xF6)
MUTED = RGBColor(0x8C, 0x95, 0xAD)
ACCENT = RGBColor(0x6E, 0xE7, 0xB7)
HEADER_BG = RGBColor(0x0F, 0x3B, 0x31)
CELL_BG = RGBColor(0x13, 0x17, 0x22)

TITLE_PT = 28.0
BODY_PT = 13.5
SUB_PT = 14.5
# average glyph advance as a fraction of point size for the theme's sans face
CHAR_W = 0.50
LINE_H = 1.22
EMU_PER_PT = 12700
INSET_PT = 12.0  # text frame left+right insets


def recolor(frame, color, size=None, bold=None) -> int:
    n = 0
    for para in frame.paragraphs:
        for run in para.runs:
            run.font.color.rgb = color
            if size is not None:
                run.font.size = Pt(size)
            if bold is not None:
                run.font.bold = bold
            n += 1
    return n


def strip_table_style(table) -> None:
    tblPr = table._tbl.find(qn("a:tblPr"))
    if tblPr is None:
        return
    for child in list(tblPr):
        if child.tag == qn("a:tableStyleId"):
            tblPr.remove(child)
    tblPr.set("bandRow", "0")
    tblPr.set("firstRow", "1")


def fits(shape, texts: list[tuple[str, float]], box_w_pt: float, box_h_pt: float) -> bool:
    """Estimate wrapped height of all paragraphs against the box height."""
    if box_w_pt <= 0 or box_h_pt <= 0:
        return True
    avail = max(box_w_pt - INSET_PT, 20.0)
    total = 0.0
    for text, size in texts:
        if not text:
            total += size * LINE_H
            continue
        width_pt = len(text) * size * CHAR_W
        lines = max(1, math.ceil(width_pt / avail))
        total += lines * size * LINE_H
    return total <= box_h_pt * 1.02


def main(path: str) -> int:
    prs = Presentation(path)
    W, H = prs.slide_width, prs.slide_height
    report: list[str] = []
    counts = {"titles": 0, "body": 0, "cells": 0}

    for idx, slide in enumerate(prs.slides, start=1):
        is_title_layout = slide.slide_layout.name.lower().startswith("title slide")
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            frame = shape.text_frame
            is_title = slide.shapes.title is not None and shape == slide.shapes.title
            is_sub = is_title_layout and shape.placeholder_format.idx == 1
            if is_title:
                counts["titles"] += recolor(frame, FG, TITLE_PT, True)
            elif is_sub:
                recolor(frame, MUTED, SUB_PT, False)
            else:
                # body: preserve per-bullet emphasis by only forcing size+colour
                counts["body"] += recolor(frame, FG, BODY_PT, None)

            # wrapping-aware fit check
            box_w_pt = (shape.width or 0) / EMU_PER_PT
            box_h_pt = (shape.height or 0) / EMU_PER_PT
            paras = []
            for para in frame.paragraphs:
                text = "".join(run.text for run in para.runs)
                size = next(
                    (r.font.size.pt for r in para.runs if r.font.size),
                    BODY_PT,
                )
                paras.append((text, size))
            if not fits(shape, paras, box_w_pt, box_h_pt):
                longest = max(paras, key=lambda p: len(p[0]))[0] if paras else ""
                report.append(
                    f"slide {idx}: LIKELY OVERFLOW in {box_w_pt:.0f}x{box_h_pt:.0f}pt box "
                    f"({len(paras)} paragraphs): {longest[:60]}..."
                )

        # tables: graphic frames have no text frame, so style them separately
        for shape in slide.shapes:
            if not getattr(shape, "has_table", False):
                continue
            table = shape.table
            strip_table_style(table)
            for r, row in enumerate(table.rows):
                for c, cell in enumerate(row.cells):
                    is_header = r == 0
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = HEADER_BG if is_header else CELL_BG
                    for para in cell.text_frame.paragraphs:
                        for run in para.runs:
                            run.font.size = Pt(11.5 if is_header else 11)
                            run.font.bold = is_header
                            run.font.color.rgb = ACCENT if is_header else FG
                            counts["cells"] += 1

        for shape in slide.shapes:
            if shape.left is None or shape.top is None:
                continue
            right = shape.left + (shape.width or 0)
            bottom = shape.top + (shape.height or 0)
            if shape.left < 0 or shape.top < 0 or right > W or bottom > H:
                report.append(f"slide {idx}: OUT OF BOUNDS shape r={right} b={bottom}")

    prs.save(path)
    print(f"styled: {counts['titles']} title runs, {counts['body']} body runs, {counts['cells']} table cells")
    print("\n".join(report) if report else "geometry: clean - all shapes in bounds, no overflow predicted")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "deck.pptx"))
