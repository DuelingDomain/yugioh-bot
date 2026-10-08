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

    def environment(self, source=None, keep=None, release_keep_days=None):
        environment = os.environ.copy()
        environment.pop("DUELING_BACKUP_KEEP", None)
        environment.pop("DUELING_RELEASE_KEEP_DAYS", None)
        environment.update(
            DUELING_BACKUP_SRC=str(source or self.source),
            DUELING_BACKUP_DIR=str(self.destination),
            PYTHONDONTWRITEBYTECODE="1",
        )
        if keep is not None:
            environment["DUELING_BACKUP_KEEP"] = str(keep)
        if release_keep_days is not None:
            environment["DUELING_RELEASE_KEEP_DAYS"] = str(release_keep_days)
        return environment

    def run_backup(self, source=None, keep=None, release_keep_days=None):
        return subprocess.run(
            [sys.executable, str(BACKUP_SCRIPT)],
            env=self.environment(source, keep, release_keep_days), capture_output=True, text=True, timeout=30,
        )

    def namespace(self):
        with mock.patch.dict(os.environ, self.environment()):
            return runpy.run_path(str(BACKUP_SCRIPT))

    def seed_release(self, name):
        release = self.destination / name
        release.mkdir(parents=True)
        for name in ("checkout-commit", "deploy-commit", "images.jsonl", "runtime.env"):
            (release / name).write_bytes(b"protected metadata fixture")
        for name in ("online", "drained"):
            directory = release / name
            directory.mkdir()
            write_pair(directory, "bot-20000101-000000Z.sqlite")
        write_pair(release, "extra.sqlite")
        (release / "extra.sqlite-wal").write_bytes(b"WAL fixture")
        (release / "extra.sqlite-shm").write_bytes(b"SHM fixture")
        nested = release / "nested"
        nested.mkdir()
        (nested / "history.sqlite.gz").write_bytes(b"compressed fixture")
        return release

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

    def test_daily_age_cap_removes_stale_pairs_even_below_count_limit(self):
        # The daily timer expires copies a day early, so nothing outlives 14 days between runs.
        names, protected = self.seed_retention((1, 12, 13, 30))
        result = self.run_backup(keep=50)
        self.assert_success(result)
        for age, name in names.items():
            self.assert_pair_exists(name, age < 13)
        self.assert_protected(protected)
        self.assertIn(" kept=3 total_bytes=", result.stdout)

    def test_daily_age_cap_preserves_newest_one_when_every_snapshot_is_stale(self):
        self.destination.mkdir()
        newest = "bot-20000201-120000Z.sqlite"
        oldest = "bot-20000101-120000Z.sqlite"
        write_pair(self.destination, newest)
        write_pair(self.destination, oldest)
        namespace = self.namespace()
        kept, total_bytes = namespace["prune_backups"](7)
        self.assert_pair_exists(newest, True)
        self.assert_pair_exists(oldest, False)
        self.assertEqual(kept, 1)
        self.assertEqual(total_bytes, len(b"retention fixture"))

    def test_daily_age_cap_uses_exact_utc_boundary(self):
        self.destination.mkdir()
        newest = "bot-20261008-120000Z.sqlite"
        boundary = "bot-20260925-120000Z.sqlite"
        expired = "bot-20260925-115959Z.sqlite"
        for name in (newest, boundary, expired):
            write_pair(self.destination, name)

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 8, 12, tzinfo=UTC)

        namespace = self.namespace()
        with mock.patch.dict(namespace["prune_backups"].__globals__, {"datetime": FixedDateTime}):
            kept, _ = namespace["prune_backups"](7)
        self.assertEqual(kept, 2)
        self.assert_pair_exists(newest, True)
        self.assert_pair_exists(boundary, True)
        self.assert_pair_exists(expired, False)

    def test_backup_refuses_symlinked_destination_or_ancestor(self):
        outside = self.root / "outside"
        outside.mkdir()
        link = self.root / "linked-backups"
        link.symlink_to(outside, target_is_directory=True)
        for destination in (link, link / "child"):
            with self.subTest(destination=destination):
                self.destination = destination
                result = self.run_backup()
                self.assertEqual(result.returncode, 1)
                self.assertIn("symlink", result.stderr.lower())
                self.assertEqual(list(outside.iterdir()), [])

    def test_daily_pruning_leaves_symlinked_database_and_sidecar_untouched(self):
        self.destination.mkdir()
        outside = self.root / "outside.sqlite"
        outside.write_bytes(b"never remove")
        database_link = self.destination / "bot-20000101-000000Z.sqlite"
        database_link.symlink_to(outside)
        name = "bot-20000102-000000Z.sqlite"
        backup, sidecar = write_pair(self.destination, name)
        sidecar.unlink()
        sidecar.symlink_to(outside)
        result = self.run_backup()
        self.assert_success(result)
        self.assertTrue(database_link.is_symlink())
        self.assertTrue(sidecar.is_symlink())
        self.assertFalse(backup.exists())
        self.assertEqual(outside.read_bytes(), b"never remove")

    def test_daily_run_prunes_expired_release_dirs_by_name_not_mtime(self):
        expired = self.seed_release("pr2-20000101-000000Z")
        stamp = datetime.now(UTC) - timedelta(days=3)
        recent = self.seed_release(stamp.strftime("pr2-%Y%m%d-%H%M%SZ"))
        os.utime(expired, (2000000000, 2000000000))
        os.utime(recent, (0, 0))
        result = self.run_backup()
        self.assert_success(result)
        self.assertFalse(expired.exists())
        self.assertTrue((recent / "online" / "bot-20000101-000000Z.sqlite").exists())
        self.assertTrue((recent / "drained" / "bot-20000101-000000Z.sqlite").exists())

    def test_newest_expired_release_keeps_metadata_but_loses_all_database_copies(self):
        older = self.seed_release("pr2-20000101-000000Z")
        newest = self.seed_release("pr2-20000201-000000Z")
        os.utime(older, (2000000000, 2000000000))
        os.utime(newest, (0, 0))
        result = self.run_backup()
        self.assert_success(result)
        self.assertFalse(older.exists())
        for name in ("checkout-commit", "deploy-commit", "images.jsonl", "runtime.env"):
            self.assertEqual((newest / name).read_bytes(), b"protected metadata fixture")
        self.assertFalse((newest / "online").exists())
        self.assertFalse((newest / "drained").exists())
        self.assertEqual(list(newest.rglob("*.sqlite*")), [])
        # Idempotent even when only empty non-database directories remain.
        self.namespace()["prune_releases"]()
        self.assertTrue((newest / "runtime.env").exists())

    def test_release_retention_ignores_unmatched_names_and_top_level_archives(self):
        self.seed_release("pr2-20000101-000000Z")
        protected = [self.seed_release(name) for name in (
            "pr2-20000101-000000", "pr2-20000101-000000Z-extra", "pr2-20001301-000000Z",
            "pr2-20000101-240000Z", "pr2-2000011-000000Z", "manual-release",
        )]
        files = (
            "pre-competitive-wipe-20261003-232821Z.sqlite", MANUAL_NAME,
            "bot-20261002-140023-pre-reboot.sqlite", "bot-20261002-211806-pre-https.sqlite",
            "wipe.sql", "run-wipe.py", "pr2-20000201-000000Z",
        )
        for name in files:
            (self.destination / name).write_bytes(b"never remove")
        result = self.run_backup()
        self.assert_success(result)
        for release in protected:
            self.assertTrue((release / "online" / "bot-20000101-000000Z.sqlite").exists())
        for name in files:
            self.assertEqual((self.destination / name).read_bytes(), b"never remove")

    def test_release_keep_one_day_never_removes_a_fresh_release(self):
        fresh = self.seed_release(datetime.now(UTC).strftime("pr2-%Y%m%d-%H%M%SZ"))
        namespace = self.namespace()
        with mock.patch.dict(os.environ, {"DUELING_RELEASE_KEEP_DAYS": "1"}):
            namespace["prune_releases"]()
        self.assertTrue((fresh / "online").exists())
        self.assertTrue((fresh / "drained").exists())

    def test_release_age_cap_uses_exact_utc_boundary(self):
        newest = self.seed_release("pr2-20261008-120000Z")
        boundary = self.seed_release("pr2-20260925-120000Z")
        expired = self.seed_release("pr2-20260925-115959Z")

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 8, 12, tzinfo=UTC)

        namespace = self.namespace()
        self.assertTrue("prune_releases" in namespace, "release retention helper is missing")
        with mock.patch.dict(namespace["prune_releases"].__globals__, {"datetime": FixedDateTime}):
            namespace["prune_releases"]()
        self.assertFalse(expired.exists())
        self.assertTrue((boundary / "online").exists())
        self.assertTrue((newest / "drained").exists())

    def test_shorter_release_database_retention_leaves_metadata_until_fourteen_days(self):
        self.seed_release("pr2-20000101-000000Z")
        stamp = datetime.now(UTC) - timedelta(days=4)
        expired_database = self.seed_release(stamp.strftime("pr2-%Y%m%d-%H%M%SZ"))
        stamp = datetime.now(UTC) - timedelta(days=1)
        newest = self.seed_release(stamp.strftime("pr2-%Y%m%d-%H%M%SZ"))
        result = self.run_backup(release_keep_days=3)
        self.assert_success(result)
        self.assertTrue((expired_database / "runtime.env").exists())
        self.assertFalse((expired_database / "online").exists())
        self.assertEqual(list(expired_database.rglob("*.sqlite*")), [])
        self.assertTrue((newest / "online").exists())

    def test_invalid_release_retention_warns_and_enforces_default_without_failing_backup(self):
        for index, keep_days in enumerate(("0", "-1", "invalid", "1.5", "", "15")):
            with self.subTest(keep_days=keep_days):
                self.destination = self.root / ("invalid-retention-" + str(index))
                release = self.seed_release("pr2-20000101-000000Z")
                output = io.StringIO()
                success = io.StringIO()
                namespace = self.namespace()
                with mock.patch.dict(os.environ, {"DUELING_RELEASE_KEEP_DAYS": keep_days}):
                    with contextlib.redirect_stderr(output), contextlib.redirect_stdout(success):
                        status = namespace["main"]()
                self.assertEqual(status, 0, output.getvalue())
                self.assertIn("WARNING", output.getvalue())
                self.assertIn("DUELING_RELEASE_KEEP_DAYS", output.getvalue())
                self.assertFalse((release / "online").exists())
                self.assertIn(" kept=", success.getvalue())

    def test_release_pruning_refuses_symlinks_and_continues_with_safe_releases(self):
        unsafe = self.seed_release("pr2-20000101-000000Z")
        safe = self.seed_release("pr2-20000201-000000Z")
        self.seed_release(datetime.now(UTC).strftime("pr2-%Y%m%d-%H%M%SZ"))
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "valuable.sqlite").write_bytes(b"never remove")
        (unsafe / "online" / "linked").symlink_to(outside, target_is_directory=True)
        release_link = self.destination / "pr2-20990101-000000Z"
        release_link.symlink_to(outside, target_is_directory=True)
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WARNING", result.stderr)
        self.assertIn("symlink", result.stderr.lower())
        self.assertTrue(unsafe.exists())
        self.assertFalse(safe.exists())
        self.assertTrue(release_link.is_symlink())
        self.assertEqual((outside / "valuable.sqlite").read_bytes(), b"never remove")

    def test_newest_release_database_symlink_is_refused_without_deleting_metadata(self):
        release = self.seed_release("pr2-20000101-000000Z")
        outside = self.root / "outside.sqlite"
        outside.write_bytes(b"never remove")
        (release / "linked.sqlite-wal").symlink_to(outside)
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WARNING", result.stderr)
        self.assertTrue((release / "linked.sqlite-wal").is_symlink())
        self.assertTrue((release / "runtime.env").exists())
        self.assertEqual(outside.read_bytes(), b"never remove")

    def test_release_deletion_failure_warns_without_failing_verified_daily_backup(self):
        expired = self.seed_release("pr2-20000101-000000Z")
        self.seed_release(datetime.now(UTC).strftime("pr2-%Y%m%d-%H%M%SZ"))
        namespace = self.namespace()
        output = io.StringIO()
        success = io.StringIO()
        with mock.patch.object(namespace["shutil"], "rmtree", side_effect=OSError("simulated deletion\nfailure")):
            with contextlib.redirect_stderr(output), contextlib.redirect_stdout(success):
                status = namespace["main"]()
        self.assertEqual(status, 0, output.getvalue())
        self.assertIn("WARNING", output.getvalue())
        self.assertIn("simulated deletion failure", output.getvalue())
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertTrue(expired.exists())
        self.assertIn(" kept=1 total_bytes=", success.getvalue())
        backup = next(self.destination.glob("bot-*.sqlite"))
        with contextlib.closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)) as copy:
            self.assertEqual(copy.execute("SELECT * FROM messages ORDER BY id").fetchall(), self.rows)

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
