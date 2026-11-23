"""把 rich 的 ANSI 终端输出渲染成 PNG：按字符网格绘制，中英文与框线严格对齐。"""

from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont
from rich.console import Console

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
CJK_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

SGR = re.compile(r"\x1b\[([0-9;]*)m")
OTHER_CSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

DEFAULT_FG = (222, 222, 222)
DEFAULT_BG = (30, 30, 30)


@dataclass
class Style:
    fg: tuple[int, int, int] = DEFAULT_FG
    bg: tuple[int, int, int] | None = None
    bold: bool = False


def is_wide(ch: str) -> bool:
    return unicodedata.east_asian_width(ch) in ("W", "F")


def render(ansi: str, size: int = 22, padding: int = 26) -> Image.Image:
    cell_w = int(size * 0.602)  # DejaVu Sans Mono 的 ASCII 步进
    line_h = int(size * 1.42)
    baseline = int(size * 1.06)

    fonts = {
        False: (ImageFont.truetype(MONO, size), ImageFont.truetype(CJK, size, index=0)),
        True: (ImageFont.truetype(MONO_BOLD, size), ImageFont.truetype(CJK_BOLD, size, index=0)),
    }

    # 先切行，保留每行末尾样式（rich 已把行补齐到终端宽度）
    lines = ansi.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    columns = max(
        sum(2 if is_wide(ch) else 1 for ch in OTHER_CSI.sub("", SGR.sub("", line))) for line in lines
    )
    width = columns * cell_w + padding * 2
    height = len(lines) * line_h + padding * 2

    image = Image.new("RGB", (width, height), DEFAULT_BG)
    draw = ImageDraw.Draw(image)
    style = Style()

    for row, raw in enumerate(lines):
        y = padding + row * line_h
        x = padding
        style = Style()

        index = 0
        for match in SGR.finditer(raw):
            chunk = raw[index : match.start()]
            x = draw_chunk(draw, chunk, x, y, cell_w, line_h, baseline, fonts, style, image)
            index = match.end()
            apply_sgr(style, match.group(1))
        draw_chunk(draw, raw[index:], x, y, cell_w, line_h, baseline, fonts, style, image)

    return image


def draw_chunk(draw, chunk, x, y, cell_w, line_h, baseline, fonts, style, image):
    chunk = OTHER_CSI.sub("", chunk)
    mono, cjk = fonts[style.bold]
    for ch in chunk:
        if ch == "\t":
            ch = " "
        width = 2 if is_wide(ch) else 1
        if style.bg:
            draw.rectangle([x, y, x + width * cell_w - 1, y + line_h - 1], fill=style.bg)
        if ch.strip():
            font = cjk if is_wide(ch) else mono
            # 统一基线对齐：下划线、逗号等标点才能落在正确位置
            glyph_w = font.getbbox(ch)[2] - font.getbbox(ch)[0]
            offset = max(0, (width * cell_w - glyph_w) // 2)
            draw.text((x + offset, y + baseline), ch, font=font, fill=style.fg, anchor="ls")
        x += width * cell_w
    return x


def apply_sgr(style: Style, params: str) -> None:
    codes = [int(part) if part.isdigit() else 0 for part in params.split(";")] if params else [0]
    i = 0
    while i < len(codes):
        code = codes[i]
        if code == 0:
            style.fg, style.bg, style.bold = DEFAULT_FG, None, False
        elif code == 1:
            style.bold = True
        elif code == 22:
            style.bold = False
        elif code == 39:
            style.fg = DEFAULT_FG
        elif code == 49:
            style.bg = None
        elif code in (38, 48) and i + 1 < len(codes):
            if codes[i + 1] == 2 and i + 4 < len(codes):
                color = (codes[i + 2], codes[i + 3], codes[i + 4])
                if code == 38:
                    style.fg = color
                else:
                    style.bg = color
                i += 4
            elif codes[i + 1] == 5 and i + 2 < len(codes):
                index = codes[i + 2]
                palette = (0, 0, 0) if index == 0 else (255, 255, 255)
                if code == 38:
                    style.fg = palette
                else:
                    style.bg = palette
                i += 2
        i += 1


def capture(renderable, width: int = 112, height: int = 36) -> str:
    buffer = io.StringIO()
    console = Console(
        file=buffer,
        force_terminal=True,
        color_system="truecolor",
        width=width,
        height=height,
        highlight=False,
        legacy_windows=False,
    )
    console.print(renderable)
    return buffer.getvalue()
