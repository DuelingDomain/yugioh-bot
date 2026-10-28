#!/usr/bin/env python3
"""Build the engine source zip that the site offers under AGPL-3.0 section 13.

    python3 tools/engine-source/build-zip.py OUT.zip [REF]

REF is any commit or tree-ish (default HEAD). The zip is made from the TREE of REF,
so it holds no commit ID, no history and no author names, and its comment is empty.
The file list is in tools/engine-source/paths.txt.

The repo files stay as they are. The zip is cleaned while it is packed:
  - patch headers (above the first "---" line) lose tool credit trailers;
  - a home directory path in a script comment becomes /path/to/repo.
The build stops if any text in the zip still matches a blocked word.
"""
import os
import posixpath
import re
import subprocess
import sys
import tarfile
import zipfile

BLOCKED = re.compile(r"claude|anthropic|co-authored|codex|openai|gpt-|sonnet|opus|sulman|/home/", re.I)
TRAILER = re.compile(r"^(Co-Authored-By: (Claude|Codex)|Claude-Session:)", re.I)
HOME_PATH = re.compile(r"/home/sulman633/repos/yugioh-bot/\.worktrees/[\w.-]+")
FIXED_TIME = (2000, 1, 1, 0, 0, 0)


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, stdout=subprocess.PIPE).stdout


def clean(name: str, data: bytes) -> bytes:
    text = data.decode("utf-8")
    if name.endswith(".patch"):
        head, sep, rest = text.partition("\n---\n")
        lines = head.split("\n")
        kept = [line for line in lines if not TRAILER.match(line)]
        if len(kept) != len(lines):
            while kept and kept[-1] == "":
                kept.pop()
        head = "\n".join(kept).replace("Review fixes (Opus review of this patch):", "Review fixes:")
        text = head + sep + rest
    text = HOME_PATH.sub("/path/to/repo", text)
    hit = BLOCKED.search(text)
    if hit:
        raise SystemExit(f"blocked text {hit.group(0)!r} in {name}: clean it in the source")
    return text.encode("utf-8")


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    out = sys.argv[1]
    ref = sys.argv[2] if len(sys.argv) == 3 else "HEAD"
    root = git("rev-parse", "--show-toplevel").decode().strip()
    tree = git("-C", root, "rev-parse", "--verify", f"{ref}^{{tree}}").decode().strip()

    specs, exts, keeps, roots = [], [], set(), []
    for line in git("-C", root, "show", f"{tree}:tools/engine-source/paths.txt").decode().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        kind, _, value = line.partition(" ")
        if kind == "path":
            specs.append(value)
        elif kind == "ext":
            exts.append(value)
        elif kind == "keep":
            keeps.add(value)
        elif kind == "root":
            roots.append(value)
        else:
            raise SystemExit(f"bad line in paths.txt: {line}")

    files = {}
    archive = subprocess.Popen(
        ["git", "-C", root, "archive", "--format=tar", tree, "--", *specs], stdout=subprocess.PIPE
    )
    with tarfile.open(fileobj=archive.stdout, mode="r|") as tar:
        for member in tar:
            if not member.isfile():
                continue
            base = posixpath.basename(member.name)
            if base not in keeps and not member.name.endswith(tuple(exts)):
                continue
            files[member.name] = (clean(member.name, tar.extractfile(member).read()), member.mode)
    if archive.wait() != 0:
        raise SystemExit("git archive failed")
    for path in roots:
        files[posixpath.basename(path)] = (git("-C", root, "show", f"{tree}:{path}"), 0o644)
    if not files:
        raise SystemExit("no files selected")

    tmp = f"{out}.tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in sorted(files, key=lambda n: (n.count("/") > 0, n)):
            data, mode = files[name]
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100755 if mode & 0o111 else 0o100644) << 16
            zf.writestr(info, data)
    os.replace(tmp, out)
    print(f"wrote {out}: {len(files)} files, tree {tree}")


if __name__ == "__main__":
    main()
