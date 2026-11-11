#!/usr/bin/env python3
"""Write the non-door task files in tasks/. Edit here, rerun, commit the JSON."""
import itertools
import json
import pathlib
import random

TASKS = pathlib.Path(__file__).resolve().parent.parent / "tasks"


def truth_script(ins, outs, fn, seed=7, extra=2):
    """Every input combination in Gray-code order (one lever at a time), then random jumps (several levers at once)."""
    n = len(ins)
    order = [i ^ (i >> 1) for i in range(2 ** n)]
    rnd = random.Random(seed)
    for _ in range(min(extra * 2 ** n, 32)):
        nxt = rnd.randrange(2 ** n)
        while nxt == order[-1]:
            nxt = rnd.randrange(2 ** n)
        order.append(nxt)
    script, cur = [], None
    for v in order:
        bits = {name: (v >> (n - 1 - i)) & 1 for i, name in enumerate(ins)}
        st = {"set": {k: b for k, b in bits.items() if cur is None or cur[k] != b} if cur else {},
              "expect": dict(zip(outs, fn(*bits.values())))}
        script.append(st)
        cur = bits
    return script


def table_md(ins, outs, fn):
    rows = [" ".join(ins) + " | " + " ".join(outs)]
    for bits in itertools.product((0, 1), repeat=len(ins)):
        rows.append(" ".join(str(b).ljust(len(n)) for b, n in zip(bits, ins)) + " | " +
                    " ".join(str(o).ljust(len(n)) for o, n in zip(fn(*bits), outs)))
    return "\n".join("    " + r for r in rows)


def logic(tid, title, ins, outs, fn, desc, box, timeout=100):
    return {"id": tid, "kind": "circuit", "family": "logic", "title": title, "max_box": box, "inputs": ins, "outputs": outs,
            "timeout_ticks": timeout, "desc": desc + "\n\nTruth table:\n\n" + table_md(ins, outs, fn),
            "test": {"type": "script", "script": truth_script(ins, outs, fn)}}


def pulses(name, outs, values, holds=(20, 40, 20, 60)):
    """A script that switches lever `name` on and off; values[i] are the outputs after the i-th rising edge."""
    script = [{"set": {}, "expect": dict(zip(outs, values[0]))}]
    for i, v in enumerate(values[1:]):
        script.append({"set": {name: 1}, "expect": dict(zip(outs, v)), "hold": holds[i % len(holds)]})
        script.append({"set": {name: 0}, "expect": dict(zip(outs, v)), "hold": holds[(i + 1) % len(holds)]})
    return script


SEG = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg",
       "abcefg", "cdefg", "adef", "bcdeg", "adefg", "aefg"]

tasks = [
    logic("logic_not", "NOT gate", ["A"], ["Q"], lambda a: [1 - a], "Q is on exactly when A is off.", [12, 8, 12]),
    logic("logic_xor", "XOR gate", ["A", "B"], ["Q"], lambda a, b: [a ^ b],
          "Q is on exactly when one of A and B is on, but not both.", [16, 10, 16]),
    logic("logic_full_adder", "Full adder", ["A", "B", "C"], ["S", "K"],
          lambda a, b, c: [(a + b + c) & 1, (a + b + c) >> 1],
          "Add the three input bits. S is the sum bit (on when one or three inputs are on). "
          "K is the carry bit (on when two or three inputs are on).", [20, 12, 20]),
    logic("logic_adder2", "2-bit adder", ["A1", "A0", "B1", "B0"], ["S2", "S1", "S0"],
          lambda a1, a0, b1, b0: [((2 * a1 + a0 + 2 * b1 + b0) >> k) & 1 for k in (2, 1, 0)],
          "A1 A0 and B1 B0 are two 2-bit binary numbers (A1 and B1 are the high bits). "
          "S2 S1 S0 is their sum as a 3-bit number (S2 is the high bit).", [24, 12, 24], 150),
    logic("logic_seg7", "Hex to seven-segment decoder", ["D3", "D2", "D1", "D0"], list("abcdefg"),
          lambda d3, d2, d1, d0: [int(s in SEG[8 * d3 + 4 * d2 + 2 * d1 + d0]) for s in "abcdefg"],
          "D3 D2 D1 D0 is a hex digit (D3 is the high bit). The lamps a..g are the segments of a seven-segment display "
          "(a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle) showing "
          "0 1 2 3 4 5 6 7 8 9 A b C d E F. The lamps do not have to be arranged as a display.", [24, 12, 24], 150),
    {"id": "mem_tff", "kind": "circuit", "family": "memory", "title": "T flip-flop", "max_box": [16, 10, 16],
     "inputs": ["T"], "outputs": ["Q"], "timeout_ticks": 100,
     "desc": "Q starts off. Every time lever T is switched on, Q flips (off to on, on to off) and keeps that value. "
             "Switching T off changes nothing.",
     "test": {"type": "script", "script": pulses("T", ["Q"], [[i % 2] for i in range(7)])}},
    {"id": "mem_rs_latch", "kind": "circuit", "family": "memory", "title": "Set-reset latch", "max_box": [16, 10, 16],
     "inputs": ["S", "R"], "outputs": ["Q"], "timeout_ticks": 100,
     "desc": "Q starts off. Switching S on turns Q on; Q stays on after S is switched off again. Switching R on turns Q off; "
             "Q stays off after R is switched off again. S and R are never on at the same time.",
     "test": {"type": "script", "script": [
         {"set": {}, "expect": {"Q": 0}},
         *[{"set": {k: v}, "expect": {"Q": q}, "hold": h} for k, v, q, h in [
             ("S", 1, 1, 20), ("S", 0, 1, 60), ("S", 1, 1, 20), ("S", 0, 1, 20), ("R", 1, 0, 20), ("R", 0, 0, 60),
             ("R", 1, 0, 20), ("R", 0, 0, 20), ("S", 1, 1, 40), ("S", 0, 1, 20), ("R", 1, 0, 20), ("R", 0, 0, 40),
             ("S", 1, 1, 20), ("S", 0, 1, 20)]]]}},
    {"id": "mem_counter2", "kind": "circuit", "family": "memory", "title": "2-bit counter", "max_box": [24, 12, 24],
     "inputs": ["C"], "outputs": ["Q1", "Q0"], "timeout_ticks": 150,
     "desc": "Q1 Q0 is a 2-bit binary number (Q1 is the high bit) that starts at 0. Every time lever C is switched on, "
             "the number goes up by one: 0, 1, 2, 3, then back to 0. Switching C off changes nothing.",
     "test": {"type": "script", "script": pulses("C", ["Q1", "Q0"], [[(i % 4) >> 1, i % 2] for i in range(10)])}},
]
for period in (20, 120):
    tasks.append({
        "id": f"time_clock{period}", "kind": "circuit", "family": "timing", "title": f"{period}-tick clock",
        "max_box": [24, 12, 24], "inputs": ["E"], "outputs": ["Q"], "test": {"type": "clock", "period": period, "cycles": 2},
        "desc": f"While lever E is off, Q is off. While E is on, Q blinks: it turns on once every {period} game ticks, exactly. "
                "How long it stays lit each time is up to you."})
tasks.append({
    "id": "time_pulse30", "kind": "circuit", "family": "timing", "title": "30-tick pulse", "max_box": [24, 12, 24],
    "inputs": ["E"], "outputs": ["Q"], "test": {"type": "pulse", "length": 30, "max_delay": 40, "quiet": 60, "cycles": 3},
    "desc": "When lever E is switched on (and left on), Q lights up once for exactly 30 game ticks, then goes dark and stays "
            "dark. Switching E off must not light Q."})
for n in (2, 3):
    x, z, y0, box = 6, 6, 10, [13, 16, 13]
    col = [[x, y0 + i, z] for i in range(n)]
    keep = [[[0, y0, 0], [x - 1, box[1] - 1, box[2] - 1]], [[x + 1, y0, 0], [box[0] - 1, box[1] - 1, box[2] - 1]],
            [[x, y0, 0], [x, box[1] - 1, z - 1]], [[x, y0, z + 1], [x, box[1] - 1, box[2] - 1]],
            [[x, y0 + n, z], [x, box[1] - 1, z]]]
    tasks.append({
        "id": f"mech_extender{n}", "kind": "extender", "family": "mechanical",
        "title": f"{'Double' if n == 2 else 'Triple'} piston extender", "max_box": box, "opening": col, "closed_cells": [col[-1]],
        "keep_air": keep, "floor_y": y0, "reach": n, "timeout_ticks": 300, "cycles": 3})

for t in tasks:
    (TASKS / f"{t['id']}.json").write_text(json.dumps(t, indent=1) + "\n")
    print(t["id"], len(t.get("test", {}).get("script", [])) or "")
