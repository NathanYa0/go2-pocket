# DimOS source snapshot

Source: https://github.com/dimensionalOS/dimos
Revision: 14c62abc393024726029e75ec89f3ed0aa3a9da4 (version 0.0.15).
License: Apache-2.0; see LICENSE and original source notices.

This snapshot keeps the upstream source in Go2 Pocket's repository. Large optional
recordings and demo media are omitted; LFS-ASSETS.json records their upstream paths,
hashes and sizes. They are not needed by the live mapping stack.
Upstream Git attributes/ignores are retained with `.upstream` suffixes so they do
not change the enclosing repository's Git behavior.

Local modification: frontier_exploration/wavefront_frontier_goal_selector.py waits
for navigation success/failure without the former 15-second target deadline.
Failures choose another frontier; operator stop interrupts the wait. Tests are in
test_goal_wait.py alongside that source. No collision/footprint rules are disabled.

Go2 Pocket's process adapter, installation instructions, and app interface live
outside this snapshot in integrations/dimos, scripts, and src/ui/components.
