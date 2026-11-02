#!/bin/bash
# SessionStart hook (see .claude/settings.json). In Claude Code cloud sessions it installs the
# root (Convex) and apps/web dependencies so lint, typecheck, tests, the build, the dev server
# and the e2e smoke test work right away. Locally it does nothing.
#
# Installs are skipped while the lockfiles, package.json files and this script are unchanged
# since the last successful install, so resumed sessions start instantly.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 1

install() {
  local dir=$1
  local stamp="$dir/node_modules/.cloud-install.sha256"
  local inputs=("$dir/package.json" "$dir/bun.lock" scripts/cloud-session-start.sh)
  if sha256sum --check --status "$stamp" 2>/dev/null; then
    return 0
  fi
  rm -f "$stamp"
  # Bun can trip over the cloud security proxy now and then; one retry clears most of those.
  local attempt
  for attempt in 1 2; do
    if (cd "$dir" && bun install --frozen-lockfile >/tmp/alavu-bun-install.log 2>&1); then
      sha256sum "${inputs[@]}" >"$stamp"
      echo "Installed dependencies in $dir"
      return 0
    fi
    sleep 2
  done
  echo "bun install failed in $dir; see /tmp/alavu-bun-install.log and run it again." >&2
  return 1
}

status=0
install . || status=1
install apps/web || status=1

if [ $status -eq 0 ]; then
  echo "Alavu is ready: bun run check (all CI checks but iOS), bun run e2e (browser smoke test)."
fi
# Never block the session on a failed install; Claude can rerun it.
exit 0
