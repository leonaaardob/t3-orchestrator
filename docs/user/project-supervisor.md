# Project Supervisor

The Project Supervisor coordinates work through Planning cards. Once a card is
Ready, it can request a worker directly. Ready cards also start automatically
when their dependencies are Done and a worker slot is available.

The supervisor reports the card's actual state: Ready means queued, Running
identifies active work, and Blocked or Needs Decision includes the reason to
resolve. Execution uses the worker presets configured for your environment and
project. A missing preset must be configured before retrying the card.

Standard Mode follows implementation with an independent review and, when
needed, repair. A successful review moves the card to Review; you decide when
to mark it Done. This works on the environment hosting the project, including
when you connect remotely from web, desktop, or mobile.
