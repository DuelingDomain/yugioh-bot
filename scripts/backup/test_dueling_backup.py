#!/usr/bin/env python3
"""Offline tests; all fixtures live under this kit's directory. No SSH is run."""

import contextlib
import hashlib
import io
import os
from pathlib import Path
import runpy
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock


KIT_DIR = Path(__file__).resolve().parent
BACKUP_SCRIPT = KIT_DIR / "dueling-backup"
UTC = timezone.utc
MANUAL_NAME = "bot-20261001-224200-manual.sqlite"


def automatic_name(age_days, extra_hours=1):
    stamp = datetime.now(UTC) - timedelta(days=age_days, hours=extra_hours)
    return stamp.strftime("bot-%Y%m%d-%H%M%SZ.sqlite")


def write_pair(directory, name, content=b"retention fixture"):
    backup = directory / name
    backup.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    sidecar = directory / (name + ".sha256")
    sidecar.write_text(digest + "  " + name + "\n", encoding="ascii")
    return backup, sidecar


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".backup-test-", dir=KIT_DIR)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "live db?#.sqlite"
        self.destination = self.root / "backups"
        self.writer = sqlite3.connect(str(self.source))
        self.addCleanup(self.writer.close)
        self.assertEqual(self.writer.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
        self.writer.execute("PRAGMA wal_autocheckpoint=0")
        self.writer.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)")
        self.writer.commit()
        self.writer.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        self.rows = [(number, "committed in WAL " + str(number)) for number in range(1, 21)]
        self.writer.executemany("INSERT INTO messages VALUES (?, ?)", self.rows)
        self.writer.commit()

    def environment(self, source=None, keep=None):
        environment = os.environ.copy()
        environment.pop("DUELING_BACKUP_KEEP", None)
        environment.update(
            DUELING_BACKUP_SRC=str(source or self.source),
            DUELING_BACKUP_DIR=str(self.destination),
            PYTHONDONTWRITEBYTECODE="1",
        )
        if keep is not None:
            environment["DUELING_BACKUP_KEEP"] = str(keep)
        return environment

    def run_backup(self, source=None, keep=None):
        return subprocess.run(
            [sys.executable, str(BACKUP_SCRIPT)],
            env=self.environment(source, keep), capture_output=True, text=True, timeout=30,
        )

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(len(result.stdout.splitlines()), 1)

    def assert_pair_exists(self, name, exists):
        self.assertEqual((self.destination / name).exists(), exists, name)
        self.assertEqual((self.destination / (name + ".sha256")).exists(), exists, name)

    def test_open_wal_rows_become_self_contained_verified_backup(self):
        self.assertGreater(Path(str(self.source) + "-wal").stat().st_size, 0)
        # Ignoring WAL must show zero rows, proving a plain DB copy would lose them.
        with contextlib.closing(sqlite3.connect(self.source.as_uri() + "?immutable=1", uri=True)) as main:
            self.assertEqual(main.execute("SELECT count(*) FROM messages").fetchone()[0], 0)

        result = self.run_backup()
        self.assert_success(result)
        backups = list(self.destination.glob("bot-*.sqlite"))
        self.assertEqual(len(backups), 1)
        backup = backups[0]
        self.assertRegex(backup.name, r"^bot-\d{8}-\d{6}Z\.sqlite$")
        with contextlib.closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)) as copy:
            self.assertEqual(copy.execute("SELECT * FROM messages ORDER BY id").fetchall(), self.rows)
            self.assertEqual(copy.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(copy.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        for suffix in ("-wal", "-shm", "-journal"):
            self.assertFalse(Path(str(backup) + suffix).exists())
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        sidecar = Path(str(backup) + ".sha256")
        self.assertEqual(stat.S_IMODE(sidecar.stat().st_mode), 0o600)
        digest = hashlib.sha256(backup.read_bytes()).hexdigest()
        self.assertEqual(sidecar.read_text(), digest + "  " + backup.name + "\n")
        size = backup.stat().st_size
        self.assertEqual(result.stdout.strip(), "{} {} {} kept=1 total_bytes={}".format(backup, size, digest, size))
        self.assertEqual(list(self.destination.glob("*.tmp")), [])

    def seed_retention(self, ages):
        self.destination.mkdir()
        names = {}
        for age in ages:
            name = automatic_name(age)
            backup, _ = write_pair(self.destination, name)
            # Misleading mtimes must not determine retention.
            os.utime(backup, (0, 0) if age % 2 else (2000000000, 2000000000))
            names[age] = name
        protected = [MANUAL_NAME, "bot-20000101-000000.sqlite", "bot-20991340-999999Z.sqlite", "notes.txt"]
        for name in protected:
            write_pair(self.destination, name, b"never remove")
        return names, protected

    def assert_protected(self, names):
        for name in names:
            self.assertEqual((self.destination / name).read_bytes(), b"never remove")
            self.assert_pair_exists(name, True)

    def test_default_retention_keeps_seven_newest_pairs_and_reports_total_bytes(self):
        names, protected = self.seed_retention(range(1, 10))
        result = self.run_backup()
        self.assert_success(result)
        for age, name in names.items():
            # Today's snapshot plus six fixtures; the eighth-newest pair is removed.
            self.assert_pair_exists(name, age <= 6)
        self.assert_protected(protected)
        fresh = next(path for path in self.destination.glob("bot-*.sqlite")
                     if path.name not in names.values() and path.name not in protected)
        total_bytes = fresh.stat().st_size + 6 * len(b"retention fixture")
        self.assertTrue(result.stdout.strip().endswith("kept=7 total_bytes={}".format(total_bytes)), result.stdout)

    def test_retention_env_override_keeps_two_newest_pairs(self):
        names, protected = self.seed_retention(range(1, 5))
        result = self.run_backup(keep=2)
        self.assert_success(result)
        for age, name in names.items():
            self.assert_pair_exists(name, age == 1)
        self.assert_protected(protected)
        self.assertIn(" kept=2 total_bytes=", result.stdout)

    def test_invalid_retention_fails_cleanly_before_backup_or_pruning(self):
        names, protected = self.seed_retention(range(1, 10))
        for keep in ("0", "-1", "invalid", "1.5", ""):
            with self.subTest(keep=keep):
                result = self.run_backup(keep=keep)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(len(result.stderr.splitlines()), 1)
                self.assertIn("DUELING_BACKUP_KEEP", result.stderr)
                self.assertIn(">= 1", result.stderr)
                self.assertEqual(list(self.destination.glob("*.tmp")), [])
                for name in names.values():
                    self.assert_pair_exists(name, True)
                self.assert_protected(protected)

    def test_corrupt_source_fails_without_temporary_files_or_traceback(self):
        corrupt = self.root / "corrupt.sqlite"
        corrupt.write_bytes(b"This is not a SQLite database.\n")
        result = self.run_backup(corrupt)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(len(result.stderr.splitlines()), 1)
        self.assertIn("ERROR", result.stderr)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_integrity_failure_rejects_a_database_with_an_orphaned_index_page(self):
        # This remains readable and copyable, but integrity_check finds the lost page.
        self.writer.execute("CREATE INDEX message_body ON messages(body)")
        self.writer.commit()
        self.writer.execute("PRAGMA writable_schema=ON")
        self.writer.execute("DELETE FROM sqlite_master WHERE name='message_body'")
        self.writer.commit()
        result = self.run_backup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("integrity_check", result.stderr)
        self.assertEqual(len(result.stderr.splitlines()), 1)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_missing_source_fails_without_creating_a_database(self):
        missing = self.root / "missing.sqlite"
        result = self.run_backup(missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(missing.exists())
        self.assertEqual(list(self.destination.glob("*.tmp")), [])

    def test_insufficient_space_includes_wal_size_and_fails_before_copying(self):
        required = 3 * (self.source.stat().st_size + Path(str(self.source) + "-wal").stat().st_size)
        with mock.patch.dict(os.environ, self.environment()):
            namespace = runpy.run_path(str(BACKUP_SCRIPT))
        output = io.StringIO()
        with mock.patch.object(namespace["shutil"], "disk_usage", return_value=SimpleNamespace(free=required - 1)):
            with contextlib.redirect_stderr(output):
                status = namespace["main"]()
        self.assertNotEqual(status, 0)
        self.assertIn("space", output.getvalue().lower())
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_fsync_failure_removes_temporary_files(self):
        with mock.patch.dict(os.environ, self.environment()):
            namespace = runpy.run_path(str(BACKUP_SCRIPT))
        output = io.StringIO()
        with mock.patch.object(namespace["os"], "fsync", side_effect=OSError("simulated fsync failure")):
            with contextlib.redirect_stderr(output):
                status = namespace["main"]()
        self.assertNotEqual(status, 0)
        self.assertIn("fsync", output.getvalue())
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_same_second_filename_collision_preserves_existing_backup(self):
        self.destination.mkdir()
        stamp = datetime.now(UTC).replace(microsecond=0)
        name = stamp.strftime("bot-%Y%m%d-%H%M%SZ.sqlite")
        backup, sidecar = write_pair(self.destination, name, b"existing backup")
        original_sidecar = sidecar.read_bytes()

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return stamp

        with mock.patch.dict(os.environ, self.environment()):
            namespace = runpy.run_path(str(BACKUP_SCRIPT))
        output = io.StringIO()
        with mock.patch.dict(namespace["create_backup"].__globals__, {"datetime": FixedDateTime}):
            with contextlib.redirect_stderr(output):
                status = namespace["main"]()
        self.assertNotEqual(status, 0)
        self.assertIn("already exists", output.getvalue())
        self.assertEqual(backup.read_bytes(), b"existing backup")
        self.assertEqual(sidecar.read_bytes(), original_sidecar)
        self.assertEqual(list(self.destination.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
