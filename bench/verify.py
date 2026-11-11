#!/usr/bin/env python3
"""Verify a redstone submission against real vanilla Minecraft.

usage: verify.py <task.json> <submission.json> [--capture]

Task kinds (task["kind"], default "door"):
  door      one lever; lever off = every doorway cell air, lever on = every doorway cell a door block
  extender  like door, but only task["closed_cells"] must hold a door block when on, and
            task["keep_air"] boxes must stay empty at every tick
  circuit   named levers in, named redstone lamps out; task["test"] is a script, clock or pulse test
Submission: {"blocks": [{"pos":[x,y,z], "state":"minecraft:..."}], "input":[x,y,z]}            (door, extender)
            {"blocks": [...], "inputs": {"A":[x,y,z]}, "outputs": {"Q":[x,y,z]}}               (circuit)
All coordinates are local to the build box (0..max_box-1).
"""
import fcntl
import json
import pathlib
import re
import sys
import time

import circuit
from rcon import Rcon

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = (0, 100, 0)
REF_DY = 80              # an always-air copy of the arena, used for "is this region air"
LEVER_DY = 40            # a copy holding only the lever, so the lever does not count toward volume
MARGIN = 3               # air shell watched around the build box
STABLE_TICKS = 40        # door must hold its state this long to count
MAX_BLOCKS = 4000
BANNED = re.compile(
    r"command_block|structure_block|structure_void|jigsaw|barrier|spawner|portal|end_gateway|"
    r"bedrock|:light|test_block|test_instance_block|moving_piston|vault|"
    r"reinforced_deepslate|budding_amethyst|:air|_air\b"
)
STATE_RE = re.compile(r"^minecraft:[a-z0-9_]+(\[[a-z0-9_=,]+\])?$")
FLAGS = [  # (id regex, state test, label when it matches)
    (r"^(sticky_)?piston$", "extended=true", "extended"),
    (r"^redstone_wire$", "power=0", "unpowered"),
    (r"^(repeater|comparator|observer|lever|.*_button|.*rail|dropper|dispenser|note_block|target)$", "powered=true", "powered"),
    (r"^(redstone_torch|redstone_wall_torch|redstone_lamp)$", "lit=true", "lit"),
]


class Arena:
    def __init__(self, rc, box):
        self.rc, self.box = rc, box

    def w(self, p, dy=0):
        return f"{BASE[0] + p[0]} {BASE[1] + p[1] + dy} {BASE[2] + p[2]}"

    def gametime(self):
        return int(re.search(r"(\d+)", self.rc.cmd("time query gametime")).group(1))

    def step(self, n=1):
        t0 = self.gametime()
        self.rc.cmd(f"tick step {n}")
        while self.gametime() < t0 + n:
            pass
        if n == 1 and getattr(self, "on_tick", None):
            self.on_tick()

    def passed(self, command):
        return self.rc.cmd(command).startswith("Test passed")

    def setup(self):
        rc = self.rc
        rc.cmd("tick rate 10000")
        rc.cmd("tick freeze")
        rc.cmd(f"forceload add {BASE[0] - 8} {BASE[2] - 8} {BASE[0] + self.box[0] + 8} {BASE[2] + self.box[2] + 8}")
        self.clear()
        self.step(30)   # flush scheduled ticks and block events left by an earlier build
        self.clear()

    def nudge(self, p):
        """Send a block update to every neighbour of cell p, by cloning p onto itself. Pistons and observers are
        left alone: re-setting one mid-move breaks it, and neither passes power on to its neighbours anyway."""
        w = self.w(p)
        self.rc.cmd(f"execute unless block {w} minecraft:piston unless block {w} minecraft:sticky_piston "
                    f"unless block {w} minecraft:piston_head unless block {w} minecraft:moving_piston "
                    f"unless block {w} minecraft:observer unless block {w} minecraft:air run clone {w} {w} {w} replace force")

    def set_lever(self, pos, state, dy=0):
        """/setblock only updates the lever's own neighbours. A real flip also updates the neighbours of the
        block the lever is mounted on (so that block's strong power is noticed); do that too."""
        self.rc.cmd(f"setblock {self.w(pos, dy)} {state}")
        if dy:
            return
        face = (re.search(r"face=(\w+)", state) or [0, "wall"])[1]
        facing = (re.search(r"facing=(\w+)", state) or [0, "north"])[1]
        d = {"floor": (0, -1, 0), "ceiling": (0, 1, 0)}.get(face) or \
            {"north": (0, 0, 1), "south": (0, 0, -1), "east": (-1, 0, 0), "west": (1, 0, 0)}[facing]
        self.nudge([pos[i] + d[i] for i in range(3)])

    def clear(self):
        m = MARGIN + 2
        a = [-m, -m, -m]
        b = [self.box[0] + m, self.box[1] + m, self.box[2] + m]
        for _ in range(2):  # twice: breaking blocks can drop items or leave piston halves
            self.rc.cmd(f"fill {self.w(a)} {self.w(b)} minecraft:air")
            self.rc.cmd(f"fill {self.w(a, LEVER_DY)} {self.w(b, LEVER_DY)} minecraft:air")
            self.rc.cmd("kill @e[type=!minecraft:player]")

    def entity_count(self):
        m = re.search(r"count: (\d+)", self.rc.cmd("execute if entity @e[type=!minecraft:player]"))
        return int(m.group(1)) if m else 0

    def is_air(self, a, b):
        return self.passed(f"execute if blocks {self.w(a)} {self.w(b)} {self.w(a, REF_DY)} all")

    def grow_to_fit(self, lo, hi):
        """Expand the box lo..hi until the cells just outside it are air.
        Returns False if something reached past the build box."""
        m = MARGIN
        whole_a = [lo[i] - m for i in range(3)]
        while True:
            cmd, slabs = "execute", []
            for axis in range(3):
                for side in (0, 1):
                    a = [lo[i] - m for i in range(3)]
                    b = [hi[i] + m for i in range(3)]
                    if side == 0:
                        b[axis] = lo[axis] - 1
                    else:
                        a[axis] = hi[axis] + 1
                    slabs.append((axis, side, a, b))
                    cmd += f" if blocks {self.w(a)} {self.w(b)} {self.w(a, LEVER_DY)} all"
            if self.passed(cmd):
                return True
            for axis, side, a, b in slabs:
                if not self.passed(f"execute if blocks {self.w(a)} {self.w(b)} {self.w(a, LEVER_DY)} all"):
                    if side == 0:
                        lo[axis] -= 1
                    else:
                        hi[axis] += 1
            if any(lo[i] < 0 or hi[i] >= self.box[i] for i in range(3)):
                return False

    def snapshot(self, lo, hi, ids):
        """List of 'x,y,z id (flags)' for every non-air cell in lo..hi."""
        out = []
        for y in range(lo[1], hi[1] + 1):
            for z in range(lo[2], hi[2] + 1):
                if self.is_air([lo[0], y, z], [hi[0], y, z]):
                    continue
                for x in range(lo[0], hi[0] + 1):
                    p = [x, y, z]
                    if self.passed(f"execute if block {self.w(p)} minecraft:air"):
                        continue
                    name = "?"
                    for i in ids:
                        if self.passed(f"execute if block {self.w(p)} minecraft:{i}"):
                            name = i
                            break
                    for pat, test, label in FLAGS:
                        if re.match(pat, name) and self.passed(f"execute if block {self.w(p)} minecraft:{name}[{test}]"):
                            name += f" ({label})"
                    out.append(f"{x},{y},{z} {name}")
        return out


PROPS = {k: v[0] for k, v in json.loads((pathlib.Path(__file__).parent / "blocks.json").read_text()).items()}


def moving_state(arena, w):
    """The block a moving_piston cell is carrying, from its block entity."""
    out = arena.rc.cmd(f"data get block {w}")
    m = re.search(r'blockState: "([^"]+)"', out)
    if m:
        return m.group(1)
    m = re.search(r'blockState: \{id: "([^"]+)"(?:, properties: \{([^}]*)\})?', out)
    if not m:
        return None
    kv = re.findall(r'(\w+): "([^"]*)"', m.group(2) or "")
    return m.group(1) + (f"[{','.join(f'{k}={v}' for k, v in kv)}]" if kv else "")


def full_states(arena, lo, hi, ids, extra=(), cache=None):
    """Exact block state of every non-air cell in lo..hi (plus `extra` cells), found by probing each property.
    `cache` (cell -> last state) makes repeated calls cheap: an unchanged cell costs one command."""
    cache = {} if cache is None else cache
    out, todo = [], []
    for y in range(lo[1], hi[1] + 1):
        for z in range(lo[2], hi[2] + 1):
            if not arena.is_air([lo[0], y, z], [hi[0], y, z]):
                todo += [[x, y, z] for x in range(lo[0], hi[0] + 1)]
    todo += [list(p) for p in extra if list(p) not in todo]
    for p in todo:
        w, key = arena.w(p), tuple(p)
        last = cache.get(key)
        if last and arena.passed(f"execute if block {w} {last}"):
            out.append({"pos": p, "state": last})
            continue
        cache.pop(key, None)
        if arena.passed(f"execute if block {w} minecraft:air"):
            continue
        name = next((i for i in ids if arena.passed(f"execute if block {w} minecraft:{i}")), None)
        if name is None:
            continue
        if name == "moving_piston":
            st = moving_state(arena, w)
            if st:
                out.append({"pos": p, "state": st, "moving": True})
            continue
        props = {}
        for k, vals in PROPS.get(name, {}).items():
            props[k] = next((v for v in vals[:-1] if arena.passed(f"execute if block {w} minecraft:{name}[{k}={v}]")), vals[-1])
        st = f"minecraft:{name}" + (f"[{','.join(f'{k}={v}' for k, v in props.items())}]" if props else "")
        cache[key] = st
        out.append({"pos": p, "state": st})
    return out


def door_state(arena, opening, closed_cells):
    """'open' if every doorway cell is air, 'closed' if every closed cell is a door block, else 'moving'."""
    if arena.passed("execute" + "".join(f" if block {arena.w(p)} minecraft:air" for p in opening)):
        return "open"
    if arena.passed("execute" + "".join(f" if block {arena.w(p)} #rsb:door" for p in closed_cells)):
        return "closed"
    return "moving"


def doorway_report(arena, opening):
    rep = []
    for p in opening:
        if arena.passed(f"execute if block {arena.w(p)} minecraft:air"):
            s = "air"
        elif arena.passed(f"execute if block {arena.w(p)} #rsb:door"):
            s = "door block"
        else:
            s = "other block (not air, not an allowed door block)"
        rep.append(f"{p[0]},{p[1]},{p[2]} {s}")
    return rep


def run_until(arena, opening, closed_cells, want, timeout, lo, hi, stats):
    """Step ticks until the door holds `want` for STABLE_TICKS. Returns ticks or None."""
    reached, held = None, 0
    for t in range(1, timeout + STABLE_TICKS + 1):
        arena.step(1)
        stats["max_entities"] = max(stats["max_entities"], arena.entity_count())
        if not all(arena.is_air(a, b) for a, b in stats["walkway"]):
            stats["walkway_blocked"] = True
            return None
        if not arena.grow_to_fit(lo, hi):
            stats["left_box"] = True
            return None
        if door_state(arena, opening, closed_cells) == want:
            if reached is None:
                reached = t
            held += 1
            if held >= STABLE_TICKS:
                return reached
        else:
            reached, held = None, 0
    return None


def lever_states(state):
    lever = re.sub(r"powered=(true|false),?", "", state).replace(",]", "]").replace("[]", "")
    off = lever.replace("[", "[powered=false,") if "[" in lever else lever + "[powered=false]"
    return off, off.replace("powered=false", "powered=true")


def pos_of(v):
    try:
        p = tuple(int(x) for x in v)
        return p if len(p) == 3 else ()
    except Exception:
        return ()


def verify(task, sub, capture=False, record=False):
    """capture=True also records the world at rest (res["states"]) for rendering.
    record=True also records the exact world every tick (res["frames"]): one open/close cycle for a door,
    the whole test for a circuit. Each frame is {"blocks": [...], "event": optional label}."""
    t_start = time.time()
    kind = task.get("kind", "door")
    res = {"task": task["id"], "valid": False, "errors": []}
    err = res["errors"].append
    box = task["max_box"]
    blocks = sub.get("blocks") if isinstance(sub, dict) else None
    if not isinstance(blocks, list) or not blocks:
        err("submission needs a non-empty 'blocks' list")
        return res
    if len(blocks) > MAX_BLOCKS:
        err("too many blocks")
        return res
    doorish = kind in ("door", "extender")
    words = {"open": "open", "closed": "closed", "thing": "door", "zone": "the walkway in front of or behind the doorway"}
    if kind == "extender":
        words = {"open": "retracted", "closed": "extended", "thing": "extender", "zone": "the zone that must stay empty"}
    opening, closed_cells, keep, start = [], [], [], "open"
    if doorish:
        opening = [list(p) for p in task["opening"]]
        closed_cells = [list(p) for p in task.get("closed_cells", opening)]
        start = sub.get("start", "open")
        if start not in ("open", "closed"):
            err('"start" must be "open" or "closed"')
            return res
        if "keep_air" in task:
            keep = [(list(a), list(b)) for a, b in task["keep_air"]]
        else:
            ox, oy, oz = ([o[i] for o in opening] for i in range(3))
            if oz[0] > 0:
                keep.append(([min(ox), min(oy), 0], [max(ox), max(oy), oz[0] - 1]))
            if oz[0] < box[2] - 1:
                keep.append(([min(ox), min(oy), oz[0] + 1], [max(ox), max(oy), box[2] - 1]))
    cells = {}
    for b in blocks:
        try:
            p, s = tuple(int(v) for v in b["pos"]), str(b["state"])
            assert len(p) == 3
        except Exception:
            err(f"bad block entry: {json.dumps(b)[:80]}")
            continue
        if not all(0 <= p[i] < box[i] for i in range(3)):
            err(f"block outside build box: {list(p)}")
        if not STATE_RE.match(s) or BANNED.search(s):
            err(f"block not allowed or badly formed: {s[:60]}")
        if p in cells:
            err(f"duplicate position: {list(p)}")
        if list(p) in opening and start != "closed":
            err(f"block placed inside the {'doorway' if kind == 'door' else 'column'}, but the build starts {words['open']}: {list(p)}")
        if any(all(a[i] <= p[i] <= b2[i] for i in range(3)) for a, b2 in keep):
            err(f"block in {words['zone']}: {list(p)}")
        cells[p] = s
    ins, outs, inp = {}, {}, ()
    if doorish:
        inp = pos_of(sub.get("input", ()))
        if not cells.get(inp, "").startswith("minecraft:lever"):
            err("input must be the position of a minecraft:lever block in your list")
    else:
        for label, names, want, into in (("inputs", task["inputs"], "minecraft:lever", ins),
                                         ("outputs", task["outputs"], "minecraft:redstone_lamp", outs)):
            given = sub.get(label)
            if not isinstance(given, dict) or sorted(given) != sorted(names):
                err(f'"{label}" must be an object with exactly these names: {", ".join(names)}')
                continue
            for n in names:
                p = pos_of(given[n])
                if not cells.get(p, "").startswith(want):
                    err(f"{label}.{n} must be the position of a {want} block in your list")
                elif p in into.values():
                    err(f"{label}.{n} uses a position already used by another name")
                into[n] = p
    back = {"north": (0, 0, 1), "south": (0, 0, -1), "east": (-1, 0, 0), "west": (1, 0, 0), "up": (0, -1, 0), "down": (0, 1, 0)}
    for p, s in cells.items():
        if "piston_head" in s:
            f = re.search(r"facing=(\w+)", s)
            d = back.get(f.group(1)) if f else None
            base = cells.get((p[0] + d[0], p[1] + d[1], p[2] + d[2]), "") if d else ""
            if not (re.match(r"minecraft:(sticky_)?piston\[", base) and "extended=true" in base and f"facing={f.group(1)}" in base):
                err(f"piston head without its extended piston behind it: {list(p)}")
    if res["errors"]:
        del res["errors"][20:]
        return res

    body = [p for p in cells if p != inp]  # a door's lever does not count toward volume
    lo = [min([p[i] for p in body] + [p[i] for p in opening]) for i in range(3)]
    hi = [max([p[i] for p in body] + [p[i] for p in opening]) for i in range(3)]
    res["block_count"] = len(cells)
    ids = []
    for s in cells.values():
        i = s.split("[")[0].split(":")[1]
        if i not in ids:
            ids.append(i)
    ids = ["piston_head", "moving_piston"] + ids

    lock = open("/tmp/redstone-bench.lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    rc = Rcon(password=(ROOT / ".rcon_password").read_text().strip())
    arena = Arena(rc, box)
    arena.setup()
    states, frames, fcache, pending = {}, [], {}, []
    MAX_FRAMES = 1500

    def grab():
        if len(frames) < MAX_FRAMES:
            f = {"blocks": full_states(arena, lo, hi, ids + ["lever"], [inp] if inp else [], fcache)}
            if pending:
                f["event"] = pending.pop()
            frames.append(f)

    def shot(label):
        if capture and label not in states:
            states[label] = full_states(arena, lo, hi, ids + ["lever"], [inp] if inp else [])

    def fail(msg):
        err(msg)
        if doorish:
            res["doorway_now"] = doorway_report(arena, opening)
        res["world_now"] = arena.snapshot(lo, hi, ids)

    def place():
        for p, s in cells.items():
            out = rc.cmd(f"setblock {arena.w(p)} {s}" + (" strict" if sub.get("placement") == "raw" else ""))
            if "Changed the block" not in out:
                err(f"setblock failed at {list(p)} for {s}: {out[:160]}")
        del res["errors"][20:]
        return not res["errors"]

    def finish(**extra):
        dims = [hi[i] - lo[i] + 1 for i in range(3)]
        res.update(valid=True, dims=dims, volume=dims[0] * dims[1] * dims[2], box_min=lo, box_max=hi, **extra)

    try:
        if not doorish:
            levers = {n: lever_states(cells[p]) for n, p in ins.items()}
            for n, p in ins.items():
                cells[p] = levers[n][0]
            if not place():
                return res
            stats = {"max_entities": 0}
            bench = circuit.Bench(arena, ins, outs, levers, lo, hi, stats)
            if record:
                bench.on_set = lambda name, v: pending.append(f"{name} {'on' if v else 'off'}")
                grab()
                arena.on_tick = grab
            try:
                delay = circuit.RUNNERS[task["test"]["type"]](bench, task)
            except circuit.Fail as e:
                fail(str(e))
                return res
            shot("rest")
            finish(delay_ticks=delay, tiebreak=delay, max_entities=stats["max_entities"], ticks_run=bench.ticks)
            return res

        lever_off, lever_on = lever_states(cells[inp])
        cells[inp] = lever_on if start == "closed" else lever_off

        def flip(state):
            arena.set_lever(inp, state)
            arena.set_lever(inp, state, LEVER_DY)

        rc.cmd(f"setblock {arena.w(inp, LEVER_DY)} {cells[inp]}")
        if not place():
            return res
        stats = {"max_entities": 0, "left_box": False, "walkway": keep, "walkway_blocked": False}
        timeout = task.get("timeout_ticks", 400)

        def phase(want, label):
            t = run_until(arena, opening, closed_cells, want, timeout, lo, hi, stats)
            if stats["walkway_blocked"]:
                fail(f"{label}: a block entered {words['zone']}")
            elif stats["left_box"]:
                fail(f"{label}: something moved outside the build box")
            elif t is None:
                fail(f"{label}: {words['thing']} did not become {words[want]} and stay {words[want]} for {STABLE_TICKS} ticks "
                     f"within {timeout} ticks")
            else:
                shot(words[want])
            return t

        if start == "closed":
            if phase("closed", "start (lever on)") is None:
                return res
            flip(lever_off)
            if phase("open", f"first {'opening' if kind == 'door' else 'retraction'}") is None:
                return res
        elif phase("open", "start (lever off)") is None:
            return res
        close_t, open_t = [], []
        for cycle in range(1, task.get("cycles", 3) + 1):
            if record:
                if cycle == 1:
                    grab()
                    arena.on_tick = grab
                else:
                    arena.on_tick = None
            pending.append("lever on")
            flip(lever_on)
            t = phase("closed", f"cycle {cycle}, lever on")
            if t is None:
                return res
            close_t.append(t)
            pending.append("lever off")
            flip(lever_off)
            t = phase("open", f"cycle {cycle}, lever off")
            if t is None:
                return res
            open_t.append(t)
        finish(close_ticks=max(close_t), open_ticks=max(open_t), tiebreak=max(close_t) + max(open_t),
               max_entities=stats["max_entities"])
        return res
    finally:
        if states:
            res["states"] = states
        if frames:
            res["frames"] = frames
        res["verify_seconds"] = round(time.time() - t_start, 2)
        arena.clear()
        rc.close()
        lock.close()


def main():
    task = json.loads(pathlib.Path(sys.argv[1]).read_text())
    sub = json.loads(pathlib.Path(sys.argv[2]).read_text())
    res = verify(task, sub, capture="--capture" in sys.argv)
    print(json.dumps(res, indent=1))
    sys.exit(0 if res["valid"] else 1)


if __name__ == "__main__":
    main()
