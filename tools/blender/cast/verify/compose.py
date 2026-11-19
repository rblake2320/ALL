#!/usr/bin/env python3
"""Compose verify_cast.py panels into one labelled review sheet per body (system python3 + PIL).

    python3 tools/blender/cast/verify/compose.py DIR [id ...]
"""
import json
import os
import sys

from PIL import Image, ImageDraw

PANELS = [('1door', 'door 2.10 m + classic'), ('2face', 'face 3/4'), ('3back', 'back 3/4'), ('5sit', 'sit (seat 0.46)'),
          ('6sitEat', 'sitEat + plate/fork'), ('8cook', 'cook (counter 0.92)'), ('9hug', 'hug pair (1 m)')]
WIDE = [('4walk', 'walk 0/25/50/75 %'), ('7sleep', 'sleep (bed 0.42)')]


def sheet(d, bid, metrics):
    tiles = []
    for key, label in PANELS + WIDE:
        p = os.path.join(d, f'{bid}_{key}.png')
        if os.path.exists(p):
            im = Image.open(p).convert('RGB')
            im = im.resize((int(im.width * 300 / im.height), 300))
            dr = ImageDraw.Draw(im)
            dr.rectangle([0, 0, im.width, 16], fill=(0, 0, 0))
            dr.text((4, 2), label, fill=(255, 255, 255))
            tiles.append(im)
    rows, row, w = [], [], 0
    for t in tiles:
        if w + t.width > 2000 and row:
            rows.append(row); row, w = [], 0
        row.append(t); w += t.width
    rows.append(row)
    W = max(sum(t.width for t in r) for r in rows)
    out = Image.new('RGB', (W, 300 * len(rows) + 22), (20, 20, 24))
    y = 22
    for r in rows:
        x = 0
        for t in r:
            out.paste(t, (x, y)); x += t.width
        y += 300
    ImageDraw.Draw(out).text((6, 4), bid, fill=(255, 255, 160))
    out.save(os.path.join(d, f'review_{bid}.png'))


def main():
    d = sys.argv[1]
    mp = os.path.join(d, 'metrics.json')
    m = json.load(open(mp)) if os.path.exists(mp) else {}
    ids = sys.argv[2:] or [k for k in m if not k.startswith('_')]
    for bid in ids:
        sheet(d, bid, m.get(bid))


if __name__ == '__main__':
    main()
