import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Persists explicit stop/interrupt intent independently from provider runtime state. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE projection_thread_sessions
    ADD COLUMN auto_wake_paused INTEGER NOT NULL DEFAULT 0
  `;
});
