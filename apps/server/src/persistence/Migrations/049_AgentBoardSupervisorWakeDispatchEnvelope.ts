import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Immutable command envelope retained until a pending wake receipt is resolved. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_thread_id TEXT`;
  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_message_id TEXT`;
  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_message_text TEXT`;
  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_runtime_mode TEXT`;
  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_interaction_mode TEXT`;
  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_created_at TEXT`;
});
