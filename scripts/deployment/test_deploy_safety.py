"""Local deploy safety checks. No SSH, Docker daemon or production files are used."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "scripts/deployment/check-prod-activity.py"


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

    def run_guard(self, force="false", live_only=False):
        command = ["python3", str(GUARD), str(self.path), "--force", force]
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

    def test_idle_rule_covers_every_kind_and_activity_fallback_without_writes(self):
        for column in ("kind", "last_activity_at", "started_at", "created_at"):
            self.db.execute(f"alter table duels add column {column} text")
        for kind in ("play", "replay-fork", "future-practice"):
            for activity_column in ("last_activity_at", "started_at", "created_at"):
                for minutes in (9, 11, 1800):
                    with self.subTest(kind=kind, activity_column=activity_column, minutes=minutes):
                        self.db.execute("delete from duels")
                        self.db.execute(f"""insert into duels (status, kind, {activity_column})
                            values ('active', ?, datetime('now', ?))""", (kind, f"-{minutes} minutes"))
                        self.db.commit()
                        before = self.path.read_bytes()
                        result = self.run_guard(live_only=True)
                        self.assertEqual(result.returncode, int(kind != "replay-fork" and minutes < 10), result.stderr)
                        self.assertEqual(self.path.read_bytes(), before)

    def test_forks_never_block_even_without_legacy_activity_columns(self):
        self.db.execute("alter table duels add column kind text")
        self.db.execute("insert into duels (status, kind) values ('active', 'replay-fork')")
        self.db.commit()
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("duels=0", result.stdout)

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


class ProductionRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        controls = subprocess.run([
            "node", "--input-type=module", "-e", """
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const { prepare, deploy } = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')).jobs;
process.stdout.write(JSON.stringify({
    save: prepare.steps.find(step => step.name === 'Save deployment activity guard').run,
    remote: deploy.steps.find(step => step.name === 'Deploy over SSH').run,
}));
"""], cwd=ROOT, text=True, capture_output=True, check=True)
        cls.controls = json.loads(controls.stdout)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.phases = self.root / "phases.log"
        self.log = self.root / "commands.log"
        self.saved = self.root / "controls"
        self.saved.mkdir()
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        TEST_LOG=str(self.log), TEST_PHASES=str(self.phases),
                        RUNNER_TEMP=str(self.saved), release_dir=str(self.root),
                        bundle_src=str(self.root), runtime_compose=str(self.root / "runtime.json"))
        subprocess.run(["sh", "-ec", self.controls["save"]], cwd=ROOT,
                       env=self.env, text=True, capture_output=True, check=True)
        self.env["DEPLOY_RUNTIME_PREPARE"] = str(self.saved / "prepare-runtime-data.sh")
        (self.root / "runtime.json").write_text('{"name":"production-fixture"}')
        data = self.root / "data"
        data.mkdir()
        with sqlite3.connect(data / "bot.sqlite") as db:
            db.execute("create table checks (value text)")
        (data / "bot.sqlite").chmod(0o600)
        backup = self.root / "scripts/backup/dueling-backup"
        backup.parent.mkdir(parents=True)
        backup.write_text("import os\nwith open(os.environ['TEST_PHASES'], 'a') as log: log.write('backup\\n')\n")
        installer = self.root / "packages/duel-server/scripts/install-engine-bundle.sh"
        installer.parent.mkdir(parents=True)
        installer.write_text('printf "installed\\n" >> "$TEST_PHASES"\n')
        # Ownership is recorded without requiring root in CI. The deployment shell
        # still executes the real helper and propagates its failure.
        self.command("chown", '''echo "chown $*" >> "$TEST_LOG"
for arg do path=$arg; done
if [ "$path" = data ]; then
  printf 'ownership\n' >> "$TEST_PHASES"
  count=$(awk '$0 == "ownership" { count++ } END { print count+0 }' "$TEST_PHASES")
  if [ "$count" = "${TEST_CHOWN_FAIL_AT:-0}" ]; then TEST_CHOWN_FAIL=1; fi
fi
if [ "${TEST_CHOWN_FAIL:-0}" = 1 ]; then
  echo "chown: fixture ownership failure" >&2
  exit 1
fi
''')
        self.command("docker", '''case "$*" in
  "ps "*) ;;
  *" stop "*) printf 'stopped\n' >> "$TEST_PHASES" ;;
  *" run "*) printf 'migrated\n' >> "$TEST_PHASES" ;;
  *" down "*) printf 'removed\n' >> "$TEST_PHASES" ;;
  *" up "*) printf 'started\n' >> "$TEST_PHASES" ;;
  *) echo "Unexpected fixture Docker command" >&2; exit 1 ;;
esac
''')

    def command(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def run_cutover(self, **extra):
        remote = self.controls["remote"]
        start = remote.index("# Retire the bot container")
        end = remote.index('docker compose -f "$runtime_compose" --project-directory /opt/yugioh-bot ps', start)
        script = remote[start:end].replace("/opt/yugioh-bot/data/duel-engine", str(self.root / "data/duel-engine"))
        return subprocess.run(["sh", "-ec", "cleanup() { :; }\n" + script], cwd=self.root,
                              env=dict(self.env, **extra), text=True, capture_output=True, timeout=10)

    def test_installed_data_is_prepared_before_migration_and_again_before_start(self):
        result = self.run_cutover()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.phases.read_text().splitlines(), [
            "stopped", "backup", "installed", "ownership", "migrated",
            "removed", "ownership", "started",
        ])

    def test_ownership_failure_leaves_consumers_stopped(self):
        for failed_preparation in (1, 2):
            with self.subTest(failed_preparation=failed_preparation):
                self.phases.unlink(missing_ok=True)
                result = self.run_cutover(TEST_CHOWN_FAIL_AT=str(failed_preparation))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("chown: fixture ownership failure", result.stderr)
                phases = self.phases.read_text().splitlines()
                self.assertIn("stopped", phases)
                self.assertNotIn("started", phases)
                if failed_preparation == 1:
                    self.assertNotIn("migrated", phases)
                else:
                    self.assertIn("migrated", phases)


if __name__ == "__main__":
    unittest.main()
