import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Migration 046 (NOT 043): ensure `projection_projects.agent_execution_presets_json`
// exists. This was originally folded into fork migration 043, but id 43 was already
// recorded on databases upgraded from upstream 0.0.35 (where upstream's 043 is
// `ProjectionThreadsUnsettledAt`). The migrator keys by numeric migration id, so the
// modified 043 was never replayed. Per migration-immutability policy, already-shipped
// ids (043/044/045) must not be repurposed, so the schema guarantee lives here at 046.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!columns.some((column) => column.name === "agent_execution_presets_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN agent_execution_presets_json TEXT
    `;
  }
});
