import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * ORCH-041: server-owned agent board documents.
 *
 * Stores the encoded AgentBoardFile JSON keyed by project_id in state.sqlite
 * so opening a user repo never creates `.t3/agent-board.json`.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_boards (
      project_id TEXT PRIMARY KEY NOT NULL,
      project_root TEXT NOT NULL,
      board_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS agent_boards_project_root_idx
    ON agent_boards (project_root)
  `;
});
