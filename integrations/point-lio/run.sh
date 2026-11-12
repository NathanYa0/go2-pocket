#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
workspace="$repo_root/output/point-lio/ws"
source_dir="$workspace/src/point_lio_unilidar"
revision=18ed5976d8fab2bd8a5148c26a40692bd3c0dc91
action="${1:-help}"

if [[ "$action" == prepare ]]; then
  mkdir -p "$workspace/src"
  if [[ ! -d "$source_dir/.git" ]]; then
    git clone https://github.com/unitreerobotics/point_lio_unilidar.git "$source_dir"
    git -C "$source_dir" checkout --detach "$revision"
  fi
  if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
    echo 'Existing checkout differs from the pinned revision; inspect it before rebuilding.' >&2
    exit 1
  fi
  echo "Point-LIO source ready: $source_dir ($revision)"
  exit 0
fi

if [[ "$action" != build && "$action" != check-inputs && "$action" != run ]]; then
  echo 'Usage: bash integrations/point-lio/run.sh prepare|build|check-inputs|run [L1|L2]'
  exit 0
fi
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Point-LIO needs a Linux/ROS runtime. This command does not run the mapper directly on macOS.' >&2
  exit 1
fi
if [[ ! -f /opt/ros/noetic/setup.bash ]]; then
  echo 'Install/configure ROS Noetic and the upstream prerequisites in the Linux environment first.' >&2
  exit 1
fi
set +u
source /opt/ros/noetic/setup.bash
set -u
if [[ "$action" == check-inputs ]]; then
  exec python3 "$repo_root/integrations/point-lio/check_inputs.py"
fi
if [[ ! -d "$source_dir/.git" || "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
  echo 'Run prepare first; the pinned upstream source is required.' >&2
  exit 1
fi
if [[ "$action" == build ]]; then
  cd "$workspace"
  exec catkin_make -j2
fi
sensor="${2:-}"
case "$sensor" in
  L1) launch=mapping_unilidar_l1.launch ;;
  L2) launch=mapping_unilidar_l2.launch ;;
  *) echo 'Specify the verified sensor model: run L1 or run L2.' >&2; exit 1 ;;
esac
if [[ ! -f "$workspace/devel/setup.bash" ]]; then
  echo 'Build the workspace first.' >&2; exit 1
fi
# Require a live input check before starting a new tracking/mapping session.
python3 "$repo_root/integrations/point-lio/check_inputs.py"
set +u
source "$workspace/devel/setup.bash"
set -u
exec roslaunch point_lio_unilidar "$launch" rviz:=false
