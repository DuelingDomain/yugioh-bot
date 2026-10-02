#!/usr/bin/env bash
set -euo pipefail
umask 077

LOCAL_DIR="${LOCAL_DIR:-/home/imran/backups/dueling-system}"
MIRROR_DIR="${MIRROR_DIR:-}"
KEEP="${KEEP-7}"
mkdir -p -m 0700 -- "$LOCAL_DIR"
LOCAL_DIR="$(cd -- "$LOCAL_DIR" && pwd -P)"
LOG_FILE="$LOCAL_DIR/pull.log"

log() {
    local message="$*"
    message="${message//$'\n'/ }"
    message="${message//$'\r'/ }"
    printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" | tee -a "$LOG_FILE"
}

finish() {
    local status=$? log_temporary=""
    trap - ERR
    if [[ -f "$LOG_FILE" ]]; then
        if log_temporary="$(mktemp "$LOCAL_DIR/.pull-log-XXXXXX.tmp")" &&
            tail -n 1000 -- "$LOG_FILE" > "$log_temporary" &&
            mv -- "$log_temporary" "$LOG_FILE"; then
            :
        else
            if [[ -n "$log_temporary" ]]; then
                rm -f -- "$log_temporary"
            fi
            printf 'ERROR: could not trim %s\n' "$LOG_FILE" >&2
            if [[ "$status" -eq 0 ]]; then status=1; fi
        fi
    fi
    exit "$status"
}

trap finish EXIT
trap 'status=$?; log "ERROR: pull failed (exit $status, line $LINENO)" >&2; exit "$status"' ERR

if [[ ! "$KEEP" =~ ^0*[1-9][0-9]*$ ]]; then
    log 'ERROR: KEEP must be an integer >= 1' >&2
    exit 1
fi

log 'Starting backup pull'
rsync -a -e 'ssh -o BatchMode=yes -o ConnectTimeout=20' \
    --include='bot-*.sqlite' --include='bot-*.sqlite.sha256' --exclude='*' \
    'dueling-system:/var/backups/yugioh-bot/' "$LOCAL_DIR/"

shopt -s nullglob
for backup in "$LOCAL_DIR"/bot-*.sqlite; do
    basename="${backup##*/}"
    if [[ "$basename" =~ ^bot-[0-9]{8}-[0-9]{6}Z\.sqlite$ && -f "$backup.sha256" ]]; then
        if checksum_output="$(cd -- "$LOCAL_DIR" && sha256sum -c -- "$basename.sha256" 2>&1)"; then
            log "Verified $basename"
        else
            log "ERROR: checksum verification failed for $basename: $checksum_output" >&2
            exit 1
        fi
    fi
done

# Python stdlib parses UTC filenames, avoiding mtime-based find and date arithmetic.
health_status=0
if maintenance_output="$(python3 - "$LOCAL_DIR" "$KEEP" <<'PY'
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import sys

KEEP = int(sys.argv[2])
MAX_AGE_HOURS = 36
directory = Path(sys.argv[1])
now = datetime.now(timezone.utc)
backups = []
for path in directory.iterdir():
    if not re.fullmatch(r"bot-\d{8}-\d{6}Z\.sqlite", path.name) or path.is_symlink() or not path.is_file():
        continue
    try:
        stamp = datetime.strptime(path.name, "bot-%Y%m%d-%H%M%SZ.sqlite").replace(tzinfo=timezone.utc)
    except ValueError:
        continue
    backups.append((stamp, path))
backups.sort(key=lambda entry: entry[0], reverse=True)
for _, path in backups[KEEP:]:
    path.unlink()
    try:
        Path(str(path) + ".sha256").unlink()
    except FileNotFoundError:
        pass
    print("Removed older automatic backup " + path.name)
retained = backups[:KEEP]
print("kept={} total_bytes={}".format(len(retained), sum(path.stat().st_size for _, path in retained)))
if not backups:
    print("WARNING: no automatic backup exists")
    sys.exit(2)
if backups[0][0] < now - timedelta(hours=MAX_AGE_HOURS):
    print("WARNING: newest automatic backup is older than {} hours: {}".format(MAX_AGE_HOURS, backups[0][1].name))
    sys.exit(2)
PY
)"; then
    health_status=0
else
    health_status=$?
fi
backup_stats=""
while IFS= read -r line; do
    if [[ "$line" == kept=* ]]; then
        backup_stats="$line"
    elif [[ -n "$line" ]]; then
        log "$line"
    fi
done <<< "$maintenance_output"
if [[ "$health_status" -ne 0 && "$health_status" -ne 2 ]]; then
    log "ERROR: local retention/freshness check failed (exit $health_status)" >&2
    exit 1
fi

if [[ -n "$MIRROR_DIR" ]]; then
    mkdir -p -- "$MIRROR_DIR"
    rsync -a --include='*.sqlite' --include='*.sha256' --exclude='*' \
        "$LOCAL_DIR/" "$MIRROR_DIR/"
    log "Mirrored backups to $MIRROR_DIR"
fi
if [[ "$health_status" -eq 2 ]]; then
    log "Backup pull completed with warning $backup_stats"
    exit 2
fi
log "Backup pull completed successfully $backup_stats"
exit 0
