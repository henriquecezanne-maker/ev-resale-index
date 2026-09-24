#!/usr/bin/env bash
# Installs Aampere's secret-protection hook into this project.
# Safe to run as often as you like. Works on macOS, Linux and Windows (Git Bash).
set -eu

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "This folder is not a git project yet — run this script from inside the project folder." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
hooks_dir="$(git rev-parse --git-path hooks)"

# git rev-parse --git-path may return a relative path; anchor it to the repo root.
case "$hooks_dir" in
  /*|[A-Za-z]:*) : ;;
  *) hooks_dir="$repo_root/$hooks_dir" ;;
esac

mkdir -p "$hooks_dir"
cp "$repo_root/scripts/pre-commit" "$hooks_dir/pre-commit"
chmod +x "$hooks_dir/pre-commit"

echo "✅ Secret protection is active: every save is now checked for passwords and API keys."
