#!/usr/bin/env python3
"""Offline tests; all fixtures live under this kit's directory. No SSH is run."""

import contextlib
import fcntl
import gzip
import hashlib
import io
import os
from pathlib import Path
import runpy
import select
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock


KIT_DIR = Path(__file__).resolve().parent
BACKUP_SCRIPT = KIT_DIR / "dueling-backup"
RESTORE_SCRIPT = KIT_DIR / "dueling-restore"
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
        environment.pop("DUELING_DEPLOY_BACKUP_KEEP", None)
        environment.pop("DUELING_BACKUP_LOCK_WAIT_SECONDS", None)
        environment.update(
            DUELING_BACKUP_SRC=str(source or self.source),
            DUELING_BACKUP_DIR=str(self.destination),
            PYTHONDONTWRITEBYTECODE="1",
            DUELING_BACKUP_MIN_FREE_BYTES="0",
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
            write_pair(directory, "bot-20000101-000000Z.sqlite", self.snapshot_bytes())
        write_pair(release, "extra.sqlite")
        (release / "extra.sqlite-wal").write_bytes(b"WAL fixture")
        (release / "extra.sqlite-shm").write_bytes(b"SHM fixture")
        nested = release / "nested"
        nested.mkdir()
        (nested / "history.sqlite.gz").write_bytes(b"compressed fixture")
        return release

    def snapshot_bytes(self):
        path = self.root / "fixture.sqlite"
        with contextlib.closing(sqlite3.connect(path)) as copy:
            self.writer.backup(copy)
            copy.execute("PRAGMA journal_mode=DELETE")
        content = path.read_bytes()
        path.unlink()
        return content

    def read_backup(self, path):
        if path.suffix == ".gz":
            return gzip.decompress(path.read_bytes())
        if path.suffix == ".zst":
            return subprocess.run(["zstd", "-q", "-d", "-c", str(path)], check=True,
                                  capture_output=True, timeout=30).stdout
        return path.read_bytes()

    def assert_rows(self, path):
        raw = self.root / "checked.sqlite"
        raw.write_bytes(self.read_backup(path))
        try:
            with contextlib.closing(sqlite3.connect(raw.as_uri() + "?mode=ro", uri=True)) as copy:
                self.assertEqual(copy.execute("SELECT * FROM messages ORDER BY id").fetchall(), self.rows)
                self.assertEqual(copy.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
                self.assertEqual(copy.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        finally:
            raw.unlink()

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
        backups = [p for p in self.destination.glob("bot-*.sqlite.*") if p.suffix != ".sha256"]
        self.assertEqual(len(backups), 1)
        backup = backups[0]
        self.assertRegex(backup.name, r"^bot-\d{8}-\d{6}Z\.sqlite\.(gz|zst)$")
        self.assert_rows(backup)
        self.assertLess(backup.stat().st_size, len(self.read_backup(backup)))
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
        fresh = next(path for path in self.destination.glob("bot-*.sqlite.*") if path.suffix != ".sha256"
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
        content = self.snapshot_bytes()
        write_pair(self.destination, newest, content)
        write_pair(self.destination, oldest, content)
        namespace = self.namespace()
        kept, total_bytes = namespace["prune_backups"](7)
        self.assert_pair_exists(newest, True)
        self.assert_pair_exists(oldest, False)
        self.assertEqual(kept, 1)
        self.assertEqual(total_bytes, len(content))

    def test_daily_age_cap_uses_exact_utc_boundary(self):
        self.destination.mkdir()
        newest = "bot-20261008-120000Z.sqlite"
        boundary = "bot-20260925-120000Z.sqlite"
        expired = "bot-20260925-115959Z.sqlite"
        for name in (newest, boundary, expired):
            write_pair(self.destination, name, self.snapshot_bytes())

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

    def test_newest_expired_release_keeps_metadata_and_last_good_copy_per_kind(self):
        older = self.seed_release("pr2-20000101-000000Z")
        newest = self.seed_release("pr2-20000201-000000Z")
        os.utime(older, (2000000000, 2000000000))
        os.utime(newest, (0, 0))
        result = self.run_backup()
        self.assert_success(result)
        self.assertFalse(older.exists())
        for name in ("checkout-commit", "deploy-commit", "images.jsonl", "runtime.env"):
            self.assertEqual((newest / name).read_bytes(), b"protected metadata fixture")
        for kind in ("online", "drained"):
            self.assert_rows(newest / kind / "bot-20000101-000000Z.sqlite")
        self.assertFalse((newest / "extra.sqlite").exists())
        self.assertFalse((newest / "nested/history.sqlite.gz").exists())
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
                self.assertTrue((release / "online").exists())
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
        backup = next(p for p in self.destination.glob("bot-*.sqlite.*") if p.suffix != ".sha256")
        self.assert_rows(backup)

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

    def test_gzip_fallback_produces_a_verified_compressed_pair(self):
        namespace = self.namespace()
        with mock.patch.object(namespace["shutil"], "which", return_value=None):
            backup, _, _, _, _ = namespace["create_backup"]()
        self.assertEqual(backup.suffix, ".gz")
        self.assert_rows(backup)
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    @unittest.skipUnless(shutil.which("zstd") or os.environ.get("CI") == "true", "zstd is not installed")
    def test_zstd_produces_a_verified_compressed_pair(self):
        self.assertIsNotNone(shutil.which("zstd"), "CI requires zstd")
        result = self.run_backup()
        self.assert_success(result)
        backup = next(self.destination.glob("bot-*.sqlite.zst"))
        self.assert_rows(backup)
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    def test_corrupted_compression_is_rejected_before_publication(self):
        namespace = self.namespace()

        def corrupt(snapshot, archive, compression):
            archive.write_bytes(gzip.compress(b"not a SQLite file"))

        with mock.patch.dict(namespace["create_backup"].__globals__, {"compress_snapshot": corrupt}):
            with mock.patch.object(namespace["shutil"], "which", return_value=None):
                with contextlib.redirect_stderr(io.StringIO()) as output:
                    status = namespace["main"]()
        self.assertEqual(status, 1)
        self.assertIn("ERROR", output.getvalue())
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_truncated_compression_is_rejected_and_temp_files_are_removed(self):
        namespace = self.namespace()

        def truncate(snapshot, archive, compression):
            archive.write_bytes(gzip.compress(snapshot.read_bytes())[:-8])

        with mock.patch.dict(namespace["create_backup"].__globals__, {"compress_snapshot": truncate}):
            with mock.patch.object(namespace["shutil"], "which", return_value=None):
                with contextlib.redirect_stderr(io.StringIO()):
                    status = namespace["main"]()
        self.assertEqual(status, 1)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_daily_retention_counts_old_raw_and_compressed_copies_together(self):
        self.destination.mkdir()
        raw = automatic_name(2)
        compressed = automatic_name(1) + ".gz"
        write_pair(self.destination, raw, self.snapshot_bytes())
        write_pair(self.destination, compressed, gzip.compress(self.snapshot_bytes()))
        result = self.run_backup(keep=2)
        self.assert_success(result)
        self.assert_pair_exists(raw, False)
        self.assert_pair_exists(compressed, True)

    def test_pruning_keeps_last_good_daily_copy_when_newer_copy_is_corrupt(self):
        self.destination.mkdir()
        good = automatic_name(30)
        bad = automatic_name(1) + ".gz"
        write_pair(self.destination, good, self.snapshot_bytes())
        write_pair(self.destination, bad, gzip.compress(b"corrupt SQLite file"))
        namespace = self.namespace()
        with contextlib.redirect_stderr(io.StringIO()):
            namespace["prune_backups"](1)
        self.assert_pair_exists(good, True)
        self.assert_rows(self.destination / good)

    def recent_release(self, hours):
        stamp = datetime.now(UTC) - timedelta(hours=hours)
        return self.seed_release(stamp.strftime("pr2-%Y%m%d-%H%M%SZ"))

    def test_deploy_retention_keeps_three_copies_for_each_kind(self):
        releases = [self.recent_release(hours) for hours in range(1, 7)]
        # An incomplete deployment must not consume a drained copy's slot.
        shutil.rmtree(releases[0] / "drained")
        result = self.run_backup()
        self.assert_success(result)
        for index, release in enumerate(releases):
            with self.subTest(index=index):
                self.assertEqual(bool(list((release / "online").glob("*.sqlite*"))), index < 3)
                self.assertEqual(bool(list((release / "drained").glob("*.sqlite*"))), 1 <= index < 4)
                self.assertTrue((release / "runtime.env").exists())

    def test_deploy_count_is_configurable_and_counts_compressed_copies(self):
        releases = [self.recent_release(hours) for hours in range(1, 5)]
        for release in releases:
            for kind in ("online", "drained"):
                directory = release / kind
                raw = directory / "bot-20000101-000000Z.sqlite"
                compressed = raw.name + ".gz"
                write_pair(directory, compressed, gzip.compress(raw.read_bytes()))
                raw.unlink()
                Path(str(raw) + ".sha256").unlink()
        namespace = self.namespace()
        with mock.patch.dict(os.environ, {"DUELING_DEPLOY_BACKUP_KEEP": "2"}):
            namespace["prune_releases"]()
        for index, release in enumerate(releases):
            for kind in ("online", "drained"):
                pair = release / kind / "bot-20000101-000000Z.sqlite.gz"
                self.assertEqual(pair.exists(), index < 2)
                self.assertEqual(Path(str(pair) + ".sha256").exists(), index < 2)

    def test_deploy_run_prunes_across_the_parent_backup_root(self):
        root = self.destination
        releases = [self.recent_release(hours) for hours in range(1, 6)]
        fresh = root / datetime.now(UTC).strftime("pr2-%Y%m%d-%H%M%SZ")
        self.destination = fresh / "online"
        result = self.run_backup()
        self.assert_success(result)
        self.assertEqual(len(list(root.glob("pr2-*/online/*.sqlite*"))), 6)  # Three pairs.
        self.assertEqual(len(list(root.glob("pr2-*/drained/*.sqlite*"))), 6)
        self.assertTrue((releases[0] / "runtime.env").exists())

    def test_last_good_deploy_copy_survives_corrupt_newer_release_and_age_cap(self):
        good = self.seed_release("pr2-20000101-000000Z")
        bad = self.recent_release(1)
        for kind in ("online", "drained"):
            write_pair(bad / kind, "bot-20000101-000000Z.sqlite", b"bad database")
        namespace = self.namespace()
        with mock.patch.dict(os.environ, {"DUELING_DEPLOY_BACKUP_KEEP": "1"}):
            with contextlib.redirect_stderr(io.StringIO()):
                namespace["prune_releases"]()
        for kind in ("online", "drained"):
            self.assert_rows(good / kind / "bot-20000101-000000Z.sqlite")
        self.assertTrue((good / "runtime.env").exists())

    def test_disk_reserve_skips_without_pruning_the_last_good_backup(self):
        self.destination.mkdir()
        old = automatic_name(30)
        write_pair(self.destination, old, self.snapshot_bytes())
        namespace = self.namespace()
        output = io.StringIO()
        required = 3 * (self.source.stat().st_size + Path(str(self.source) + "-wal").stat().st_size)
        with mock.patch.dict(os.environ, {"DUELING_BACKUP_MIN_FREE_BYTES": "1048576"}):
            with mock.patch.object(namespace["shutil"], "disk_usage", return_value=SimpleNamespace(free=required + 1048575)):
                with contextlib.redirect_stderr(output):
                    status = namespace["main"]()
        self.assertEqual(status, 1)
        self.assertIn("SKIPPED", output.getvalue())
        self.assertIn("insufficient free space", output.getvalue())
        self.assert_pair_exists(old, True)
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    def test_invalid_disk_reserve_fails_before_creating_or_pruning_files(self):
        namespace = self.namespace()
        for value in ("-1", "bad", "1.5", ""):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"DUELING_BACKUP_MIN_FREE_BYTES": value}):
                with contextlib.redirect_stderr(io.StringIO()) as output:
                    self.assertEqual(namespace["main"](), 1)
                self.assertIn("DUELING_BACKUP_MIN_FREE_BYTES", output.getvalue())
        self.assertFalse(self.destination.exists())

    def run_restore(self, backup, target):
        return subprocess.run([sys.executable, str(RESTORE_SCRIPT), str(backup), str(target)],
                              env=self.environment(), capture_output=True, text=True, timeout=30)

    def test_restore_accepts_old_uncompressed_backup(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1), self.snapshot_bytes())
        target = self.root / "restored db?#.sqlite"
        result = self.run_restore(backup, target)
        self.assert_success(result)
        self.assert_rows(target)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(list(self.root.glob(".*.tmp")), [])

    def test_restore_accepts_gzip_backup(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1) + ".gz", gzip.compress(self.snapshot_bytes()))
        target = self.root / "restored.sqlite"
        result = self.run_restore(backup, target)
        self.assert_success(result)
        self.assert_rows(target)

    @unittest.skipUnless(shutil.which("zstd") or os.environ.get("CI") == "true", "zstd is not installed")
    def test_restore_accepts_zstd_backup(self):
        self.assertIsNotNone(shutil.which("zstd"), "CI requires zstd")
        result = self.run_backup()
        self.assert_success(result)
        backup = next(self.destination.glob("*.zst"))
        target = self.root / "restored.sqlite"
        result = self.run_restore(backup, target)
        self.assert_success(result)
        self.assert_rows(target)

    def test_restore_rejects_checksum_mismatch_without_output(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1) + ".gz", gzip.compress(self.snapshot_bytes()))
        backup.write_bytes(backup.read_bytes() + b"changed")
        target = self.root / "restored.sqlite"
        result = self.run_restore(backup, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("checksum", result.stderr.lower())
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".*.tmp")), [])

    def test_restore_rejects_corrupt_sqlite_after_decompression(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1) + ".gz", gzip.compress(b"not SQLite"))
        target = self.root / "restored.sqlite"
        result = self.run_restore(backup, target)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".*.tmp")), [])

    def test_restore_refuses_existing_target_or_wal(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1), self.snapshot_bytes())
        target = self.root / "restored.sqlite"
        for suffix in ("", "-wal", "-shm"):
            with self.subTest(suffix=suffix):
                protected = Path(str(target) + suffix)
                protected.write_bytes(b"preserve live files")
                result = self.run_restore(backup, target)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(protected.read_bytes(), b"preserve live files")
                protected.unlink()

    def test_restore_rejects_missing_sidecar(self):
        self.destination.mkdir()
        backup, sidecar = write_pair(self.destination, automatic_name(1), self.snapshot_bytes())
        sidecar.unlink()
        target = self.root / "restored.sqlite"
        result = self.run_restore(backup, target)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(target.exists())

    def test_deploy_count_rejects_invalid_settings_before_any_backup(self):
        namespace = self.namespace()
        for value in ("0", "-1", "bad", "1.5", ""):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"DUELING_DEPLOY_BACKUP_KEEP": value}):
                with contextlib.redirect_stderr(io.StringIO()) as output:
                    self.assertEqual(namespace["main"](), 1)
                self.assertIn("DUELING_DEPLOY_BACKUP_KEEP", output.getvalue())
        self.assertFalse(self.destination.exists())

    def test_daily_fails_fast_but_deploy_kinds_wait_for_the_root_lock(self):
        self.destination.mkdir()
        root = self.destination
        fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for kind in (None, "online", "drained"):
                with self.subTest(kind=kind):
                    self.destination = root if kind is None else root / "pr2-20261011-000000Z" / kind
                    environment = self.environment()
                    environment["DUELING_BACKUP_LOCK_WAIT_SECONDS"] = "1"
                    started = time.monotonic()
                    result = subprocess.run([sys.executable, str(BACKUP_SCRIPT)], env=environment,
                                            capture_output=True, text=True, timeout=5)
                    elapsed = time.monotonic() - started
                    self.assertEqual(result.returncode, 1)
                    if kind is None:
                        self.assertIn("another backup is already running", result.stderr)
                        self.assertLess(elapsed, 1)
                    else:
                        self.assertIn("timed out", result.stderr)
                        self.assertGreaterEqual(elapsed, 1)
                    self.assertEqual(list(root.rglob("*.sqlite*")), [])
        finally:
            os.close(fd)

    def test_failed_compressor_preserves_old_backup_and_removes_temporary_files(self):
        self.destination.mkdir()
        name = automatic_name(1)
        write_pair(self.destination, name, self.snapshot_bytes())
        namespace = self.namespace()
        with mock.patch.dict(namespace["create_backup"].__globals__,
                             {"compress_snapshot": mock.Mock(side_effect=OSError("compressor failed"))}):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(namespace["main"](), 1)
        self.assert_pair_exists(name, True)
        self.assert_rows(self.destination / name)
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    def test_sidecar_rename_failure_removes_partial_publication_and_keeps_old_copy(self):
        self.destination.mkdir()
        name = automatic_name(1)
        write_pair(self.destination, name, self.snapshot_bytes())
        namespace = self.namespace()
        rename = namespace["os"].rename

        def fail_sidecar(source, target):
            if str(target).endswith(".sha256"):
                raise OSError("sidecar rename failed")
            return rename(source, target)

        with mock.patch.object(namespace["os"], "rename", side_effect=fail_sidecar):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(namespace["main"](), 1)
        self.assert_pair_exists(name, True)
        self.assertEqual(set(p.name for p in self.destination.iterdir()), {name, name + ".sha256"})

    def test_unverifiable_deploy_kind_is_not_pruned(self):
        releases = [self.recent_release(hours) for hours in range(1, 5)]
        for release in releases:
            raw = release / "drained/bot-20000101-000000Z.sqlite"
            write_pair(raw.parent, raw.name, b"bad database")
        namespace = self.namespace()
        with contextlib.redirect_stderr(io.StringIO()) as output:
            namespace["prune_releases"]()
        self.assertIn("cannot verify", output.getvalue())
        self.assertEqual(sum((release / "online/bot-20000101-000000Z.sqlite").exists() for release in releases), 3)
        for release in releases:
            self.assertTrue((release / "drained/bot-20000101-000000Z.sqlite").exists())

    def test_restore_verify_only_removes_its_temporary_file(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1) + ".gz", gzip.compress(self.snapshot_bytes()))
        result = subprocess.run([sys.executable, str(RESTORE_SCRIPT), "--verify", str(backup)],
                                env=self.environment(), capture_output=True, text=True, timeout=30)
        self.assert_success(result)
        self.assertIn("Verified", result.stdout)
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    def test_restore_refuses_symlinked_backup_sidecar_and_target_parent(self):
        self.destination.mkdir()
        backup, sidecar = write_pair(self.destination, automatic_name(1), self.snapshot_bytes())
        alias = self.root / "alias.sqlite"
        alias.symlink_to(backup)
        target = self.root / "restored.sqlite"
        result = self.run_restore(alias, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("symlink", result.stderr)
        original_checksum = self.root / "checksum.txt"
        sidecar.rename(original_checksum)
        sidecar.symlink_to(original_checksum)
        result = self.run_restore(backup, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("symlink", result.stderr)
        sidecar.unlink()
        original_checksum.rename(sidecar)
        parent = self.root / "linked-parent"
        parent.symlink_to(self.destination, target_is_directory=True)
        result = self.run_restore(backup, parent / "restored.sqlite")
        self.assertEqual(result.returncode, 1)
        self.assertIn("symlink", result.stderr)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.destination.glob(".*.tmp")), [])

    def test_restore_cannot_overwrite_a_target_created_during_publication(self):
        self.destination.mkdir()
        backup, _ = write_pair(self.destination, automatic_name(1), self.snapshot_bytes())
        target = self.root / "restored.sqlite"
        namespace = self.namespace()
        lexists = namespace["os"].path.lexists
        checks = 0

        def concurrent_writer(path):
            nonlocal checks
            exists = lexists(path)
            if str(path) == str(target) + "-journal":
                checks += 1
                if checks == 2:
                    target.write_bytes(b"concurrent writer's file")
            return exists

        with mock.patch.object(namespace["os"].path, "lexists", side_effect=concurrent_writer):
            with self.assertRaises(FileExistsError):
                namespace["restore_backup"](backup, target)
        self.assertEqual(target.read_bytes(), b"concurrent writer's file")
        self.assertEqual(list(self.root.glob(".*.tmp")), [])

    def test_deploy_and_daily_service_use_the_same_vm_backup_config(self):
        workflow = KIT_DIR.parents[1] / ".github/workflows/deploy.yml"
        text = workflow.read_text()
        self.assertIn('. /etc/default/dueling-backup', text)
        self.assertNotIn('vars.DUELING_DEPLOY_BACKUP_KEEP', text)
        self.assertNotIn('vars.DUELING_BACKUP_MIN_FREE_BYTES', text)
        self.assertIn('EnvironmentFile=-/etc/default/dueling-backup',
                      (KIT_DIR / 'dueling-backup.service').read_text())

    def test_deploy_stop_hook_refuses_new_activity_after_the_lock_wait(self):
        text = (KIT_DIR.parents[1] / ".github/workflows/deploy.yml").read_text()
        hook = text.split("--before-backup sh -eu -c '", 1)[1].split("\n               '", 1)[0]
        guard = self.root / "refuse-activity.py"
        guard.write_text("raise SystemExit(1)\n")
        marker = self.root / "stopped-services"
        docker = self.root / "docker"
        docker.write_text('#!/bin/sh\nprintf stopped > "' + str(marker) + '"\n')
        docker.chmod(0o700)
        environment = self.environment()
        environment.update(DEPLOY_GUARD=str(guard), DEPLOY_FORCE="false", RETIRED_BOT_IDS="example-bot",
                           PATH=str(self.root) + os.pathsep + environment["PATH"])
        result = subprocess.run(["sh", "-eu", "-c", hook], env=environment,
                                capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Do not run compose up", result.stderr)
        self.assertFalse(marker.exists())

    def test_missing_zstd_keeps_unverifiable_deploy_copies(self):
        releases = [self.recent_release(hours) for hours in range(1, 5)]
        for release in releases:
            directory = release / "drained"
            raw = directory / "bot-20000101-000000Z.sqlite"
            # The command is missing, so decoding must fail before these bytes matter.
            write_pair(directory, raw.name + ".zst", b"unavailable codec fixture")
            raw.unlink()
            Path(str(raw) + ".sha256").unlink()
        namespace = self.namespace()
        with mock.patch.object(namespace["subprocess"], "run", side_effect=FileNotFoundError("zstd missing")):
            with contextlib.redirect_stderr(io.StringIO()) as output:
                namespace["prune_releases"]()
        self.assertIn("zstd missing", output.getvalue())
        for release in releases:
            self.assertTrue((release / "drained/bot-20000101-000000Z.sqlite.zst").exists())
            self.assertEqual(list(release.rglob(".*.tmp")), [])

    def test_deploy_backups_succeed_when_the_root_lock_is_released(self):
        root = self.destination
        root.mkdir()
        for kind, delay in (("online", 0.2), ("drained", 2)):
            with self.subTest(kind=kind):
                fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                release = threading.Timer(delay, fcntl.flock, args=(fd, fcntl.LOCK_UN))
                release.start()
                try:
                    self.destination = root / "pr2-20261011-000000Z" / kind
                    result = self.run_backup()
                    self.assert_success(result)
                    self.assert_rows(next(path for path in self.destination.glob("bot-*.sqlite.*")
                                          if path.suffix != ".sha256"))
                finally:
                    release.cancel()
                    release.join()
                    os.close(fd)

    def test_invalid_lock_wait_fails_before_the_stop_command(self):
        self.destination = self.destination / "pr2-20261011-000000Z/drained"
        namespace = self.namespace()
        for value in ("-1", "bad", "1.5", ""):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"DUELING_BACKUP_LOCK_WAIT_SECONDS": value}):
                with mock.patch.object(namespace["subprocess"], "run") as stop:
                    with contextlib.redirect_stderr(io.StringIO()) as output:
                        self.assertEqual(namespace["main"](["--before-backup", "stop-fixture"]), 1)
                    stop.assert_not_called()
                    self.assertIn("DUELING_BACKUP_LOCK_WAIT_SECONDS", output.getvalue())

    def test_lock_timeout_never_calls_the_stop_command(self):
        root = self.destination
        root.mkdir()
        fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.destination = root / "pr2-20261011-000000Z/drained"
            namespace = self.namespace()
            with mock.patch.dict(os.environ, {"DUELING_BACKUP_LOCK_WAIT_SECONDS": "0"}):
                with mock.patch.object(namespace["subprocess"], "run") as stop:
                    with contextlib.redirect_stderr(io.StringIO()) as output:
                        self.assertEqual(namespace["main"](["--before-backup", "stop-fixture"]), 1)
                    stop.assert_not_called()
                    self.assertIn("timed out", output.getvalue())
        finally:
            os.close(fd)

    def test_drained_stop_hook_runs_after_preflight_under_the_same_lock(self):
        root = self.destination
        self.destination = root / "pr2-20261011-000000Z/drained"
        namespace = self.namespace()

        def stop_services(command, **kwargs):
            self.assertEqual(command, ["stop-fixture"])
            self.assertTrue(kwargs["check"])
            self.assertEqual(list(self.destination.iterdir()), [])
            fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(fd)
            return SimpleNamespace(returncode=0)

        with mock.patch.object(namespace["shutil"], "which", return_value=None):
            with mock.patch.object(namespace["shutil"], "disk_usage", return_value=SimpleNamespace(free=10**12)) as space:
                with mock.patch.object(namespace["subprocess"], "run", side_effect=stop_services) as stop:
                    backup, *_ = namespace["create_backup"](before_backup=["stop-fixture"])
                stop.assert_called_once()
                space.assert_called_once()
        self.assert_rows(backup)

    def test_low_space_after_online_backup_stops_before_service_shutdown(self):
        root = self.destination
        self.destination = root / "pr2-20261011-000000Z/online"
        namespace = self.namespace()
        with mock.patch.object(namespace["shutil"], "disk_usage", return_value=SimpleNamespace(free=10**12)):
            online, *_ = namespace["create_backup"]()
        self.destination = root / "pr2-20261011-000000Z/drained"
        namespace = self.namespace()
        with mock.patch.object(namespace["shutil"], "disk_usage", return_value=SimpleNamespace(free=0)):
            with mock.patch.object(namespace["subprocess"], "run") as stop:
                with contextlib.redirect_stderr(io.StringIO()) as output:
                    status = namespace["main"](["--before-backup", "stop-fixture"])
                stop.assert_not_called()
        self.assertEqual(status, 1)
        self.assertIn("SKIPPED", output.getvalue())
        self.assert_rows(online)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_space_only_mode_creates_no_snapshot_and_does_not_prune(self):
        self.destination.mkdir()
        old, _ = write_pair(self.destination, automatic_name(30), self.snapshot_bytes())
        namespace = self.namespace()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(namespace["main"](["--check-space"]), 0)
        self.assertEqual(set(self.destination.iterdir()), {old, Path(str(old) + ".sha256")})

    def test_drained_backup_never_prunes_or_rechecks_the_online_copy(self):
        release = self.recent_release(1)
        self.destination = release / "drained"
        namespace = self.namespace()
        prune = mock.Mock(side_effect=AssertionError("drained pruning"))
        verify = mock.Mock(side_effect=AssertionError("online recheck"))
        with mock.patch.dict(namespace["create_backup"].__globals__,
                             {"prune_releases": prune, "verify_backup": verify}):
            backup, *_ = namespace["create_backup"]()
        prune.assert_not_called()
        verify.assert_not_called()
        self.assert_rows(backup)
        self.assertTrue((release / "online/bot-20000101-000000Z.sqlite").exists())

    def test_daily_run_does_not_reverify_deploy_copies_within_retention_limits(self):
        self.recent_release(1)
        self.recent_release(2)
        namespace = self.namespace()
        verify = mock.Mock(side_effect=AssertionError("unneeded deploy verification"))
        with mock.patch.dict(namespace["create_backup"].__globals__, {"verify_backup": verify}):
            namespace["create_backup"]()
        verify.assert_not_called()

    def test_signal_during_compression_removes_all_temporary_files(self):
        root = self.destination
        code = '''
import runpy, sys, time
kit = runpy.run_path(sys.argv[1])
def slow_compress(snapshot, archive, compression):
    archive.write_bytes(b"partial archive")
    print("compressing", flush=True)
    time.sleep(60)
kit["create_backup"].__globals__["compress_snapshot"] = slow_compress
sys.exit(kit["main"]())
'''
        for signum in (signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=signum):
                self.destination = root / str(signum)
                process = subprocess.Popen([sys.executable, "-u", "-c", code, str(BACKUP_SCRIPT)],
                                           env=self.environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True)
                try:
                    ready, _, _ = select.select([process.stdout], [], [], 5)
                    self.assertTrue(ready, "compressor did not start")
                    self.assertEqual(process.stdout.readline().strip(), "compressing")
                    process.send_signal(signum)
                    process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 128 + signum)
                    self.assertEqual(list(self.destination.iterdir()), [])
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.communicate(timeout=5)

    def test_stale_sweep_removes_old_temps_journals_and_orphan_sidecars_under_lock(self):
        root = self.destination
        release = self.recent_release(1)
        old = time.time() - 7 * 3600
        stale = []
        recent = []
        for directory in (root, release / "online", release / "drained"):
            for prefix in ("backup", "compressed", "verify", "sha256"):
                for suffix in ("", "-journal", "-wal", "-shm"):
                    path = directory / (".dueling-" + prefix + "-stale.tmp" + suffix)
                    path.write_bytes(b"old incomplete data")
                    os.utime(path, (old, old))
                    stale.append(path)
            orphan = directory / (automatic_name(2) + ".gz.sha256")
            orphan.write_bytes(b"old orphan sidecar")
            os.utime(orphan, (old, old))
            stale.append(orphan)
            fresh = directory / ".dueling-backup-recent.tmp"
            fresh.write_bytes(b"recent incomplete data")
            recent.append(fresh)
        protected = root / ".dueling-unmanaged-stale.tmp"
        protected.write_bytes(b"keep")
        os.utime(protected, (old, old))
        result = self.run_backup()
        self.assert_success(result)
        self.assertTrue(all(not path.exists() for path in stale))
        self.assertTrue(all(path.exists() for path in recent))
        self.assertEqual(protected.read_bytes(), b"keep")

    def test_stale_sweep_never_follows_symlinks_or_unmanaged_release_directories(self):
        self.destination.mkdir()
        outside = self.root / "outside.tmp"
        outside.write_bytes(b"keep")
        old = time.time() - 7 * 3600
        os.utime(outside, (old, old))
        link = self.destination / ".dueling-backup-linked.tmp"
        link.symlink_to(outside)
        unmanaged = self.destination / "manual-release"
        unmanaged.mkdir()
        nested = unmanaged / ".dueling-backup-stale.tmp"
        nested.write_bytes(b"keep")
        os.utime(nested, (old, old))
        self.assert_success(self.run_backup())
        self.assertTrue(link.is_symlink())
        self.assertEqual(outside.read_bytes(), b"keep")
        self.assertEqual(nested.read_bytes(), b"keep")

    def test_failed_root_lock_does_not_sweep_stale_files(self):
        self.destination.mkdir()
        stale = self.destination / ".dueling-backup-stale.tmp"
        stale.write_bytes(b"keep until locked")
        old = time.time() - 7 * 3600
        os.utime(stale, (old, old))
        fd = os.open(str(self.destination), os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.run_backup().returncode, 1)
            self.assertTrue(stale.exists())
        finally:
            os.close(fd)

    def test_archive_is_published_after_the_sidecar_even_if_publication_is_interrupted(self):
        self.destination.mkdir()
        namespace = self.namespace()
        rename = namespace["os"].rename
        targets = []

        def interrupted_rename(source, target):
            targets.append(target)
            if len(targets) == 2:
                raise SystemExit(143)
            return rename(source, target)

        with mock.patch.object(namespace["os"], "rename", side_effect=interrupted_rename):
            with self.assertRaises(SystemExit):
                namespace["create_backup"]()
        self.assertTrue(str(targets[0]).endswith(".sha256"))
        self.assertFalse(str(targets[1]).endswith(".sha256"))
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_gzip_fallback_uses_fast_compression(self):
        namespace = self.namespace()
        gzip_open = gzip.open
        with mock.patch.object(namespace["shutil"], "which", return_value=None):
            with mock.patch.object(namespace["gzip"], "open", wraps=gzip_open) as compressed:
                namespace["create_backup"]()
        writes = [call for call in compressed.call_args_list if call.args[1] == "wb"]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].kwargs["compresslevel"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
