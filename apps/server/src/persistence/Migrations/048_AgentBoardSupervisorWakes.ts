import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Durable, coalesced notifications for the project Supervisor. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_board_supervisor_wakes (
      project_id TEXT PRIMARY KEY NOT NULL,
      project_root TEXT NOT NULL,
      pending_fingerprint TEXT,
      pending_card_ids_json TEXT NOT NULL,
      pending_reason TEXT,
      dispatch_command_id TEXT,
      dispatch_attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_dispatched_fingerprint TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS agent_board_supervisor_wakes_pending_idx
    ON agent_board_supervisor_wakes (pending_fingerprint, next_attempt_at)
  `;
});
