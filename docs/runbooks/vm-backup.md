# VM database backup

Runs on the VM, not in Actions. Files: `scripts/backup/dueling-backup`, `scripts/backup/dueling-backup.service`, `scripts/backup/dueling-backup.timer`. Full text: [VM runbook, Backups](../deployment/vm-runbook.md#backups).

## Purpose

Makes a safe copy of the SQLite database every day. The app keeps running while it copies.

## Schedule & triggers

| Trigger | Detail |
|---|---|
| systemd timer `dueling-backup.timer` | Daily 07:30 UTC. `RandomizedDelaySec=600`. `Persistent=true` (runs late after a reboot) |
| Deploy | Takes its own backup before it changes the VM |
| Manual | Start the service |

## What it changes

- Writes `/var/backups/yugioh-bot/bot-YYYYmmdd-HHMMSSZ.sqlite` and a `.sha256` file.
- Deletes automatic backups past the newest 7 (and past 14 days).
- Deletes `pr2-*` release folders older than 14 days.
- Never touches other names. Four named pre-alpha files are kept on purpose (list in the runbook).

## Depends on

`python3` on the VM. Root. Database at `/opt/yugioh-bot/data/bot.sqlite`. Free disk space. Optional overrides: `DUELING_BACKUP_SRC`, `DUELING_BACKUP_DIR`, `DUELING_BACKUP_KEEP`, `DUELING_RELEASE_KEEP_DAYS`.

## Run it by hand

```bash
sudo systemctl start dueling-backup.service
sudo journalctl -u dueling-backup.service --no-pager -n 30
```

Install on a new VM:

```bash
cd /opt/yugioh-bot
sudo cp scripts/backup/dueling-backup.service scripts/backup/dueling-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dueling-backup.timer
```

Restore: use the `RESTORE` block in the [VM runbook](../deployment/vm-runbook.md#backups). It stops the app first.

## Check it worked

```bash
systemctl list-timers dueling-backup.timer
ls -lt /var/backups/yugioh-bot | head
cd /var/backups/yugioh-bot && sha256sum -c bot-<stamp>.sqlite.sha256
```

The newest file must be under 25 hours old.

## When it fails

| Sign | Action |
|---|---|
| No new file | `journalctl -u dueling-backup.service`. Check disk space with `df -h`. |
| `WARNING: dueling-backup: release pruning:` | Backup is fine. Look at the named folder. |
| Timer not listed | Run the install block above. |

Health: cannot be checked from the repo. Ask the owner to run the check commands. Backups stay on the VM only. There is no off-site copy in the repo (ask owner).

## Cost/limits

7 copies of the database. Size grows with the database. Duel storage compaction can shrink it (see [Duel server timers](duel-server-timers.md)).
