#!/bin/bash
# SessionStart hook for Claude Code on the web: install workspace
# dependencies so lint, typecheck and tests run from the first turn.
set -euo pipefail

# Local sessions manage their own node_modules; only remote containers
# start cold.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

corepack enable pnpm >/dev/null 2>&1 || true

# Idempotent and cache-friendly: a warm container with node_modules present
# resolves in seconds; a cold one installs from the committed lockfile.
pnpm install --frozen-lockfile
