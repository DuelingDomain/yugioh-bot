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
import textwrap
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock


KIT_DIR = Path(__file__).resolve().parent
BACKUP_SCRIPT = KIT_DIR / "dueling-backup"
PULL_SCRIPT = KIT_DIR / "pull-dueling-backup.sh"
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


class PullTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".pull-test-", dir=KIT_DIR)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.local = self.root / "local backups"
        self.local.mkdir()
        self.mirror = self.root / "Windows mirror"
        self.remote = self.root / "remote fixture"
        self.remote.mkdir()
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.rsync_calls = self.root / "rsync-calls.txt"
        # Replace only network transport; real sha256sum and retention still run.
        stand_in = self.bin_dir / "rsync"
        stand_in.write_text("#!" + sys.executable + "\n" + textwrap.dedent('''\
            import json
            import os
            from pathlib import Path
            import shutil
            import sys
            arguments = sys.argv[1:]
            with open(os.environ["TEST_RSYNC_CALLS"], "a") as output:
                output.write(json.dumps(arguments) + "\\n")
            if os.environ.get("TEST_RSYNC_FAIL"):
                sys.exit(23)
            source, destination = arguments[-2:]
            if source == "dueling-system:/var/backups/yugioh-bot/":
                assert "-a" in arguments
                assert "--delete" not in arguments
                assert arguments[arguments.index("-e") + 1] == "ssh -o BatchMode=yes -o ConnectTimeout=20"
                assert "--include=bot-*.sqlite" in arguments
                assert "--include=bot-*.sqlite.sha256" in arguments
                assert "--exclude=*" in arguments
                source = os.environ["TEST_REMOTE"]
            for file in Path(source).iterdir():
                if file.is_file() and (file.name.endswith(".sqlite") or file.name.endswith(".sha256")):
                    shutil.copy2(file, Path(destination) / file.name)
            '''), encoding="utf-8")
        stand_in.chmod(0o700)

    def run_pull(self, mirror=False, fail=False, keep=None):
        environment = os.environ.copy()
        for variable in ("MIRROR_DIR", "KEEP", "TEST_RSYNC_FAIL"):
            environment.pop(variable, None)
        environment.update(
            LOCAL_DIR=str(self.local), PATH=str(self.bin_dir) + os.pathsep + environment["PATH"],
            TEST_REMOTE=str(self.remote), TEST_RSYNC_CALLS=str(self.rsync_calls),
            PYTHONDONTWRITEBYTECODE="1",
        )
        if mirror:
            environment["MIRROR_DIR"] = str(self.mirror)
        if fail:
            environment["TEST_RSYNC_FAIL"] = "1"
        if keep is not None:
            environment["KEEP"] = str(keep)
        return subprocess.run(["bash", str(PULL_SCRIPT)], env=environment,
                              capture_output=True, text=True, timeout=30)

    def test_pull_verifies_mirrors_and_preserves_manual_backups(self):
        fresh = automatic_name(0, extra_hours=0)
        write_pair(self.remote, fresh, b"new remote backup")
        write_pair(self.remote, MANUAL_NAME, b"manual backup")
        result = self.run_pull(mirror=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in (fresh, MANUAL_NAME):
            self.assertEqual((self.local / name).read_bytes(), (self.remote / name).read_bytes())
            self.assertEqual((self.mirror / name).read_bytes(), (self.remote / name).read_bytes())
            self.assertTrue((self.mirror / (name + ".sha256")).exists())
        self.assertFalse((self.mirror / "pull.log").exists())
        log = (self.local / "pull.log").read_text()
        self.assertIn("Verified", log)
        self.assertIn("Backup pull completed successfully kept=1 total_bytes={}".format(len(b"new remote backup")), log)

    def test_checksum_mismatch_is_error_before_retention_or_mirror(self):
        fresh = automatic_name(0, extra_hours=0)
        backup, _ = write_pair(self.remote, fresh)
        backup.write_bytes(b"changed after hash was written")
        old_names = [automatic_name(age) for age in range(1, 10)]
        for name in old_names:
            write_pair(self.local, name)
        result = self.run_pull(mirror=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("ERROR", (self.local / "pull.log").read_text())
        for line in (self.local / "pull.log").read_text().splitlines():
            self.assertRegex(line, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z ")
        for name in old_names:
            self.assertTrue((self.local / name).exists())
            self.assertTrue((self.local / (name + ".sha256")).exists())
        self.assertFalse(self.mirror.exists())

    def test_default_local_retention_keeps_seven_newest_pairs_and_reports_total_bytes(self):
        fresh = automatic_name(0, extra_hours=0)
        write_pair(self.remote, fresh)
        names = {age: automatic_name(age) for age in range(1, 10)}
        for age, name in names.items():
            backup, _ = write_pair(self.local, name)
            os.utime(backup, (0, 0) if age % 2 else (2000000000, 2000000000))
        protected = [MANUAL_NAME, "bot-20000101-000000.sqlite", "bot-20991340-999999Z.sqlite"]
        for name in protected:
            write_pair(self.local, name, b"protected")
        result = self.run_pull()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for age, name in names.items():
            self.assertEqual((self.local / name).exists(), age <= 6, name)
            self.assertEqual((self.local / (name + ".sha256")).exists(), age <= 6, name)
        for name in protected:
            self.assertEqual((self.local / name).read_bytes(), b"protected")
            self.assertTrue((self.local / (name + ".sha256")).exists())
        self.assertIn("Backup pull completed successfully kept=7 total_bytes={}".format(7 * len(b"retention fixture")),
                      (self.local / "pull.log").read_text())

    def test_local_retention_env_override_keeps_two_newest_pairs(self):
        fresh = automatic_name(0, extra_hours=0)
        write_pair(self.remote, fresh)
        names = [automatic_name(age) for age in range(1, 5)]
        for name in names:
            write_pair(self.local, name)
        result = self.run_pull(keep=2)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for age, name in enumerate(names, start=1):
            self.assertEqual((self.local / name).exists(), age == 1, name)
            self.assertEqual((self.local / (name + ".sha256")).exists(), age == 1, name)
        self.assertIn("Backup pull completed successfully kept=2 total_bytes={}".format(2 * len(b"retention fixture")),
                      (self.local / "pull.log").read_text())

    def test_invalid_local_retention_fails_cleanly_before_pull_or_pruning(self):
        names = [automatic_name(age) for age in range(1, 10)]
        for name in names:
            write_pair(self.local, name)
        for keep in ("0", "-1", "invalid", "1.5", ""):
            with self.subTest(keep=keep):
                result = self.run_pull(mirror=True, keep=keep)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stdout + result.stderr)
                self.assertIn("KEEP", result.stderr)
                self.assertIn(">= 1", result.stderr)
                self.assertFalse(self.rsync_calls.exists())
                self.assertFalse(self.mirror.exists())
                for name in names:
                    self.assertTrue((self.local / name).exists())
                    self.assertTrue((self.local / (name + ".sha256")).exists())

    def test_stale_backup_warns_exits_two_and_still_mirrors(self):
        stale = automatic_name(2, extra_hours=0)
        write_pair(self.remote, stale)
        result = self.run_pull(mirror=True)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("WARNING", (self.local / "pull.log").read_text())
        self.assertTrue((self.local / stale).exists())
        self.assertTrue((self.mirror / stale).exists())

    def test_only_manual_backup_counts_as_no_automatic_backup(self):
        write_pair(self.remote, MANUAL_NAME)
        result = self.run_pull()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("WARNING", (self.local / "pull.log").read_text())
        self.assertTrue((self.local / MANUAL_NAME).exists())

    def test_missing_sidecar_does_not_prevent_freshness_check(self):
        fresh = automatic_name(0, extra_hours=0)
        (self.remote / fresh).write_bytes(b"backup without sidecar")
        result = self.run_pull()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_log_is_trimmed_even_when_transport_fails(self):
        (self.local / "pull.log").write_text("".join("old log {}\n".format(n) for n in range(1100)))
        result = self.run_pull(fail=True)
        self.assertNotEqual(result.returncode, 0)
        lines = (self.local / "pull.log").read_text().splitlines()
        self.assertEqual(len(lines), 1000)
        self.assertIn("ERROR", lines[-1])
        self.assertEqual(list(self.local.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
