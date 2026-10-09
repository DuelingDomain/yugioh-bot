"""Local deploy safety checks. No SSH, Docker daemon or production files are used."""
import fcntl
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "scripts/deployment/check-prod-activity.py"
REMOTE = ROOT / "scripts/staging/remote-deploy.sh"


class ProductionActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "bot.sqlite"
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript("""
            create table duels (status text);
            create table drafts (status text);
            create table tournaments (id integer, status text);
            create table tournament_matches (tournament_id integer, round_number integer, status text);
            create table duel_series (status text);
        """)

    def run_guard(self, force="false"):
        return subprocess.run(
            ["python3", str(GUARD), str(self.path), "--force", force],
            text=True, capture_output=True, timeout=10,
        )

    def test_idle_database_passes_without_changes(self):
        self.db.executescript("""
            insert into duels values ('lobby'), ('completed'), ('interrupted');
            insert into drafts values ('pending'), ('completed');
            insert into tournaments values (1, 'completed'), (2, 'pending');
            insert into tournament_matches values (1, 1, 'open'), (2, 1, 'open');
            insert into duel_series values ('completed'), ('cancelled');
        """)
        before = self.path.read_bytes()
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("duels=0 drafts=0 tournament_rounds=0 series=0", result.stdout)
        self.assertEqual(self.path.read_bytes(), before)

    def test_each_active_game_type_refuses_and_force_overrides(self):
        for statement in [
            "insert into duels values ('active')",
            "insert into drafts values ('active')",
            "insert into duel_series values ('active')",
            "insert into duel_series values ('between_games')",
        ]:
            with self.subTest(statement=statement):
                self.db.execute(statement)
                self.db.commit()
                result = self.run_guard()
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("Production deploy refused", result.stderr)
                self.assertEqual(self.run_guard("true").returncode, 0)
                for table in ("duels", "drafts", "duel_series"):
                    self.db.execute(f"delete from {table}")
                self.db.commit()

    def test_open_and_pending_approval_rounds_refuse_without_a_duel(self):
        self.db.execute("insert into tournaments values (1, 'active')")
        for status in ("open", "pending_approval"):
            with self.subTest(status=status):
                self.db.execute("delete from tournament_matches")
                self.db.executemany(
                    "insert into tournament_matches values (1, ?, ?)", [(1, status), (1, status), (2, status)]
                )
                self.db.commit()
                result = self.run_guard()
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("tournament_rounds=2", result.stdout)

    def test_committed_wal_activity_is_seen(self):
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("insert into drafts values ('active')")
        self.db.commit()
        self.assertTrue(Path(str(self.path) + "-wal").exists())
        result = self.run_guard()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("drafts=1", result.stdout)
        self.assertEqual(self.db.execute("select count(*) from drafts").fetchone()[0], 1)

    def test_missing_corrupt_locked_and_incomplete_databases_fail_closed(self):
        missing = Path(self.tmp.name) / "missing.sqlite"
        result = subprocess.run(["python3", str(GUARD), str(missing)], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(missing.exists())
        self.db.execute("begin exclusive")
        self.assertEqual(self.run_guard().returncode, 1)
        self.db.rollback()
        self.db.execute("drop table drafts")
        self.db.commit()
        self.assertEqual(self.run_guard().returncode, 1)
        self.db.close()
        self.path.write_bytes(b"not a database")
        self.assertEqual(self.run_guard().returncode, 1)
        self.assertEqual(self.run_guard("true").returncode, 0)


class StagingResourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.staging = self.root / "staging"
        self.scripts = self.staging / "scripts/staging"
        self.scripts.mkdir(parents=True)
        (self.staging / ".git").mkdir()
        (self.staging / ".env.staging").touch()
        (self.staging / "data-staging").mkdir()
        (self.staging / "data-staging/bot.sqlite").touch()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.log"
        self.meminfo = self.root / "meminfo"
        self.set_memory(3000)
        self.lock = self.root / "build.lock"
        self.bundle = self.root / "bundle.tar.gz"
        contents = self.root / "contents"
        contents.mkdir()
        for core in ("ocgcore.multi", "ocgcore.multi-domain"):
            (contents / f"{core}.SOURCE").write_text("test source\n")
            (self.staging / f"data-staging/duel-engine").mkdir(exist_ok=True)
            (self.staging / f"data-staging/duel-engine/{core}.SOURCE").write_text("test source\n")
        with tarfile.open(self.bundle, "w:gz") as archive:
            archive.add(contents, arcname=".")
        self.command("git", 'echo "git $*" >> "$TEST_LOG"\n[ "$1" != rev-parse ] || echo 0123456\n')
        self.command("pgrep", 'exit "${TEST_BUSY_BUILD:-1}"\n')
        self.command("df", 'printf "Filesystem Size Used Avail Use%% Mounted\\nfixture 20000 1000 19000 5%% /opt\\n"\n')
        self.command("docker", 'echo "docker $*" >> "$TEST_LOG"\n')
        (self.scripts / "compose.sh").write_text('''#!/bin/sh
echo "compose $*" >> "$TEST_LOG"
if [ "$1" = build ] && [ "${TEST_LOW_AFTER_BUILD:-0}" = 1 ]; then
  printf 'MemTotal: 4194304 kB\nMemAvailable: 512000 kB\n' > "$STAGING_MEMINFO_FILE"
fi
''')
        (self.scripts / "check-resources.sh").write_text((ROOT / "scripts/staging/check-resources.sh").read_text())
        for name in ("interrupt-active-duels.sh", "install-staging-bundle.sh", "health-check.sh", "remove-old-images.sh"):
            (self.scripts / name).write_text("#!/bin/sh\nexit 0\n")
        installer = self.staging / "packages/duel-server/scripts/install-engine-bundle.sh"
        installer.parent.mkdir(parents=True)
        installer.write_text("#!/bin/sh\nexit 0\n")

    def command(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def set_memory(self, mb):
        self.meminfo.write_text(f"MemTotal: 4194304 kB\nMemAvailable: {mb * 1024} kB\n")

    def run_remote(self, **extra):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                   TEST_LOG=str(self.log), STAGING_DIR=str(self.staging),
                   STAGING_BUILD_LOCK=str(self.lock), STAGING_LOCK_WAIT_S="0",
                   STAGING_MEMINFO_FILE=str(self.meminfo), STAGING_BUNDLE=str(self.bundle),
                   STAGING_REF="main", STAGING_COMMIT="a" * 40, **extra)
        return subprocess.run(["sh", str(REMOTE)], env=env, text=True, capture_output=True, timeout=10)

    def test_busy_lock_skips_before_checkout_or_context_cleanup(self):
        context = self.staging / ".deploy-duel-engine"
        context.mkdir()
        marker = context / "keep"
        marker.touch()
        with self.lock.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        self.assertFalse(self.log.exists())
        self.assertTrue(marker.exists())

    def test_low_memory_before_build_skips_without_build_or_start(self):
        self.set_memory(500)
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        log = self.log.read_text()
        self.assertNotIn("compose build", log)
        self.assertNotIn("compose up", log)

    def test_low_memory_before_start_leaves_staging_down(self):
        result = self.run_remote(TEST_LOW_AFTER_BUILD="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        log = self.log.read_text()
        self.assertIn("compose build", log)
        self.assertNotIn("compose up", log)

    def test_another_build_skips_without_building(self):
        result = self.run_remote(TEST_BUSY_BUILD="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        self.assertNotIn("compose build", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
