#!/usr/bin/env bash
# Build dist/ for public hosting: the page, its data, renders and icons. Only models with every task run are kept.
# Run bench/export_site.py and site/render_all.mjs first. This does not publish anything.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/data/builds dist/renders
cp ../site/index.html ../site/style.css ../site/app.js ../site/viewer.js ../site/signal.js dist/
cp ../site/favicon.svg ../site/favicon-32.png ../site/apple-touch-icon.png ../site/icon-192.png ../site/og.png dist/
cp -R ../site/vendor ../site/assets dist/
python3 - <<'PY'
import json, os, pathlib, shutil
src, dst = pathlib.Path("../site"), pathlib.Path("dist")
d = json.loads((src / "data/index.json").read_text())
n = len(d["tasks"])
ran = {}
for r in d["runs"]:
    ran[r["config"]] = ran.get(r["config"], 0) + 1
prefixes = tuple(p for p in os.environ.get("RSB_INCLUDE_PARTIAL_PREFIXES", "").split(",") if p)
complete = {c for c, k in ran.items() if k == n}
partial_kept = {c for c in ran if c not in complete and prefixes and c.startswith(prefixes)}
keep = complete | partial_kept
dropped = sorted(set(ran) - keep)
d["configs"] = [c for c in d["configs"] if c["id"] in keep]
d["runs"] = [r for r in d["runs"] if r["config"] in keep]
(dst / "data/index.json").write_text(json.dumps(d, separators=(",", ":")))
for r in d["runs"]:
    if (src / "data/builds" / r["id"]).is_dir():
        shutil.copytree(src / "data/builds" / r["id"], dst / "data/builds" / r["id"])
    if (src / "renders" / f"{r['id']}.png").exists():
        shutil.copy(src / "renders" / f"{r['id']}.png", dst / "renders")
for o in d["others"]:
    shutil.copy(src / "data/builds" / f"{o['id']}.json", dst / "data/builds")
    if (src / "renders" / f"{o['id']}.png").exists():
        shutil.copy(src / "renders" / f"{o['id']}.png", dst / "renders")
extra = f" (+{len(partial_kept)} partial)" if partial_kept else ""
print(f"{len(complete)} complete settings kept{extra}; left out:", ", ".join(dropped) or "none")
PY
echo "dist: $(du -sh dist | cut -f1), $(find dist -type f | wc -l | tr -d ' ') files"
