#!/usr/bin/env bash
# Gate D: what must never be committed or shipped.
#
#   scripts/gate-d.sh <file-or-dir>...    exit 1 on any hit
#   scripts/gate-d.sh --self-test         prove the gate can fail: a planted
#                                         dirty fixture must fail, a clean one
#                                         must pass, through this same script
#
# It looks for credential shapes, source maps and a person's home path. It
# proves those strings are ABSENT; it says nothing else about a file.
#
# One `grep -F` per literal, never an alternation: a special character inside
# `grep -E` silently turns a pattern into a different one.
set -uo pipefail

# Assembled from parts so this file is not itself a hit.
LITERALS=(
  "sk_""live_"
  "sk_""test_"
  "whsec""_"
  "sk-or""-v1-"
  "GOCSPX""-"
  "postgresql""://"
  "-----BEGIN"" "
  "sourceMapping""URL"
  ":\\Users""\\"
  "/home""/"
  "/Users""/"
  "runner""admin"
)
# na8ve developer and ingest tokens: the prefix and at least 20 token characters.
TOKEN_SHAPE='n8[di]_[A-Za-z0-9_-]{20,}'

scan() {
  local hits=0 f p
  while IFS= read -r -d '' f; do
    for p in "${LITERALS[@]}"; do
      if grep -a -F -q -- "$p" "$f"; then
        echo "HIT  ${f}: ${p}"
        hits=$((hits + 1))
      fi
    done
    if grep -a -E -q -- "$TOKEN_SHAPE" "$f"; then
      echo "HIT  ${f}: a token shape"
      hits=$((hits + 1))
    fi
    case "$f" in
      *.map) echo "HIT  ${f}: a source map file"; hits=$((hits + 1)) ;;
    esac
  done < <(find "$@" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -print0)
  return "$hits"
}

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/dirty1" "$tmp/dirty2" "$tmp/dirty3" "$tmp/dirty4" "$tmp/clean"
  printf 'key %s%s\n' "sk_""live_" "0000" > "$tmp/dirty1/a.txt"
  printf '//# %s=app.js.map\n' "sourceMapping""URL" > "$tmp/dirty2/app.js"
  printf 'token n8d_%s\n' "abcdefghijklmnopqrstuvwxyz" > "$tmp/dirty3/t.txt"
  printf 'at C:%sUsers%salice%sapp.js\n' '\' '\' '\' > "$tmp/dirty4/a.txt"
  printf 'nothing to see here\n' > "$tmp/clean/ok.txt"
  for d in dirty1 dirty2 dirty3 dirty4; do
    if scan "$tmp/$d" > /dev/null; then echo "SELF-TEST FAILED: $d passed"; exit 1; fi
  done
  if ! scan "$tmp/clean" > /dev/null; then echo "SELF-TEST FAILED: the clean fixture failed"; exit 1; fi
  echo "self-test ok: four dirty fixtures failed, the clean one passed"
  exit 0
fi

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/gate-d.sh <file-or-dir>... | --self-test" >&2
  exit 2
fi
scan "$@"
n=$?
if [ "$n" -ne 0 ]; then echo "gate D: ${n} hit(s)"; exit 1; fi
echo "gate D: clean"
