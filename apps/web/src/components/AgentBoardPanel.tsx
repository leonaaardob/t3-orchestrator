import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  type WheelEvent,
} from "react";
import {
  AgentBoardFile,
  type AgentBoardCard,
  type AgentBoardCardId,
  type AgentBoardFile as AgentBoardFileType,
  type AgentBoardIntentBrief,
  type AgentBoardState,
  type AgentBoardView,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  LoaderIcon,
  PanelRightCloseIcon,
  PencilIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  Table2Icon,
  KanbanSquareIcon,
  GitBranchIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { Schema } from "effect";

import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { createModelSelection } from "@t3tools/shared/model";
import {
  MISSING_WORKER_CONFIG_ERROR,
  resolveWorkerModelSelection,
} from "@t3tools/shared/agentBoardRunner";
import { SUPERVISOR_THREAD_TITLE, isSupervisorThread } from "../lib/supervisorThread";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { agentBoardEnvironment } from "~/state/agentBoard";
import { projectEnvironment } from "~/state/projects";
import { primaryServerProvidersAtom } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProjects, useThreadShells } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { newThreadId } from "~/lib/utils";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { usePrimarySettings } from "~/hooks/useSettings";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";

interface AgentBoardPanelProps {
  environmentId: EnvironmentId;
  /** Project workspace root (not a thread worktree). */
  workspaceRoot: string | undefined;
  mode?: "page" | "sheet" | "sidebar";
  onClose: () => void;
  /** The project's `defaultModelSelection`, used to show the effective worker source. */
  projectDefaultModelSelection?: ModelSelection | null;
}

function KanbanDroppableColumn({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <section
      ref={setNodeRef}
      data-kanban-column={id}
      className={cn(className, isOver && "border-emerald-500/50")}
    >
      {children}
    </section>
  );
}

function KanbanDraggableCard({
  id,
  disabled,
  selected,
  onClick,
  onDoubleClick,
  children,
}: {
  id: AgentBoardCardId;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded-lg border bg-background/55 p-2.5 text-left transition-colors",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45 ring-1 ring-emerald-400/50",
        selected ? "border-emerald-500/40" : "border-border/55 hover:border-border",
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </article>
  );
}

const BOARD_COLUMNS: ReadonlyArray<{
  state: AgentBoardState;
  label: string;
}> = [
  { state: "Draft", label: "Draft" },
  { state: "Ready", label: "Ready" },
  { state: "Running", label: "Running" },
  { state: "Reviewing", label: "Reviewing" },
  { state: "Diagnosing", label: "Diagnosing" },
  { state: "Review", label: "Review" },
  { state: "Done", label: "Done" },
  { state: "Needs Decision", label: "Needs Decision" },
];

const MOVABLE_STATES: readonly AgentBoardState[] = [
  "Draft",
  "Backlog",
  "Ready",
  "Running",
  "Review",
  "Done",
  "Needs Decision",
  "Blocked",
  "Canceled",
];

const BOARD_REFRESH_INTERVAL_MS = 10_000;
const DEFAULT_SLICE_PLAN_PATH = "docs/agents/slices/authoritative-agent-board.md";
const BOARD_COLUMN_MIN_WIDTH = 260;
const BOARD_COLUMN_MIN_WIDTH_EXPANDED = 320;
const BOARD_COLUMN_GAP = 12;
const BOARD_HORIZONTAL_PADDING = 24;
const PLANNING_EDIT_COMMIT_DELAY_MS = 850;
const GRAPH_NODE_WIDTH = 180;
const GRAPH_NODE_HEIGHT = 84;
const GRAPH_AREA_NODE_WIDTH = 160;
const GRAPH_SLICE_NODE_WIDTH = 170;
const GRAPH_X_AREA = 60;
const GRAPH_X_SLICE = 320;
const GRAPH_X_CARD = 580;
const GRAPH_X_SPACING_CARD = 220;
const GRAPH_ROW_HEIGHT = 128;
const GRAPH_ROW_GAP = 34;
const GRAPH_PAN_IGNORE_SELECTOR = "button,input,textarea,select,a,[role='button']";
const GRAPH_MIN_ZOOM = 0.5;
const GRAPH_MAX_ZOOM = 1.8;
const GRAPH_ZOOM_STEP = 0.0015;
const GRAPH_GRID_SIZE = 22;
type AgentBoardLocalView = AgentBoardView | "expanded";
const BOARD_VIEW_URL_PARAM = "view";
const VALID_BOARD_VIEW_VALUES: readonly AgentBoardLocalView[] = [
  "kanban",
  "table",
  "execution-path",
  "expanded",
] as const;

function parseBoardViewParam(value: string | null): AgentBoardLocalView | null {
  if (!value) return null;
  // Back-compat: old UI used `graph` for the execution-path view.
  if (value === "graph") return "execution-path";
  return (VALID_BOARD_VIEW_VALUES as readonly string[]).includes(value)
    ? (value as AgentBoardLocalView)
    : null;
}

function readBoardViewFromUrl(): AgentBoardLocalView | null {
  if (typeof window === "undefined") return null;
  try {
    return parseBoardViewParam(
      new URLSearchParams(window.location.search).get(BOARD_VIEW_URL_PARAM),
    );
  } catch {
    return null;
  }
}

function writeBoardViewToUrl(nextView: AgentBoardLocalView): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(BOARD_VIEW_URL_PARAM, nextView);
    window.history.replaceState(null, "", url.toString());
  } catch {
    // ignore URL write failures (e.g. non-http context)
  }
}

function boardViewToPersistedView(view: AgentBoardLocalView): AgentBoardView {
  // `expanded` is a kanban presentation variant — persist as `kanban`.
  return view === "expanded" ? "kanban" : view;
}
type PlanningTableColumn =
  | "area"
  | "slice"
  | "card"
  | "status"
  | "priority"
  | "slicePlan"
  | "actions";
type PlanningEditableColumn = Exclude<PlanningTableColumn, "status" | "actions">;

const PLANNING_TABLE_COLUMN_MIN_WIDTH: Record<PlanningTableColumn, number> = {
  area: 120,
  slice: 140,
  card: 220,
  status: 120,
  priority: 76,
  slicePlan: 140,
  actions: 92,
};

const DEFAULT_PLANNING_TABLE_COLUMN_WIDTHS: Record<PlanningTableColumn, number> = {
  area: 170,
  slice: 180,
  card: 520,
  status: 132,
  priority: 86,
  slicePlan: 170,
  actions: 104,
};

const PLANNING_TABLE_COLUMNS: ReadonlyArray<{
  id: PlanningTableColumn;
  label: string;
  align?: "right";
}> = [
  { id: "area", label: "Area" },
  { id: "slice", label: "Slice" },
  { id: "card", label: "Card" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "slicePlan", label: "Slice plan" },
  { id: "actions", label: "Actions", align: "right" },
];
const UNASSIGNED_AREA_LABEL = "Unassigned";
const FUTURE_SCOPE_AREA_LABEL = "Future Scope";

interface IntentDraft {
  intent: string;
  desiredOutcome: string;
  acceptanceCriteria: string;
  constraints: string;
  nonGoals: string;
  openDecisions: string;
}

interface DetailDraft {
  title: string;
  area: string;
  slice: string;
  slicePlanPath: string;
  dependencies: string;
}

interface GraphNodePosition {
  x: number;
  y: number;
}

interface GraphNodeMeta {
  id: string;
  label: string;
  kind: "Area" | "Slice" | "Card";
  width: number;
  height: number;
}

interface DependencyTreeGroup {
  area: string;
  slice: string;
  cards: AgentBoardCard[];
}

interface DependencyTreeEdge {
  from: AgentBoardCard;
  to: AgentBoardCard;
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "agent-board-card";
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function optionalTrimmedValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function intentDraftFromCard(card: AgentBoardCard): IntentDraft {
  return {
    intent: card.intentBrief?.intent ?? "",
    desiredOutcome: card.intentBrief?.desiredOutcome ?? "",
    acceptanceCriteria: (card.intentBrief?.acceptanceCriteria ?? []).join("\n"),
    constraints: (card.intentBrief?.constraints ?? []).join("\n"),
    nonGoals: (card.intentBrief?.nonGoals ?? []).join("\n"),
    openDecisions: (card.intentBrief?.openDecisions ?? []).join("\n"),
  };
}

function emptyIntentDraft(): IntentDraft {
  return {
    intent: "",
    desiredOutcome: "",
    acceptanceCriteria: "",
    constraints: "",
    nonGoals: "",
    openDecisions: "",
  };
}

function detailDraftFromCard(card: AgentBoardCard): DetailDraft {
  return {
    title: card.title,
    area: card.area ?? "",
    slice: card.slice ?? "",
    slicePlanPath: card.slicePlanPath ?? "",
    dependencies: dependencyDraftFromCard(card),
  };
}

function intentBriefFromDraft(draft: IntentDraft): AgentBoardIntentBrief | null {
  const intent = draft.intent.trim();
  if (!intent) return null;
  return {
    intent,
    ...(draft.desiredOutcome.trim() ? { desiredOutcome: draft.desiredOutcome.trim() } : {}),
    acceptanceCriteria: lines(draft.acceptanceCriteria),
    constraints: lines(draft.constraints),
    nonGoals: lines(draft.nonGoals),
    openDecisions: lines(draft.openDecisions),
  };
}

function taskRecordMarkdown(input: {
  card: AgentBoardCard;
  taskRecordPath: string;
  intentBrief: AgentBoardIntentBrief;
}): string {
  const acceptanceCriteria = input.intentBrief.acceptanceCriteria.length
    ? input.intentBrief.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
    : "- Clarify acceptance criteria before agent execution.";
  const constraints = input.intentBrief.constraints.length
    ? input.intentBrief.constraints.map((item) => `- ${item}`).join("\n")
    : "- Stay within the board card scope.";
  const nonGoals = input.intentBrief.nonGoals.length
    ? input.intentBrief.nonGoals.map((item) => `- ${item}`).join("\n")
    : "- Do not expand beyond this card without a decision.";
  const openDecisions = input.intentBrief.openDecisions.length
    ? input.intentBrief.openDecisions.map((item) => `- ${item}`).join("\n")
    : "- None.";

  return `# ${input.card.id}

Status: \`ready\`
Agent eligible: yes
Area: \`${input.card.area ?? "Unassigned"}\`
Slice group: \`${input.card.slice ?? "Unassigned"}\`
Slice: \`${input.card.slicePlanPath ?? DEFAULT_SLICE_PLAN_PATH}\`

## Owner Intent

${input.intentBrief.intent}

## Target Status

${input.intentBrief.desiredOutcome ?? "Tested"}

## Scope Guard

${constraints}

## Acceptance Criteria

${acceptanceCriteria}

## Non Goals

${nonGoals}

## Open Decisions

${openDecisions}

## Verification

- Run the smallest relevant focused checks.
- Run broader repo checks when the implementation touches shared contracts or UI shell behavior.

## Parallelism Plan

Safe: \`${input.card.parallelism.safe}\`

Reason:

${input.card.parallelism.reason ?? "Confirm dependencies before parallel execution."}

Allowed write scopes:

${input.card.parallelism.allowedWriteScopes.length ? input.card.parallelism.allowedWriteScopes.map((item) => `- ${item}`).join("\n") : "- To be confirmed during implementation planning."}

Conflicts with:

${input.card.parallelism.conflictsWith.length ? input.card.parallelism.conflictsWith.map((item) => `- ${item}`).join("\n") : "- None listed."}

## Proof Of Done

Fill before marking done.
`;
}

function newDraftCard(title: string): AgentBoardCard {
  return newCardForState(title, "Draft");
}

const decodeAgentBoardCards = Schema.decodeUnknownSync(AgentBoardFile.fields.cards);

function newCardForState(title: string, state: AgentBoardState): AgentBoardCard {
  const timestamp = new Date().toISOString();
  return decodeAgentBoardCards([
    {
      id: `TASK-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now()}` as AgentBoardCardId,
      title,
      state,
      priority: 3,
      ...(state === "Ready"
        ? {
            intentBrief: {
              intent: title,
              acceptanceCriteria: [],
              constraints: [],
              nonGoals: [],
              openDecisions: [],
            },
          }
        : {}),
      dependencies: [],
      parallelism: {
        safe: "conditional",
        reason: "New board card needs clarification before parallel execution.",
        conflictsWith: [],
        allowedWriteScopes: [],
      },
      runtime: {
        attemptCount: 0,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ])[0] as AgentBoardCard;
}

function cardWithState(
  card: AgentBoardCard,
  state: AgentBoardState,
  timestamp: string,
): AgentBoardCard {
  return {
    ...card,
    state,
    ...(state === "Ready" && !card.intentBrief
      ? {
          intentBrief: {
            intent: card.title,
            acceptanceCriteria: [],
            constraints: [],
            nonGoals: [],
            openDecisions: [],
          },
        }
      : {}),
    updatedAt: timestamp,
  } as AgentBoardCard;
}

function cardWithPlanningField(
  card: AgentBoardCard,
  field: "area" | "slice" | "slicePlanPath",
  value: string,
): AgentBoardCard {
  const trimmed = optionalTrimmedValue(value);
  if (trimmed) {
    return {
      ...card,
      [field]: trimmed,
    } as AgentBoardCard;
  }
  const { [field]: _omitted, ...rest } = card;
  return rest as AgentBoardCard;
}

function planningAreaForCard(card: AgentBoardCard): string {
  return card.area?.trim() || UNASSIGNED_AREA_LABEL;
}

function areaGraphNodeId(area: string): string {
  return `area:${area}`;
}

function sliceGraphNodeId(area: string, slice: string): string {
  return `slice:${area}:${slice}`;
}

function dependencySliceKey(area: string, slice: string): string {
  return `${area}\u0000${slice}`;
}

function groupDependencyTreeCards(cards: readonly AgentBoardCard[]): DependencyTreeGroup[] {
  const groups = new Map<string, DependencyTreeGroup>();
  for (const card of cards) {
    const area = planningAreaForCard(card);
    const slice = card.slice?.trim() || "Unassigned slice";
    const key = dependencySliceKey(area, slice);
    const existing = groups.get(key);
    if (existing) {
      existing.cards.push(card);
    } else {
      groups.set(key, { area, slice, cards: [card] });
    }
  }
  return Array.from(groups.values())
    .map((group) => ({
      area: group.area,
      slice: group.slice,
      cards: group.cards.toSorted((first, second) => {
        return first.priority - second.priority || first.title.localeCompare(second.title);
      }),
    }))
    .toSorted((first, second) => {
      return (
        first.area.localeCompare(second.area) ||
        first.slice.localeCompare(second.slice) ||
        (first.cards[0]?.title ?? "").localeCompare(second.cards[0]?.title ?? "")
      );
    });
}

function planningEditIsFocused(): boolean {
  return (
    document.activeElement instanceof HTMLElement &&
    Boolean(document.activeElement.closest("[data-agent-board-planning-edit='true']"))
  );
}

function stateTone(state: AgentBoardState): string {
  switch (state) {
    case "Ready":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "Running":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "Review":
    case "Reviewing":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "Done":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Needs Decision":
    case "Blocked":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-border/70 bg-muted/30 text-muted-foreground";
  }
}

function dependencyDraftFromCard(card: AgentBoardCard): string {
  return card.dependencies.join("\n");
}

function dependencyIdsFromDraft(value: string): AgentBoardCardId[] {
  return lines(value) as AgentBoardCardId[];
}

const AgentBoardPanel = memo(function AgentBoardPanel({
  environmentId,
  workspaceRoot,
  mode = "sidebar",
  onClose,
  projectDefaultModelSelection,
}: AgentBoardPanelProps) {
  const [board, setBoard] = useState<AgentBoardFileType | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [boardView, setBoardView] = useState<AgentBoardLocalView>(
    () => readBoardViewFromUrl() ?? "kanban",
  );
  const [planningTableColumnWidths, setPlanningTableColumnWidths] = useState(
    DEFAULT_PLANNING_TABLE_COLUMN_WIDTHS,
  );
  const [planningCellDrafts, setPlanningCellDrafts] = useState<Record<string, string>>({});
  const [collapsedPlanningAreas, setCollapsedPlanningAreas] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedDependencySlices, setCollapsedDependencySlices] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [quickAddState, setQuickAddState] = useState<AgentBoardState | null>(null);
  const [quickAddArea, setQuickAddArea] = useState<string | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<AgentBoardCardId | null>(null);
  const [detailCardId, setDetailCardId] = useState<AgentBoardCardId | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<AgentBoardCardId | null>(null);
  const draggingCard = useMemo(
    () => board?.cards.find((card) => card.id === draggingCardId) ?? null,
    [board?.cards, draggingCardId],
  );
  const [isGraphPanning, setIsGraphPanning] = useState(false);
  const [graphPanOffset, setGraphPanOffset] = useState({ x: 0, y: 0 });
  const [graphZoom, setGraphZoom] = useState(1);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [graphConnectFromNodeId, setGraphConnectFromNodeId] = useState<string | null>(null);
  const [graphNodeDraftPositions, setGraphNodeDraftPositions] = useState<
    Record<string, GraphNodePosition>
  >({});
  const [intentDraft, setIntentDraft] = useState<IntentDraft>(() => emptyIntentDraft());
  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportPlanningError = useCallback((message: string) => {
    setError(message);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Planning",
        description: message,
      }),
    );
  }, []);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const graphPanRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const graphNodeDragRef = useRef<{
    cardId: AgentBoardCardId;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressGraphNodeClickRef = useRef(false);
  const syncingScrollRef = useRef(false);
  const planningCommitTimersRef = useRef(new Map<string, number>());
  const detailCommitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const planningCommitTimers = planningCommitTimersRef.current;
    return () => {
      for (const timer of planningCommitTimers.values()) {
        window.clearTimeout(timer);
      }
      if (detailCommitTimerRef.current) {
        window.clearTimeout(detailCommitTimerRef.current);
      }
    };
  }, []);

  const columns = useMemo(() => {
    const cards = board?.cards ?? [];
    return BOARD_COLUMNS.map((column) => {
      return {
        state: column.state,
        label: column.label,
        cards: cards.filter((card) => card.state === column.state),
      };
    });
  }, [board?.cards]);
  const selectedCard = useMemo(
    () => board?.cards.find((card) => card.id === selectedCardId) ?? null,
    [board?.cards, selectedCardId],
  );
  const detailCard = useMemo(
    () => board?.cards.find((card) => card.id === detailCardId) ?? null,
    [board?.cards, detailCardId],
  );
  const isExpandedView = boardView === "expanded";
  const isKanbanView = boardView === "kanban" || isExpandedView;
  const effectiveColumnMinWidth = isExpandedView
    ? BOARD_COLUMN_MIN_WIDTH_EXPANDED
    : BOARD_COLUMN_MIN_WIDTH;
  const boardMinWidth = useMemo(
    () =>
      columns.length * effectiveColumnMinWidth +
      Math.max(columns.length - 1, 0) * BOARD_COLUMN_GAP +
      BOARD_HORIZONTAL_PADDING,
    [columns.length, effectiveColumnMinWidth],
  );
  const tableCards = useMemo(() => {
    return (board?.cards ?? []).toSorted((first, second) => {
      return (
        planningAreaForCard(first).localeCompare(planningAreaForCard(second)) ||
        (first.slice ?? "").localeCompare(second.slice ?? "") ||
        first.priority - second.priority ||
        first.title.localeCompare(second.title)
      );
    });
  }, [board?.cards]);
  const planningAreaGroups = useMemo(() => {
    const groups = new Map<string, AgentBoardCard[]>();
    for (const card of tableCards) {
      const area = planningAreaForCard(card);
      groups.set(area, [...(groups.get(area) ?? []), card]);
    }

    const orderedAreas = [
      UNASSIGNED_AREA_LABEL,
      ...Array.from(groups.keys())
        .filter((area) => area !== UNASSIGNED_AREA_LABEL && area !== FUTURE_SCOPE_AREA_LABEL)
        .toSorted((first, second) => first.localeCompare(second)),
      FUTURE_SCOPE_AREA_LABEL,
    ];

    return orderedAreas
      .map((area) => ({ area, cards: groups.get(area) ?? [] }))
      .filter(
        (group) =>
          group.cards.length > 0 ||
          group.area === UNASSIGNED_AREA_LABEL ||
          group.area === FUTURE_SCOPE_AREA_LABEL,
      );
  }, [tableCards]);
  const graphModel = useMemo(() => {
    const cards = board?.cards ?? [];
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const nodePositions = new Map<string, { x: number; y: number }>();
    const nodeMeta = new Map<string, GraphNodeMeta>();
    const areaNames = Array.from(new Set(cards.map(planningAreaForCard))).toSorted(
      (first, second) => first.localeCompare(second),
    );
    let cursorY = 64;
    const areas = areaNames.map((area, areaIndex) => {
      const areaCards = cards
        .filter((card) => planningAreaForCard(card) === area)
        .toSorted((first, second) => {
          return (
            (first.slice ?? "").localeCompare(second.slice ?? "") ||
            first.priority - second.priority ||
            first.title.localeCompare(second.title)
          );
        });
      const sliceNames = Array.from(
        new Set(areaCards.map((card) => card.slice?.trim() || "Unassigned slice")),
      ).toSorted((first, second) => first.localeCompare(second));
      const areaStartY = cursorY;
      const areaNodeId = areaGraphNodeId(area);
      nodePositions.set(areaNodeId, { x: GRAPH_X_AREA, y: areaStartY });
      nodeMeta.set(areaNodeId, {
        id: areaNodeId,
        label: area,
        kind: "Area",
        width: GRAPH_AREA_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
      });
      const slices = sliceNames.map((slice, sliceIndex) => {
        const sliceCards = areaCards.filter(
          (card) => (card.slice?.trim() || "Unassigned slice") === slice,
        );
        const sliceY = cursorY;
        const sliceNodeId = sliceGraphNodeId(area, slice);
        nodePositions.set(sliceNodeId, { x: GRAPH_X_SLICE, y: sliceY });
        nodeMeta.set(sliceNodeId, {
          id: sliceNodeId,
          label: slice,
          kind: "Slice",
          width: GRAPH_SLICE_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
        });
        for (const [cardIndex, card] of sliceCards.entries()) {
          const draftPosition = graphNodeDraftPositions[card.id];
          const cardPosition = draftPosition ?? card.graphPosition;
          nodePositions.set(
            card.id,
            cardPosition ?? {
              x: GRAPH_X_CARD + cardIndex * GRAPH_X_SPACING_CARD,
              y: sliceY,
            },
          );
          nodeMeta.set(card.id, {
            id: card.id,
            label: card.title,
            kind: "Card",
            width: GRAPH_NODE_WIDTH,
            height: GRAPH_NODE_HEIGHT,
          });
        }
        cursorY += GRAPH_ROW_HEIGHT + GRAPH_ROW_GAP;
        return {
          slice,
          sliceIndex,
          y: sliceY,
          cards: sliceCards,
        };
      });
      const areaEndY = Math.max(areaStartY, cursorY - GRAPH_ROW_GAP - GRAPH_ROW_HEIGHT);
      return {
        area,
        areaIndex,
        y: areaStartY + Math.max(0, areaEndY - areaStartY) / 2,
        cards: areaCards,
        slices,
      };
    });
    const dependencyEdges = cards.flatMap((card) =>
      card.dependencies
        .map((dependencyId) => {
          const dependency = cardById.get(dependencyId);
          if (!dependency) return null;
          return {
            from: dependency,
            to: card,
          };
        })
        .filter((edge): edge is { from: AgentBoardCard; to: AgentBoardCard } => edge !== null),
    );
    const maxCardCount = Math.max(
      1,
      ...areas.flatMap((area) => area.slices.map((slice) => slice.cards.length)),
    );
    const maxPositionX = Math.max(0, ...Array.from(nodePositions.values()).map((pos) => pos.x));
    const maxPositionY = Math.max(0, ...Array.from(nodePositions.values()).map((pos) => pos.y));
    const width = Math.max(
      GRAPH_X_CARD + maxCardCount * GRAPH_X_SPACING_CARD + 120,
      maxPositionX + 260,
    );
    const height = Math.max(520, cursorY + 80, maxPositionY + 180);
    const graphLinks = (board?.graphLinks ?? []).filter(
      (link) => nodePositions.has(link.from) && nodePositions.has(link.to),
    );
    return { areas, dependencyEdges, graphLinks, nodeMeta, nodePositions, width, height };
  }, [board?.cards, board?.graphLinks, graphNodeDraftPositions]);
  const dependencyTreeModel = useMemo(() => {
    const cards = board?.cards ?? [];
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const dependentsById = new Map<string, AgentBoardCard[]>();
    for (const card of cards) {
      for (const dependencyId of card.dependencies) {
        const dependency = cardById.get(dependencyId);
        if (!dependency) continue;
        dependentsById.set(dependencyId, [...(dependentsById.get(dependencyId) ?? []), card]);
      }
    }

    const futureCards = cards.filter(
      (card) => planningAreaForCard(card) === FUTURE_SCOPE_AREA_LABEL,
    );
    const activeCards = cards.filter(
      (card) =>
        planningAreaForCard(card) !== FUTURE_SCOPE_AREA_LABEL &&
        planningAreaForCard(card) !== UNASSIGNED_AREA_LABEL,
    );
    const explicitlyUnassignedCards = cards.filter(
      (card) => planningAreaForCard(card) === UNASSIGNED_AREA_LABEL,
    );
    const activeCardIds = new Set(activeCards.map((card) => card.id));
    const activeDependencyCount = (card: AgentBoardCard) =>
      card.dependencies.filter((dependencyId) => activeCardIds.has(dependencyId)).length;
    const activeDependentCount = (card: AgentBoardCard) =>
      (dependentsById.get(card.id) ?? []).filter((dependent) => activeCardIds.has(dependent.id))
        .length;
    const independentCards = [
      ...explicitlyUnassignedCards,
      ...activeCards.filter(
        (card) => activeDependencyCount(card) === 0 && activeDependentCount(card) === 0,
      ),
    ];
    const independentIds = new Set(independentCards.map((card) => card.id));
    const pathCards = activeCards.filter((card) => !independentIds.has(card.id));
    const pathCardIds = new Set(pathCards.map((card) => card.id));
    const depthCache = new Map<string, number>();
    const depthForCard = (card: AgentBoardCard, visiting = new Set<string>()): number => {
      const cached = depthCache.get(card.id);
      if (cached !== undefined) return cached;
      if (visiting.has(card.id)) return 0;
      visiting.add(card.id);
      const dependencyDepths = card.dependencies
        .map((dependencyId) => cardById.get(dependencyId))
        .filter((dependency): dependency is AgentBoardCard =>
          Boolean(dependency && pathCardIds.has(dependency.id)),
        )
        .map((dependency) => depthForCard(dependency, new Set(visiting)));
      const depth = dependencyDepths.length ? Math.max(...dependencyDepths) + 1 : 0;
      depthCache.set(card.id, depth);
      return depth;
    };
    const tierMap = new Map<number, AgentBoardCard[]>();
    for (const card of pathCards) {
      const depth = depthForCard(card);
      tierMap.set(depth, [...(tierMap.get(depth) ?? []), card]);
    }
    const tiers = Array.from(tierMap.entries())
      .toSorted(([first], [second]) => first - second)
      .map(([depth, tierCards], index, allTiers) => {
        const isFirst = index === 0;
        const isLast = index === allTiers.length - 1;
        const label = isFirst ? "Foundations" : isLast ? "Finish pass" : `Build tier ${depth + 1}`;
        return {
          depth,
          label,
          groups: groupDependencyTreeCards(tierCards),
        };
      });
    const edges: DependencyTreeEdge[] = pathCards.flatMap((card) =>
      card.dependencies
        .map((dependencyId) => cardById.get(dependencyId))
        .filter((dependency): dependency is AgentBoardCard =>
          Boolean(dependency && pathCardIds.has(dependency.id)),
        )
        .map((dependency) => ({ from: dependency, to: card })),
    );

    return {
      independentGroups: groupDependencyTreeCards(independentCards),
      futureGroups: groupDependencyTreeCards(futureCards),
      tiers,
      edges,
    };
  }, [board?.cards]);
  const planningTableGridTemplate = useMemo(
    () =>
      [
        planningTableColumnWidths.area,
        planningTableColumnWidths.slice,
        planningTableColumnWidths.card,
        planningTableColumnWidths.status,
        planningTableColumnWidths.priority,
        planningTableColumnWidths.slicePlan,
        planningTableColumnWidths.actions,
      ]
        .map((width) => `${width}px`)
        .join(" "),
    [planningTableColumnWidths],
  );
  const planningTableMinWidth = useMemo(
    () => Object.values(planningTableColumnWidths).reduce((total, width) => total + width, 0) + 24,
    [planningTableColumnWidths],
  );
  const graphGridStyle = useMemo(() => {
    const scaledGridSize = GRAPH_GRID_SIZE * graphZoom;
    return {
      backgroundImage:
        "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--muted-foreground) 22%, transparent) 1px, transparent 0)",
      backgroundSize: `${scaledGridSize}px ${scaledGridSize}px`,
      backgroundPosition: `${graphPanOffset.x}px ${graphPanOffset.y}px`,
    };
  }, [graphPanOffset.x, graphPanOffset.y, graphZoom]);

  const syncHorizontalScroll = useCallback((source: HTMLDivElement, target: HTMLDivElement) => {
    if (syncingScrollRef.current) return;
    syncingScrollRef.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  const handleTopScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const boardScroller = boardScrollRef.current;
      if (!boardScroller) return;
      syncHorizontalScroll(event.currentTarget, boardScroller);
    },
    [syncHorizontalScroll],
  );

  const handleBoardScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const topScroller = topScrollRef.current;
      if (!topScroller) return;
      syncHorizontalScroll(event.currentTarget, topScroller);
    },
    [syncHorizontalScroll],
  );

  const handleBoardWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const boardScroller = boardScrollRef.current;
    const topScroller = topScrollRef.current;
    if (!boardScroller || !topScroller) return;
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const scrollDelta = horizontalDelta ? event.deltaX : event.deltaY;
    if (scrollDelta === 0) return;

    const nextScrollLeft = boardScroller.scrollLeft + scrollDelta;
    const canScrollLeft = boardScroller.scrollLeft > 0 && scrollDelta < 0;
    const canScrollRight =
      boardScroller.scrollLeft < boardScroller.scrollWidth - boardScroller.clientWidth &&
      scrollDelta > 0;
    if (!horizontalDelta && !canScrollLeft && !canScrollRight) return;

    event.preventDefault();
    boardScroller.scrollLeft = nextScrollLeft;
    topScroller.scrollLeft = boardScroller.scrollLeft;
  }, []);

  const centerGraphCanvas = useCallback(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    setGraphPanOffset({
      x: Math.round(canvas.clientWidth / 2 - (graphModel.width * graphZoom) / 2),
      y: 24,
    });
  }, [graphModel.width, graphZoom]);

  const handleGraphWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const canvas = graphCanvasRef.current;
      if (!canvas) return;
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const nextZoom = clamp(
        graphZoom * (1 - event.deltaY * GRAPH_ZOOM_STEP),
        GRAPH_MIN_ZOOM,
        GRAPH_MAX_ZOOM,
      );
      if (nextZoom === graphZoom) return;

      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const worldX = (cursorX - graphPanOffset.x) / graphZoom;
      const worldY = (cursorY - graphPanOffset.y) / graphZoom;

      setGraphZoom(nextZoom);
      setGraphPanOffset({
        x: cursorX - worldX * nextZoom,
        y: cursorY - worldY * nextZoom,
      });
    },
    [graphPanOffset.x, graphPanOffset.y, graphZoom],
  );

  const beginGraphPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest(GRAPH_PAN_IGNORE_SELECTOR) !== null
      ) {
        return;
      }

      const canvas = event.currentTarget;
      graphPanRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: graphPanOffset.x,
        offsetY: graphPanOffset.y,
      };
      canvas.setPointerCapture(event.pointerId);
      setIsGraphPanning(true);
      event.preventDefault();
    },
    [graphPanOffset.x, graphPanOffset.y],
  );

  const updateGraphPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = graphPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setGraphPanOffset({
      x: pan.offsetX + event.clientX - pan.startX,
      y: pan.offsetY + event.clientY - pan.startY,
    });
    event.preventDefault();
  }, []);

  const endGraphPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = graphPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    graphPanRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsGraphPanning(false);
  }, []);

  const beginPlanningColumnResize = useCallback(
    (column: PlanningTableColumn, startX: number) => {
      const startWidth = planningTableColumnWidths[column];
      const minWidth = PLANNING_TABLE_COLUMN_MIN_WIDTH[column];

      const handlePointerMove = (event: PointerEvent) => {
        const nextWidth = Math.max(minWidth, startWidth + event.clientX - startX);
        setPlanningTableColumnWidths((widths) => ({
          ...widths,
          [column]: nextWidth,
        }));
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [planningTableColumnWidths],
  );

  const togglePlanningArea = useCallback((area: string) => {
    setCollapsedPlanningAreas((existing) => {
      const next = new Set(existing);
      if (next.has(area)) {
        next.delete(area);
      } else {
        next.add(area);
      }
      return next;
    });
  }, []);

  const toggleDependencySlice = useCallback((area: string, slice: string) => {
    const key = dependencySliceKey(area, slice);
    setCollapsedDependencySlices((existing) => {
      const next = new Set(existing);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const loadAgentBoard = useAtomCommand(agentBoardEnvironment.load);

  const loadBoard = useCallback(
    (options?: { readonly silent?: boolean }) => {
      if (!workspaceRoot) return;
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }
      void loadAgentBoard({
        environmentId,
        input: { cwd: workspaceRoot, createIfMissing: true },
      })
        .then((outcome) => {
          if (outcome._tag !== "Success") {
            const loadError = squashAtomCommandFailure(outcome);
            if (!options?.silent) {
              setError(loadError instanceof Error ? loadError.message : "Could not load board.");
            }
            return;
          }
          const result = outcome.value;
          setBoard(result.board);
          if (!options?.silent) {
            // Sync view state: URL wins (shareable), otherwise board.defaultView.
            const urlView = readBoardViewFromUrl();
            if (urlView) {
              setBoardView(urlView);
            } else {
              const persistedView = (result.board.defaultView ?? "kanban") as AgentBoardLocalView;
              setBoardView(persistedView);
              writeBoardViewToUrl(persistedView);
            }
            setSelectedCardId((existing) => {
              const selected =
                result.board.cards.find((card) => card.id === existing) ??
                result.board.cards[0] ??
                null;
              setIntentDraft(selected ? intentDraftFromCard(selected) : emptyIntentDraft());
              return selected?.id ?? null;
            });
          }
        })
        .catch((loadError) => {
          if (!options?.silent) {
            setError(loadError instanceof Error ? loadError.message : "Could not load board.");
          }
        })
        .then(
          () => {
            if (!options?.silent) setLoading(false);
          },
          () => {
            if (!options?.silent) setLoading(false);
          },
        );
    },
    [environmentId, loadAgentBoard, workspaceRoot],
  );

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (!workspaceRoot) return;
    const timer = window.setInterval(() => loadBoard({ silent: true }), BOARD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadBoard, workspaceRoot]);

  const saveAgentBoardCommand = useAtomCommand(agentBoardEnvironment.save);

  const saveBoard = useCallback(
    (nextBoard: AgentBoardFileType) => {
      if (!workspaceRoot) return;
      setBoard(nextBoard);
      setSaving(true);
      setError(null);
      void saveAgentBoardCommand({
        environmentId,
        input: { cwd: workspaceRoot, board: nextBoard },
      })
        .then((outcome) => {
          if (outcome._tag !== "Success") {
            throw squashAtomCommandFailure(outcome);
          }
          setBoard(outcome.value.board);
        })
        .catch((saveError) => {
          const description =
            saveError instanceof Error ? saveError.message : "Could not save board.";
          setError(description);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Board save failed",
              description,
            }),
          );
        })
        .then(
          () => setSaving(false),
          () => setSaving(false),
        );
    },
    [environmentId, workspaceRoot],
  );

  const setBoardViewAndPersist = useCallback(
    (nextView: AgentBoardLocalView) => {
      setBoardView(nextView);
      writeBoardViewToUrl(nextView);
      if (!board) return;
      const persisted = boardViewToPersistedView(nextView);
      if (board.defaultView === persisted) return;
      const timestamp = new Date().toISOString();
      saveBoard({ ...board, defaultView: persisted, updatedAt: timestamp });
    },
    [board, saveBoard],
  );

  useEffect(() => {
    const handlePopState = () => {
      const next = readBoardViewFromUrl();
      if (next) setBoardView(next);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // ----- worker execution config -----
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, serverProviders),
    [serverProviders, settings],
  );
  const workerResolution = useMemo(
    () => (board ? resolveWorkerModelSelection(board, projectDefaultModelSelection) : null),
    [board, projectDefaultModelSelection],
  );
  const workerSelection = workerResolution?._tag === "resolved" ? workerResolution.selection : null;
  const workerEntry = workerSelection
    ? (instanceEntries.find((entry) => entry.instanceId === workerSelection.instanceId) ?? null)
    : null;
  const workerSourceLabel =
    workerResolution?._tag !== "resolved"
      ? MISSING_WORKER_CONFIG_ERROR
      : workerResolution.source === "board-runner"
        ? "Board override — used for every card run"
        : "Project default — pick a model to override";
  const setWorkerModelOverride = useCallback(
    (selection: ModelSelection | null) => {
      if (!board) return;
      const timestamp = new Date().toISOString();
      const { workerModelSelection: _clearedOverride, ...runner } = board.runner;
      saveBoard({
        ...board,
        runner: selection ? { ...runner, workerModelSelection: selection } : runner,
        updatedAt: timestamp,
      });
    },
    [board, saveBoard],
  );

  // ----- Supervisor thread (normal thread, pinned + badge) -----
  const boardProjects = useProjects();
  const boardThreadShells = useThreadShells();
  const supervisorProject = useMemo(() => {
    if (!workspaceRoot) return null;
    return (
      boardProjects.find(
        (candidate) =>
          candidate.environmentId === environmentId && candidate.workspaceRoot === workspaceRoot,
      ) ?? null
    );
  }, [boardProjects, environmentId, workspaceRoot]);
  const hasSupervisorForProject = useMemo(() => {
    if (!supervisorProject) return false;
    return boardThreadShells.some(
      (shell) =>
        shell.environmentId === environmentId &&
        shell.projectId === supervisorProject.id &&
        isSupervisorThread(shell),
    );
  }, [boardThreadShells, environmentId, supervisorProject]);
  const createSupervisorThreadForBoard = useAtomCommand(threadEnvironment.create, {
    reportFailure: false,
  });
  const pinSupervisorThreadForBoard = useAtomCommand(threadEnvironment.pin, {
    reportFailure: false,
  });
  const handleCreateSupervisorThreadForBoard = useCallback(() => {
    if (!supervisorProject) {
      toastManager.add({
        type: "error",
        title: "No project found",
        description: "Open a project before creating a Supervisor thread.",
      });
      return;
    }
    let modelSelection = supervisorProject.defaultModelSelection ?? null;
    if (!modelSelection) {
      for (const entry of instanceEntries) {
        if (entry.models.length > 0) {
          modelSelection = createModelSelection(entry.instanceId, entry.models[0]!.slug);
          break;
        }
      }
    }
    if (!modelSelection) {
      toastManager.add({
        type: "error",
        title: "No provider configured",
        description: "Configure a provider before creating a Supervisor thread.",
      });
      return;
    }
    const threadId = newThreadId();
    void (async () => {
      const result = await createSupervisorThreadForBoard({
        environmentId,
        input: {
          threadId,
          projectId: supervisorProject.id,
          title: SUPERVISOR_THREAD_TITLE,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to create Supervisor thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      const pinResult = await pinSupervisorThreadForBoard({
        environmentId,
        input: { threadId },
      });
      if (pinResult._tag === "Failure" && !isAtomCommandInterrupted(pinResult)) {
        const error = squashAtomCommandFailure(pinResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Supervisor created, but pin failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [
    createSupervisorThreadForBoard,
    environmentId,
    instanceEntries,
    pinSupervisorThreadForBoard,
    supervisorProject,
  ]);

  const addDraftCard = useCallback(() => {
    if (!board) return;
    const title = draftTitle.trim();
    if (!title) return;
    const card = newDraftCard(title);
    saveBoard({
      ...board,
      cards: [...board.cards, card],
      updatedAt: new Date().toISOString(),
    });
    setSelectedCardId(card.id);
    setIntentDraft(intentDraftFromCard(card));
    setDraftTitle("");
  }, [board, draftTitle, saveBoard]);

  const addCardToState = useCallback(
    (state: AgentBoardState) => {
      if (!board) return;
      const title = quickAddTitle.trim();
      if (!title) return;
      const card = newCardForState(title, state);
      saveBoard({
        ...board,
        cards: [...board.cards, card],
        updatedAt: new Date().toISOString(),
      });
      setSelectedCardId(card.id);
      setIntentDraft(intentDraftFromCard(card));
      setQuickAddTitle("");
      setQuickAddState(null);
    },
    [board, quickAddTitle, saveBoard],
  );

  const addCardToArea = useCallback(
    (area: string) => {
      if (!board) return;
      const title = quickAddTitle.trim();
      if (!title) return;
      const card = {
        ...newCardForState(title, "Draft"),
        ...(area !== UNASSIGNED_AREA_LABEL ? { area } : {}),
      } as AgentBoardCard;
      saveBoard({
        ...board,
        cards: [...board.cards, card],
        updatedAt: new Date().toISOString(),
      });
      setSelectedCardId(card.id);
      setIntentDraft(intentDraftFromCard(card));
      setQuickAddTitle("");
      setQuickAddArea(null);
    },
    [board, quickAddTitle, saveBoard],
  );

  const updateSelectedCard = useCallback(
    (updater: (card: AgentBoardCard) => AgentBoardCard) => {
      if (!board || !selectedCard) return;
      const timestamp = new Date().toISOString();
      saveBoard({
        ...board,
        cards: board.cards.map((card) =>
          card.id === selectedCard.id ? updater({ ...card, updatedAt: timestamp }) : card,
        ),
        updatedAt: timestamp,
      });
    },
    [board, saveBoard, selectedCard],
  );

  const updateCardById = useCallback(
    (cardId: AgentBoardCardId, updater: (card: AgentBoardCard) => AgentBoardCard) => {
      if (!board) return;
      const timestamp = new Date().toISOString();
      const updatedCards = board.cards.map((card) =>
        card.id === cardId ? updater({ ...card, updatedAt: timestamp }) : card,
      );
      saveBoard({
        ...board,
        cards: updatedCards,
        updatedAt: timestamp,
      });
      const updatedCard = updatedCards.find((card) => card.id === cardId);
      if (updatedCard && selectedCardId === cardId) {
        setIntentDraft(intentDraftFromCard(updatedCard));
      }
    },
    [board, saveBoard, selectedCardId],
  );

  const selectGraphNode = useCallback(
    (nodeId: string) => {
      if (graphConnectFromNodeId && graphConnectFromNodeId !== nodeId && board) {
        const exists = (board.graphLinks ?? []).some(
          (link) => link.from === graphConnectFromNodeId && link.to === nodeId,
        );
        if (!exists) {
          saveBoard({
            ...board,
            graphLinks: [
              ...(board.graphLinks ?? []),
              {
                from: graphConnectFromNodeId,
                to: nodeId,
                kind: "depends-on",
              },
            ],
            updatedAt: new Date().toISOString(),
          });
        }
        setGraphConnectFromNodeId(null);
      }
      setSelectedGraphNodeId(nodeId);
    },
    [board, graphConnectFromNodeId, saveBoard],
  );

  const selectedGraphNode = selectedGraphNodeId
    ? graphModel.nodeMeta.get(selectedGraphNodeId)
    : null;

  const beginGraphNodeDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cardId: AgentBoardCardId) => {
      if (event.button !== 0) return;
      const position = graphModel.nodePositions.get(cardId);
      if (!position) return;
      graphNodeDragRef.current = {
        cardId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    },
    [graphModel.nodePositions],
  );

  const updateGraphNodeDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = graphNodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = (event.clientX - drag.startX) / graphZoom;
      const deltaY = (event.clientY - drag.startY) / graphZoom;
      const moved = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
      if (moved) {
        drag.moved = true;
        suppressGraphNodeClickRef.current = true;
      }
      setGraphNodeDraftPositions((positions) => ({
        ...positions,
        [drag.cardId]: {
          x: Math.max(0, Math.round(drag.originX + deltaX)),
          y: Math.max(0, Math.round(drag.originY + deltaY)),
        },
      }));
      event.preventDefault();
      event.stopPropagation();
    },
    [graphZoom],
  );

  const endGraphNodeDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = graphNodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      graphNodeDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const position = graphNodeDraftPositions[drag.cardId];
      if (drag.moved && position) {
        updateCardById(
          drag.cardId,
          (card) =>
            ({
              ...card,
              graphPosition: position,
            }) as AgentBoardCard,
        );
      }
      event.stopPropagation();
      window.setTimeout(() => {
        suppressGraphNodeClickRef.current = false;
      }, 0);
    },
    [graphNodeDraftPositions, updateCardById],
  );

  const planningCellKey = useCallback(
    (cardId: AgentBoardCardId, column: PlanningEditableColumn) => {
      return `${cardId}:${column}`;
    },
    [],
  );

  const readPlanningCellValue = useCallback(
    (card: AgentBoardCard, column: PlanningEditableColumn): string => {
      const draft = planningCellDrafts[planningCellKey(card.id, column)];
      if (draft !== undefined) return draft;
      switch (column) {
        case "area":
          return card.area ?? "";
        case "slice":
          return card.slice ?? "";
        case "card":
          return card.title;
        case "priority":
          return String(card.priority);
        case "slicePlan":
          return card.slicePlanPath ?? "";
      }
    },
    [planningCellDrafts, planningCellKey],
  );

  const setPlanningCellDraft = useCallback(
    (cardId: AgentBoardCardId, column: PlanningEditableColumn, value: string) => {
      const key = planningCellKey(cardId, column);
      setPlanningCellDrafts((drafts) => ({ ...drafts, [key]: value }));
    },
    [planningCellKey],
  );

  const clearPlanningCellDraft = useCallback(
    (cardId: AgentBoardCardId, column: PlanningEditableColumn) => {
      const key = planningCellKey(cardId, column);
      setPlanningCellDrafts((drafts) => {
        if (!(key in drafts)) return drafts;
        const next = { ...drafts };
        delete next[key];
        return next;
      });
    },
    [planningCellKey],
  );

  const commitPlanningCellDraft = useCallback(
    (card: AgentBoardCard, column: PlanningEditableColumn) => {
      const key = planningCellKey(card.id, column);
      const pendingTimer = planningCommitTimersRef.current.get(key);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        planningCommitTimersRef.current.delete(key);
      }
      const value = planningCellDrafts[planningCellKey(card.id, column)];
      if (value === undefined) return;

      switch (column) {
        case "area":
        case "slice":
          updateCardById(card.id, (existing) => cardWithPlanningField(existing, column, value));
          break;
        case "card":
          if (value.trim()) {
            updateCardById(
              card.id,
              (existing) => ({ ...existing, title: value.trim() }) as AgentBoardCard,
            );
          }
          break;
        case "priority": {
          const priority = Number.parseInt(value, 10);
          if (Number.isFinite(priority) && priority >= 1) {
            updateCardById(card.id, (existing) => ({ ...existing, priority }) as AgentBoardCard);
          }
          break;
        }
        case "slicePlan":
          updateCardById(card.id, (existing) =>
            cardWithPlanningField(existing, "slicePlanPath", value),
          );
          break;
      }
      clearPlanningCellDraft(card.id, column);
    },
    [clearPlanningCellDraft, planningCellDrafts, planningCellKey, updateCardById],
  );

  const schedulePlanningCellCommit = useCallback(
    (card: AgentBoardCard, column: PlanningEditableColumn) => {
      const key = planningCellKey(card.id, column);
      const existing = planningCommitTimersRef.current.get(key);
      if (existing) {
        window.clearTimeout(existing);
      }
      const scheduleTimer = (): number =>
        window.setTimeout(() => {
          if (planningEditIsFocused()) {
            planningCommitTimersRef.current.set(key, scheduleTimer());
            return;
          }
          planningCommitTimersRef.current.delete(key);
          commitPlanningCellDraft(card, column);
        }, PLANNING_EDIT_COMMIT_DELAY_MS);
      const timer = scheduleTimer();
      planningCommitTimersRef.current.set(key, timer);
    },
    [commitPlanningCellDraft, planningCellKey],
  );

  const openCardDetails = useCallback((card: AgentBoardCard) => {
    setSelectedCardId(card.id);
    setDetailCardId(card.id);
    setDetailDraft(detailDraftFromCard(card));
    setIntentDraft(intentDraftFromCard(card));
    setError(null);
  }, []);

  const updateDetailCard = useCallback(
    (updater: (card: AgentBoardCard) => AgentBoardCard) => {
      if (!board || !detailCard) return;
      const timestamp = new Date().toISOString();
      const updatedCard = updater({ ...detailCard, updatedAt: timestamp });
      saveBoard({
        ...board,
        cards: board.cards.map((card) => (card.id === detailCard.id ? updatedCard : card)),
        updatedAt: timestamp,
      });
      setSelectedCardId(updatedCard.id);
      setDetailDraft(detailDraftFromCard(updatedCard));
      setIntentDraft(intentDraftFromCard(updatedCard));
    },
    [board, detailCard, saveBoard],
  );

  const commitDetailDraft = useCallback(() => {
    if (detailCommitTimerRef.current) {
      window.clearTimeout(detailCommitTimerRef.current);
      detailCommitTimerRef.current = null;
    }
    if (!detailDraft) return;
    updateDetailCard((card) => {
      const {
        area: _existingArea,
        slice: _existingSlice,
        slicePlanPath: _existingSlicePlanPath,
        ...cardWithoutPlanningFields
      } = card;
      const area = optionalTrimmedValue(detailDraft.area);
      const slice = optionalTrimmedValue(detailDraft.slice);
      const slicePlanPath = optionalTrimmedValue(detailDraft.slicePlanPath);
      return {
        ...cardWithoutPlanningFields,
        title: detailDraft.title.trim() || card.title,
        dependencies: dependencyIdsFromDraft(detailDraft.dependencies),
        ...(area ? { area } : {}),
        ...(slice ? { slice } : {}),
        ...(slicePlanPath ? { slicePlanPath } : {}),
      } as AgentBoardCard;
    });
  }, [detailDraft, updateDetailCard]);

  const scheduleDetailDraftCommit = useCallback(() => {
    if (detailCommitTimerRef.current) {
      window.clearTimeout(detailCommitTimerRef.current);
    }
    const scheduleTimer = (): number =>
      window.setTimeout(() => {
        if (planningEditIsFocused()) {
          detailCommitTimerRef.current = scheduleTimer();
          return;
        }
        detailCommitTimerRef.current = null;
        commitDetailDraft();
      }, PLANNING_EDIT_COMMIT_DELAY_MS);
    detailCommitTimerRef.current = scheduleTimer();
  }, [commitDetailDraft]);

  const saveIntentBrief = useCallback(() => {
    const intentBrief = intentBriefFromDraft(intentDraft);
    if (!intentBrief) {
      reportPlanningError("Intent is required before saving a brief.");
      return;
    }
    updateSelectedCard((card) => ({ ...card, intentBrief }) as AgentBoardCard);
  }, [intentDraft, reportPlanningError, updateSelectedCard]);

  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile);

  const createTaskRecord = useCallback(() => {
    const intentBrief = intentBriefFromDraft(intentDraft);
    const card = detailCard ?? selectedCard;
    if (!intentBrief) {
      reportPlanningError("Intent is required before creating a task record.");
      return;
    }
    if (!workspaceRoot) {
      reportPlanningError("Open a project workspace before marking a card Ready.");
      return;
    }
    if (!board || !card) {
      reportPlanningError("Select a card before marking it Ready.");
      return;
    }
    const taskRecordPath =
      card.taskRecordPath ?? `docs/agents/tasks/${card.id}-${slugifyTitle(card.title)}.md`;
    const timestamp = new Date().toISOString();
    const nextCard = {
      ...card,
      state: "Ready" as const,
      taskRecordPath,
      slicePlanPath: card.slicePlanPath ?? DEFAULT_SLICE_PLAN_PATH,
      intentBrief,
      updatedAt: timestamp,
    } as AgentBoardCard;
    const nextBoard = {
      ...board,
      cards: board.cards.map((entry) => (entry.id === card.id ? nextCard : entry)),
      updatedAt: timestamp,
    };
    setBoard(nextBoard);
    setSelectedCardId(nextCard.id);
    setIntentDraft(intentDraftFromCard(nextCard));
    setSaving(true);
    setError(null);
    void writeProjectFile({
      environmentId,
      input: {
        cwd: workspaceRoot,
        relativePath: taskRecordPath,
        contents: taskRecordMarkdown({ card: nextCard, taskRecordPath, intentBrief }),
      },
    })
      .then((outcome) => {
        if (outcome._tag !== "Success") throw squashAtomCommandFailure(outcome);
        return saveAgentBoardCommand({
          environmentId,
          input: { cwd: workspaceRoot, board: nextBoard },
        });
      })
      .then((outcome) => {
        if (outcome._tag !== "Success") throw squashAtomCommandFailure(outcome);
        setBoard(outcome.value.board);
        toastManager.add({
          type: "success",
          title: "Task record created",
          description: taskRecordPath,
        });
      })
      .catch((taskError) => {
        const description =
          taskError instanceof Error ? taskError.message : "Could not create task record.";
        setError(description);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Task record failed",
            description,
          }),
        );
      })
      .then(
        () => setSaving(false),
        () => setSaving(false),
      );
  }, [
    board,
    detailCard,
    environmentId,
    intentDraft,
    reportPlanningError,
    saveAgentBoardCommand,
    selectedCard,
    workspaceRoot,
    writeProjectFile,
  ]);

  const moveCard = useCallback(
    (cardId: AgentBoardCardId, state: AgentBoardState) => {
      if (!board) return;
      const timestamp = new Date().toISOString();
      saveBoard({
        ...board,
        cards: board.cards.map((card) =>
          card.id === cardId ? cardWithState(card, state, timestamp) : card,
        ),
        updatedAt: timestamp,
      });
    },
    [board, saveBoard],
  );

  const boardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleBoardDragStart = useCallback((event: DragStartEvent) => {
    setDraggingCardId(event.active.id as AgentBoardCardId);
  }, []);

  const handleBoardDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingCardId(null);
      const target = event.over?.id;
      if (!target || !event.active.id) return;
      if (target === event.active.id) return;
      moveCard(event.active.id as AgentBoardCardId, target as AgentBoardState);
    },
    [moveCard],
  );

  const handleBoardDragCancel = useCallback(() => {
    setDraggingCardId(null);
  }, []);

  const runAgentBoardCard = useAtomCommand(agentBoardEnvironment.runCard);

  const runReadyCard = useCallback(
    (card: AgentBoardCard) => {
      if (!workspaceRoot || card.state !== "Ready") return;
      setSaving(true);
      setError(null);
      void runAgentBoardCard({
        environmentId,
        input: { cwd: workspaceRoot, cardId: card.id },
      })
        .then((outcome) => {
          if (outcome._tag !== "Success") throw squashAtomCommandFailure(outcome);
          const result = outcome.value;
          setBoard(result.board);
          setSelectedCardId(result.card.id);
          setIntentDraft(intentDraftFromCard(result.card));
          toastManager.add({
            type: "success",
            title: "Agent run started",
            description: `${result.card.title} is running in ${result.workspacePath}.`,
          });
        })
        .catch((runError) => {
          const description =
            runError instanceof Error ? runError.message : "Could not run board card.";
          setError(description);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Run failed",
              description,
            }),
          );
          loadBoard();
        })
        .then(
          () => setSaving(false),
          () => setSaving(false),
        );
    },
    [environmentId, loadBoard, runAgentBoardCard, workspaceRoot],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[380px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-emerald-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-emerald-300 uppercase"
          >
            Board
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground/60">
            .t3/agent-board.json
          </span>
          {mode === "page" ? (
            <div
              role="tablist"
              aria-label="Board view"
              className="ml-2 flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/20 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isKanbanView}
                onClick={() => setBoardViewAndPersist("kanban")}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors",
                  isKanbanView
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
                )}
              >
                <KanbanSquareIcon className="size-3.5" />
                Kanban
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={boardView === "table"}
                onClick={() => setBoardViewAndPersist("table")}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors",
                  boardView === "table"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
                )}
              >
                <Table2Icon className="size-3.5" />
                Planning table
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={boardView === "execution-path"}
                onClick={() => setBoardViewAndPersist("execution-path")}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors",
                  boardView === "execution-path"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
                )}
              >
                <GitBranchIcon className="size-3.5" />
                Execution path
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {mode === "page" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setBoardViewAndPersist(isExpandedView ? "kanban" : "expanded")}
              aria-label={isExpandedView ? "Exit expanded view" : "Expand Kanban"}
              aria-pressed={isExpandedView}
              title={
                isExpandedView
                  ? "Exit expanded (320px → 260px)"
                  : "Expand Kanban to fullscreen (260px → 320px)"
              }
            >
              {isExpandedView ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <Maximize2Icon className="size-3.5" />
              )}
              {isExpandedView ? "Exit expanded" : "Expand"}
            </Button>
          ) : null}
          {mode === "page" ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              onClick={() => {
                if (boardView === "table") {
                  setQuickAddArea(UNASSIGNED_AREA_LABEL);
                } else {
                  setQuickAddState("Draft");
                }
                setQuickAddTitle("");
              }}
              disabled={!board || saving}
            >
              <PlusIcon className="size-3.5" />
              New item
            </Button>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => loadBoard()}
            disabled={loading || !workspaceRoot}
            aria-label="Refresh board"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          {mode !== "page" ? (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onClose}
              aria-label="Close board sidebar"
              className="text-muted-foreground/50 hover:text-foreground/70"
            >
              <PanelRightCloseIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div
        data-agent-board-worker-config="true"
        className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/50 px-3 py-2"
      >
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-[11px] font-medium text-foreground/80">Worker execution</p>
          <p className="truncate text-[10px] text-muted-foreground/60">{workerSourceLabel}</p>
        </div>
        {instanceEntries.length === 0 ? (
          <span className="text-xs text-muted-foreground">No providers available</span>
        ) : workerSelection && workerEntry ? (
          <div className="flex items-center gap-1.5">
            <ProviderModelPicker
              compact
              activeInstanceId={workerSelection.instanceId}
              model={workerSelection.model}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="h-7 min-w-0 max-w-none shrink-0 text-xs text-foreground/90 hover:text-foreground"
              disabled={!board || saving}
              onInstanceModelChange={(instanceId, model) => {
                setWorkerModelOverride(createModelSelection(instanceId, model));
              }}
            />
            <TraitsPicker
              provider={workerEntry.driverKind}
              models={workerEntry.models}
              model={workerSelection.model}
              planModeEnabled={settings.planModeEnabled}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={workerSelection.options ?? []}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="h-7 min-w-0 max-w-none shrink-0 text-xs text-foreground/90 hover:text-foreground"
              onModelOptionsChange={(nextOptions) => {
                setWorkerModelOverride(
                  createModelSelection(
                    workerSelection.instanceId,
                    workerSelection.model,
                    nextOptions,
                  ),
                );
              }}
            />
            {board?.runner.workerModelSelection ? (
              <Button
                size="xs"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                disabled={!board || saving}
                onClick={() => setWorkerModelOverride(null)}
                title="Clear the board override and use the project default model"
              >
                Use project default
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {workerEntry ? "Configured provider unavailable" : "Not configured"}
          </span>
        )}
      </div>

      {/* Supervisor thread affordance — a normal pinned thread, just easy to find. */}
      {supervisorProject ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-violet-500/[0.04] px-3 py-2">
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-violet-500/30 bg-violet-500/15 px-1.5 py-0 text-[10px] font-medium text-violet-700 dark:border-violet-400/30 dark:text-violet-300"
          >
            Supervisor
          </Badge>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
            {hasSupervisorForProject
              ? "Project Supervisor thread is pinned at the top of the list."
              : "No Supervisor thread yet for this project."}
          </span>
          {!hasSupervisorForProject ? (
            <Button
              size="xs"
              variant="outline"
              className="h-6 shrink-0 px-2 text-[11px]"
              disabled={!workspaceRoot || saving}
              onClick={handleCreateSupervisorThreadForBoard}
            >
              <PlusIcon className="size-3" />
              Create Supervisor
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={cn("shrink-0 border-b border-border/50 p-3", mode === "page" && "hidden")}>
        <div className="flex gap-2">
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                addDraftCard();
              }
            }}
            placeholder="New draft card"
            disabled={!board || saving}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 px-2"
            onClick={addDraftCard}
            disabled={!board || saving || draftTitle.trim().length === 0}
            title="Add draft card"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        {error ? <p className="mt-2 text-[11px] leading-4 text-rose-300">{error}</p> : null}
        {!workspaceRoot ? (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground/60">
            Open a project thread to load its board.
          </p>
        ) : null}
        {selectedCard ? (
          <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium text-foreground/80">
                {selectedCard.title}
              </p>
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px]",
                  stateTone(selectedCard.state),
                )}
              >
                {selectedCard.state}
              </span>
            </div>
            <Input
              value={intentDraft.intent}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setIntentDraft((draft) => ({ ...draft, intent: value }));
              }}
              placeholder="Intent"
              className="h-8 text-xs"
            />
            <Input
              value={intentDraft.desiredOutcome}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setIntentDraft((draft) => ({
                  ...draft,
                  desiredOutcome: value,
                }));
              }}
              placeholder="Desired outcome"
              className="h-8 text-xs"
            />
            <textarea
              value={intentDraft.acceptanceCriteria}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setIntentDraft((draft) => ({
                  ...draft,
                  acceptanceCriteria: value,
                }));
              }}
              placeholder="Acceptance criteria, one per line"
              className="min-h-20 w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-hidden transition-colors placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="grid grid-cols-2 gap-2">
              <textarea
                value={intentDraft.constraints}
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setIntentDraft((draft) => ({ ...draft, constraints: value }));
                }}
                placeholder="Constraints"
                className="min-h-16 resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-hidden placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <textarea
                value={intentDraft.nonGoals}
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setIntentDraft((draft) => ({ ...draft, nonGoals: value }));
                }}
                placeholder="Non-goals"
                className="min-h-16 resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-hidden placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <textarea
              value={intentDraft.openDecisions}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setIntentDraft((draft) => ({
                  ...draft,
                  openDecisions: value,
                }));
              }}
              placeholder="Open decisions"
              className="min-h-14 w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-hidden placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-8 flex-1"
                onClick={saveIntentBrief}
                disabled={saving}
              >
                <SaveIcon className="size-3.5" />
                Save brief
              </Button>
              <Button size="sm" className="h-8 flex-1" onClick={createTaskRecord} disabled={saving}>
                Ready
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "page" && isKanbanView ? (
        <div className="border-b border-border/45 px-3 py-1.5">
          <div
            ref={topScrollRef}
            onScroll={handleTopScroll}
            className="h-3 overflow-x-auto overflow-y-hidden [scrollbar-color:color-mix(in_oklab,var(--foreground)_25%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/25 [&::-webkit-scrollbar-track]:bg-transparent"
            aria-label="Scroll board columns"
          >
            <div style={{ width: boardMinWidth }} className="h-px" />
          </div>
        </div>
      ) : null}

      <div
        ref={mode === "page" ? boardScrollRef : undefined}
        onScroll={mode === "page" && isKanbanView ? handleBoardScroll : undefined}
        onWheel={mode === "page" && isKanbanView ? handleBoardWheel : undefined}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          mode === "page" &&
            "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          mode === "page" && !isKanbanView && "hidden",
          isExpandedView && "bg-background",
        )}
      >
        <div
          className={cn(
            mode === "page" ? "grid min-h-full grid-flow-col gap-3 p-3" : "space-y-3 p-3",
            isExpandedView && "gap-4 p-4",
            draggingCardId && "select-none",
          )}
          style={
            mode === "page"
              ? {
                  boxSizing: "border-box",
                  minWidth: boardMinWidth,
                  gridTemplateColumns: `repeat(${columns.length}, minmax(${effectiveColumnMinWidth}px, 1fr))`,
                }
              : undefined
          }
        >
          <DndContext
            sensors={boardSensors}
            onDragStart={handleBoardDragStart}
            onDragEnd={handleBoardDragEnd}
            onDragCancel={handleBoardDragCancel}
          >
            {loading && !board ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground/50 text-xs">
                <LoaderIcon className="size-3.5 animate-spin" />
                Loading board
              </div>
            ) : null}

            {board && board.cards.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] text-muted-foreground/45">No cards yet.</p>
                <p className="mt-1 text-[11px] text-muted-foreground/35">
                  Add a draft card to start shaping work.
                </p>
              </div>
            ) : null}

            {columns.map((column) => (
              <KanbanDroppableColumn
                key={column.state}
                id={column.state}
                disabled={mode !== "page"}
                className={cn(
                  "space-y-2",
                  mode === "page" &&
                    "flex min-h-[520px] flex-col rounded-md border border-border/60 bg-muted/15 p-2",
                )}
              >
                <div className="flex h-8 items-center justify-between">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/55 uppercase">
                    {column.label}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground/35">
                      {column.cards.length}
                    </span>
                    {mode === "page" ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="size-6 text-muted-foreground/45 hover:text-foreground/80"
                        onClick={() => {
                          setQuickAddState(column.state);
                          setQuickAddTitle("");
                        }}
                        disabled={!board || saving}
                        aria-label={`Add card to ${column.label}`}
                      >
                        <PlusIcon className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {quickAddState === column.state ? (
                  <div className="rounded-md border border-border/70 bg-background/70 p-2">
                    <Input
                      autoFocus
                      value={quickAddTitle}
                      onChange={(event) => setQuickAddTitle(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          addCardToState(column.state);
                        }
                        if (event.key === "Escape") {
                          setQuickAddState(null);
                          setQuickAddTitle("");
                        }
                      }}
                      placeholder={`Add ${column.label.toLowerCase()} card`}
                      className="h-8 text-xs"
                    />
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="xs"
                        className="h-7 px-2 text-xs"
                        onClick={() => addCardToState(column.state)}
                        disabled={quickAddTitle.trim().length === 0 || saving}
                      >
                        Add
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setQuickAddState(null);
                          setQuickAddTitle("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className={cn("space-y-1.5", mode === "page" && "min-h-0 flex-1")}>
                  {column.cards.map((card) => (
                    <KanbanDraggableCard
                      key={card.id}
                      id={card.id}
                      disabled={mode !== "page"}
                      selected={selectedCardId === card.id}
                      onClick={() => {
                        setSelectedCardId(card.id);
                        setIntentDraft(intentDraftFromCard(card));
                      }}
                      onDoubleClick={() => openCardDetails(card)}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {card.state === "Done" ? (
                          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                        ) : (
                          <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/45" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[13px] leading-4 text-foreground/90">
                            {card.title}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-muted-foreground/35">
                            {card.id}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 text-[10px]",
                            stateTone(card.state),
                          )}
                        >
                          {card.state}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="size-6 text-muted-foreground/45 hover:text-foreground/80"
                            onClick={(event) => {
                              event.stopPropagation();
                              openCardDetails(card);
                            }}
                            aria-label={`Edit ${card.title}`}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          {card.state === "Ready" ? (
                            <Button
                              size="xs"
                              className="h-6 px-1.5 text-[10px]"
                              onClick={(event) => {
                                event.stopPropagation();
                                runReadyCard(card);
                              }}
                              disabled={saving}
                            >
                              <PlayIcon className="size-3" />
                              Run
                            </Button>
                          ) : null}
                          <Select
                            value={card.state}
                            onValueChange={(value) => moveCard(card.id, value as AgentBoardState)}
                          >
                            <SelectTrigger
                              variant="ghost"
                              size="xs"
                              className="h-6 px-1.5 text-[10px]"
                              aria-label={`Move ${card.title}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <SelectValue>Move</SelectValue>
                            </SelectTrigger>
                            <SelectPopup alignItemWithTrigger={false}>
                              {MOVABLE_STATES.map((state) => (
                                <SelectItem key={state} value={state} className="min-w-36">
                                  {state}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>
                      </div>
                    </KanbanDraggableCard>
                  ))}
                  {mode === "page" &&
                  column.cards.length === 0 &&
                  quickAddState !== column.state ? (
                    <button
                      type="button"
                      className="flex h-28 w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-background/25 text-[12px] text-muted-foreground/45 transition-colors hover:border-border hover:bg-background/45 hover:text-muted-foreground"
                      onClick={() => {
                        setQuickAddState(column.state);
                        setQuickAddTitle("");
                      }}
                    >
                      Add a card
                    </button>
                  ) : null}
                </div>
              </KanbanDroppableColumn>
            ))}
            <DragOverlay dropAnimation={null}>
              {draggingCard ? (
                <div className="w-60 rotate-1 rounded-lg border border-emerald-400/50 bg-background/95 p-2.5 shadow-xl">
                  <div className="flex min-w-0 items-start gap-2">
                    {draggingCard.state === "Done" ? (
                      <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                    ) : (
                      <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/45" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] leading-4 text-foreground/90">
                        {draggingCard.title}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground/35">
                        {draggingCard.id}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[10px]",
                        stateTone(draggingCard.state),
                      )}
                    >
                      {draggingCard.state}
                    </span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {mode === "page" && boardView === "table" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div
            data-agent-board-planning-edit="true"
            className="overflow-hidden rounded-md border border-border/60 bg-background/35"
            style={{ minWidth: planningTableMinWidth }}
          >
            <div
              className="grid border-b border-border/60 bg-muted/25 px-3 text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase"
              style={{ gridTemplateColumns: planningTableGridTemplate }}
            >
              {PLANNING_TABLE_COLUMNS.map((column) => (
                <div
                  key={column.id}
                  className={cn(
                    "relative flex h-9 items-center pr-3",
                    column.align === "right" && "justify-end text-right",
                  )}
                >
                  <span className="truncate">{column.label}</span>
                  {column.id !== "actions" ? (
                    <button
                      type="button"
                      aria-label={`Resize ${column.label} column`}
                      className="absolute top-1 right-0 h-7 w-2 cursor-col-resize rounded-sm hover:bg-border/80"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        beginPlanningColumnResize(column.id, event.clientX);
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            {loading && !board ? (
              <div className="flex items-center gap-2 px-3 py-8 text-xs text-muted-foreground/50">
                <LoaderIcon className="size-3.5 animate-spin" />
                Loading board
              </div>
            ) : null}
            {board && tableCards.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-[13px] text-muted-foreground/45">No cards yet.</p>
                <p className="mt-1 text-[11px] text-muted-foreground/35">
                  Add a card from the Kanban view or the New item button.
                </p>
              </div>
            ) : null}
            {planningAreaGroups.map((group) => {
              const collapsed = collapsedPlanningAreas.has(group.area);
              return (
                <div key={group.area} className="border-b border-border/50 last:border-b-0">
                  <div
                    className={cn(
                      "flex h-9 items-center gap-2 bg-muted/15 px-3 text-[11px] font-semibold tracking-wide text-foreground/75",
                      group.area === FUTURE_SCOPE_AREA_LABEL && "bg-violet-500/10 text-violet-200",
                      group.area === UNASSIGNED_AREA_LABEL && "bg-amber-500/10 text-amber-200",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => togglePlanningArea(group.area)}
                    >
                      {collapsed ? (
                        <ChevronRightIcon className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">{group.area}</span>
                      <span className="ml-auto rounded-md border border-border/55 bg-background/35 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {group.cards.length}
                      </span>
                    </button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-6 shrink-0 text-current opacity-70 hover:opacity-100"
                      onClick={() => {
                        setQuickAddArea(group.area);
                        setQuickAddTitle("");
                        setCollapsedPlanningAreas((existing) => {
                          const next = new Set(existing);
                          next.delete(group.area);
                          return next;
                        });
                      }}
                      aria-label={`Add card to ${group.area}`}
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                  </div>
                  {!collapsed
                    ? [
                        quickAddArea === group.area ? (
                          <div
                            key={`${group.area}-quick-add`}
                            className="grid items-center px-3 py-2"
                            style={{ gridTemplateColumns: planningTableGridTemplate }}
                          >
                            <Input
                              value={group.area === UNASSIGNED_AREA_LABEL ? "" : group.area}
                              readOnly
                              placeholder="Area"
                              className="h-8 min-w-0 rounded-r-none border-r-0 text-xs"
                            />
                            <Input
                              value=""
                              readOnly
                              placeholder="Slice"
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <Input
                              autoFocus
                              value={quickAddTitle}
                              onChange={(event) => setQuickAddTitle(event.currentTarget.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") addCardToArea(group.area);
                                if (event.key === "Escape") {
                                  setQuickAddArea(null);
                                  setQuickAddTitle("");
                                }
                              }}
                              placeholder={
                                group.area === FUTURE_SCOPE_AREA_LABEL ? "Future idea" : "New card"
                              }
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <div className="h-8 border border-r-0 border-input bg-background/30" />
                            <div className="h-8 border border-r-0 border-input bg-background/30" />
                            <div className="h-8 border border-r-0 border-input bg-background/30" />
                            <div className="flex h-8 min-w-0 items-center justify-end gap-1 overflow-hidden rounded-l-none rounded-r-md border border-input px-1">
                              <Button
                                size="xs"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => addCardToArea(group.area)}
                                disabled={!quickAddTitle.trim() || saving}
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        ) : null,
                        ...group.cards.map((card) => (
                          <div
                            key={card.id}
                            className={cn(
                              "grid items-center px-3 py-2 hover:bg-muted/15",
                              selectedCardId === card.id && "bg-emerald-500/5",
                            )}
                            style={{ gridTemplateColumns: planningTableGridTemplate }}
                            onDoubleClick={() => openCardDetails(card)}
                          >
                            <Input
                              value={readPlanningCellValue(card, "area")}
                              onChange={(event) =>
                                setPlanningCellDraft(card.id, "area", event.currentTarget.value)
                              }
                              onBlur={() => schedulePlanningCellCommit(card, "area")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              placeholder={
                                group.area === UNASSIGNED_AREA_LABEL ? "Area" : group.area
                              }
                              className="h-8 min-w-0 rounded-r-none border-r-0 text-xs"
                            />
                            <Input
                              value={readPlanningCellValue(card, "slice")}
                              onChange={(event) =>
                                setPlanningCellDraft(card.id, "slice", event.currentTarget.value)
                              }
                              onBlur={() => schedulePlanningCellCommit(card, "slice")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              placeholder="Slice"
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <Input
                              value={readPlanningCellValue(card, "card")}
                              onChange={(event) =>
                                setPlanningCellDraft(card.id, "card", event.currentTarget.value)
                              }
                              onBlur={() => schedulePlanningCellCommit(card, "card")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <Select
                              value={card.state}
                              onValueChange={(value) => moveCard(card.id, value as AgentBoardState)}
                            >
                              <SelectTrigger className="h-8 min-w-0 rounded-none border-r-0 text-xs">
                                <SelectValue>{card.state}</SelectValue>
                              </SelectTrigger>
                              <SelectPopup alignItemWithTrigger={false}>
                                {MOVABLE_STATES.map((state) => (
                                  <SelectItem key={state} value={state}>
                                    {state}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                            <Input
                              type="number"
                              min={1}
                              value={readPlanningCellValue(card, "priority")}
                              onChange={(event) =>
                                setPlanningCellDraft(card.id, "priority", event.currentTarget.value)
                              }
                              onBlur={() => schedulePlanningCellCommit(card, "priority")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <Input
                              value={readPlanningCellValue(card, "slicePlan")}
                              onChange={(event) =>
                                setPlanningCellDraft(
                                  card.id,
                                  "slicePlan",
                                  event.currentTarget.value,
                                )
                              }
                              onBlur={() => schedulePlanningCellCommit(card, "slicePlan")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              placeholder="docs/agents/slices/..."
                              className="h-8 min-w-0 rounded-none border-r-0 text-xs"
                            />
                            <div className="flex h-8 min-w-0 items-center justify-end gap-1 overflow-hidden rounded-l-none rounded-r-md border border-input px-1">
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="size-6 text-muted-foreground/45 hover:text-foreground/80"
                                onClick={() => openCardDetails(card)}
                                aria-label={`Edit ${card.title}`}
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              {card.state === "Ready" ? (
                                <Button
                                  size="xs"
                                  className="h-6 px-1.5 text-[10px]"
                                  onClick={() => runReadyCard(card)}
                                  disabled={saving}
                                >
                                  <PlayIcon className="size-3" />
                                  Run
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        )),
                      ]
                    : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {mode === "page" && boardView === "execution-path" ? (
        <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-emerald-400 uppercase">
                Execution path — Dependency tree
              </p>
              <p className="text-[12px] text-muted-foreground/60">
                Read-only family tree. Edit cards, slices, and dependencies in Kanban or Planning
                table.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
              <span className="rounded border border-emerald-500/25 px-2 py-1 text-emerald-200/80">
                solid path
              </span>
              <span className="rounded border border-violet-500/25 px-2 py-1 text-violet-200/80">
                future scope
              </span>
            </div>
          </div>

          {(board?.cards.length ?? 0) === 0 ? (
            <div className="flex min-h-[560px] items-center justify-center rounded-md border border-border/60 text-[13px] text-muted-foreground/55">
              No cards yet.
            </div>
          ) : (
            <div className="grid min-w-[1120px] grid-cols-[240px_minmax(560px,1fr)_260px] gap-4">
              <aside className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] font-semibold tracking-widest text-amber-200/70 uppercase">
                  Independent cloud
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/55">
                  Unassigned or not currently connected to the main path.
                </p>
                <div className="mt-3 space-y-3">
                  {dependencyTreeModel.independentGroups.length ? (
                    dependencyTreeModel.independentGroups.map((group) => {
                      const sliceKey = dependencySliceKey(group.area, group.slice);
                      const collapsed = collapsedDependencySlices.has(sliceKey);
                      return (
                        <div
                          key={sliceKey}
                          className="rounded border border-amber-500/15 bg-background/70"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-2 text-left"
                            onClick={() => toggleDependencySlice(group.area, group.slice)}
                          >
                            {collapsed ? (
                              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                            ) : (
                              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                              {group.area} / {group.slice}
                            </span>
                            <span className="text-[10px] text-muted-foreground/45">
                              {group.cards.length}
                            </span>
                          </button>
                          {!collapsed ? (
                            <div className="space-y-1.5 border-t border-border/50 p-2">
                              {group.cards.map((card) => (
                                <button
                                  key={card.id}
                                  type="button"
                                  className="w-full rounded border border-border/60 bg-muted/10 px-2 py-1.5 text-left text-[11px] hover:border-amber-400/35"
                                  onClick={() => openCardDetails(card)}
                                >
                                  <span className="line-clamp-2">{card.title}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="rounded border border-border/50 px-2 py-3 text-[11px] text-muted-foreground/45">
                      Nothing detached.
                    </p>
                  )}
                </div>
              </aside>

              <main className="relative rounded-md border border-border/70 bg-muted/5 p-4">
                <div className="pointer-events-none absolute inset-x-8 top-16 bottom-16">
                  <div className="mx-auto h-full w-px bg-emerald-300/15" />
                </div>
                <div className="space-y-5">
                  {dependencyTreeModel.tiers.length ? (
                    dependencyTreeModel.tiers.map((tier, tierIndex) => (
                      <section key={tier.depth} className="relative">
                        <div className="mb-2 flex items-center justify-center gap-3">
                          <div className="h-px flex-1 bg-emerald-300/15" />
                          <span className="rounded-full border border-emerald-500/25 bg-background px-3 py-1 text-[10px] font-semibold tracking-widest text-emerald-200/75 uppercase">
                            {tier.label}
                          </span>
                          <div className="h-px flex-1 bg-emerald-300/15" />
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
                          {tier.groups.map((group) => {
                            const sliceKey = dependencySliceKey(group.area, group.slice);
                            const collapsed = collapsedDependencySlices.has(sliceKey);
                            return (
                              <div
                                key={sliceKey}
                                className="rounded-md border border-emerald-500/20 bg-background/85 shadow-sm"
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left"
                                  onClick={() => toggleDependencySlice(group.area, group.slice)}
                                >
                                  {collapsed ? (
                                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                                  ) : (
                                    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[11px] text-muted-foreground/55">
                                      {group.area}
                                    </p>
                                    <p className="truncate text-[13px] font-medium text-foreground/90">
                                      {group.slice}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="text-[10px]">
                                    {group.cards.length}
                                  </Badge>
                                </button>
                                {!collapsed ? (
                                  <div className="space-y-2 p-2">
                                    {group.cards.map((card) => (
                                      <button
                                        key={card.id}
                                        type="button"
                                        className="w-full rounded border border-border/70 bg-muted/10 px-2 py-2 text-left transition-colors hover:border-emerald-400/35"
                                        onClick={() => openCardDetails(card)}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span
                                            className={cn(
                                              "rounded border px-1.5 py-0.5 text-[10px]",
                                              stateTone(card.state),
                                            )}
                                          >
                                            {card.state}
                                          </span>
                                          <span className="text-[10px] text-muted-foreground/45">
                                            P{card.priority}
                                          </span>
                                        </div>
                                        <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-4">
                                          {card.title}
                                        </p>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        {tierIndex < dependencyTreeModel.tiers.length - 1 ? (
                          <div className="mx-auto my-3 h-8 w-px bg-emerald-300/35" />
                        ) : null}
                      </section>
                    ))
                  ) : (
                    <div className="flex min-h-[420px] items-center justify-center rounded border border-border/50 text-[12px] text-muted-foreground/50">
                      Add dependencies between cards to form the main tree.
                    </div>
                  )}

                  {dependencyTreeModel.edges.length ? (
                    <section className="rounded-md border border-emerald-500/15 bg-emerald-500/5 p-3">
                      <p className="mb-2 text-[10px] font-semibold tracking-widest text-emerald-200/70 uppercase">
                        Dependency strings
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {dependencyTreeModel.edges.map((edge) => (
                          <div
                            key={`${edge.from.id}:${edge.to.id}`}
                            className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-2 text-[11px]"
                          >
                            <span className="truncate rounded border border-emerald-500/25 bg-background/80 px-2 py-1.5 text-emerald-100/80">
                              {edge.from.title}
                            </span>
                            <span className="relative h-px bg-emerald-300/60">
                              <span className="absolute top-1/2 right-0 size-2 -translate-y-1/2 rotate-45 border-t border-r border-emerald-200/90" />
                            </span>
                            <span className="truncate rounded border border-emerald-500/25 bg-background/80 px-2 py-1.5 text-emerald-100/80">
                              {edge.to.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </main>

              <aside className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3">
                <p className="text-[10px] font-semibold tracking-widest text-violet-200/75 uppercase">
                  Future scope
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/55">
                  Deferred work. Treat links as dotted-line context.
                </p>
                <div className="mt-3 space-y-3 border-l border-dashed border-violet-300/25 pl-3">
                  {dependencyTreeModel.futureGroups.length ? (
                    dependencyTreeModel.futureGroups.map((group) => {
                      const sliceKey = dependencySliceKey(group.area, group.slice);
                      const collapsed = collapsedDependencySlices.has(sliceKey);
                      return (
                        <div
                          key={sliceKey}
                          className="rounded border border-violet-500/15 bg-background/70"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-2 text-left"
                            onClick={() => toggleDependencySlice(group.area, group.slice)}
                          >
                            {collapsed ? (
                              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                            ) : (
                              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                              {group.slice}
                            </span>
                            <span className="text-[10px] text-muted-foreground/45">
                              {group.cards.length}
                            </span>
                          </button>
                          {!collapsed ? (
                            <div className="space-y-1.5 border-t border-border/50 p-2">
                              {group.cards.map((card) => (
                                <button
                                  key={card.id}
                                  type="button"
                                  className="w-full rounded border border-dashed border-violet-500/25 bg-violet-500/5 px-2 py-1.5 text-left text-[11px] hover:border-violet-300/45"
                                  onClick={() => openCardDetails(card)}
                                >
                                  <span className="line-clamp-2">{card.title}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="rounded border border-border/50 px-2 py-3 text-[11px] text-muted-foreground/45">
                      No future items.
                    </p>
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      ) : null}

      {mode === "page" && boardView === "execution-path" ? (
        <div className="relative min-h-0 flex-1 overflow-hidden border-t border-border/50">
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md border border-border/60 bg-background/90 px-2 py-1 shadow-sm">
            <span className="text-[11px] text-muted-foreground/65">
              {graphModel.areas.length} areas · {board?.cards.length ?? 0} cards ·{" "}
              {graphModel.dependencyEdges.length} deps ﾂｷ {Math.round(graphZoom * 100)}%
            </span>
            {selectedGraphNode ? (
              <span className="max-w-44 truncate rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-foreground/75">
                {selectedGraphNode!.kind}: {selectedGraphNode!.label}
              </span>
            ) : null}
            {selectedGraphNode ? (
              <Button
                size="xs"
                variant={graphConnectFromNodeId ? "default" : "secondary"}
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setGraphConnectFromNodeId((existing) =>
                    existing === selectedGraphNode!.id ? null : selectedGraphNode!.id,
                  )
                }
              >
                {graphConnectFromNodeId ? "Pick target" : "Connect"}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="secondary"
              className="h-7 px-2 text-xs"
              onClick={centerGraphCanvas}
            >
              Auto center
            </Button>
          </div>
          <div
            ref={graphCanvasRef}
            className={cn(
              "size-full touch-none overflow-hidden bg-background",
              isGraphPanning ? "cursor-grabbing select-none" : "cursor-grab",
            )}
            onWheel={handleGraphWheel}
            onPointerDown={beginGraphPan}
            onPointerMove={updateGraphPan}
            onPointerUp={endGraphPan}
            onPointerCancel={endGraphPan}
          >
            <div className="pointer-events-none absolute inset-0" style={graphGridStyle} />
            <div
              className="relative"
              style={{
                width: graphModel.width,
                height: graphModel.height,
                transform: `translate(${graphPanOffset.x}px, ${graphPanOffset.y}px) scale(${graphZoom})`,
                transformOrigin: "0 0",
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={graphModel.width}
                height={graphModel.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="agent-board-arrow"
                    markerHeight="8"
                    markerWidth="8"
                    orient="auto"
                    refX="7"
                    refY="4"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" className="fill-emerald-300/70" />
                  </marker>
                </defs>
                {graphModel.areas.flatMap((area) =>
                  area.slices.map((slice) => {
                    const areaPos = graphModel.nodePositions.get(`area:${area.area}`);
                    const slicePos = graphModel.nodePositions.get(
                      `slice:${area.area}:${slice.slice}`,
                    );
                    if (!areaPos || !slicePos) return null;
                    return (
                      <path
                        key={`area-edge:${area.area}:${slice.slice}`}
                        d={`M ${areaPos.x + GRAPH_AREA_NODE_WIDTH} ${area.y + GRAPH_NODE_HEIGHT / 2} C ${areaPos.x + 210} ${area.y + GRAPH_NODE_HEIGHT / 2}, ${slicePos.x - 50} ${slice.y + GRAPH_NODE_HEIGHT / 2}, ${slicePos.x} ${slice.y + GRAPH_NODE_HEIGHT / 2}`}
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                        className="text-muted-foreground/20"
                      />
                    );
                  }),
                )}
                {graphModel.areas.flatMap((area) =>
                  area.slices.flatMap((slice) =>
                    slice.cards.map((card) => {
                      const slicePos = graphModel.nodePositions.get(
                        `slice:${area.area}:${slice.slice}`,
                      );
                      const cardPos = graphModel.nodePositions.get(card.id);
                      if (!slicePos || !cardPos) return null;
                      return (
                        <path
                          key={`slice-edge:${slice.slice}:${card.id}`}
                          d={`M ${slicePos.x + GRAPH_SLICE_NODE_WIDTH} ${slice.y + GRAPH_NODE_HEIGHT / 2} C ${slicePos.x + 220} ${slice.y + GRAPH_NODE_HEIGHT / 2}, ${cardPos.x - 45} ${cardPos.y + GRAPH_NODE_HEIGHT / 2}, ${cardPos.x} ${cardPos.y + GRAPH_NODE_HEIGHT / 2}`}
                          stroke="currentColor"
                          strokeWidth="1"
                          fill="none"
                          className="text-muted-foreground/18"
                        />
                      );
                    }),
                  ),
                )}
                {graphModel.graphLinks.map((link) => {
                  const fromPos = graphModel.nodePositions.get(link.from);
                  const toPos = graphModel.nodePositions.get(link.to);
                  const fromMeta = graphModel.nodeMeta.get(link.from);
                  const toMeta = graphModel.nodeMeta.get(link.to);
                  if (!fromPos || !toPos || !fromMeta || !toMeta) return null;
                  const fromX = fromPos.x + fromMeta.width;
                  const fromY = fromPos.y + fromMeta.height / 2;
                  const toX = toPos.x;
                  const toY = toPos.y + toMeta.height / 2;
                  return (
                    <path
                      key={`graph-link:${link.from}:${link.to}:${link.kind}`}
                      d={`M ${fromX} ${fromY} C ${fromX + 90} ${fromY}, ${toX - 90} ${toY}, ${toX} ${toY}`}
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      markerEnd="url(#agent-board-arrow)"
                      className="text-sky-300/65"
                    />
                  );
                })}
                {graphModel.dependencyEdges.map((edge) => {
                  const fromPos = graphModel.nodePositions.get(edge.from.id);
                  const toPos = graphModel.nodePositions.get(edge.to.id);
                  if (!fromPos || !toPos) return null;
                  const fromX = fromPos.x + GRAPH_NODE_WIDTH;
                  const fromY = fromPos.y + GRAPH_NODE_HEIGHT / 2;
                  const toX = toPos.x;
                  const toY = toPos.y + GRAPH_NODE_HEIGHT / 2;
                  return (
                    <path
                      key={`dependency:${edge.from.id}:${edge.to.id}`}
                      d={`M ${fromX} ${fromY} C ${fromX + 70} ${fromY}, ${toX - 70} ${toY}, ${toX} ${toY}`}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                      markerEnd="url(#agent-board-arrow)"
                      className="text-emerald-300/55"
                    />
                  );
                })}
              </svg>

              {graphModel.areas.map((area) => {
                const areaNodeId = areaGraphNodeId(area.area);
                const areaPos = graphModel.nodePositions.get(areaNodeId);
                if (!areaPos) return null;
                return (
                  <button
                    key={`area-node:${area.area}`}
                    type="button"
                    className={cn(
                      "absolute cursor-pointer rounded-md border bg-background/90 p-3 text-left shadow-sm",
                      selectedGraphNodeId === areaNodeId && "ring-1 ring-sky-300/70",
                      graphConnectFromNodeId === areaNodeId && "border-sky-300/70",
                      area.area === FUTURE_SCOPE_AREA_LABEL
                        ? "border-violet-500/35"
                        : area.area === UNASSIGNED_AREA_LABEL
                          ? "border-amber-500/35"
                          : "border-emerald-500/35",
                    )}
                    style={{
                      left: areaPos.x,
                      top: area.y,
                      width: GRAPH_AREA_NODE_WIDTH,
                      minHeight: GRAPH_NODE_HEIGHT,
                    }}
                    onClick={() => selectGraphNode(areaNodeId)}
                  >
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/55 uppercase">
                      Area
                    </p>
                    <p className="mt-1 line-clamp-2 text-[13px] font-medium text-foreground/90">
                      {area.area}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/45">
                      {area.cards.length} cards
                    </p>
                  </button>
                );
              })}

              {graphModel.areas.flatMap((area) =>
                area.slices.map((slice) => {
                  const sliceNodeId = sliceGraphNodeId(area.area, slice.slice);
                  const slicePos = graphModel.nodePositions.get(sliceNodeId);
                  if (!slicePos) return null;
                  return (
                    <button
                      key={`slice-node:${area.area}:${slice.slice}`}
                      type="button"
                      className={cn(
                        "absolute cursor-pointer rounded-md border border-border/60 bg-background/90 p-3 text-left shadow-sm",
                        selectedGraphNodeId === sliceNodeId && "ring-1 ring-sky-300/70",
                        graphConnectFromNodeId === sliceNodeId && "border-sky-300/70",
                      )}
                      style={{
                        left: slicePos.x,
                        top: slicePos.y,
                        width: GRAPH_SLICE_NODE_WIDTH,
                        minHeight: GRAPH_NODE_HEIGHT,
                      }}
                      onClick={() => selectGraphNode(sliceNodeId)}
                    >
                      <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/55 uppercase">
                        Slice
                      </p>
                      <p className="mt-1 line-clamp-2 text-[13px] font-medium text-foreground/90">
                        {slice.slice}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground/45">
                        {slice.cards.length} cards
                      </p>
                    </button>
                  );
                }),
              )}

              {graphModel.areas.flatMap((area) =>
                area.slices.flatMap((slice) =>
                  slice.cards.map((card) => {
                    const cardPos = graphModel.nodePositions.get(card.id);
                    if (!cardPos) return null;
                    return (
                      <button
                        key={`card-node:${card.id}`}
                        type="button"
                        className={cn(
                          "absolute cursor-move rounded-md border bg-background/95 p-2 text-left shadow-sm transition-colors hover:border-border",
                          selectedCardId === card.id ? "border-emerald-500/45" : "border-border/60",
                          selectedGraphNodeId === card.id && "ring-1 ring-sky-300/70",
                          graphConnectFromNodeId === card.id && "border-sky-300/70",
                        )}
                        style={{
                          left: cardPos.x,
                          top: cardPos.y,
                          width: GRAPH_NODE_WIDTH,
                          minHeight: GRAPH_NODE_HEIGHT,
                        }}
                        onPointerDown={(event) => beginGraphNodeDrag(event, card.id)}
                        onPointerMove={updateGraphNodeDrag}
                        onPointerUp={endGraphNodeDrag}
                        onPointerCancel={endGraphNodeDrag}
                        onClick={() => {
                          if (suppressGraphNodeClickRef.current) return;
                          selectGraphNode(card.id);
                        }}
                        onDoubleClick={() => openCardDetails(card)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[10px]",
                              stateTone(card.state),
                            )}
                          >
                            {card.state}
                          </span>
                          <span className="text-[10px] text-muted-foreground/45">
                            P{card.priority}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[12px] leading-4 text-foreground/90">
                          {card.title}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground/35">
                          {card.id}
                        </p>
                      </button>
                    );
                  }),
                ),
              )}

              {graphModel.areas.length === 0 ? (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border/60 bg-background/90 px-4 py-3 text-[13px] text-muted-foreground/55">
                  No cards yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={detailCard !== null}
        onOpenChange={(open) => {
          if (!open) {
            commitDetailDraft();
            setDetailCardId(null);
            setDetailDraft(null);
          }
        }}
      >
        <DialogPopup className="max-w-3xl">
          {detailCard ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 text-base">Card details</DialogTitle>
                <DialogDescription>{detailCard.id}</DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-4" data-agent-board-planning-edit="true">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Title</span>
                    <Input
                      value={detailDraft?.title ?? detailCard.title}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setDetailDraft((draft) => ({
                          ...(draft ?? detailDraftFromCard(detailCard)),
                          title: value,
                        }));
                      }}
                      onBlur={scheduleDetailDraftCommit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="h-9 text-sm"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">State</span>
                    <Select
                      value={detailCard.state}
                      onValueChange={(value) =>
                        updateDetailCard((card) =>
                          cardWithState(card, value as AgentBoardState, new Date().toISOString()),
                        )
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue>{detailCard.state}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {MOVABLE_STATES.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Area</span>
                    <Input
                      value={detailDraft?.area ?? detailCard.area ?? ""}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setDetailDraft((draft) => ({
                          ...(draft ?? detailDraftFromCard(detailCard)),
                          area: value,
                        }));
                      }}
                      onBlur={scheduleDetailDraftCommit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder="Frontend, Backend, Admin"
                      className="h-9 text-sm"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Slice</span>
                    <Input
                      value={detailDraft?.slice ?? detailCard.slice ?? ""}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setDetailDraft((draft) => ({
                          ...(draft ?? detailDraftFromCard(detailCard)),
                          slice: value,
                        }));
                      }}
                      onBlur={scheduleDetailDraftCommit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder="Estimate workspace"
                      className="h-9 text-sm"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Slice plan
                    </span>
                    <Input
                      value={detailDraft?.slicePlanPath ?? detailCard.slicePlanPath ?? ""}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setDetailDraft((draft) => ({
                          ...(draft ?? detailDraftFromCard(detailCard)),
                          slicePlanPath: value,
                        }));
                      }}
                      onBlur={scheduleDetailDraftCommit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={DEFAULT_SLICE_PLAN_PATH}
                      className="h-9 text-sm"
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                      Priority
                    </p>
                    <p className="mt-1 text-sm text-foreground">{detailCard.priority}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                      Attempts
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {detailCard.runtime.attemptCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                      Last heartbeat
                    </p>
                    <p className="mt-1 truncate text-sm text-foreground">
                      {detailCard.runtime.lastHeartbeatAt ?? "None"}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 border-t border-border/60 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Intent</span>
                      <Input
                        value={intentDraft.intent}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setIntentDraft((draft) => ({
                            ...draft,
                            intent: value,
                          }));
                        }}
                        className="h-9 text-sm"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Desired outcome
                      </span>
                      <Input
                        value={intentDraft.desiredOutcome}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setIntentDraft((draft) => ({
                            ...draft,
                            desiredOutcome: value,
                          }));
                        }}
                        className="h-9 text-sm"
                      />
                    </label>
                  </div>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Acceptance criteria
                    </span>
                    <Textarea
                      value={intentDraft.acceptanceCriteria}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setIntentDraft((draft) => ({
                          ...draft,
                          acceptanceCriteria: value,
                        }));
                      }}
                      placeholder="One per line"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Constraints
                      </span>
                      <Textarea
                        value={intentDraft.constraints}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setIntentDraft((draft) => ({
                            ...draft,
                            constraints: value,
                          }));
                        }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Non-goals
                      </span>
                      <Textarea
                        value={intentDraft.nonGoals}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setIntentDraft((draft) => ({
                            ...draft,
                            nonGoals: value,
                          }));
                        }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Open decisions
                      </span>
                      <Textarea
                        value={intentDraft.openDecisions}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setIntentDraft((draft) => ({
                            ...draft,
                            openDecisions: value,
                          }));
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border/60 pt-4">
                  <p className="text-[11px] font-medium text-muted-foreground">References</p>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <p className="truncate rounded-md border border-border/55 bg-muted/20 px-2 py-1.5">
                      Task: {detailCard.taskRecordPath ?? "Not created"}
                    </p>
                    <p className="truncate rounded-md border border-border/55 bg-muted/20 px-2 py-1.5">
                      Slice: {detailCard.slicePlanPath ?? "Not set"}
                    </p>
                    <p className="truncate rounded-md border border-border/55 bg-muted/20 px-2 py-1.5">
                      Workspace: {detailCard.runtime.workspacePath ?? "None"}
                    </p>
                    <p className="truncate rounded-md border border-border/55 bg-muted/20 px-2 py-1.5">
                      Run: {detailCard.runtime.implementationRunId ?? "None"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border/60 pt-4">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Dependencies
                    </span>
                    <Textarea
                      value={detailDraft?.dependencies ?? dependencyDraftFromCard(detailCard)}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setDetailDraft((draft) => ({
                          ...(draft ?? detailDraftFromCard(detailCard)),
                          dependencies: value,
                        }));
                      }}
                      onBlur={scheduleDetailDraftCommit}
                      placeholder="One card ID per line"
                    />
                  </label>
                </div>
              </DialogPanel>
              {error ? <p className="px-4 text-[11px] leading-4 text-rose-300">{error}</p> : null}
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const intentBrief = intentBriefFromDraft(intentDraft);
                    if (!intentBrief) {
                      reportPlanningError("Intent is required before saving a brief.");
                      return;
                    }
                    updateDetailCard((card) => ({ ...card, intentBrief }) as AgentBoardCard);
                  }}
                  disabled={saving}
                >
                  <SaveIcon className="size-3.5" />
                  Save brief
                </Button>
                <Button onClick={createTaskRecord} disabled={saving}>
                  Ready
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogPopup>
      </Dialog>
    </div>
  );
});

export default AgentBoardPanel;
export type { AgentBoardPanelProps };
