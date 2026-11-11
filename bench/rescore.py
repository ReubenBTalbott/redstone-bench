#!/usr/bin/env python3
"""Re-verify every saved attempt of a run with the current verifier.
usage: rescore.py runs/<cfg>/<task>   -> writes rescored.json there"""
import json
import pathlib
import sys

from verify import verify

ROOT = pathlib.Path(__file__).resolve().parent.parent


def key(r):
    return (r["volume"], r.get("tiebreak", r.get("close_ticks", 0) + r.get("open_ticks", 0)))


def rescore(run):
    run = pathlib.Path(run)
    task = json.loads((ROOT / "tasks" / (run.name.split("+")[0] + ".json")).read_text())
    best, flips, n = None, [], 0
    for f in sorted((run / "attempts").glob("[0-9][0-9][0-9].json")):
        n += 1
        old = json.loads(f.with_suffix("").with_suffix(".result.json").read_text())
        try:
            new = verify(task, json.loads(f.read_text()))
        except json.JSONDecodeError:
            new = {"valid": False, "errors": ["not JSON"]}
        if bool(old.get("valid")) != bool(new.get("valid")) or old.get("volume") != new.get("volume"):
            flips.append({"attempt": int(f.stem), "was": [old.get("valid"), old.get("volume")],
                          "now": [new.get("valid"), new.get("volume")], "error": (new.get("errors") or [""])[0][:120]})
        if new.get("valid") and (best is None or key(new) < key(best)):
            best = dict(new, attempt=int(f.stem))
    out = {"attempts": n, "best": best, "changed": flips}
    (run / "rescored.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    for r in sys.argv[1:]:
        o = rescore(r)
        b = o["best"]
        print(r, "attempts", o["attempts"], "best", b and (b["volume"], b["attempt"]), "changed", o["changed"])
