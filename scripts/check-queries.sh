#!/usr/bin/env bash
# Checks that every Tree-sitter query compiles against the grammar revision
# pinned in extension.toml, and that the sample file parses without errors.
#
# Usage: scripts/check-queries.sh (set TREE_SITTER to use a specific CLI)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tree_sitter=${TREE_SITTER:-tree-sitter}

grammar_field() {
  sed -n "/^\[grammars\.javascript\]/,/^\[/s/^$1 = \"\(.*\)\"/\1/p" "$root/extension.toml"
}
repository=$(grammar_field repository)
rev=$(grammar_field rev)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work/grammar"
git -C "$work/grammar" fetch -q --depth 1 "$repository" "$rev"
git -C "$work/grammar" checkout -q FETCH_HEAD
# The CLI picks the grammar from the file extension.
cp "$root/tests/fixtures/sample.gs" "$work/sample.js"
cd "$work/grammar"

status=0
if "$tree_sitter" parse --quiet "$work/sample.js" >/dev/null 2>&1; then
  echo "ok   tests/fixtures/sample.gs parses without errors"
else
  echo "FAIL tests/fixtures/sample.gs has parse errors"
  status=1
fi

for query in "$root"/languages/*/*.scm; do
  name=${query#"$root"/}
  if output=$("$tree_sitter" query "$query" "$work/sample.js" 2>&1) &&
    ! grep -q "Query compilation failed" <<<"$output"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    grep -A1 "Caused by" <<<"$output" || echo "$output"
    status=1
  fi
done
exit $status
