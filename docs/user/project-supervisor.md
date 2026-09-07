# Project Supervisor

The Project Supervisor coordinates work through Planning cards. Once a card is
Ready, it can request a worker directly. Ready cards also start automatically
when their dependencies are Done and a worker slot is available.

The supervisor reports the card's actual state: Ready means queued, Running
identifies active work, and Blocked or Needs Decision includes the reason to
resolve. Execution uses the worker presets configured for your environment and
project. A missing preset must be configured before retrying the card.

In Planning, use **Parallel cards** below Worker execution to set the maximum
number of active cards for this project, then select **Apply**. The default is 1.
Implementation, review, and repair all occupy a slot. Increasing the limit lets
eligible Ready cards start as slots become available; dependencies still apply.
Lowering it lets existing work finish before more cards can start. The setting
is saved on the project's environment and shared by web and desktop clients,
including remote connections.

Standard Mode follows implementation with an independent review and, when
needed, repair. A successful review moves the card to Review; you decide when
to mark it Done. This works on the environment hosting the project, including
when you connect remotely from web, desktop, or mobile.

After resolving a blocker, move the failed card back to Ready to request a new
repair cycle. If its worker has already finished, the repair runs in the existing
workspace before a fresh independent review. The new cycle gets a fresh attempt
budget; prior attempts and evidence remain in the card's proof history. Repeating
Run while the repair is pending does not start another worker. If the repair
cannot start, the card becomes Blocked with the launch error.
