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

The Supervisor is also followed up automatically when a worker or review result
lands in Review, Blocked, or Needs Decision, and when a human moves a blocked
card back to Ready or validates a Review card as Done. Nearby results are grouped into one turn, and an active
turn is allowed to finish first. The follow-up asks the Supervisor to reread
the current board before taking an allowed action.

It does not promote Review to Done, promote Draft cards, reset attempts, or
answer a human decision. It is paused while the Supervisor is settled or
snoozed, interrupted, stopped, archived, deleted, approval-gated, or already running.
Each automatic start is atomically rejected if a turn is already queued or
active, so a nearby card result cannot create a second simultaneous turn.
If an explicit interrupt or session stop reaches the server before a queued
follow-up is handed to the provider, it atomically cancels that queued start and
pauses automatic follow-ups as soon as the stop is accepted. You can still send
the Supervisor a normal message to resume it explicitly.
Dispatch failures use a
bounded retry and retain the pending notification for inspection; a later board
transition can create a fresh bounded attempt.

An automatic follow-up preserves its exact command identifiers, message, and
timestamp until its server receipt resolves. If another result arrives while
that request is in flight, the newer notification waits separately and is
handled after the original receipt resolves. A stop only pauses automatic
follow-ups: you can send the Supervisor a new message when you want to resume
it.

If the server restarts before a saved start is claimed, the pending start is
handed to the provider when the reactor returns. A provider response marks
that handoff complete. Claimed or sending starts are kept for inspection with
an ambiguous outcome and are not retried automatically; provider-side
idempotency is required to guarantee exactly-once execution across the
external boundary. The saved delivery record identifies whether recovery was
paused after the claim or after the provider handoff, so an operator can
distinguish the ambiguity without guessing. A normal human message remains the
explicit way to resume.
