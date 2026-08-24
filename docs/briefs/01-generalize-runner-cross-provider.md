# Goal — Generalize the Planning Fork Runner to T3 Cross-Provider

## Goal

Replace the planning fork's Codex-specific worker execution assumption with T3's existing provider/runtime abstraction.

Preserve the current planning workflow:

```text
Supervisor
→ Agent Board
→ claim Ready card
→ isolated workspace
→ fresh worker thread
→ run
```

The only intended change is that worker execution must no longer be implicitly tied to `codex app-server`.

Each project must be able to choose its worker execution configuration centrally, for example:

```text
provider: opencode
model: <configured model>
effort: <configured effort>
```

The same mechanism must also allow Codex, Cursor, Ollama-backed OpenCode, or any other provider already supported by T3.

Cards must not require the user to select provider/model individually. Project configuration is the default source of execution settings.

Reuse T3's existing provider/runtime architecture. Do not create a second provider abstraction or independently spawn provider CLIs if T3 already exposes the required execution path.

## Files / documents to consult

- `WORKFLOW.md`
  - Current runtime contract and current Codex-first assumptions.
- `docs/agents/symphony-conformance.md`
  - Defines what the fork mirrors from OpenAI Symphony and what behavior must remain intact.
- `docs/agents/project-master-plan.md`
  - Especially **Slice 5: Board Runner MVP**.
- `PATCH.md`
  - Current planning-fork patch map after the upstream T3 v0.0.33 sync.
- `packages/contracts/src/agentBoard.ts`
  - Existing board/runtime contract.
- `apps/server/src/agentBoard/`
  - Existing board claim, workspace, and launch implementation.
- Existing T3 provider/runtime implementation in the synced upstream codebase.
  - Discover and reuse the current provider paths for Codex, Cursor, OpenCode, etc.
