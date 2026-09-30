#!/bin/sh
# Gives each named internal secret a random value when it is missing or empty in
# the env file. A value that is already set is never changed, and no value is printed.
# Usage: sh scripts/ensure-env-secrets.sh <env-file> NAME [NAME...]
set -eu

file=$1
shift
if [ ! -f "$file" ]; then
  echo "ensure-env-secrets: $file not found" >&2
  exit 1
fi

for name in "$@"; do
  if grep -Eq "^${name}=[\"']?[^\"'[:space:]]" "$file"; then
    continue
  fi
  value=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  if grep -Eq "^${name}=" "$file"; then
    sed -i "s/^${name}=.*/${name}=${value}/" "$file"
  else
    if [ -n "$(tail -c1 "$file")" ]; then printf '\n' >> "$file"; fi
    printf '%s=%s\n' "$name" "$value" >> "$file"
  fi
  echo "ensure-env-secrets: generated $name in $file"
done
