#!/bin/sh
# Caddy reports only its own cgroup. The worker mounts this private volume read-only.
set -eu
umask 022
health_output_dir=${VPS_HEALTH_OUTPUT_DIR:-/run/vps-health}
health_cgroup_dir=${VPS_HEALTH_CGROUP_DIR:-/sys/fs/cgroup}
health_proc_dir=${VPS_HEALTH_PROC_DIR:-/proc}
health_number() {
    if [ ! -r "$1" ]; then printf 'null\n'; return; fi
    awk 'NR == 1 { if ($1 ~ /^[0-9]+$/) print $1; else print "null"; found=1 } END { if (!found) print "null" }' "$1" 2>/dev/null || printf 'null\n'
}
health_counter() {
    if [ ! -r "$1" ]; then printf 'null\n'; return; fi
    awk -v key="$2" '$1 == key && $2 ~ /^[0-9]+$/ { print $2; found=1; exit } END { if (!found) print "null" }' "$1" 2>/dev/null || printf 'null\n'
}
health_sample() {
    health_member=$(awk -F: '$1 == "0" {print $3; exit}' "$health_proc_dir/self/cgroup" 2>/dev/null || true)
    case "$health_member" in /*) ;; *) return ;; esac
    case "$health_member" in *..*) return ;; esac
    health_own_dir="$health_cgroup_dir$health_member"
    health_memory=$(health_number "$health_own_dir/memory.current")
    health_limit=$(health_number "$health_own_dir/memory.max")
    health_oom=$(health_counter "$health_own_dir/memory.events" oom_kill)
    health_cpu=$(health_counter "$health_own_dir/cpu.stat" usage_usec)
    health_identity=$(stat -c %i "$health_own_dir" 2>/dev/null || printf '0')
    health_at=$(date +%s)
    mkdir -p "$health_output_dir"
    printf '{"at":%s000,"instance":"%s","cgroup":{"memoryBytes":%s,"memoryLimitBytes":%s,"oomKills":%s,"cpuUsageUsec":%s,"cpuPercent":null}}\n' \
        "$health_at" "$health_identity" "$health_memory" "$health_limit" "$health_oom" "$health_cpu" > "$health_output_dir/caddy.json.tmp"
    mv "$health_output_dir/caddy.json.tmp" "$health_output_dir/caddy.json"
}
if [ "${1:-}" = "--sample-once" ]; then health_sample; exit; fi
(
    while :; do
        health_sample || true
        sleep 60
    done
) &
exec caddy "$@"
