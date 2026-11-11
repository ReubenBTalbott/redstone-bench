#!/usr/bin/env python3
"""Convert a redstonepedia design file (vjeux/redstonepedia, MIT) into a submission.

usage: import_redstonepedia.py <design.txt> <task.json> <out.json>
Their files rest closed with the lever on; layers are y, rows inside a layer are z, columns are x.
"""
import json
import re
import sys

src, task, out = sys.argv[1:4]
opening = json.load(open(task))["opening"]
omin = [min(p[i] for p in opening) for i in range(3)]
door, origin, palette, blocks, lever, y, z, mode = None, [0, 0, 0], {}, [], None, None, 0, None
for line in open(src):
    line = line.rstrip("\n")
    if not line.strip() or line.startswith("#"):
        continue
    if m := re.match(r"port door: (-?\d+) (-?\d+) (-?\d+)", line):
        door = [int(v) for v in m.groups()]
    elif m := re.match(r"origin: (-?\d+) (-?\d+) (-?\d+)", line):
        origin = [int(v) for v in m.groups()]
    elif line.startswith("palette:"):
        mode = "palette"
    elif m := re.match(r"layer (-?\d+):", line):
        y, z, mode = int(m.group(1)), 0, "layer"
    elif mode == "palette" and (m := re.match(r"\s+(\S) (minecraft:\S+)", line)):
        palette[m.group(1)] = m.group(2)
    elif mode == "layer" and line.startswith("  "):
        for i, ch in enumerate(line[2:]):
            if ch in palette:
                pos = [origin[0] + i - door[0] + omin[0], y - door[1] + omin[1], origin[2] + z - door[2] + omin[2]]
                blocks.append({"pos": pos, "state": palette[ch]})
                if palette[ch].startswith("minecraft:lever"):
                    lever = pos
        z += 1
json.dump({"start": "closed", "placement": "raw", "blocks": blocks, "input": lever}, open(out, "w"), indent=1)
print(len(blocks), "blocks, lever at", lever)
