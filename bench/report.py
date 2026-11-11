#!/usr/bin/env python3
"""Collect every run into runs/summary.json and docs/RESULTS.md.   usage: report.py"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def known():
    """Best sizes we know of per task: human record, seed, my hand-made baseline."""
    f = ROOT / "baselines/scores.json"
    out = json.loads(f.read_text()) if f.exists() else {}
    return out


def main():
    rows = []
    for f in sorted((ROOT / "runs").glob("[!_]*/*/result.json")):
        r = json.loads(f.read_text())
        rs = f.parent / "rescored.json"       # verdicts under the current verifier, if the run predates a fix
        b = (json.loads(rs.read_text())["best"] if rs.exists() else r.get("best")) or {}
        u = r.get("usage") or {}
        rows.append({
            "task": r["task"], "family": r.get("family", "door"), "config": f.parent.parent.name,
            "volume": b.get("volume"), "dims": b.get("dims"),
            "ticks": b.get("tiebreak", (b.get("close_ticks", 0) + b.get("open_ticks", 0)) if b else None),
            "entities": b.get("max_entities"), "calls": r.get("verifier_calls"), "budget": r.get("budget"),
            "valid_calls": r.get("valid_calls", sum(1 for x in r.get("attempt_log", []) if x.get("valid"))),
            "seconds": r.get("seconds"), "seconds_to_first_valid": r.get("seconds_to_first_valid"),
            "seconds_to_best": r.get("seconds_to_best"), "ended": r.get("ended"),
            "input_tokens": u.get("input_tokens"), "cached_input_tokens": u.get("cached_input_tokens"),
            "output_tokens": u.get("output_tokens"), "rescored": rs.exists(), "dir": str(f.parent.relative_to(ROOT)),
        })
    (ROOT / "runs/summary.json").write_text(json.dumps(rows, indent=1))
    k = known()
    lines = ["# Results", "", "Lower volume is better. `known` is the smallest build we have for the task (source in brackets).", "",
             "| task | config | volume | dims | ticks | known | valid/calls | minutes | to first valid | output tokens |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (r["family"], r["task"], r["config"])):
        kn = k.get(r["task"].split("+")[0])
        mins = lambda s: "" if s is None else f"{s / 60:.1f}"
        lines.append(f"| {r['task']} | {r['config']} | {r['volume'] or 'none'} | {'x'.join(map(str, r['dims'] or []))} | "
                     f"{'' if r['ticks'] is None else r['ticks']} | {f'{kn[0]} ({kn[1]})' if kn else ''} | "
                     f"{r['valid_calls']}/{r['calls']} | {mins(r['seconds'])} | {mins(r['seconds_to_first_valid'])} | "
                     f"{r['output_tokens'] or ''} |")
    (ROOT / "docs/RESULTS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
