"""Contact sheets: tiny PNG writer/reader glue + a 5x7 bitmap font for labels (no PIL dependency)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import List, Sequence, Tuple

import numpy as np

# 5x7 glyphs, rows top->bottom, '#' = ink.
_FONT_SRC = {
    'a': ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
    'b': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
    'c': ['.....', '.....', '.###.', '#....', '#....', '#....', '.###.'],
    'd': ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
    'e': ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
    'f': ['..##.', '.#...', '####.', '.#...', '.#...', '.#...', '.#...'],
    'g': ['.....', '.####', '#...#', '#...#', '.####', '....#', '.###.'],
    'h': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
    'i': ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
    'j': ['...#.', '.....', '..##.', '...#.', '...#.', '#..#.', '.##..'],
    'k': ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
    'l': ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'm': ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
    'n': ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
    'o': ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
    'p': ['.....', '####.', '#...#', '#...#', '####.', '#....', '#....'],
    'q': ['.....', '.####', '#...#', '#...#', '.####', '....#', '....#'],
    'r': ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
    's': ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
    't': ['.#...', '.#...', '####.', '.#...', '.#...', '.#..#', '..##.'],
    'u': ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
    'v': ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'w': ['.....', '.....', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
    'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    'y': ['.....', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
    'z': ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    ' ': ['.....'] * 7,
    'k_': ['.....'] * 7,
}
_FONT = {k: np.array([[c == '#' for c in row] for row in v], dtype=bool) for k, v in _FONT_SRC.items()}


def draw_text(img: np.ndarray, text: str, x: int, y: int, scale: int = 1,
              color: Tuple[float, float, float] = (0.92, 0.89, 0.8)) -> None:
    """Draw lower-case text into an (H, W, 3) float image, top-left at (x, y)."""
    h, w = img.shape[:2]
    cx = x
    for ch in text.lower():
        g = _FONT.get(ch, _FONT[' '])
        gh, gw = g.shape
        for r in range(gh):
            for c in range(gw):
                if g[r, c]:
                    y0, x0 = y + r * scale, cx + c * scale
                    if 0 <= y0 < h - scale + 1 and 0 <= x0 < w - scale + 1:
                        img[y0:y0 + scale, x0:x0 + scale, :3] = color
        cx += (gw + 1) * scale


def text_width(text: str, scale: int = 1) -> int:
    return len(text) * 6 * scale


def write_png(path: Path, img: np.ndarray) -> None:
    """Write an (H, W, 3|4) float [0,1] (sRGB-encoded) image as 8-bit PNG."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    a = np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)
    h, w, ch = a.shape
    color_type = 6 if ch == 4 else 2
    raw = b''.join(b'\x00' + a[r].tobytes() for r in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, color_type, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.write_bytes(png)


def load_png(path: Path) -> np.ndarray:
    """Load a PNG via bpy (byte images expose raw sRGB values as floats). Returns (H, W, 3) top-down."""
    import bpy
    im = bpy.data.images.load(str(path), check_existing=False)
    try:
        w, h = im.size
        buf = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(buf)
        arr = buf.reshape(h, w, 4)[::-1, :, :3].copy()
    finally:
        bpy.data.images.remove(im)
    return arr


def contact_sheet(tiles: Sequence[Tuple[str, Path]], out: Path, cols: int = 8, tile: int = 192,
                  title: str = '') -> None:
    label_h = 18
    title_h = 22 if title else 0
    rows = max(1, (len(tiles) + cols - 1) // cols)
    W = cols * tile
    H = title_h + rows * (tile + label_h)
    sheet = np.zeros((H, W, 3), dtype=np.float32)
    sheet[:] = (0.114, 0.090, 0.149)  # night plum
    if title:
        draw_text(sheet, title, 6, 6, 2)
    for i, (label, p) in enumerate(tiles):
        r, c = divmod(i, cols)
        x0, y0 = c * tile, title_h + r * (tile + label_h)
        try:
            img = load_png(p)
        except Exception:  # missing preview -> leave a dark tile with the label
            img = np.full((tile, tile, 3), 0.17, dtype=np.float32)
        ih, iw = img.shape[:2]
        if (ih, iw) != (tile, tile):
            ys = (np.arange(tile) * ih / tile).astype(int)
            xs = (np.arange(tile) * iw / tile).astype(int)
            img = img[ys][:, xs]
        sheet[y0:y0 + tile, x0:x0 + tile] = img
        scale = 2 if text_width(label, 2) <= tile - 6 else 1
        tx = x0 + max(2, (tile - text_width(label, scale)) // 2)
        draw_text(sheet, label, tx, y0 + tile + (label_h - 7 * scale) // 2, scale)
    write_png(out, sheet)
