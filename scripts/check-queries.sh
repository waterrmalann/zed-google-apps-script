#!/usr/bin/env bash
# Checks that every Tree-sitter query compiles against the grammar revision
# pinned in extension.toml, that the sample file parses without errors, and
# that the Apps Script specific queries capture what they should in it.
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

# Prints "<capture> <text>" for every single-line capture of a query in the
# sample file.
captures() {
  "$tree_sitter" query "$root/languages/google-apps-script/$1.scm" "$work/sample.js" 2>/dev/null |
    sed -n 's/^ *capture: [0-9]* - \([^,]*\), .*, text: `\(.*\)`$/\1 \2/p'
}

# expect <query> <capture> <text>: the query captures <text> as <capture>.
expect() {
  if grep -qxF "$2 $3" <<<"${results[$1]}"; then
    echo "ok   $1 captures '$3' as @$2"
  else
    echo "FAIL $1 does not capture '$3' as @$2"
    status=1
  fi
}

# expect_not <query> <capture> <text>: the query does not capture <text> as
# <capture>.
expect_not() {
  if grep -qxF "$2 $3" <<<"${results[$1]}"; then
    echo "FAIL $1 captures '$3' as @$2"
    status=1
  else
    echo "ok   $1 does not capture '$3' as @$2"
  fi
}

declare -A results
for query in highlights injections runnables; do
  results[$query]=$(captures "$query")
done

# Apps Script services and the simple-trigger and web app entry points.
expect highlights type.builtin SpreadsheetApp
expect highlights type.builtin HtmlService
expect highlights function.special onOpen
expect highlights function.special doGet
expect_not highlights function.special syncData

# HTML passed to HtmlService, and SQL passed to JDBC statements.
expect injections injection.content '<b>Sidebar</b>'
expect injections injection.content '<p><?= greeting ?></p>'
expect injections injection.content 'SELECT id, name FROM users WHERE id = ?'

# Every top-level function can be run, except private ones ending in `_`.
runnable=$(sed -n 's/^run //p' <<<"${results[runnables]}" | sort | tr '\n' ' ')
expected="DOUBLE doGet doPost onEdit onOpen queryDatabase showSidebar syncData "
if [[ $runnable == "$expected" ]]; then
  echo "ok   runnables captures exactly: $expected"
else
  echo "FAIL runnables captures: $runnable"
  echo "     expected:           $expected"
  status=1
fi

exit $status
