import type { AgentBoardCard } from "@t3tools/contracts";

/**
 * Product-owned worker constraints. Card packets carry the work; repository
 * instruction files cannot redefine T3 orchestration for workers.
 */
export const WORKER_ORCHESTRATION_CONSTRAINTS = `T3 WORKER CONSTRAINTS

You are a fresh implementation worker for one T3 orchestration card.
- Implement only this card. Do not act as Project Supervisor.
- The card packet below is the orchestration source of truth for this turn.
- Repository files such as AGENTS.md, WORKFLOW.md, CLAUDE.md, or .t3/agent-board.json
  are not the orchestration control plane. They may inform coding style or product
  context only when they do not conflict with this packet.
- Do not create synthetic orchestration docs in the user repo to "satisfy" workflow.
- Stay inside allowed write scopes when listed.
- Ask only for true intent or product decisions (NEEDS_DECISION when blocked on intent).
- Self-diagnose and self-test before handing back.
- Record proof as concise notes in your final report; T3 stores proof on the card.
  Do not treat a task Markdown file as required proof storage.`.trim();

/**
 * Product-owned reviewer constraints. Fresh review, independent of the worker turn.
 */
export const REVIEWER_ORCHESTRATION_CONSTRAINTS = `T3 REVIEWER CONSTRAINTS

You are a fresh review agent with no prior implementation context.
- Evaluate only the card packet, acceptance criteria, workspace diff, and proof notes.
- Repository WORKFLOW.md / .t3/agent-board.json are not orchestration authority.
- Do NOT reimplement; only evaluate and report gaps.
- An agent REVIEW: PASS is not human Done.`.trim();

function listBlock(label: string, values: ReadonlyArray<string> | undefined): string {
  if (!values || values.length === 0) {
    return `${label}: none`;
  }
  return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function optionalProjectContext(card: AgentBoardCard): ReadonlyArray<string> {
  const lines: Array<string> = [];
  if (card.slicePlanPath) {
    lines.push(
      `- Optional slice plan (project context, not orchestration SoT): ${card.slicePlanPath}`,
    );
  }
  if (card.taskRecordPath) {
    lines.push(
      `- Optional task notes path (project context, not required proof store): ${card.taskRecordPath}`,
    );
  }
  if (lines.length === 0) {
    return ["Optional project context docs: none"];
  }
  return ["Optional project context docs:", ...lines];
}

function cardPacket(card: AgentBoardCard): ReadonlyArray<string> {
  const brief = card.intentBrief;
  return [
    `Card: ${card.id}`,
    `Title: ${card.title}`,
    `Board state: ${card.state}`,
    `Priority: ${card.priority}`,
    `Area: ${card.area ?? "none"}`,
    `Slice: ${card.slice ?? "none"}`,
    `Dependencies: ${card.dependencies.length > 0 ? card.dependencies.join(", ") : "none"}`,
    `Attempt count: ${card.runtime.attemptCount}`,
    `Workspace path: ${card.runtime.workspacePath ?? "none"}`,
    `Branch: ${card.runtime.branchName ?? `board/${card.id}`}`,
    listBlock("Allowed write scopes", card.parallelism.allowedWriteScopes),
    listBlock("Conflicts with cards", card.parallelism.conflictsWith),
    "",
    `Intent: ${brief?.intent ?? card.title}`,
    `Desired outcome: ${brief?.desiredOutcome ?? "Not specified"}`,
    listBlock("Acceptance criteria", brief?.acceptanceCriteria),
    listBlock("Constraints", brief?.constraints),
    listBlock("Non-goals", brief?.nonGoals),
    listBlock("Open decisions", brief?.openDecisions),
    listBlock("Existing proof notes (T3-owned)", card.runtime.proofNotes),
  ];
}

export function buildAgentBoardImplementationPrompt(card: AgentBoardCard): string {
  return [
    "PLEASE IMPLEMENT THIS T3 ORCHESTRATION CARD.",
    "",
    WORKER_ORCHESTRATION_CONSTRAINTS,
    "",
    "Card packet:",
    ...cardPacket(card),
    "",
    ...optionalProjectContext(card),
  ].join("\n");
}

export function buildAgentBoardImplementationThreadTitle(card: AgentBoardCard): string {
  return `Implement ${card.title}`;
}

export function buildAgentBoardReviewPrompt(card: AgentBoardCard): string {
  return [
    "PLEASE REVIEW THIS T3 ORCHESTRATION CARD.",
    "",
    REVIEWER_ORCHESTRATION_CONSTRAINTS,
    "",
    "Card packet:",
    ...cardPacket(card),
    "",
    ...optionalProjectContext(card),
    "",
    "Review instructions:",
    "- Verify each acceptance criterion against the workspace diff and proof notes.",
    "- Run or check tests/lint/typecheck evidence when the card requires it.",
    "",
    "Output protocol (required, last lines of your final message):",
    "- On success: a line exactly `REVIEW: PASS` and a brief proof summary.",
    "- On routine failure (tests, lint, incomplete work, bug): `REVIEW: FAIL - <reason>`",
    "- On intent/scope question (missing credentials, cost/rate limits, destructive action, materially different direction): `NEEDS_DECISION: <exact question for the user>` (optionally preceded by `REVIEW: FAIL - <reason>`).",
  ].join("\n");
}

export function buildAgentBoardReviewThreadTitle(card: AgentBoardCard): string {
  return `Review ${card.title}`;
}

export type AgentBoardReviewResult =
  | { readonly _tag: "pass"; readonly summary: string }
  | { readonly _tag: "fail"; readonly reason: string }
  | { readonly _tag: "needsDecision"; readonly question: string; readonly reason: string };

export function parseAgentBoardReviewResult(text: string): AgentBoardReviewResult | null {
  // Intent questions take precedence and must surface immediately.
  const needsDecisionMatch = text.match(/NEEDS_DECISION\s*:\s*(.+)/i);
  if (needsDecisionMatch) {
    const question = (needsDecisionMatch[1] ?? "").trim().slice(0, 2000);
    // If FAIL marker also present, capture its reason; otherwise use question as reason.
    const failMatch = text.match(/REVIEW\s*:\s*FAIL\s*-?\s*(.+)/i);
    const reason = failMatch ? (failMatch[1] ?? "").trim().slice(0, 2000) : question;
    return { _tag: "needsDecision", question, reason };
  }
  if (/REVIEW\s*:\s*PASS/i.test(text)) {
    const summaryMatch = text.match(/REVIEW\s*:\s*PASS\s*-?\s*(.*)/i);
    return { _tag: "pass", summary: (summaryMatch?.[1] ?? "").trim().slice(0, 2000) };
  }
  const failMatch = text.match(/REVIEW\s*:\s*FAIL\s*-?\s*(.+)/i);
  if (failMatch) {
    return { _tag: "fail", reason: (failMatch[1] ?? "").trim().slice(0, 2000) };
  }
  return null;
}

export function buildAgentBoardRepairPrompt(card: AgentBoardCard, reviewReason: string): string {
  return [
    `Continue T3 orchestration card "${card.id}" (${card.title}) — repair after review.`,
    "",
    WORKER_ORCHESTRATION_CONSTRAINTS,
    "",
    `Review findings: ${reviewReason.slice(0, 2000)}`,
    "",
    "Card packet:",
    ...cardPacket(card),
    "",
    "Fix the reported gaps in the existing worktree, self-verify (tests/lint/typecheck), and leave proof in your final report for T3 card storage. Do not start over.",
  ].join("\n");
}
