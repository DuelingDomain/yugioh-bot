"""Makes a consistent copy of a SQLite file with the SQLite backup API (python3 standard library).

    python3 sqlite-backup.py <source.sqlite> <dest.sqlite>

Same job as sqlite-backup.cjs, for a VM that has python3 but no node. The source is opened read-only
and is never written. The copy is made to <dest>.partial, checked, cleaned for staging (duels that were
"active" become "interrupted" in the copy) and renamed to <dest>.
"""
import os
import sqlite3
import sys


def fail(message):
    print("sqlite-backup: " + message, file=sys.stderr)
    sys.exit(1)


if len(sys.argv) != 3:
    fail("usage: sqlite-backup.py <source.sqlite> <dest.sqlite>")
src, dest = sys.argv[1], sys.argv[2]
if os.path.realpath(src) == os.path.realpath(dest):
    fail("source and destination are the same file")
if not os.path.isfile(src):
    fail("source not found: " + src)

partial = dest + ".partial"


def clean_partial():
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(partial + suffix)
        except FileNotFoundError:
            pass


clean_partial()
try:
    source = sqlite3.connect("file:" + os.path.abspath(src) + "?mode=ro", uri=True)
    copy = sqlite3.connect(partial)
    try:
        source.backup(copy)
    finally:
        source.close()
    check = copy.execute("pragma quick_check").fetchone()[0]
    if check != "ok":
        fail("quick_check of the copy failed: " + str(check))
    has_duels = copy.execute(
        "select 1 from sqlite_master where type = 'table' and name = 'duels'"
    ).fetchone()
    interrupted = 0
    if has_duels:
        interrupted = copy.execute(
            "update duels set status = 'interrupted' where status = 'active'"
        ).rowcount
        copy.commit()
    copy.execute("pragma wal_checkpoint(TRUNCATE)").fetchall()
    copy.close()
    print(
        "sqlite-backup: copy is consistent, %d active duel(s) set to interrupted in the copy"
        % interrupted
    )
    for suffix in ("-wal", "-shm"):
        try:
            os.remove(partial + suffix)
        except FileNotFoundError:
            pass
    os.replace(partial, dest)
    print("sqlite-backup: wrote " + dest)
except SystemExit:
    clean_partial()
    raise
except Exception as error:  # noqa: BLE001
    clean_partial()
    fail(str(error))
