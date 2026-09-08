import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Identifies the immutable envelope currently accepted or being dispatched. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE agent_board_supervisor_wakes ADD COLUMN dispatch_fingerprint TEXT`;
  yield* sql`
    UPDATE agent_board_supervisor_wakes
    SET dispatch_fingerprint = pending_fingerprint
    WHERE dispatch_command_id IS NOT NULL
  `;
});
