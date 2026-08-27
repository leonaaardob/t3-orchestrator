import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadsRole", (it) => {
  it.effect("backfills the legacy title designation into the durable role", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at
        ) VALUES (
          'supervisor-thread', 'project-1', 'Project Supervisor',
          '{"instanceId":"codex","model":"gpt-5"}', 'full-access',
          'default', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });
      const rows = yield* sql<{ readonly role: string }>`
        SELECT role FROM projection_threads WHERE thread_id = 'supervisor-thread'
      `;
      assert.deepEqual(rows, [{ role: "project-supervisor" }]);
    }),
  );
});
