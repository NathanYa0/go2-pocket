# Copyright 2026 Dimensional Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from queue import Empty
import threading
from unittest.mock import MagicMock, patch

from dimos_lcm.std_msgs import Bool

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Vector3 import Vector3

from dimos.navigation.experimental.frontier_exploration.wavefront_frontier_goal_selector import (
    WavefrontFrontierExplorer,
)


def test_reachable_goal_has_no_elapsed_time_deadline() -> None:
    explorer = WavefrontFrontierExplorer()
    # Model 200 polling intervals (20 seconds), beyond the former 15s deadline.
    with patch.object(explorer._goal_results, "get", side_effect=[Empty()] * 200 + [True]) as get:
        assert explorer._wait_for_goal_result() is True
        assert get.call_count == 201


def test_navigation_failure_releases_wait_without_a_timeout() -> None:
    explorer = WavefrontFrontierExplorer()
    explorer._on_goal_reached(Bool(False))
    assert explorer._wait_for_goal_result() is False


def test_immediate_arrival_is_retained() -> None:
    explorer = WavefrontFrontierExplorer()
    explorer._on_goal_reached(Bool(True))
    assert explorer._wait_for_goal_result() is True


def test_operator_stop_interrupts_wait_for_silent_navigator() -> None:
    explorer = WavefrontFrontierExplorer()
    results: list[bool | None] = []
    worker = threading.Thread(target=lambda: results.append(explorer._wait_for_goal_result()))
    worker.start()
    try:
        explorer.stop_event.set()
        worker.join(timeout=1)
        assert not worker.is_alive()
        assert results == [None]
    finally:
        explorer.stop_event.set()
        worker.join(timeout=1)


def test_failed_target_advances_and_immediate_result_is_not_lost() -> None:
    explorer = WavefrontFrontierExplorer()
    explorer.latest_odometry = PoseStamped()
    explorer.latest_costmap = MagicMock(ts=1.0)
    explorer.exploration_active = True
    published: list[PoseStamped] = []

    def publish(goal: PoseStamped) -> None:
        published.append(goal)
        explorer._on_goal_reached(Bool(len(published) == 2))
        if len(published) == 2:
            explorer.exploration_active = False

    module = "dimos.navigation.experimental.frontier_exploration.wavefront_frontier_goal_selector"
    with (
        patch(f"{module}.simple_inflate", return_value=explorer.latest_costmap),
        patch.object(explorer, "get_exploration_goal", side_effect=[Vector3(1, 0, 0), Vector3(0, 2, 0)]),
        patch.object(explorer.goal_request, "publish", side_effect=publish),
    ):
        worker = threading.Thread(target=explorer._run_exploration_loop)
        worker.start()
        try:
            worker.join(timeout=1)
            assert not worker.is_alive()
            assert len(published) == 2
            assert published[1].position.y == 2
        finally:
            explorer.stop_event.set()
            worker.join(timeout=1)
