#!/bin/sh
# Stops a staging step when the VM has too little free memory or disk space.
#
#   sh scripts/staging/check-resources.sh <label> <min-available-memory-MB> [<min-free-disk-MB> [<disk-path>]]
#
# Memory is MemAvailable from /proc/meminfo (it counts cache that the kernel can free).
# The numbers are in MB. Environment STAGING_SKIP_RESOURCE_CHECK=1 turns the check off (do not use it
# on the production VM). Exit 0: enough. Exit 1: too little.
set -eu

label=${1:?label is required}
min_mem=${2:?minimum memory in MB is required}
min_disk=${3:-0}
disk_path=${4:-.}

if [ "${STAGING_SKIP_RESOURCE_CHECK:-0}" = "1" ]; then
  echo "check-resources ($label): skipped because STAGING_SKIP_RESOURCE_CHECK=1"
  exit 0
fi

meminfo=${STAGING_MEMINFO_FILE:-/proc/meminfo}
avail_kb=$(awk '/^MemAvailable:/ { print $2 }' "$meminfo")
total_kb=$(awk '/^MemTotal:/ { print $2 }' "$meminfo")
if [ -z "$avail_kb" ]; then
  echo "check-resources ($label): cannot read MemAvailable from $meminfo" >&2
  exit 1
fi
avail_mb=$((avail_kb / 1024))
total_mb=$((total_kb / 1024))
echo "check-resources ($label): memory available ${avail_mb} MB of ${total_mb} MB, need ${min_mem} MB"
if [ "$avail_mb" -lt "$min_mem" ]; then
  echo "check-resources ($label): not enough free memory. Production could suffer, so staging stops here." >&2
  echo "check-resources ($label): stop something, or try again when the VM is quiet." >&2
  exit 1
fi

if [ "$min_disk" -gt 0 ]; then
  free_mb=$(df -Pm "$disk_path" | awk 'NR == 2 { print $4 }')
  echo "check-resources ($label): disk free ${free_mb} MB at $disk_path, need ${min_disk} MB"
  if [ "$free_mb" -lt "$min_disk" ]; then
    echo "check-resources ($label): not enough free disk space." >&2
    exit 1
  fi
fi
