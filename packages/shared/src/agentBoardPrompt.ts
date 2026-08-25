import type { AgentBoardCard } from "@t3tools/contracts";

function listBlock(label: string, values: ReadonlyArray<string> | undefined): string {
  if (!values || values.length === 0) {
    return `${label}: none`;
  }
  return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

export function buildAgentBoardImplementationPrompt(card: AgentBoardCard): string {
  const brief = card.intentBrief;
  const references = [
    "WORKFLOW.md",
    "PROJECT.md",
    "CONTEXT.md",
    ".t3/agent-board.json",
    card.slicePlanPath,
    card.taskRecordPath,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return [
    "PLEASE IMPLEMENT THIS AGENT BOARD CARD.",
    "",
    "You are a fresh implementation agent. Treat the project-local board and task docs as the source of truth, then execute the card end to end.",
    "",
    `Card: ${card.id}`,
    `Title: ${card.title}`,
    `Board state: ${card.state}`,
    `Workspace metadata path: ${card.runtime.workspacePath ?? "none"}`,
    "",
    "Read these references first:",
    ...references.map((reference) => `- ${reference}`),
    "",
    `Intent: ${brief?.intent ?? card.title}`,
    `Desired outcome: ${brief?.desiredOutcome ?? "Not specified"}`,
    listBlock("Acceptance criteria", brief?.acceptanceCriteria),
    listBlock("Constraints", brief?.constraints),
    listBlock("Non-goals", brief?.nonGoals),
    listBlock("Open decisions", brief?.openDecisions),
    "",
    "Execution rules:",
    "- Ask only for true intent or product decisions.",
    "- Self-diagnose and self-test before handing back.",
    "- Keep work inside the active project unless the task docs explicitly say otherwise.",
    "- Update proof in the relevant task record when implementation is complete.",
  ].join("\n");
}

export function buildAgentBoardImplementationThreadTitle(card: AgentBoardCard): string {
  return `Implement ${card.title}`;
}

export function buildAgentBoardReviewPrompt(card: AgentBoardCard): string {
  const brief = card.intentBrief;
  const references = [
    "WORKFLOW.md",
    "PROJECT.md",
    "CONTEXT.md",
    ".t3/agent-board.json",
    card.slicePlanPath,
    card.taskRecordPath,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return [
    "PLEASE REVIEW THIS AGENT BOARD CARD.",
    "",
    "You are a fresh review agent with no prior implementation context. Evaluate only the persisted task record, acceptance criteria, and workspace diff.",
    "",
    `Card: ${card.id}`,
    `Title: ${card.title}`,
    `Workspace: ${card.runtime.workspacePath ?? "none"}`,
    `Branch: ${card.runtime.branchName ?? `board/${card.id}`}`,
    "",
    "Read these references first:",
    ...references.map((reference) => `- ${reference}`),
    "",
    `Intent: ${brief?.intent ?? card.title}`,
    `Desired outcome: ${brief?.desiredOutcome ?? "Not specified"}`,
    listBlock("Acceptance criteria", brief?.acceptanceCriteria),
    listBlock("Constraints", brief?.constraints),
    listBlock("Non-goals", brief?.nonGoals),
    "",
    "Review instructions:",
    "- Verify each acceptance criterion against the workspace diff and task record proof.",
    "- Run or check tests/lint/typecheck evidence when the task requires it.",
    "- Do NOT reimplement; only evaluate and report gaps.",
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
    `Continue agent board card "${card.id}" (${card.title}) — repair after review.`,
    `Review findings: ${reviewReason.slice(0, 2000)}`,
    "Fix the reported gaps in the existing worktree, self-verify (tests/lint/typecheck) and update the task record proof. Do not start over.",
  ].join("\n");
}
