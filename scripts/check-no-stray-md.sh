#!/usr/bin/env bash
# Fails if any tracked or staged Markdown file is outside the allowlist.
# Rule source: AGENTS.md and SECURITY.md.
set -euo pipefail

ALLOWED_REGEX='^README\.md$'

cd "$(git rev-parse --show-toplevel)"

# Tracked files plus anything staged for addition, minus files staged for deletion.
files=$( { git ls-files; git diff --cached --name-only --diff-filter=AM; } | sort -u )

bad=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -e "$f" ] || continue
  case "$f" in
    *.md|*.MD|*.markdown|*.mdx)
      if ! printf '%s' "$f" | grep -Eq "$ALLOWED_REGEX"; then
        bad="$bad$f"$'\n'
      fi
      ;;
  esac
done <<< "$files"

if [ -n "$bad" ]; then
  echo "Disallowed Markdown files: only the root README.md may be committed. Keep other .md files local (they are gitignored)." >&2
  printf '%s' "$bad" >&2
  exit 1
fi
echo "ok: no stray Markdown files"
