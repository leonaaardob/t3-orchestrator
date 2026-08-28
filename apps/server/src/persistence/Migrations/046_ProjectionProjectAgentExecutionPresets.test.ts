import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const memory = Layer.mergeAll(NodeSqliteClient.layerMemory());

const hasAgentExecutionPresetsColumn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  return columns.some((column) => column.name === "agent_execution_presets_json");
});

const markApplied = (id: number, name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
  });

it.layer(memory)("046 fresh database: full migration chain adds the column", (it) => {
  it.effect("adds the agent execution presets column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(columns.some((column) => column.name === "agent_execution_presets_json"));
    }),
  );
});

it.layer(memory)(
  "046 legacy 0.0.35-style DB (043 already executed, column absent) upgrades via 046",
  (it) => {
    it.effect("046 adds the missing column", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 42 });

        // Simulate the kyle-house failure: upstream's migration 43
        // (ProjectionThreadsUnsettledAt) was already recorded on the existing
        // database, and 044/045 were applied, but the
        // agent_execution_presets_json column was never added.
        yield* markApplied(43, "ProjectionThreadsUnsettledAt");
        yield* markApplied(44, "ProjectionThreadsUnsettledAt");
        yield* markApplied(45, "ProjectionThreadsRole");

        assert.ok(!(yield* hasAgentExecutionPresetsColumn));

        // 046 must run and add the missing column even though 043 is recorded.
        yield* runMigrations({ toMigrationInclusive: 46 });

        assert.ok(yield* hasAgentExecutionPresetsColumn);
      }),
    );
  },
);

it.layer(memory)("046 already manually repaired DB: 046 is a safe no-op", (it) => {
  it.effect("does not error and keeps the column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });

      // Operator repaired the column out-of-band and recorded 046 as applied.
      yield* sql`ALTER TABLE projection_projects ADD COLUMN agent_execution_presets_json TEXT`;
      yield* markApplied(46, "ProjectionProjectAgentExecutionPresets");

      assert.ok(yield* hasAgentExecutionPresetsColumn);

      // Re-running migrations must not error or duplicate the column.
      yield* runMigrations();

      assert.ok(yield* hasAgentExecutionPresetsColumn);
    }),
  );
});

it.layer(memory)("046 no regression: partial runs converge on the column", (it) => {
  it.effect("absent at 45, present at 46", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 45 });
      assert.ok(!(yield* hasAgentExecutionPresetsColumn));

      yield* runMigrations({ toMigrationInclusive: 46 });
      assert.ok(yield* hasAgentExecutionPresetsColumn);
    }),
  );
});
