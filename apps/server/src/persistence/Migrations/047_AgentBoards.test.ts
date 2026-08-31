import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const memory = Layer.mergeAll(NodeSqliteClient.layerMemory());

const hasAgentBoardsTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_boards'
  `;
  return rows.length > 0;
});

it.layer(memory)("047 fresh database: creates agent_boards", (it) => {
  it.effect("adds the agent_boards table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations();

      assert.ok(yield* hasAgentBoardsTable);

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(agent_boards)
      `;
      const names = new Set(columns.map((column) => column.name));
      assert.ok(names.has("project_id"));
      assert.ok(names.has("project_root"));
      assert.ok(names.has("board_json"));
      assert.ok(names.has("created_at"));
      assert.ok(names.has("updated_at"));
    }),
  );
});

it.layer(memory)("047 upgrade from 046: creates agent_boards", (it) => {
  it.effect("absent at 46, present at 47", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 46 });
      assert.ok(!(yield* hasAgentBoardsTable));

      yield* runMigrations({ toMigrationInclusive: 47 });
      assert.ok(yield* hasAgentBoardsTable);
    }),
  );
});

it.layer(memory)("047 re-run is a safe no-op", (it) => {
  it.effect("does not error when the table already exists", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      assert.ok(yield* hasAgentBoardsTable);

      yield* runMigrations();
      assert.ok(yield* hasAgentBoardsTable);
    }),
  );
});
