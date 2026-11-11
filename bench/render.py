#!/usr/bin/env python3
"""Draw a build as an isometric picture.

usage: render.py <task.json> <submission.json> <out.png>      (draws the blocks as placed)
From the runner: render_run() draws each captured resting state of a run's best build.
"""
import json
import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont

S = 4           # supersample
U = 30 * S      # half-width of a cube on screen
COLORS = [  # first match wins: (id regex, colour, height 0..1, inset 0..0.5)
    (r"^sticky_piston$", (120, 170, 80), 1, 0), (r"^piston$", (150, 135, 105), 1, 0),
    (r"^piston_head$", (200, 180, 130), 1, 0.25), (r"^moving_piston$", (230, 200, 120), 1, 0.1),
    (r"^redstone_wire$", (200, 30, 30), 0.08, 0.1), (r"^redstone_block$", (170, 20, 20), 1, 0),
    (r"redstone_(wall_)?torch$", (240, 90, 40), 0.6, 0.38), (r"^repeater$", (215, 150, 150), 0.15, 0.05),
    (r"^comparator$", (240, 190, 190), 0.15, 0.05), (r"^observer$", (60, 70, 110), 1, 0),
    (r"^redstone_lamp$", (190, 160, 60), 1, 0), (r"^lever$", (110, 80, 50), 0.5, 0.35),
    (r"^slime_block$", (120, 200, 110), 1, 0), (r"^honey_block$", (240, 170, 40), 1, 0),
    (r"copper_bulb", (200, 120, 80), 1, 0), (r"^target$", (235, 200, 200), 1, 0),
    (r"^note_block$", (150, 95, 165), 1, 0), (r"^(dropper|dispenser|hopper)$", (90, 150, 160), 1, 0),
    (r"glass", (190, 225, 235), 1, 0), (r"_slab$|carpet|pressure_plate|rail", (160, 160, 160), 0.5, 0),
]
LIT = {"redstone_lamp": (255, 215, 90), "redstone_wire": (255, 60, 60), "copper_bulb": (255, 200, 120)}
PLAIN = (165, 168, 172)


def style(name, flags):
    for pat, col, h, inset in COLORS:
        if re.search(pat, name):
            if name in LIT and ("lit" in flags or (name == "redstone_wire" and "unpowered" not in flags)):
                col = LIT[name]
            if name == "redstone_wire" and "unpowered" in flags:
                col = (110, 20, 20)
            if "torch" in name and "lit" not in flags:
                col = (110, 50, 30)
            return col, h, inset
    return PLAIN, 1, 0


def label_of(name):
    for pat, *_ in COLORS:
        if re.search(pat, name):
            return {"redstone_(wall_)?torch$": "redstone torch"}.get(pat, name.replace("_", " "))
    return "solid block"


def parse_state(entries):
    if entries and isinstance(entries[0], dict):
        return from_submission({"blocks": entries})
    cells = {}
    for e in entries:
        m = re.match(r"(-?\d+),(-?\d+),(-?\d+) (\S+)(.*)", e)
        cells[(int(m[1]), int(m[2]), int(m[3]))] = (m[4], m[5])
    return cells


def from_submission(sub):
    cells = {}
    for b in sub["blocks"]:
        s = b["state"].split(":", 1)[1]
        name, _, props = s.partition("[")
        flags = " ".join(f for f, k in (("lit", "lit=true"), ("powered", "powered=true"), ("extended", "extended=true")) if k in props)
        if name == "redstone_wire" and "power=" not in props.replace("power=0", ""):
            flags += " unpowered"
        if "torch" in name and "lit=false" not in props:
            flags += " lit"
        cells[tuple(b["pos"])] = (name, flags)
    return cells


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def draw(cells, targets, path, caption="", target_name="empty target cell"):
    pts = list(cells) + [tuple(t) for t in targets]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]

    def proj(x, y, z):  # x runs down-right, z down-left, y up
        return ((x - z) * U, (x + z) * U * 0.5 - y * U * 1.1)

    corners = [proj(x, y, z) for x in (lo[0], hi[0] + 1) for y in (lo[1], hi[1] + 1) for z in (lo[2], hi[2] + 1)]
    names = []
    for n, f in cells.values():
        lab = label_of(n)
        col = style(n, f)[0]
        if lab not in [x[0] for x in names]:
            names.append((lab, col))
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15 * S)
    pad, row = 26 * S, 24 * S
    minx, maxx = min(c[0] for c in corners), max(c[0] for c in corners)
    miny, maxy = min(c[1] for c in corners), max(c[1] for c in corners)
    legend_w = int(max(font.getlength(n) for n in [x[0] for x in names] + [caption, target_name]) + 40 * S)
    W = int(maxx - minx + 2 * pad + legend_w + pad)
    H = int(max(maxy - miny + 2 * pad, (len(names) + 3) * row + 2 * pad))
    img = Image.new("RGB", (W, H), (246, 244, 238))
    d = ImageDraw.Draw(img, "RGBA")
    ox, oy = pad - minx, pad - miny + (H - 2 * pad - (maxy - miny)) / 2

    def P(x, y, z):
        px, py = proj(x, y, z)
        return (px + ox, py + oy)

    def cube(x, y, z, col, h=1.0, inset=0.0, outline=(40, 40, 40, 255), fill=True):
        a, b = inset, 1 - inset
        top = [P(x + a, y + h, z + a), P(x + b, y + h, z + a), P(x + b, y + h, z + b), P(x + a, y + h, z + b)]
        left = [P(x + a, y + h, z + b), P(x + b, y + h, z + b), P(x + b, y, z + b), P(x + a, y, z + b)]
        right = [P(x + b, y + h, z + a), P(x + b, y + h, z + b), P(x + b, y, z + b), P(x + b, y, z + a)]
        for poly, k in ((left, 0.78), (right, 0.6), (top, 1.0)):
            d.polygon(poly, fill=shade(col, k) + (255,) if fill else None, outline=outline, width=S)

    empty = [tuple(t) for t in targets if tuple(t) not in cells]
    for p in sorted(cells, key=lambda p: (p[0] + p[2] + p[1], p[1])):
        col, h, inset = style(*cells[p])
        cube(*p, col, h, inset)
    for x, y, z in empty:   # the front face of each empty target cell, drawn over the build
        d.polygon([P(x, y + 1, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x, y, z + 1)],
                  fill=(30, 110, 200, 45), outline=(30, 110, 200, 255), width=S)
    if empty:
        names.append((target_name, None))
    lx = W - legend_w - pad
    y = pad
    if caption:
        d.text((lx, y - 1 * S), caption, fill=(28, 28, 26), font=font)
        y += int(row * 1.5)
    for n, col in names:
        d.rectangle([lx, y, lx + 16 * S, y + 16 * S], fill=col, outline=(40, 40, 40) if col else (30, 110, 200), width=S)
        d.text((lx + 26 * S, y - 1 * S), n, fill=(28, 28, 26), font=font)
        y += row
    img = img.resize((W // S, H // S), Image.LANCZOS)
    img.save(path)


def targets_of(task):
    return task.get("opening", [])


def describe(task, label):
    kind = task.get("kind", "door")
    what = task.get("title") or task["id"].split("_")[1] + " piston door"
    tn = {"door": "open doorway", "extender": "empty column"}.get(kind, "")
    return f"{what}, {label}" if label not in ("rest", "placed") else what, tn


def render_run(out, task, sub, states, prefix="best"):
    out = pathlib.Path(out)
    made = []
    placed = from_submission(sub)
    if not states:
        states = {"placed": None}
    for label, entries in states.items():
        cells = parse_state(entries) if entries is not None else dict(placed)
        lever = tuple(sub.get("input", ()))
        if lever in placed and lever not in cells:   # a door's lever sits outside the measured box
            cells[lever] = placed[lever]
        cap, tn = describe(task, label)
        f = out / f"{prefix}_{label}.png"
        draw(cells, targets_of(task), f, cap, tn)
        made.append(f.name)
    return made


if __name__ == "__main__":
    task = json.loads(pathlib.Path(sys.argv[1]).read_text())
    sub = json.loads(pathlib.Path(sys.argv[2]).read_text())
    draw(from_submission(sub), targets_of(task), sys.argv[3], *describe(task, "placed"))
