import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const memory = Layer.mergeAll(NodeSqliteClient.layerMemory());

it.layer(memory)("agent board Supervisor wakes", (it) => {
  it.effect("creates durable coalescing and immutable dispatch state after agent boards", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* runMigrations({ toMigrationInclusive: 50 });
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'agent_board_supervisor_wakes'
      `;
      assert.deepEqual(rows, [{ name: "agent_board_supervisor_wakes" }]);
      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('agent_board_supervisor_wakes')
        WHERE name IN (
          'dispatch_thread_id', 'dispatch_message_id', 'dispatch_message_text',
          'dispatch_runtime_mode', 'dispatch_interaction_mode', 'dispatch_created_at',
          'dispatch_fingerprint'
        )
        ORDER BY name
      `;
      assert.deepEqual(columns, [
        { name: "dispatch_created_at" },
        { name: "dispatch_fingerprint" },
        { name: "dispatch_interaction_mode" },
        { name: "dispatch_message_id" },
        { name: "dispatch_message_text" },
        { name: "dispatch_runtime_mode" },
        { name: "dispatch_thread_id" },
      ]);
    }),
  );
});
