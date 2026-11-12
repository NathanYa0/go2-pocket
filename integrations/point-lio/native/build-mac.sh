#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then echo 'This adapter build is for macOS.' >&2; exit 1; fi
bash "$root/integrations/point-lio/run.sh" prepare
cmake -S "$root/integrations/point-lio/native" -B "$root/output/point-lio/native-build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$root/output/point-lio/native-build" -j2
echo "Built: $root/output/point-lio/native-build/pointlio-mac"
