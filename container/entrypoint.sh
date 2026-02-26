#!/bin/bash
set -e

# Run plugin entrypoint hooks (opt-in; sourced before agent starts)
for _step in /workspace/plugins/*/hooks/entrypoint-steps.sh \
             /workspace/.nanoclaw/plugins/*/hooks/entrypoint-steps.sh; do
  [ -f "$_step" ] && . "$_step"
done
unset _step

# Recompile agent-runner from host-mounted source
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist

# Read secrets from stdin, run agent
cat > /tmp/input.json
exec node /tmp/dist/index.js < /tmp/input.json
