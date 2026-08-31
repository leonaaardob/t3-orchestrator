import {
  AgentBoardCard,
  AgentBoardFile,
  AgentBoardFileError,
  AgentBoardWorkflowMode,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { AgentBoardFileSystem } from "../../../agentBoard/Services/AgentBoardFileSystem.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  AgentBoardFileSystem,
  ProjectionSnapshotQuery,
];

const PositivePriority = PositiveInt;

/** Empty parameters — project identity comes from the Supervisor session. */
export const AgentBoardReadInput = Schema.Struct({});
export type AgentBoardReadInput = typeof AgentBoardReadInput.Type;

export const AgentBoardReadResult = Schema.Struct({
  storageRef: Schema.Literal("t3://orchestration/agent-board"),
  projectId: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  board: AgentBoardFile,
});
export type AgentBoardReadResult = typeof AgentBoardReadResult.Type;

export const AgentBoardCreateCardInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  id: Schema.optionalKey(TrimmedNonEmptyString),
  intent: Schema.optionalKey(TrimmedNonEmptyString),
  desiredOutcome: Schema.optionalKey(TrimmedNonEmptyString),
  acceptanceCriteria: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  constraints: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  nonGoals: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  dependencies: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  allowedWriteScopes: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  workflowMode: Schema.optionalKey(AgentBoardWorkflowMode),
  priority: Schema.optionalKey(PositivePriority),
  area: Schema.optionalKey(TrimmedNonEmptyString),
  slice: Schema.optionalKey(TrimmedNonEmptyString),
  /**
   * When true and intent fields are present, create the card as Ready.
   * Default Draft so the Supervisor can shape before marking Ready.
   */
  markReady: Schema.optionalKey(Schema.Boolean),
});
export type AgentBoardCreateCardInput = typeof AgentBoardCreateCardInput.Type;

export const AgentBoardUpdateCardInput = Schema.Struct({
  cardId: TrimmedNonEmptyString,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  intent: Schema.optionalKey(TrimmedNonEmptyString),
  desiredOutcome: Schema.optionalKey(TrimmedNonEmptyString),
  acceptanceCriteria: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  constraints: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  nonGoals: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  openDecisions: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  dependencies: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  allowedWriteScopes: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  workflowMode: Schema.optionalKey(AgentBoardWorkflowMode),
  priority: Schema.optionalKey(PositivePriority),
  area: Schema.optionalKey(TrimmedNonEmptyString),
  slice: Schema.optionalKey(TrimmedNonEmptyString),
  /**
   * Optional non-terminal shaping states only. Running / Reviewing / Done etc.
   * remain scheduler and human-gate concerns — Supervisor cannot force them here.
   */
  state: Schema.optionalKey(Schema.Literals(["Backlog", "Draft", "Ready", "Blocked"])),
});
export type AgentBoardUpdateCardInput = typeof AgentBoardUpdateCardInput.Type;

export const AgentBoardCardMutationResult = Schema.Struct({
  storageRef: Schema.Literal("t3://orchestration/agent-board"),
  projectId: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  card: AgentBoardCard,
  board: AgentBoardFile,
});
export type AgentBoardCardMutationResult = typeof AgentBoardCardMutationResult.Type;

const boardTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.Destructive, true).annotate(Tool.OpenWorld, false) as T;

const readonlyBoardTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

export const AgentBoardReadTool = readonlyBoardTool(
  Tool.make("agent_board_read", {
    description:
      "Read the T3-owned Agent Board for the Project Supervisor's current project. Project identity is taken from this Supervisor session — do not pass a project root. Returns cards and workflow state stored at t3://orchestration/agent-board (never writes into the user repo).",
    parameters: AgentBoardReadInput,
    success: AgentBoardReadResult,
    failure: AgentBoardFileError,
    dependencies,
  }).annotate(Tool.Title, "Read project agent board"),
);

export const AgentBoardCreateCardTool = boardTool(
  Tool.make("agent_board_create_card", {
    description:
      "Create a card on the T3-owned Agent Board for the Project Supervisor's current project. Use this instead of editing the user repository. Does not implement code — only shapes orchestration state so an implementation worker can be delegated.",
    parameters: AgentBoardCreateCardInput,
    success: AgentBoardCardMutationResult,
    failure: AgentBoardFileError,
    dependencies,
  }).annotate(Tool.Title, "Create agent board card"),
);

export const AgentBoardUpdateCardTool = boardTool(
  Tool.make("agent_board_update_card", {
    description:
      "Update/shape an existing card on the Supervisor's current project board (intent, acceptance criteria, constraints, dependencies, workflow mode, Ready, etc.). Scoped to this Supervisor's project only. Does not implement code.",
    parameters: AgentBoardUpdateCardInput,
    success: AgentBoardCardMutationResult,
    failure: AgentBoardFileError,
    dependencies,
  }).annotate(Tool.Title, "Update agent board card"),
);

export const AgentBoardToolkit = Toolkit.make(
  AgentBoardReadTool,
  AgentBoardCreateCardTool,
  AgentBoardUpdateCardTool,
);
