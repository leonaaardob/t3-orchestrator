import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "role")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN role TEXT NOT NULL DEFAULT 'standard'
    `;
    // Preserve the fork's pre-role designation when upgrading an existing
    // projection. Future title changes never infer or clear this field.
    yield* sql`
      UPDATE projection_threads
      SET role = 'project-supervisor'
      WHERE trim(title) = 'Project Supervisor'
    `;
  }
});
