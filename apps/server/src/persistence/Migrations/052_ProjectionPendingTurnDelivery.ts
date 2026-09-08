import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Keeps a provider handoff intent durable until sendTurn returns. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'pending'
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_pending_delivery
    ON projection_turns(delivery_state, requested_at)
    WHERE turn_id IS NULL AND state = 'pending'
  `;
});
