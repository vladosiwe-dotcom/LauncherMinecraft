#!/usr/bin/env bash
# Standalone world backup (for cron) when the server is NOT run under Rift Control.
# Under Rift Control use the panel or its API instead: it pauses autosave (save-off / save-all flush) during the copy.
# Usage: ./backup.sh <server-dir> <backup-dir> [keep=14]
set -euo pipefail
SERVER="${1:?server dir}"; DEST="${2:?backup dir}"; KEEP="${3:-14}"
LEVEL="$(sed -n 's/^level-name=//p' "$SERVER/server.properties" 2>/dev/null || true)"; LEVEL="${LEVEL:-world}"
mkdir -p "$DEST"
NAME="$(date -u +%Y-%m-%dT%H-%M-%S-000Z)__scheduled.tar.gz"
tar -czf "$DEST/$NAME.tmp" -C "$SERVER" "$LEVEL" config server.properties $(cd "$SERVER" && ls ops.json whitelist.json banned-players.json banned-ips.json 2>/dev/null || true)
mv "$DEST/$NAME.tmp" "$DEST/$NAME"
ls -1t "$DEST"/*__scheduled.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "backup: $DEST/$NAME"
