"""Local deploy safety checks. No SSH, Docker daemon or production files are used."""
import fcntl
import importlib.util
import io
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch


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
            create table duels (status text, opening_json text);
            create table drafts (status text);
            create table tournaments (id integer, status text);
            create table tournament_matches (tournament_id integer, round_number integer, status text);
            create table duel_series (status text);
        """)

    def run_guard(self, force="false", target=None, live_only=False):
        command = ["python3", str(GUARD), str(self.path), "--force", force]
        if target:
            command.extend(["--target", target])
        if live_only:
            command.append("--live-only")
        return subprocess.run(
            command,
            text=True, capture_output=True, timeout=10,
        )

    def run_waiting_guard(self, wait, sleep_action=None, force="false", live_only=False):
        spec = importlib.util.spec_from_file_location("activity_guard", GUARD)
        guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guard)
        clock = [0]

        def sleep(seconds):
            clock[0] += seconds
            if sleep_action:
                sleep_action()

        out, err = io.StringIO(), io.StringIO()
        command = [str(GUARD), str(self.path), "--wait-seconds", str(wait), "--force", force]
        if live_only:
            command.append("--live-only")
        with patch("sys.argv", command), \
                patch("time.monotonic", side_effect=lambda: clock[0]), \
                patch("time.sleep", side_effect=sleep) as slept, \
                redirect_stdout(out), redirect_stderr(err):
            try:
                result = guard.main()
            except SystemExit as error:
                result = error.code
        return result, out.getvalue(), err.getvalue(), slept

    def test_wait_rechecks_committed_activity_then_deploys_when_idle(self):
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("insert into duels (status) values ('active')")
        self.db.commit()

        def finish_game():
            self.db.execute("update duels set status='completed'")
            self.db.commit()

        result, out, err, slept = self.run_waiting_guard(3600, finish_game)
        self.assertEqual(result, 0, err)
        slept.assert_called_once_with(120)
        self.assertIn("duels=1", out)
        self.assertIn("duels=0", out)

    def test_wait_times_out_after_an_hour_without_changing_active_games(self):
        self.db.execute("insert into drafts values ('active')")
        self.db.commit()
        result, out, err, slept = self.run_waiting_guard(3600)
        self.assertEqual(result, 1)
        self.assertEqual(slept.call_count, 30)
        self.assertEqual(sum(call.args[0] for call in slept.call_args_list), 3600)
        self.assertIn("still active after waiting 3600 seconds", err)
        self.assertIn("manual Deploy or the next merge", err)
        self.assertEqual(self.db.execute("select status from drafts").fetchone()[0], "active")

    def test_wait_uses_remaining_budget_and_manual_force_still_bypasses_only_activity(self):
        self.db.execute("insert into duel_series values ('between_games')")
        self.db.commit()
        result, _, _, slept = self.run_waiting_guard(121)
        self.assertEqual(result, 1)
        self.assertEqual([call.args[0] for call in slept.call_args_list], [120, 1])
        result, out, _, slept = self.run_waiting_guard(3600, force="true")
        self.assertEqual(result, 0)
        slept.assert_not_called()
        self.assertIn("Engine preflight still applies", out)

    def test_wait_fails_closed_immediately_when_activity_cannot_be_read(self):
        self.db.execute("drop table drafts")
        self.db.commit()
        result, _, err, slept = self.run_waiting_guard(3600)
        self.assertEqual(result, 1)
        self.assertIn("cannot read gameplay activity", err)
        slept.assert_not_called()

    def test_idle_database_passes_without_changes(self):
        self.db.executescript("""
            insert into duels (status) values ('lobby'), ('completed'), ('interrupted');
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
            "insert into duels (status) values ('active')",
            "insert into duels values ('lobby', '{\"phase\":\"rps\"}')",
            "insert into duels values ('lobby', '{\"phase\":\"dice\"}')",
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

    def test_live_only_reports_open_rounds_and_series_without_blocking(self):
        self.db.executescript("""
            insert into tournaments values (1, 'active');
            insert into tournament_matches values (1, 1, 'open'), (1, 2, 'pending_approval');
            insert into duel_series values ('active'), ('between_games');
        """)
        before = self.path.read_bytes()
        result = self.run_guard(live_only=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("duels=0 drafts=0 (not blocking: tournament_rounds=2 series=2)", result.stdout)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.run_guard().returncode, 1)

    def test_live_only_still_refuses_live_duels_openings_and_drafts(self):
        for statement in [
            "insert into duels (status) values ('active')",
            "insert into duels values ('lobby', '{\"phase\":\"rps\"}')",
            "insert into duels values ('lobby', '{\"phase\":\"dice\"}')",
            "insert into drafts values ('active')",
        ]:
            with self.subTest(statement=statement):
                self.db.execute(statement)
                self.db.commit()
                result = self.run_guard(live_only=True)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("Production deploy refused: gameplay is active", result.stderr)
                for table in ("duels", "drafts"):
                    self.db.execute(f"delete from {table}")
                self.db.commit()

    def test_live_only_wait_finishes_after_live_game_even_with_open_series(self):
        self.db.execute("pragma journal_mode=wal")
        self.db.executescript("""
            insert into duels (status) values ('active');
            insert into duel_series values ('between_games');
        """)

        def finish_game():
            self.db.execute("update duels set status='completed'")
            self.db.commit()

        result, out, err, slept = self.run_waiting_guard(3600, finish_game, live_only=True)
        self.assertEqual(result, 0, err)
        slept.assert_called_once_with(120)
        self.assertIn("duels=1", out)
        self.assertIn("duels=0 drafts=0 (not blocking: tournament_rounds=0 series=1)", out)

    def test_live_only_fails_closed_when_any_activity_count_cannot_be_read(self):
        for table in ("duels", "drafts", "tournaments", "tournament_matches", "duel_series"):
            with self.subTest(table=table):
                schema = self.db.execute("select sql from sqlite_master where name=?", (table,)).fetchone()[0]
                self.db.execute(f"drop table {table}")
                self.db.commit()
                result, _, err, slept = self.run_waiting_guard(3600, live_only=True)
                self.assertEqual(result, 1)
                self.assertIn("cannot read gameplay activity", err)
                slept.assert_not_called()
                self.db.execute(schema)
                self.db.commit()

    def test_committed_wal_activity_is_seen(self):
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("insert into drafts values ('active')")
        self.db.commit()
        self.assertTrue(Path(str(self.path) + "-wal").exists())
        result = self.run_guard()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("drafts=1", result.stdout)
        self.assertEqual(self.db.execute("select count(*) from drafts").fetchone()[0], 1)

    def test_staging_ignores_open_rounds_and_series(self):
        self.db.executescript("""
            insert into tournaments values (1, 'active');
            insert into tournament_matches values (1, 1, 'open'), (1, 2, 'pending_approval');
            insert into duel_series values ('active'), ('between_games');
        """)
        result = self.run_guard(target="staging")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("duels=0 drafts=0", result.stdout)
        self.assertNotIn("tournament_rounds=", result.stdout)
        self.assertNotIn("series=", result.stdout)
        self.assertEqual(self.run_guard().returncode, 1)

    def test_staging_refuses_live_duels_openings_and_drafts_with_its_own_label(self):
        for statement in [
            "insert into duels (status) values ('active')",
            "insert into duels values ('lobby', '{\"phase\":\"rps\"}')",
            "insert into duels values ('lobby', '{\"phase\":\"dice\"}')",
            "insert into drafts values ('active')",
        ]:
            with self.subTest(statement=statement):
                self.db.execute(statement)
                self.db.commit()
                result = self.run_guard(target="staging")
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("Staging deploy skipped: production is busy", result.stderr)
                self.assertNotIn("Production deploy refused", result.stderr)
                for table in ("duels", "drafts"):
                    self.db.execute(f"delete from {table}")
                self.db.commit()

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
        self.prod = self.root / "prod.sqlite"
        self.guard = self.root / "guard.py"
        self.guard.write_text(GUARD.read_text())
        with sqlite3.connect(self.prod) as db:
            db.executescript("""
                create table duels (status text, opening_json text);
                create table drafts (status text);
                create table tournaments (id integer, status text);
                create table tournament_matches (tournament_id integer, round_number integer, status text);
                create table duel_series (status text);
            """)
        # Map the fixed production path to a fixture; no production files are opened.
        self.remote = self.root / "remote-deploy.sh"
        self.remote.write_text(REMOTE.read_text().replace(
            '"$prod_dir/data/bot.sqlite"', f'"{self.prod}"'
        ))
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
        self.command("df", '''disk=${TEST_DISK_MB:-19000}
if grep -q '^compose build$' "$TEST_LOG" 2>/dev/null; then disk=${TEST_DISK_AFTER_BUILD_MB:-$disk}; fi
printf "Filesystem Size Used Avail Use%% Mounted\\nfixture 20000 1000 %s 5%% /opt\\n" "$disk"
''')
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
        env.update(STAGING_GUARD=str(self.guard))
        return subprocess.run(["sh", str(self.remote)], env=env, text=True, capture_output=True, timeout=10)

    def assert_skip_reported(self, result):
        self.assertIn("::warning title=Staging skipped::", result.stdout)

    def command_log(self):
        return self.log.read_text() if self.log.exists() else ""

    def test_active_production_duel_skips_without_stopping_or_building_staging(self):
        with sqlite3.connect(self.prod) as db:
            db.execute("insert into duels (status) values ('active')")
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("duels=1", result.stdout)
        log = self.command_log()
        self.assertNotIn("git fetch", log)
        self.assertNotIn("git reset", log)
        self.assertNotIn("compose stop", log)
        self.assertNotIn("compose build", log)
        self.assertNotIn("compose up", log)
        self.assertIn("Staging deploy skipped: production is busy", result.stderr)
        self.assertNotIn("Production deploy refused", result.stderr)
        self.assert_skip_reported(result)

    def test_failed_production_guard_skips_without_stopping_or_building_staging(self):
        self.prod.unlink()
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.command_log()
        self.assertNotIn("git fetch", log)
        self.assertNotIn("git reset", log)
        self.assertNotIn("compose stop", log)
        self.assertNotIn("compose build", log)
        self.assert_skip_reported(result)

    def test_missing_production_guard_skips_without_stopping_or_building_staging(self):
        self.guard.unlink()
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.command_log()
        self.assertNotIn("git fetch", log)
        self.assertNotIn("git reset", log)
        self.assertNotIn("compose stop", log)
        self.assertNotIn("compose build", log)
        self.assert_skip_reported(result)

    def test_open_tournament_round_builds_when_ignore_prod_activity_is_on(self):
        with sqlite3.connect(self.prod) as db:
            db.executescript("""
                insert into tournaments values (1, 'active');
                insert into tournament_matches values (1, 1, 'open');
            """)
        result = self.run_remote(STAGING_IGNORE_PROD_ACTIVITY="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("compose build", self.command_log())
        self.assertIn("compose up -d", self.command_log())
        self.assertIn("ignore_prod_activity=true", result.stdout)

    def test_open_tournament_round_builds_without_override(self):
        with sqlite3.connect(self.prod) as db:
            db.executescript("""
                insert into tournaments values (1, 'active');
                insert into tournament_matches values (1, 1, 'open');
                insert into duel_series values ('between_games');
            """)
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("compose build", self.command_log())

    def test_ignore_prod_activity_builds_with_live_production_duel_and_no_guard(self):
        with sqlite3.connect(self.prod) as db:
            db.execute("insert into duels (status) values ('active')")
        self.guard.unlink()
        result = self.run_remote(STAGING_IGNORE_PROD_ACTIVITY="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("compose build", self.command_log())

    def test_ignore_prod_activity_keeps_the_build_lock(self):
        with self.lock.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_remote(STAGING_IGNORE_PROD_ACTIVITY="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_skip_reported(result)
        self.assertEqual(self.command_log(), "")

    def test_ignore_prod_activity_keeps_resource_checks(self):
        with sqlite3.connect(self.prod) as db:
            db.execute("insert into duels (status) values ('active')")
        self.set_memory(500)
        result = self.run_remote(STAGING_IGNORE_PROD_ACTIVITY="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("the build resource check did not pass", result.stdout)
        self.assertNotIn("compose build", self.command_log())
        self.assertNotIn("compose up", self.command_log())

    def test_busy_stop_fails_instead_of_reporting_a_skip(self):
        with self.lock.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_remote(STAGING_ACTION="stop")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("skipping", result.stdout)
        self.assertFalse(self.log.exists())

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
        self.assert_skip_reported(result)
        self.assertFalse(self.log.exists())
        self.assertTrue(marker.exists())

    def test_low_memory_before_build_skips_without_build_or_start(self):
        self.set_memory(500)
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        self.assert_skip_reported(result)
        log = self.log.read_text()
        self.assertNotIn("compose build", log)
        self.assertNotIn("compose up", log)

    def test_low_memory_before_start_leaves_staging_down(self):
        result = self.run_remote(TEST_LOW_AFTER_BUILD="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        self.assert_skip_reported(result)
        log = self.log.read_text()
        self.assertIn("compose build", log)
        self.assertNotIn("compose up", log)

    def test_low_disk_before_build_skips_without_building(self):
        result = self.run_remote(TEST_DISK_MB="1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_skip_reported(result)
        self.assertNotIn("compose build", self.log.read_text())

    def test_low_disk_after_build_skips_without_starting(self):
        result = self.run_remote(TEST_DISK_AFTER_BUILD_MB="2000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_skip_reported(result)
        self.assertIn("compose build", self.log.read_text())
        self.assertNotIn("compose up", self.log.read_text())

    def test_stop_with_free_lock_removes_staging_without_activity_guard(self):
        self.prod.unlink()
        result = self.run_remote(STAGING_ACTION="stop")
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn("compose down --rmi local --remove-orphans", log)
        self.assertNotIn("compose build", log)
        self.assertNotIn("git reset", log)

    def test_another_build_skips_without_building(self):
        result = self.run_remote(TEST_BUSY_BUILD="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping", result.stdout)
        self.assert_skip_reported(result)
        self.assertNotIn("compose build", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
