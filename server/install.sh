#!/usr/bin/env bash
# Installs a NeoForge 1.21.1 server into ./runtime (or $1) and applies Spell and Iron Rift defaults.
# Usage: ./install.sh [target-dir] [neoforge-version]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HERE/runtime}"
NEO="${2:-21.1.172}"
MAVEN="https://maven.neoforged.net/releases/net/neoforged/neoforge"

[[ "$NEO" =~ ^21\.1\.[0-9]+(-beta)?$ ]] || { echo "Only NeoForge 21.1.x (Minecraft 1.21.1) is supported, got $NEO" >&2; exit 1; }
command -v java >/dev/null || { echo "Java 21 is required (e.g. apt install openjdk-21-jre-headless)" >&2; exit 1; }
JAVA_MAJOR="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/{print $2}')"
[[ "${JAVA_MAJOR%%.*}" -ge 21 ]] || { echo "Java 21+ required, found $JAVA_MAJOR" >&2; exit 1; }

mkdir -p "$TARGET" && cd "$TARGET"
JAR="neoforge-$NEO-installer.jar"
echo "→ Downloading NeoForge $NEO installer"
curl -fsSL -o "$JAR" "$MAVEN/$NEO/$JAR"
EXPECTED="$(curl -fsSL "$MAVEN/$NEO/$JAR.sha1" | awk '{print $1}')"
ACTUAL="$(sha1sum "$JAR" | awk '{print $1}')"
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo "Checksum mismatch for $JAR" >&2; rm -f "$JAR"; exit 1; }

echo "→ Installing server"
java -jar "$JAR" --install-server "$TARGET"
rm -f "$JAR" "$JAR.log"

# Our defaults; existing files are never overwritten.
for f in server.properties user_jvm_args.txt; do
  [[ -f "$f" ]] || cp "$HERE/templates/$f" "$f"
done
mkdir -p mods config defaultconfigs logs
chmod +x run.sh

if [[ ! -f eula.txt ]] || ! grep -q 'eula=true' eula.txt; then
  echo
  echo "Minecraft EULA: https://aka.ms/MinecraftEULA"
  read -r -p "Do you accept the EULA? [y/N] " ok
  [[ "$ok" =~ ^[Yy]$ ]] && echo "eula=true" > eula.txt || echo "eula=false" > eula.txt
fi
echo
echo "Done. Server directory: $TARGET"
echo "Set RIFT_SERVER_DIR=$TARGET for the backend, or start manually with ./run.sh nogui"
