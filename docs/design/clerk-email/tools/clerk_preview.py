"""Render every template through Clerk's preview endpoint (POST only, nothing is saved).

Usage: python3 clerk_preview.py <out_dir> [--instance dev]
Needs the repo's linked Clerk project: run from a checkout whose cwd is linked (packages/web in alpha-access-pr2).
Writes <out_dir>/before/<slug>.html|.json (the stored dev template) and <out_dir>/after/<slug>.html|.json (this design).
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.dirname(HERE)
CWD = os.environ.get("CLERK_CWD", "/home/imran/orca/workspaces/yugioh-discord-bot/alpha-access-pr2/packages/web")
out = sys.argv[1]; inst = sys.argv[sys.argv.index("--instance") + 1] if "--instance" in sys.argv else "dev"
ORDER = list(json.load(open(f"{SRC}/subjects.json")).keys())

def clerk(*a):
    r = subprocess.run(["clerk", "api", "--instance", inst, *a], cwd=CWD, stdin=subprocess.DEVNULL, capture_output=True, text=True)
    return json.loads(r.stdout)

def preview(slug, subject, body, tag):
    os.makedirs(f"{out}/work", exist_ok=True)
    pf = f"{out}/work/req-{slug}-{tag}.json"
    json.dump({"subject": subject, "body": body}, open(pf, "w"))
    d = clerk("-X", "POST", f"/templates/email/{slug}/preview", "--file", pf)
    assert "body" in d, d
    return d

for d in ("before", "after", "backup"): os.makedirs(f"{out}/{d}", exist_ok=True)
for s in ORDER:
    bk = f"{out}/backup/{s}.json"  # the stored template from before the first apply; never overwritten
    if not os.path.exists(bk):
        json.dump(clerk(f"/templates/email/{s}"), open(bk, "w"), indent=1)
    cur = json.load(open(bk))
    b = preview(s, cur["subject"], cur["body"], "before")
    open(f"{out}/before/{s}.html", "w").write(b["body"]); json.dump({"subject": b["subject"].strip()}, open(f"{out}/before/{s}.json", "w"))
    req = json.load(open(f"{SRC}/requests/{s}.put.json"))
    a = preview(s, req["subject"], req["body"], "after")
    open(f"{out}/after/{s}.html", "w").write(a["body"]); json.dump({"subject": a["subject"].strip()}, open(f"{out}/after/{s}.json", "w"))
    print(s, "|", b["subject"].strip(), "->", a["subject"].strip())
