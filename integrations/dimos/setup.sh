#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
command -v uv >/dev/null || { echo 'Install uv first: brew install uv'; exit 1; }
# Pin the lockfile-capable installer too; do not depend on a sibling checkout.
uv tool run --from uv==0.13.7 uv sync --project "$ROOT/vendor/dimos" --python 3.12 --locked --extra unitree --extra cpu --no-default-groups --inexact
printf '\nMapping engine installed. Run npm run dev, then open Maps → Automatic mapping.\n'
