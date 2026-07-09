import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { isTauri, tauriInvoke } from "../utils/tauri";
import { safeConfirm } from "../utils/tauriDialog";
import { getAgentCommands } from "../utils/agentProvider";
import type {
  AppConfig,
  HistoryMessage,
  ProviderConfig,
  RuntimeStatus,
  ThreadInfo,
  ThreadSummary,
  OpencodeProviderCatalog,
} from "../types/agent";
import { mapRuntimeEvent } from "../types/agent";
import {
  currentTurnHasRunningTools,
  historyHasDisplayableEntries,
  finalizeTurnEntries,
  isTurnHistoryStable,
  hasUnsyncedLocalTurnTail,
  projectEntriesToChatMessages,
  sessionTitleFromEntries,
  turnHasDisplayableEntries,
} from "../utils/chatProjection";
import {
  appendReasoningDelta,
  appendTextDelta,
  lastUserEntry,
  setReasoningSnapshot,
  setTextSnapshot,
  syncEntriesFromServer,
  upsertToolEntry,
} from "../utils/opencodeSessionStore";
import { markCurrentTurnCancelled } from "../utils/chatHistory";
import {
  acceptsAgentStreamUpdates,
  createActiveTurn,
  streamingFromTurn,
  withTurnPhase,
  isGenerating,
  type ActiveTurn,
} from "../utils/turnState";
import { translate } from "../i18n/locales";
import { t } from "../i18n";
import { useSettingsStore } from "./settings";
import { useWorkspaceStore } from "./workspace";
import { workspacesMatch } from "../utils/path";
import { applyAppTheme } from "../utils/appTheme";
import { isMeaningfulToolArgs } from "../utils/toolMessage";
import {
  clearSavedThreadId,
  readSavedThreadId,
  writeSavedThreadId,
} from "../utils/threadStorage";
import {
  deleteLocalChatSession,
  loadLocalChatSession,
  mergeThreadLists,
  persistLocalChatSession,
  listLocalChatSessions,
  isGenericSessionTitle,
  writeLocalActiveSessionId,
} from "../utils/localChatHistory";
import {
  modelsForOpencodeVendor,
  normalizeOpencodeDefaultAgent,
  pickOpencodeDefaults,
  resolveOpencodeVendor,
} from "../utils/opencodeModels";
import { createOpencodeMessageId } from "../utils/opencodeIds";
import type { ProjectConfig, ProjectConfigInfo } from "../types/projectConfig";
import {
  buildProjectConfigPayload,
  resolveProjectPreferredModel,
} from "../utils/projectConfig";
import type { OpencodeConfigView, OpencodePermissionsView } from "../types/providerConfig";
import {
  createProviderChatSlice,
  ensureProviderSlice,
  type ProviderChatSlice,
} from "./providerChatSlice";

let runtimeHealthTimer: ReturnType<typeof setInterval> | null = null;

async function pollProviderRuntimeStatus(
  providerId: string,
): Promise<RuntimeStatus> {
  try {
    const commands = getAgentCommands(providerId);
    return await tauriInvoke<RuntimeStatus>(commands.runtimeStatus);
  } catch {
    return { running: false, owned: false };
  }
}

async function softDisconnectProvider(
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  stopStreamingHistorySync(providerId);
  cancelScheduledCompleteTurn(providerId);
  const status = await pollProviderRuntimeStatus(providerId);
  patchActiveTurn(set, providerId, null, {
    connectedIntent: false,
    pendingApproval: null,
    error: null,
    runtime: status,
  });
}

interface ChatState {
  config: AppConfig | null;
  providerId: string;
  providerStates: Record<string, ProviderChatSlice>;
  initialized: boolean;

  loadConfig: () => Promise<void>;
  setProvider: (providerId: string) => void;
  setProjectProvider: (providerId: string) => Promise<void>;
  setProjectDefaultModel: (defaultModel: string) => Promise<void>;
  setProjectOpencodePermissions: (
    permissions: Partial<OpencodePermissionsView>,
  ) => Promise<void>;
  onProjectOpened: (workspace: string, projectConfig: ProjectConfig) => Promise<void>;
  connectRuntime: (workspace?: string) => Promise<void>;
  disconnectRuntime: () => Promise<void>;
  restartRuntime: (workspace?: string) => Promise<void>;
  reloadProviderConfig: (providerId: string) => Promise<void>;
  refreshProviderRuntime: (providerId?: string) => Promise<void>;
  autoConnectAfterRuntimeService: (providerId: string) => Promise<void>;
  startRuntimeHealthMonitor: () => () => void;
  loadThreads: (workspace: string, providerId?: string) => Promise<void>;
  selectThread: (threadId: string, workspace: string) => Promise<void>;
  createNewThread: (workspace: string) => Promise<void>;
  deleteThread: (threadId: string, workspace: string) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  setModel: (model: string) => void;
  setOpencodeVendor: (vendorId: string) => void;
  sendMessage: (text: string) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  approve: (allow: boolean) => Promise<void>;
  refreshPendingApproval: () => Promise<void>;
  setupEventListener: () => Promise<() => void>;
  getActiveProvider: () => ProviderConfig | null;
  getActiveSlice: () => ProviderChatSlice;
}

function isUserCancellation(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "aborted" ||
    normalized === "abort" ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled") ||
    normalized.includes("已取消") ||
    normalized.includes("用户取消")
  );
}

function parseAgentEnvelope(raw: Record<string, unknown>) {
  const providerId =
    typeof raw.providerId === "string" ? raw.providerId : "";
  const eventPayload =
    raw.event && typeof raw.event === "object"
      ? (raw.event as Record<string, unknown>)
      : raw;
  return {
    providerId,
    mapped: mapRuntimeEvent(eventPayload),
  };
}

function parseAgentError(payload: unknown) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return {
      providerId:
        typeof record.providerId === "string" ? record.providerId : "",
      message:
        typeof record.message === "string"
          ? record.message
          : String(payload),
    };
  }
  return { providerId: "", message: String(payload) };
}

function isRemoteSessionNotFound(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("notfounderror") ||
    message.includes("not found") ||
    message.includes("session not found") ||
    message.includes("404")
  );
}

async function clearDeletedThreadLocally(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  threadId: string,
  workspace: string,
) {
  if (readSavedThreadId(providerId, workspace) === threadId) {
    await clearRememberedSession(providerId, workspace);
  }
  await deleteLocalChatSession(workspace, providerId, threadId);

  const slice = getProviderSlice(get, providerId);
  const wasCurrent = slice.thread?.id === threadId;
  await get().loadThreads(workspace, providerId);

  if (!wasCurrent) return;

  patchProvider(set, providerId, {
    thread: null,
    messages: [],
    streaming: false,
    pendingApproval: null,
    error: null,
  });
}

async function rememberActiveSession(
  providerId: string,
  workspace: string,
  threadId: string,
) {
  writeSavedThreadId(providerId, workspace, threadId);
  await writeLocalActiveSessionId(workspace, providerId, threadId);
}

async function clearRememberedSession(providerId: string, workspace: string) {
  clearSavedThreadId(providerId, workspace);
  await writeLocalActiveSessionId(workspace, providerId, null);
}

function rememberAssistantMessageId(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  messageId?: string,
) {
  if (!messageId) return;
  const slice = getProviderSlice(get, providerId);
  if (
    !slice.activeTurn ||
    slice.activeTurn.assistantMessageId === messageId
  ) {
    return;
  }
  patchActiveTurn(set, providerId, {
    ...slice.activeTurn,
    assistantMessageId: messageId,
  });
}

function parentMessageIdForEvent(
  slice: ProviderChatSlice,
  messageId?: string,
) {
  return messageId ?? slice.activeTurn?.assistantMessageId ?? null;
}

function patchProvider(
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  patch: Partial<ProviderChatSlice>,
) {
  set((state) => ({
    providerStates: {
      ...state.providerStates,
      [providerId]: {
        ...(state.providerStates[providerId] ??
          createProviderChatSlice(providerId)),
        ...patch,
      },
    },
  }));
}

function patchActiveTurn(
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  activeTurn: ActiveTurn | null,
  extra?: Partial<ProviderChatSlice>,
) {
  patchProvider(set, providerId, {
    activeTurn,
    streaming: streamingFromTurn(activeTurn),
    ...extra,
  });
}

function lastLocalUserMessage(
  messages: HistoryMessage[],
): HistoryMessage | undefined {
  return lastUserEntry(messages);
}

function buildResumedActiveTurn(
  providerId: string,
  messages: HistoryMessage[],
  options: {
    pending: { id: string; description: string } | null;
    activeTurnId?: string | null;
  },
): ActiveTurn | null {
  const localUser = lastLocalUserMessage(messages);
  if (providerId === "opencode" && localUser) {
    return createActiveTurn(
      localUser.id,
      "message_id",
      localUser.id,
      options.pending ? "awaiting_approval" : "streaming",
    );
  }
  return null;
}

function shouldIgnoreStreamingReactivation(providerId: string): boolean {
  return (
    finishingTurnProviders.has(providerId) || turnIdleSignals.has(providerId)
  );
}

function keepTurnStreaming(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  if (shouldIgnoreStreamingReactivation(providerId)) return;
  const slice = getProviderSlice(get, providerId);
  if (slice.activeTurn) {
    patchActiveTurn(
      set,
      providerId,
      withTurnPhase(slice.activeTurn, "streaming"),
    );
    return;
  }
  patchProvider(set, providerId, { streaming: true });
}

function markTurnIdleSignal(providerId: string) {
  turnIdleSignals.set(providerId, Date.now());
}

function clearTurnIdleSignal(providerId: string) {
  turnIdleSignals.delete(providerId);
}

async function deferTurnCompleteWhileToolsRunning(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  options?: { refresh?: boolean },
): Promise<boolean> {
  const slice = getProviderSlice(get, providerId);
  if (!currentTurnHasRunningTools(slice.messages)) {
    return false;
  }
  if (options?.refresh) {
    await syncMessagesFromServerOnce(get, set, providerId, true, false);
    const refreshed = getProviderSlice(get, providerId);
    if (!currentTurnHasRunningTools(refreshed.messages)) {
      return false;
    }
  }
  ensureStreamingHistorySync(get, set, providerId);
  return true;
}

async function prepareOpencodeTurnForComplete(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
): Promise<boolean> {
  const state = await fetchTurnCompleteState(get, providerId);
  if (state.pending || state.busy || !state.turn_complete) {
    return false;
  }

  if (
    await deferTurnCompleteWhileToolsRunning(get, set, providerId, {
      refresh: true,
    })
  ) {
    return false;
  }

  let previous = getProviderSlice(get, providerId).messages;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const localBefore = getProviderSlice(get, providerId).messages;
    await syncMessagesFromServerOnce(get, set, providerId, true, true);
    const latestState = await fetchTurnCompleteState(get, providerId);
    if (latestState.pending || latestState.busy || !latestState.turn_complete) {
      return false;
    }
    const current = getProviderSlice(get, providerId).messages;
    if (currentTurnHasRunningTools(current)) {
      return false;
    }
    if (hasUnsyncedLocalTurnTail(localBefore, current)) {
      return false;
    }
    if (attempt > 0 && isTurnHistoryStable(previous, current)) {
      return true;
    }
    previous = current;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }

  return !currentTurnHasRunningTools(getProviderSlice(get, providerId).messages);
}

function clearOpencodeSseActivity(providerId: string) {
  lastOpencodeStreamSseAt.delete(providerId);
  lastOpencodeAnswerTextSseAt.delete(providerId);
}

type TurnEndReason = "idle" | "completed" | "poll";

async function tryFinalizeTurnIfReady(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  const slice = getProviderSlice(get, providerId);
  if (!isGenerating(slice) || !slice.thread) return;

  if (!turnHasDisplayableEntries(slice.messages)) {
    ensureStreamingHistorySync(get, set, providerId);
    return;
  }

  const state = await fetchTurnCompleteState(get, providerId);
  if (state.pending) {
    resetTurnCompleteStreak(providerId);
    ensureStreamingHistorySync(get, set, providerId);
    return;
  }

  if (state.busy || !state.turn_complete) {
    resetTurnCompleteStreak(providerId);
    ensureStreamingHistorySync(get, set, providerId);
    return;
  }

  resetTurnCompleteStreak(providerId);
  await completeTurnForProvider(get, set, providerId, { force: true });
  clearTurnIdleSignal(providerId);
}

async function endTurnFromRuntimeEvent(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  options?: { forceFullHistory?: boolean; reason?: TurnEndReason },
) {
  const slice = getProviderSlice(get, providerId);
  if (!isGenerating(slice) || !slice.thread) return;

  const reason = options?.reason ?? "idle";
  if (reason === "idle") {
    markTurnIdleSignal(providerId);
  }

  const forceFullHistory = options?.forceFullHistory ?? true;
  await syncMessagesFromServerOnce(
    get,
    set,
    providerId,
    true,
    forceFullHistory,
  );

  let current = getProviderSlice(get, providerId);
  if (!turnHasDisplayableEntries(current.messages)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await syncMessagesFromServerOnce(
      get,
      set,
      providerId,
      true,
      forceFullHistory,
    );
    current = getProviderSlice(get, providerId);
  }

  if (!turnHasDisplayableEntries(current.messages)) {
    if (reason === "completed") {
      await tryFinishOpencodeTurn(get, set, providerId, { force: true });
    } else {
      ensureStreamingHistorySync(get, set, providerId);
    }
    if (reason === "idle") {
      clearTurnIdleSignal(providerId);
    }
    return;
  }

  cancelScheduledCompleteTurn(providerId);

  if (reason === "completed") {
    await completeTurnForProvider(get, set, providerId, { force: true });
    clearTurnIdleSignal(providerId);
    return;
  }

  const state = await fetchTurnCompleteState(get, providerId);
  if (state.pending) {
    ensureStreamingHistorySync(get, set, providerId);
    return;
  }
  if (state.turn_complete && !state.busy) {
    await completeTurnForProvider(get, set, providerId, { force: true });
    clearTurnIdleSignal(providerId);
    return;
  }

  ensureStreamingHistorySync(get, set, providerId);
}

function getProviderSlice(
  get: () => ChatState,
  providerId?: string,
): ProviderChatSlice {
  const id = providerId ?? get().providerId;
  return get().providerStates[id] ?? createProviderChatSlice(id);
}

const RUNTIME_ACTION_TIMEOUT_MS = 90_000;

type RuntimeActionKind = NonNullable<ProviderChatSlice["runtimeAction"]>;

async function runRuntimeAction(
  providerId: string,
  action: RuntimeActionKind,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
  work: () => Promise<void>,
) {
  if (getProviderSlice(get, providerId).runtimeBusy) return;

  patchProvider(set, providerId, {
    runtimeBusy: true,
    runtimeAction: action,
    error: null,
  });

  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    patchProvider(set, providerId, {
      runtimeBusy: false,
      runtimeAction: null,
      error: t("error.runtimeActionTimeout"),
    });
  }, RUNTIME_ACTION_TIMEOUT_MS);

  try {
    await work();
  } catch (e) {
    if (!timedOut) {
      patchProvider(set, providerId, { error: String(e) });
    }
    throw e;
  } finally {
    window.clearTimeout(timeoutId);
    if (!timedOut) {
      patchProvider(set, providerId, {
        runtimeBusy: false,
        runtimeAction: null,
      });
    }
  }
}

async function saveProviderChatLocally(
  get: () => ChatState,
  providerId: string,
  workspace?: string,
) {
  const slice = getProviderSlice(get, providerId);
  const resolvedWorkspace =
    workspace ?? slice.thread?.workspace ?? slice.chatWorkspace;
  if (!slice.thread || !resolvedWorkspace) return;

  await persistLocalChatSession({
    workspace: resolvedWorkspace,
    providerId,
    sessionId: slice.thread.id,
    title: sessionTitleFromEntries(slice.messages, slice.thread.id),
    mode: slice.mode,
    model: slice.model,
    messages: slice.messages,
  });
}

const STREAMING_POLL_MS: Record<string, number> = {
  opencode: 200,
};
const OPENCODE_SSE_POLL_MS = 120;
const DEFAULT_STREAMING_POLL_MS = 1000;
const OPENCODE_SSE_FALLBACK_MS = 1800;
const TURN_COMPLETE_EMPTY_MAX_STREAK = 4;
const OPENCODE_FORCE_FULL_POLL_MS = 8_000;
const OPENCODE_STREAMING_MESSAGE_LIMIT_MIN = 48;
const OPENCODE_STREAMING_MESSAGE_LIMIT_MAX = 160;

function streamingPollIntervalMs(providerId: string) {
  return STREAMING_POLL_MS[providerId] ?? DEFAULT_STREAMING_POLL_MS;
}

function opencodeStreamingPollDelayMs(providerId: string) {
  const sseFresh =
    Date.now() - (lastOpencodeStreamSseAt.get(providerId) ?? 0) <
    OPENCODE_SSE_FALLBACK_MS;
  return sseFresh ? OPENCODE_SSE_POLL_MS : streamingPollIntervalMs(providerId);
}

function nextStreamingPollDelayMs(providerId: string) {
  return providerId === "opencode"
    ? opencodeStreamingPollDelayMs(providerId)
    : streamingPollIntervalMs(providerId);
}

function opencodeStreamingMessageLimit(
  messages: HistoryMessage[],
  busy?: boolean,
) {
  const estimatedEntries = Math.max(
    20,
    Math.ceil(messages.length / 2) + (busy ? 24 : 12),
  );
  const max = busy
    ? OPENCODE_STREAMING_MESSAGE_LIMIT_MAX
    : Math.min(120, OPENCODE_STREAMING_MESSAGE_LIMIT_MAX);
  return Math.min(
    max,
    Math.max(OPENCODE_STREAMING_MESSAGE_LIMIT_MIN, estimatedEntries),
  );
}

const historySyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const historySyncActive = new Set<string>();
const historySyncInFlight = new Set<string>();
const finishingTurnProviders = new Set<string>();
const lastOpencodeStreamSseAt = new Map<string, number>();
const lastOpencodeAnswerTextSseAt = new Map<string, number>();
const turnCompleteStreak = new Map<string, number>();
const turnCompleteEmptyStreak = new Map<string, number>();
const streamingStartedAt = new Map<string, number>();
const turnIdleSignals = new Map<string, number>();

function resetTurnCompleteStreak(providerId: string) {
  turnCompleteStreak.delete(providerId);
  turnCompleteEmptyStreak.delete(providerId);
}

function markStreamingStarted(providerId: string) {
  streamingStartedAt.set(providerId, Date.now());
}

function shouldForceOpencodeFullPoll(
  providerId: string,
  messages: HistoryMessage[],
): boolean {
  if (turnHasDisplayableEntries(messages)) return false;
  const startedAt = streamingStartedAt.get(providerId);
  if (!startedAt) return true;
  return Date.now() - startedAt >= OPENCODE_FORCE_FULL_POLL_MS;
}

function cancelScheduledCompleteTurn(providerId: string) {
  resetTurnCompleteStreak(providerId);
}

async function fetchTurnCompleteState(
  get: () => ChatState,
  providerId: string,
): Promise<{
  busy: boolean;
  turn_complete: boolean;
  pending: boolean;
}> {
  const slice = getProviderSlice(get, providerId);
  if (!slice.thread) {
    return { busy: true, turn_complete: false, pending: false };
  }

  if (providerId === "opencode") {
    const poll = await tauriInvoke<{
      busy: boolean;
      turn_complete: boolean;
      pending: { id: string; description: string } | null;
    }>("opencode_poll_turn", {
      ...opencodeSessionArgs(get, providerId, slice.thread.id),
      limit: opencodeStreamingMessageLimit(slice.messages, true),
    });
    return {
      busy: poll.busy,
      turn_complete: poll.turn_complete,
      pending: Boolean(poll.pending?.id),
    };
  }

  return { busy: false, turn_complete: true, pending: false };
}

async function verifyAndCompleteTurn(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  const slice = getProviderSlice(get, providerId);
  if (!isGenerating(slice) || !slice.thread) return;

  try {
    const state = await fetchTurnCompleteState(get, providerId);
    if (state.pending) {
      resetTurnCompleteStreak(providerId);
      keepTurnStreaming(get, set, providerId);
      ensureStreamingHistorySync(get, set, providerId);
      return;
    }

    if (state.busy || !state.turn_complete) {
      resetTurnCompleteStreak(providerId);
      keepTurnStreaming(get, set, providerId);
      ensureStreamingHistorySync(get, set, providerId);
      return;
    }

    const slice = getProviderSlice(get, providerId);
    if (!turnHasDisplayableEntries(slice.messages)) {
      await syncMessagesFromServerOnce(
        get,
        set,
        providerId,
        true,
        providerId === "opencode",
      );
      const refreshed = getProviderSlice(get, providerId);
      if (!turnHasDisplayableEntries(refreshed.messages)) {
        const emptyStreak = (turnCompleteEmptyStreak.get(providerId) ?? 0) + 1;
        turnCompleteEmptyStreak.set(providerId, emptyStreak);
        if (emptyStreak < TURN_COMPLETE_EMPTY_MAX_STREAK) {
          resetTurnCompleteStreak(providerId);
          keepTurnStreaming(get, set, providerId);
          ensureStreamingHistorySync(get, set, providerId);
          return;
        }
        turnCompleteEmptyStreak.delete(providerId);
      } else {
        turnCompleteEmptyStreak.delete(providerId);
      }
    } else {
      turnCompleteEmptyStreak.delete(providerId);
    }

    resetTurnCompleteStreak(providerId);
    await tryFinishOpencodeTurn(get, set, providerId, { force: true });
  } catch {
    keepTurnStreaming(get, set, providerId);
    ensureStreamingHistorySync(get, set, providerId);
  }
}

function lastAssistantMessage(messages: HistoryMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }
  return undefined;
}

function markOpencodeStreamSseActivity(providerId: string) {
  if (providerId === "opencode") {
    lastOpencodeStreamSseAt.set(providerId, Date.now());
  }
}

function markOpencodeAnswerTextSseActivity(providerId: string) {
  if (providerId !== "opencode") return;
  const now = Date.now();
  lastOpencodeStreamSseAt.set(providerId, now);
  lastOpencodeAnswerTextSseAt.set(providerId, now);
}

function isPollOnlyMessageProvider(providerId: string) {
  return providerId === "opencode";
}

async function ensureEventSubscription(providerId: string, _threadId: string) {
  if (!isTauri()) return;
  try {
    await tauriInvoke(getAgentCommands(providerId).subscribeEvents, {
      threadId: _threadId,
    });
  } catch {
    // local-only session
  }
}

async function loadThreadHistoryMessages(
  get: () => ChatState,
  providerId: string,
  workspace: string,
  threadId: string,
): Promise<HistoryMessage[] | null> {
  const commands = getAgentCommands(providerId);
  try {
    return await tauriInvoke<HistoryMessage[]>(
      commands.loadThreadHistory,
      providerId === "opencode"
        ? opencodeSessionArgs(get, providerId, threadId, workspace)
        : { threadId },
    );
  } catch {
    const local = await loadLocalChatSession(workspace, providerId, threadId);
    if (!local) return null;
    return local.messages;
  }
}

async function detectInFlightTurn(
  get: () => ChatState,
  providerId: string,
  workspace: string,
  threadId: string,
): Promise<{
  busy: boolean;
  pending: { id: string; description: string } | null;
  activeTurnId?: string | null;
}> {
  const commands = getAgentCommands(providerId);

  if (providerId === "opencode") {
    try {
      const [busy, pending] = await Promise.all([
        commands.isSessionBusy
          ? tauriInvoke<boolean>(
              commands.isSessionBusy,
              opencodeSessionArgs(get, providerId, threadId, workspace),
            )
          : Promise.resolve(false),
        commands.getPendingApproval
          ? tauriInvoke<{ id: string; description: string } | null>(
              commands.getPendingApproval,
              opencodeSessionArgs(get, providerId, threadId, workspace),
            )
          : Promise.resolve(null),
      ]);
      return { busy, pending };
    } catch {
      return { busy: false, pending: null };
    }
  }

  return { busy: false, pending: null, activeTurnId: null };
}

async function resumeInFlightTurn(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  workspace: string,
  threadId: string,
  options?: { messages?: HistoryMessage[] },
) {
  const slice = getProviderSlice(get, providerId);
  const messages =
    options?.messages ??
    (await loadThreadHistoryMessages(get, providerId, workspace, threadId));

  if (messages) {
    patchProvider(set, providerId, {
      thread: {
        id: threadId,
        workspace,
        mode: slice.mode,
        model: slice.model || undefined,
      },
      chatWorkspace: workspace,
      messages,
    });
  }

  await ensureEventSubscription(providerId, threadId);

  const { busy, pending, activeTurnId } = await detectInFlightTurn(
    get,
    providerId,
    workspace,
    threadId,
  );

  const currentMessages = getProviderSlice(get, providerId).messages;
  const resumedTurn = buildResumedActiveTurn(providerId, currentMessages, {
    pending,
    activeTurnId,
  });

  if (pending?.id) {
    markStreamingStarted(providerId);
    patchActiveTurn(set, providerId, resumedTurn, {
      pendingApproval: pending,
      error: null,
    });
    startStreamingHistorySync(get, set, providerId);
    return;
  }

  if (busy) {
    markStreamingStarted(providerId);
    patchActiveTurn(set, providerId, resumedTurn, {
      pendingApproval: null,
      error: null,
    });
    startStreamingHistorySync(get, set, providerId);
    return;
  }

  patchActiveTurn(set, providerId, null, {
    pendingApproval: null,
  });
}

async function restoreActiveSessionAfterConnect(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  workspace: string,
) {
  const slice = getProviderSlice(get, providerId);
  const savedThreadId = readSavedThreadId(providerId, workspace);
  const memoryThreadId =
    slice.thread &&
    workspacesMatch(
      slice.thread.workspace ?? slice.chatWorkspace ?? workspace,
      workspace,
    )
      ? slice.thread.id
      : null;
  const threadId = memoryThreadId ?? savedThreadId;
  if (!threadId) return;

  await resumeInFlightTurn(get, set, providerId, workspace, threadId);
  await rememberActiveSession(providerId, workspace, threadId);
}

async function syncMessagesFromServer(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  force = false,
  forceFullHistory = false,
) {
  if (historySyncInFlight.has(providerId)) return;
  historySyncInFlight.add(providerId);
  try {
    await syncMessagesFromServerOnce(
      get,
      set,
      providerId,
      force,
      forceFullHistory,
    );
  } finally {
    historySyncInFlight.delete(providerId);
  }
}

async function syncMessagesFromServerOnce(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  force = false,
  forceFullHistory = false,
) {
  const slice = getProviderSlice(get, providerId);
  if (!slice.thread) return;
  if (!isGenerating(slice) && !force) return;

  const commands = getAgentCommands(providerId);
  const threadId = slice.thread.id;
  const useOpencodeStreaming =
    providerId === "opencode" && isGenerating(slice);
  const assistantEmpty = !lastAssistantMessage(slice.messages)?.content?.trim();
  const opencodeSseRecent =
    useOpencodeStreaming &&
    isGenerating(slice) &&
    Date.now() - (lastOpencodeStreamSseAt.get(providerId) ?? 0) <
      OPENCODE_SSE_FALLBACK_MS;
  const forceOpencodeFullPoll =
    useOpencodeStreaming &&
    !forceFullHistory &&
    shouldForceOpencodeFullPoll(providerId, slice.messages);
  const sseFresh =
    !forceFullHistory &&
    !forceOpencodeFullPoll &&
    useOpencodeStreaming &&
    opencodeSseRecent &&
    turnHasDisplayableEntries(slice.messages);
  const syncStartedAt = import.meta.env.DEV ? performance.now() : 0;
  try {
    let history: HistoryMessage[] | undefined;
    let polledPending: { id: string; description: string } | null | undefined;
    let polledTurnComplete = false;

    if (useOpencodeStreaming && sseFresh && !forceFullHistory) {
      const status = await tauriInvoke<{
        busy: boolean;
        pending: { id: string; description: string } | null;
      }>("opencode_poll_status", opencodeSessionArgs(get, providerId, threadId));
      polledPending = status.pending;
      if (!status.busy && !status.pending?.id) {
        const poll = await tauriInvoke<{
          messages: HistoryMessage[];
          busy: boolean;
          pending: { id: string; description: string } | null;
          turn_complete: boolean;
        }>("opencode_poll_turn", {
          ...opencodeSessionArgs(get, providerId, threadId),
          limit: opencodeStreamingMessageLimit(slice.messages, false),
        });
        history = poll.messages;
        polledPending = poll.pending;
        polledTurnComplete = poll.turn_complete;
      }
    } else if (useOpencodeStreaming && forceFullHistory) {
      history = await tauriInvoke<HistoryMessage[]>(
        commands.loadThreadHistory,
        opencodeSessionArgs(get, providerId, threadId),
      );
      polledPending = null;
    } else if (useOpencodeStreaming) {
      const poll = await tauriInvoke<{
        messages: HistoryMessage[];
        busy: boolean;
        pending: { id: string; description: string } | null;
        turn_complete: boolean;
      }>("opencode_poll_turn", {
        ...opencodeSessionArgs(get, providerId, threadId),
        limit: opencodeStreamingMessageLimit(slice.messages, true),
      });
      history = poll.messages;
      polledPending = poll.pending;
      polledTurnComplete = poll.turn_complete;
    } else {
      history = await tauriInvoke<HistoryMessage[]>(
        commands.loadThreadHistory,
        opencodeSessionArgs(get, providerId, threadId),
      );
    }

    const latest = getProviderSlice(get, providerId);
    if (!latest.thread || latest.thread.id !== threadId) return;

    if (history) {
      const useAnchor =
        isGenerating(latest) &&
        isPollOnlyMessageProvider(providerId) &&
        !forceFullHistory;
      let merged = syncEntriesFromServer(latest.messages, history, {
        anchorUserId: useAnchor ? latest.activeTurn?.anchorId ?? null : null,
        baselineEntryIds: useAnchor
          ? latest.activeTurn?.baselineEntryIds
          : null,
        full: !useAnchor || forceFullHistory,
      });
      if (
        assistantEmpty &&
        historyHasDisplayableEntries(history) &&
        !turnHasDisplayableEntries(merged)
      ) {
        merged = syncEntriesFromServer(latest.messages, history, { full: true });
      }
      const changed =
        merged.length !== latest.messages.length ||
        merged.some((msg, index) => {
          const prev = latest.messages[index];
          return (
            !prev ||
            prev.id !== msg.id ||
            prev.content !== msg.content ||
            prev.role !== msg.role ||
            prev.tool_name !== msg.tool_name ||
            prev.turn_id !== msg.turn_id
          );
        });
      if (changed) {
        patchProvider(set, providerId, {
          messages: merged,
        });
      } else if (
        import.meta.env.DEV &&
        providerId === "opencode" &&
        history.length > 0 &&
        assistantEmpty
      ) {
        console.warn("[chat sync] opencode poll returned data but sync unchanged", {
          localCount: latest.messages.length,
          remoteCount: history.length,
          remotePreview: history
            .filter((item) => item.role === "assistant")
            .slice(-1)[0]?.content?.slice(0, 80),
        });
      }
    }

    if (providerId === "opencode") {
      if (polledPending?.id) {
        cancelScheduledCompleteTurn(providerId);
        const pendingSlice = getProviderSlice(get, providerId);
        const pendingTurn = pendingSlice.activeTurn
          ? withTurnPhase(pendingSlice.activeTurn, "awaiting_approval")
          : pendingSlice.activeTurn;
        patchActiveTurn(set, providerId, pendingTurn, {
          pendingApproval: polledPending,
        });
        ensureStreamingHistorySync(get, set, providerId);
        return;
      }
      const afterPendingCheck = getProviderSlice(get, providerId);
      if (afterPendingCheck.pendingApproval) {
        patchProvider(set, providerId, { pendingApproval: null });
      }

      if (
        polledTurnComplete &&
        !getProviderSlice(get, providerId).pendingApproval
      ) {
        await tryFinalizeTurnIfReady(get, set, providerId);
        return;
      }

      const postSyncSlice = getProviderSlice(get, providerId);
      if (
        turnIdleSignals.has(providerId) &&
        !postSyncSlice.pendingApproval
      ) {
        await tryFinalizeTurnIfReady(get, set, providerId);
        return;
      }

      const latestSlice = getProviderSlice(get, providerId);
      const stalledForMs =
        (streamingStartedAt.get(providerId) ?? 0) > 0
          ? Date.now() - (streamingStartedAt.get(providerId) ?? Date.now())
          : 0;
      if (
        providerId === "opencode" &&
        latestSlice.streaming &&
        stalledForMs >= 30_000 &&
        history &&
        historyHasDisplayableEntries(history)
      ) {
        await verifyAndCompleteTurn(get, set, providerId);
        return;
      }
    } else if (commands.getPendingApproval) {
      if (await runPendingApprovalCheck(get, set, providerId)) {
        cancelScheduledCompleteTurn(providerId);
        ensureStreamingHistorySync(get, set, providerId);
        return;
      }
    }

    if (import.meta.env.DEV && providerId === "opencode" && syncStartedAt > 0) {
      console.debug(
        `[chat sync] opencode ${Math.round(performance.now() - syncStartedAt)}ms ${sseFresh ? "status" : "full"}`,
      );
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[chat sync] ${providerId} failed:`, error);
    }
  }
}

function startStreamingHistorySync(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  stopStreamingHistorySync(providerId);
  historySyncActive.add(providerId);

  const scheduleNext = () => {
    const timer = setTimeout(() => {
      void syncMessagesFromServer(get, set, providerId, true).finally(() => {
        if (!historySyncActive.has(providerId)) return;
        const slice = getProviderSlice(get, providerId);
        if (!slice.thread || !isGenerating(slice)) {
          stopStreamingHistorySync(providerId);
          return;
        }
        scheduleNext();
      });
    }, nextStreamingPollDelayMs(providerId));
    historySyncTimers.set(providerId, timer);
  };

  void syncMessagesFromServer(get, set, providerId, true).finally(() => {
    if (!historySyncActive.has(providerId)) return;
    const slice = getProviderSlice(get, providerId);
    if (!slice.thread || !isGenerating(slice)) {
      stopStreamingHistorySync(providerId);
      return;
    }
    scheduleNext();
  });
}

function ensureStreamingHistorySync(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
) {
  const slice = getProviderSlice(get, providerId);
  if (!slice.thread || !isGenerating(slice)) return;
  if (historySyncActive.has(providerId)) return;
  startStreamingHistorySync(get, set, providerId);
}

function stopStreamingHistorySync(providerId: string) {
  historySyncActive.delete(providerId);
  const timer = historySyncTimers.get(providerId);
  if (timer !== undefined) {
    clearTimeout(timer);
    historySyncTimers.delete(providerId);
  }
  historySyncInFlight.delete(providerId);
  clearOpencodeSseActivity(providerId);
  streamingStartedAt.delete(providerId);
  resetTurnCompleteStreak(providerId);
}

async function tryFinishOpencodeTurn(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  options?: { force?: boolean },
) {
  cancelScheduledCompleteTurn(providerId);
  if (
    !options?.force &&
    (await runPendingApprovalCheck(get, set, providerId))
  ) {
    ensureStreamingHistorySync(get, set, providerId);
    return;
  }
  await completeTurnForProvider(get, set, providerId, options);
}

async function completeTurnForProvider(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  resolvedId: string,
  options?: { force?: boolean },
) {
  if (finishingTurnProviders.has(resolvedId)) return;
  finishingTurnProviders.add(resolvedId);
  try {
    if (!options?.force && (await runPendingApprovalCheck(get, set, resolvedId))) {
      cancelScheduledCompleteTurn(resolvedId);
      ensureStreamingHistorySync(get, set, resolvedId);
      return;
    }

    const before = getProviderSlice(get, resolvedId);
    if (before.thread && isGenerating(before)) {
      let ready = true;
      if (resolvedId === "opencode") {
        ready = await prepareOpencodeTurnForComplete(get, set, resolvedId);
      } else {
        await syncMessagesFromServer(get, set, resolvedId, true, true);
      }
      if (!ready) {
        ensureStreamingHistorySync(get, set, resolvedId);
        return;
      }
    }
    let current = getProviderSlice(get, resolvedId);
    stopStreamingHistorySync(resolvedId);
    cancelScheduledCompleteTurn(resolvedId);
    streamingStartedAt.delete(resolvedId);
    patchActiveTurn(set, resolvedId, null, {
      messages: finalizeTurnEntries(current.messages),
      error: null,
      pendingApproval: null,
    });
    clearTurnIdleSignal(resolvedId);

    const updated = getProviderSlice(get, resolvedId);
    const workspace = updated.thread?.workspace ?? updated.chatWorkspace;
    if (workspace && updated.thread) {
      const title = sessionTitleFromEntries(
        updated.messages,
        updated.thread.id,
      );
      persistLocalChatSession({
        workspace,
        providerId: resolvedId,
        sessionId: updated.thread.id,
        title,
        mode: updated.mode,
        model: updated.model,
        messages: updated.messages,
      }).catch(() => undefined);
      const commands = getAgentCommands(resolvedId);
      if (commands.updateThreadTitle && !isGenericSessionTitle(title)) {
        tauriInvoke(commands.updateThreadTitle, {
          sessionId: updated.thread.id,
          title,
        }).catch(() => undefined);
      }
      get().loadThreads(workspace, resolvedId).catch(() => undefined);
    }
  } finally {
    finishingTurnProviders.delete(resolvedId);
  }
}

async function finalizeCancelledTurn(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  options?: {
    skipImmediateNotice?: boolean;
    notice?: string;
    formatAsError?: boolean;
  },
) {
  if (finishingTurnProviders.has(providerId)) return;
  finishingTurnProviders.add(providerId);
  try {
    stopStreamingHistorySync(providerId);
    cancelScheduledCompleteTurn(providerId);
    streamingStartedAt.delete(providerId);

    let slice = getProviderSlice(get, providerId);
    const anchorUserId =
      slice.activeTurn?.localUserMessageId ?? slice.activeTurn?.anchorId;
    const assistantMessageId = slice.activeTurn?.assistantMessageId;
    const notice = options?.notice ?? t("chat.turnCancelled");
    const noticeOptions = {
      anchorUserId,
      assistantMessageId,
      formatAsError: options?.formatAsError ?? false,
    };

    if (!options?.skipImmediateNotice) {
      patchActiveTurn(set, providerId, slice.activeTurn
        ? withTurnPhase(slice.activeTurn, "cancelling")
        : null, {
        error: null,
        messages: markCurrentTurnCancelled(slice.messages, notice, noticeOptions),
        pendingApproval: null,
      });
    } else {
      patchActiveTurn(set, providerId, slice.activeTurn
        ? withTurnPhase(slice.activeTurn, "cancelling")
        : null, {
        error: null,
        pendingApproval: null,
      });
    }

    slice = getProviderSlice(get, providerId);
    if (slice.thread) {
      await syncMessagesFromServer(get, set, providerId, true, true);
      const afterSync = getProviderSlice(get, providerId);
      patchActiveTurn(set, providerId, null, {
        messages: finalizeTurnEntries(
          markCurrentTurnCancelled(afterSync.messages, notice, noticeOptions),
        ),
        error: null,
        pendingApproval: null,
      });
    } else {
      patchActiveTurn(set, providerId, null);
    }

    await saveProviderChatLocally(get, providerId).catch(() => undefined);
  } finally {
    finishingTurnProviders.delete(providerId);
  }
}

async function runPendingApprovalCheck(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  resolvedId: string,
) {
  const slice = getProviderSlice(get, resolvedId);
  if (!isGenerating(slice)) return false;

  const commands = getAgentCommands(resolvedId);
  if (commands.getPendingApproval && slice.thread) {
    try {
      const pending = await tauriInvoke<{
        id: string;
        description: string;
      } | null>(
        commands.getPendingApproval!,
        resolvedId === "opencode"
          ? opencodeSessionArgs(get, resolvedId, slice.thread.id)
          : { threadId: slice.thread.id },
      );
      if (pending?.id) {
        cancelScheduledCompleteTurn(resolvedId);
        const current = getProviderSlice(get, resolvedId);
        patchActiveTurn(
          set,
          resolvedId,
          current.activeTurn
            ? withTurnPhase(current.activeTurn, "awaiting_approval")
            : current.activeTurn,
          { pendingApproval: pending },
        );
        return true;
      }
      if (slice.pendingApproval) {
        patchProvider(set, resolvedId, { pendingApproval: null });
      }
      return false;
    } catch {
      return Boolean(slice.pendingApproval?.id);
    }
  }

  if (slice.pendingApproval) {
    patchProvider(set, resolvedId, { pendingApproval: null });
  }
  return false;
}

async function hydrateProviderAfterConnect(
  providerId: string,
  workspace: string | undefined,
  runtime: RuntimeStatus,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
) {
  if (
    workspace &&
    (providerId === "opencode")
  ) {
    syncProviderWorkspace(get, set, providerId, workspace);
  }
  const commands = getAgentCommands(providerId);
  const slice = getProviderSlice(get, providerId);
  const patch: Partial<ProviderChatSlice> = {
    runtime,
    connectedIntent: true,
    error: null,
    ...(workspace ? { chatWorkspace: workspace } : {}),
  };

  if (providerId === "opencode") {
    if (commands.listAgents) {
      try {
        const agents = await tauriInvoke<string[]>(commands.listAgents);
        if (agents.length > 0) {
          patch.dynamicModes = agents;
          let nextMode = slice.mode;
          if (!nextMode || !agents.includes(nextMode)) {
            try {
              const ocConfig = await tauriInvoke<OpencodeConfigView>(
                "load_opencode_provider_config",
              );
              const preferred = normalizeOpencodeDefaultAgent(
                ocConfig.defaultAgent,
              );
              nextMode =
                preferred && agents.includes(preferred) ? preferred : agents[0];
            } catch {
              nextMode = agents[0];
            }
          }
          patch.mode = nextMode;
        }
      } catch {
        // ignore
      }
    }
    if (commands.listProviderModels) {
      try {
        const catalog = await tauriInvoke<OpencodeProviderCatalog>(
          commands.listProviderModels,
        );
        if (catalog.models.length > 0) {
          const preferredModel = resolveProjectPreferredModel(
            useWorkspaceStore.getState().projectConfig,
            get().config,
          );
          const defaults = pickOpencodeDefaults(catalog.models, preferredModel);
          patch.opencodeModelCatalog = catalog.models;
          patch.opencodeConnectedProviders = catalog.connectedProviderIds;
          patch.opencodeVendor = defaults.vendor;
          patch.model = defaults.model;
          if (slice.thread) {
            patch.thread = { ...slice.thread, model: defaults.model };
          }
        }
      } catch {
        // ignore
      }
    }
  }

  patchProvider(set, providerId, patch);

  if (workspace) {
    await get().loadThreads(workspace, providerId);
    await restoreActiveSessionAfterConnect(get, set, providerId, workspace);
    return;
  }

  const updated = getProviderSlice(get, providerId);
  if (updated.thread?.id) {
    await ensureEventSubscription(providerId, updated.thread.id);
  }
}

async function restartProviderRuntime(
  providerId: string,
  workspace: string | undefined,
) {
  const commands = getAgentCommands(providerId);
  return tauriInvoke<RuntimeStatus>(commands.restartRuntime, {
    workspace: workspace ?? "",
  });
}

async function startProviderRuntime(
  providerId: string,
  workspace: string | undefined,
  spawnIfMissing: boolean,
) {
  const commands = getAgentCommands(providerId);
  if (spawnIfMissing) {
    await tauriInvoke(commands.doctor);
  }
  if (providerId === "opencode") {
    if (!workspace) {
      throw new Error(t("error.openProjectFirst"));
    }
    return tauriInvoke<RuntimeStatus>(commands.startRuntime, {
      workspace,
      spawnIfMissing,
    });
  }
  return tauriInvoke<RuntimeStatus>(commands.startRuntime, {
    spawnIfMissing,
  });
}

function resolveProviderWorkspace(
  get: () => ChatState,
  providerId: string,
  workspace?: string,
) {
  if (workspace) return workspace;
  const slice = getProviderSlice(get, providerId);
  return (
    slice.chatWorkspace ??
    slice.thread?.workspace ??
    useWorkspaceStore.getState().rootPath ??
    undefined
  );
}

function opencodeSessionArgs(
  get: () => ChatState,
  providerId: string,
  sessionId: string,
  workspace?: string,
) {
  const resolvedWorkspace = resolveProviderWorkspace(get, providerId, workspace);
  return {
    sessionId,
    ...(resolvedWorkspace ? { workspace: resolvedWorkspace } : {}),
  };
}

function syncProviderWorkspace(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  providerId: string,
  workspace: string,
) {
  const slice = getProviderSlice(get, providerId);
  const threadWorkspace = slice.thread?.workspace ?? slice.chatWorkspace;
  const patch: Partial<ProviderChatSlice> = {
    chatWorkspace: workspace,
  };
  if (
    slice.thread &&
    threadWorkspace &&
    !workspacesMatch(threadWorkspace, workspace)
  ) {
    patch.thread = null;
    patch.messages = [];
    patch.streaming = false;
    patch.pendingApproval = null;
    patch.error = null;
  }
  patchProvider(set, providerId, patch);
}

function isProjectLinkedToWorkspace(
  providerStates: Record<string, ProviderChatSlice>,
  workspace: string,
): boolean {
  return Object.values(providerStates).some(
    (slice) =>
      slice.connectedIntent &&
      !!slice.chatWorkspace &&
      workspacesMatch(slice.chatWorkspace, workspace),
  );
}

function isRuntimeServiceRelevantToProject(
  providerId: string,
  config: AppConfig,
  projectProvider: string | undefined,
): boolean {
  const defaultProvider = config.app.default_provider || "opencode";
  return (
    providerId === defaultProvider ||
    (projectProvider != null && providerId === projectProvider)
  );
}

async function tryReattachProvider(
  providerId: string,
  workspace: string | undefined,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
) {
  const slice = getProviderSlice(get, providerId);
  if (!slice.connectedIntent || slice.runtime.running) return;

  const resolvedWorkspace = resolveProviderWorkspace(get, providerId, workspace);
  if ((providerId === "opencode") && !resolvedWorkspace) return;

  try {
    const runtime = await startProviderRuntime(
      providerId,
      resolvedWorkspace,
      false,
    );
    if (!runtime.running) return;
    await hydrateProviderAfterConnect(
      providerId,
      resolvedWorkspace,
      runtime,
      set,
      get,
    );
  } catch {
    // service not available yet
  }
}

async function reattachLinkedProviders(
  workspace: string | undefined,
  skipProviderId: string | undefined,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
) {
  const { config } = get();
  if (!config) return;
  for (const provider of config.providers) {
    if (provider.id === skipProviderId) continue;
    await tryReattachProvider(provider.id, workspace, set, get);
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  config: null,
  providerId: "opencode",
  providerStates: {
    opencode: createProviderChatSlice("opencode"),
  },
  initialized: false,

  getActiveProvider: () => {
    const { config, providerId } = get();
    return config?.providers.find((p) => p.id === providerId) ?? null;
  },

  getActiveSlice: () => getProviderSlice(get),

  loadConfig: async () => {
    const config = await tauriInvoke<AppConfig>("load_config");
    const projectConfig = useWorkspaceStore.getState().projectConfig;
    let providerId = config.app.default_provider || "opencode";
    if (projectConfig?.provider) {
      providerId = projectConfig.provider;
    }
    let providerStates = get().providerStates;
    for (const provider of config.providers) {
      providerStates = ensureProviderSlice(providerStates, provider.id);
    }
    set({
      config,
      initialized: true,
      providerId,
      providerStates,
    });
    applyAppTheme(config.app.theme);
  },

  setProvider: (providerId) => {
    set((state) => ({
      providerId,
      providerStates: ensureProviderSlice(state.providerStates, providerId),
    }));
    const workspace =
      get().providerStates[providerId]?.chatWorkspace ??
      get().providerStates[providerId]?.thread?.workspace ??
      useWorkspaceStore.getState().rootPath ??
      undefined;
    void tryReattachProvider(providerId, workspace, set, get);
  },

  onProjectOpened: async (workspace, projectConfig) => {
    const { config } = get();
    if (!config) return;

    const providerId = config.providers.some(
      (provider) => provider.id === projectConfig.provider,
    )
      ? projectConfig.provider
      : config.app.default_provider || "opencode";

    set((state) => ({
      providerId,
      providerStates: ensureProviderSlice(state.providerStates, providerId),
    }));

    await get().connectRuntime(workspace);
  },

  setProjectProvider: async (nextProviderId) => {
    const workspace = useWorkspaceStore.getState().rootPath;
    if (!workspace) {
      set((state) => ({
        providerId: nextProviderId,
        providerStates: ensureProviderSlice(state.providerStates, nextProviderId),
      }));
      return;
    }

    const currentId = get().providerId;
    if (currentId === nextProviderId) return;

    const currentSlice = getProviderSlice(get, currentId);
    if (currentSlice.connectedIntent) {
      await softDisconnectProvider(set, currentId);
    }

    const info = await tauriInvoke<ProjectConfigInfo>("save_project_config_cmd", {
      workspace,
      config: buildProjectConfigPayload(
        useWorkspaceStore.getState().projectConfig,
        get().providerId,
        { provider: nextProviderId },
      ),
    });
    useWorkspaceStore.setState({
      projectConfig: info.config,
      projectConfigPath: info.path,
    });

    set((state) => ({
      providerId: nextProviderId,
      providerStates: ensureProviderSlice(state.providerStates, nextProviderId),
    }));

    await get().connectRuntime(workspace);
  },

  setProjectDefaultModel: async (defaultModel) => {
    const workspace = useWorkspaceStore.getState().rootPath;
    if (!workspace) return;

    const info = await tauriInvoke<ProjectConfigInfo>("save_project_config_cmd", {
      workspace,
      config: buildProjectConfigPayload(
        useWorkspaceStore.getState().projectConfig,
        get().providerId,
        { defaultModel },
      ),
    });
    useWorkspaceStore.setState({
      projectConfig: info.config,
      projectConfigPath: info.path,
    });
  },

  setProjectOpencodePermissions: async (permissions) => {
    const workspace = useWorkspaceStore.getState().rootPath;
    if (!workspace) return;

    const info = await tauriInvoke<ProjectConfigInfo>("save_project_config_cmd", {
      workspace,
      config: buildProjectConfigPayload(
        useWorkspaceStore.getState().projectConfig,
        get().providerId,
        { opencodePermissions: permissions },
      ),
    });
    useWorkspaceStore.setState({
      projectConfig: info.config,
      projectConfigPath: info.path,
    });
  },

  startRuntimeHealthMonitor: () => {
    if (runtimeHealthTimer) {
      clearInterval(runtimeHealthTimer);
    }
    runtimeHealthTimer = setInterval(() => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      const { providerId } = get();
      if (!rootPath) return;

      void (async () => {
        const slice = getProviderSlice(get, providerId);
        try {
          const status = await pollProviderRuntimeStatus(providerId);
          if (!status.running && slice.connectedIntent) {
            stopStreamingHistorySync(providerId);
            cancelScheduledCompleteTurn(providerId);
            patchProvider(set, providerId, {
              connectedIntent: false,
              streaming: false,
              pendingApproval: null,
              runtime: status,
            });
            return;
          }
          if (
            status.running !== slice.runtime.running ||
            status.base_url !== slice.runtime.base_url ||
            status.owned !== slice.runtime.owned
          ) {
            patchProvider(set, providerId, { runtime: status });
          }
        } catch {
          // ignore polling errors
        }
      })();
    }, 3000);

    return () => {
      if (runtimeHealthTimer) {
        clearInterval(runtimeHealthTimer);
        runtimeHealthTimer = null;
      }
    };
  },

  connectRuntime: async (workspace) => {
    const { providerId } = get();
    set((state) => ({
      providerStates: ensureProviderSlice(state.providerStates, providerId),
    }));

    await runRuntimeAction(providerId, "connect", set, get, async () => {
      const resolvedWorkspace = resolveProviderWorkspace(
        get,
        providerId,
        workspace,
      );
      const status = await pollProviderRuntimeStatus(providerId);
      const runtime = status.running
        ? await restartProviderRuntime(providerId, resolvedWorkspace)
        : await startProviderRuntime(providerId, resolvedWorkspace, true);
      if (!runtime.running) {
        throw new Error(t("error.aiServiceStartFailed"));
      }
      await hydrateProviderAfterConnect(
        providerId,
        resolvedWorkspace,
        runtime,
        set,
        get,
      );
      if (resolvedWorkspace) {
        await get().loadThreads(resolvedWorkspace, providerId).catch(() => undefined);
      }
    });
  },

  disconnectRuntime: async () => {
    const { providerId } = get();
    await runRuntimeAction(providerId, "disconnect", set, get, async () => {
      await softDisconnectProvider(set, providerId);
    });
  },

  restartRuntime: async (workspace) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    const wasLinked = slice.connectedIntent;
    const resolvedWorkspace = resolveProviderWorkspace(
      get,
      providerId,
      workspace,
    );

    if ((providerId === "opencode") && !resolvedWorkspace) {
      throw new Error(t("error.openProjectFirst"));
    }

    await runRuntimeAction(providerId, "restart", set, get, async () => {
      patchProvider(set, providerId, {
        streaming: false,
        pendingApproval: null,
      });

      const commands = getAgentCommands(providerId);
      const runtime = await tauriInvoke<RuntimeStatus>(commands.restartRuntime, {
        workspace: resolvedWorkspace ?? "",
      });

      if (!runtime.running) {
        throw new Error(t("error.aiServiceRestartFailed"));
      }

      if (wasLinked) {
        await hydrateProviderAfterConnect(
          providerId,
          resolvedWorkspace,
          runtime,
          set,
          get,
        );
      } else {
        patchProvider(set, providerId, { runtime });
      }

      await reattachLinkedProviders(resolvedWorkspace, providerId, set, get);
    });
  },

  reloadProviderConfig: async (providerId) => {
    if (providerId !== "opencode") {
      return;
    }

    const status = await pollProviderRuntimeStatus(providerId);
    if (!status.running) {
      return;
    }

    const slice = getProviderSlice(get, providerId);
    const wasLinked = slice.connectedIntent;
    const resolvedWorkspace = resolveProviderWorkspace(get, providerId);

    await runRuntimeAction(providerId, "restart", set, get, async () => {
      patchProvider(set, providerId, {
        streaming: false,
        pendingApproval: null,
      });

      const runtime = await restartProviderRuntime(
        providerId,
        resolvedWorkspace,
      );
      if (!runtime.running) {
        throw new Error(t("error.aiServiceRestartFailed"));
      }

      if (wasLinked) {
        await hydrateProviderAfterConnect(
          providerId,
          resolvedWorkspace,
          runtime,
          set,
          get,
        );
      } else {
        patchProvider(set, providerId, { runtime });
      }
    });
  },

  refreshProviderRuntime: async (providerId) => {
    const id = providerId ?? get().providerId;
    if (id !== "opencode") {
      return;
    }

    const status = await pollProviderRuntimeStatus(id);
    const slice = getProviderSlice(get, id);
    if (!status.running) {
      stopStreamingHistorySync(id);
      cancelScheduledCompleteTurn(id);
      patchProvider(set, id, {
        runtime: status,
        connectedIntent: false,
        streaming: false,
        pendingApproval: null,
      });
      return;
    }

    patchProvider(set, id, {
      runtime: status,
      connectedIntent: slice.connectedIntent,
    });
  },

  autoConnectAfterRuntimeService: async (providerId) => {
    if (providerId !== "opencode") {
      return;
    }

    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;

    const { config, providerStates } = get();
    if (!config) return;

    const projectConfig = useWorkspaceStore.getState().projectConfig;
    if (
      !isRuntimeServiceRelevantToProject(
        providerId,
        config,
        projectConfig?.provider,
      )
    ) {
      return;
    }

    if (isProjectLinkedToWorkspace(providerStates, rootPath)) {
      return;
    }

    const runtime = await pollProviderRuntimeStatus(providerId);
    if (!runtime.running) return;

    if (get().providerId !== providerId) {
      set((state) => ({
        providerId,
        providerStates: ensureProviderSlice(state.providerStates, providerId),
      }));
    }

    await runRuntimeAction(providerId, "connect", set, get, async () => {
      await hydrateProviderAfterConnect(
        providerId,
        rootPath,
        runtime,
        set,
        get,
      );
    });
  },

  loadThreads: async (workspace, providerId) => {
    const id = providerId ?? get().providerId;
    const slice = getProviderSlice(get, id);
    if (!slice.connectedIntent) return;

    const commands = getAgentCommands(id);
    patchProvider(set, id, { threadsLoading: true, error: null });
    try {
      const [remote, local] = await Promise.all([
        tauriInvoke<ThreadSummary[]>(commands.listThreads, {
          workspace,
          limit: 50,
        }),
        listLocalChatSessions(workspace, id),
      ]);
      patchProvider(set, id, {
        threads: mergeThreadLists(remote, local),
        threadsLoading: false,
      });
    } catch (e) {
      patchProvider(set, id, {
        threadsLoading: false,
        error: String(e),
      });
      throw e;
    }
  },

  selectThread: async (threadId, workspace) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (slice.thread?.id === threadId) {
      if (!slice.connectedIntent) {
        await get().connectRuntime(workspace);
      }
      await resumeInFlightTurn(get, set, providerId, workspace, threadId);
      await rememberActiveSession(providerId, workspace, threadId);
      return;
    }
    if (!slice.connectedIntent) {
      await get().connectRuntime(workspace);
    }

    const commands = getAgentCommands(providerId);
    patchProvider(set, providerId, {
      error: null,
      streaming: false,
      pendingApproval: null,
    });

    try {
      const messages = await loadThreadHistoryMessages(
        get,
        providerId,
        workspace,
        threadId,
      );
      if (!messages) {
        throw new Error(t("error.sessionHistoryLoadFailed"));
      }

      await resumeInFlightTurn(get, set, providerId, workspace, threadId, {
        messages,
      });

      const current = getProviderSlice(get, providerId);
      const title = sessionTitleFromEntries(current.messages, threadId);
      await rememberActiveSession(providerId, workspace, threadId);
      await persistLocalChatSession({
        workspace,
        providerId,
        sessionId: threadId,
        title,
        mode: current.mode,
        model: current.model,
        messages: current.messages,
      });
      if (
        commands.updateThreadTitle &&
        !isGenericSessionTitle(title)
      ) {
        tauriInvoke(commands.updateThreadTitle, {
          sessionId: threadId,
          title,
        }).catch(() => undefined);
      }
    } catch (e) {
      patchProvider(set, providerId, { error: String(e) });
      throw e;
    }
  },

  createNewThread: async (workspace) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.connectedIntent) {
      await get().connectRuntime(workspace);
    }
    const current = getProviderSlice(get, providerId);
    const commands = getAgentCommands(providerId);
    const created = await tauriInvoke<ThreadInfo>(commands.createThread, {
      workspace,
      mode: current.mode,
      title: t("chat.newSessionTitle"),
    });

    await ensureEventSubscription(providerId, created.id);
    clearOpencodeSseActivity(providerId);
    streamingStartedAt.delete(providerId);
    patchProvider(set, providerId, {
      thread: {
        ...created,
        workspace: created.workspace ?? workspace,
      },
      chatWorkspace: workspace,
      messages: [],
      streaming: false,
      pendingApproval: null,
      error: null,
    });
    await rememberActiveSession(providerId, workspace, created.id);
    await persistLocalChatSession({
      workspace,
      providerId,
      sessionId: created.id,
      title: t("chat.newSessionTitle"),
      mode: current.mode,
      model: current.model,
      messages: [],
    });
    await get().loadThreads(workspace, providerId);
  },

  deleteThread: async (threadId, workspace) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    const current = slice.threads.find((item) => item.id === threadId);
    const label =
      current?.title ||
      current?.preview ||
      translate(useSettingsStore.getState().locale, "chat.sessionFallback");
    const confirmed = await safeConfirm(
      translate(useSettingsStore.getState().locale, "chat.deleteConfirm", {
        label,
      }),
    );
    if (!confirmed) return;

    const commands = getAgentCommands(providerId);
    const deletingCurrent = slice.thread?.id === threadId;

    if (deletingCurrent) {
      patchProvider(set, providerId, {
        streaming: false,
        pendingApproval: null,
        error: null,
      });
    }

    try {
      await tauriInvoke(
        commands.deleteThread,
        providerId === "opencode"
          ? {
              ...opencodeSessionArgs(get, providerId, threadId, workspace),
            }
          : { threadId },
      );
    } catch (e) {
      if (!isRemoteSessionNotFound(e)) {
        patchProvider(set, providerId, { error: String(e) });
        throw e;
      }
    }

    await clearDeletedThreadLocally(
      get,
      set,
      providerId,
      threadId,
      workspace,
    );
  },

  setMode: async (mode) => {
    const { providerId } = get();
    patchProvider(set, providerId, { mode });
  },

  setModel: (model) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    patchProvider(set, providerId, {
      model,
      opencodeVendor:
        providerId === "opencode"
          ? resolveOpencodeVendor(model, slice.opencodeVendor)
          : slice.opencodeVendor,
    });
  },

  setOpencodeVendor: (vendorId) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    const vendorModels = modelsForOpencodeVendor(
      slice.opencodeModelCatalog,
      vendorId,
    );
    const nextModel = vendorModels.some((item) => item.value === slice.model)
      ? slice.model
      : (vendorModels[0]?.value ?? "");
    patchProvider(set, providerId, {
      opencodeVendor: vendorId,
      model: nextModel,
    });
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const { providerId } = get();
    cancelScheduledCompleteTurn(providerId);
    clearOpencodeSseActivity(providerId);
    const userMsg: HistoryMessage = {
      id: createOpencodeMessageId(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    resetTurnCompleteStreak(providerId);
    markStreamingStarted(providerId);

    const current = getProviderSlice(get, providerId);
    if (!current.thread) {
      patchActiveTurn(set, providerId, null, {
        error: t("error.noSessionThread"),
      });
      return;
    }

    patchActiveTurn(
      set,
      providerId,
      createActiveTurn(
        userMsg.id,
        "message_id",
        userMsg.id,
        "streaming",
        current.messages.map((message) => message.id),
      ),
      {
        messages: [...current.messages, userMsg],
        error: null,
      },
    );

    startStreamingHistorySync(get, set, providerId);
    void saveProviderChatLocally(get, providerId).catch(() => undefined);

    const commands = getAgentCommands(providerId);
    try {
      await ensureEventSubscription(providerId, current.thread.id);

      await tauriInvoke(commands.sendTurn, {
        threadId: current.thread.id,
        message: trimmed,
        mode: current.mode,
        model: current.model || null,
        workspace: resolveProviderWorkspace(
          get,
          providerId,
          current.thread.workspace,
        ),
        messageId: userMsg.id,
      });

      window.setTimeout(() => {
        get().refreshPendingApproval().catch(() => undefined);
      }, 400);
    } catch (e) {
      stopStreamingHistorySync(providerId);
      patchActiveTurn(set, providerId, null, {
        error: String(e),
        runtime: { running: false, owned: current.runtime.owned },
      });
    }
  },

  cancelGeneration: async () => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!isGenerating(slice) || !slice.thread) return;

    const threadId = slice.thread.id;
    const pendingId = slice.pendingApproval?.id;
    const commands = getAgentCommands(providerId);
    const notice = t("chat.turnCancelled");

    stopStreamingHistorySync(providerId);
    cancelScheduledCompleteTurn(providerId);
    patchActiveTurn(
      set,
      providerId,
      slice.activeTurn
        ? withTurnPhase(slice.activeTurn, "cancelling")
        : null,
      {
        pendingApproval: null,
        error: null,
        messages: markCurrentTurnCancelled(slice.messages, notice, {
          anchorUserId:
            slice.activeTurn?.localUserMessageId ?? slice.activeTurn?.anchorId,
          assistantMessageId: slice.activeTurn?.assistantMessageId,
        }),
      },
    );

    try {
      if (pendingId && commands.approve) {
        if (providerId === "opencode") {
          await tauriInvoke(commands.approve, {
            threadId,
            approvalId: pendingId,
            allow: false,
          });
        } else {
          await tauriInvoke(commands.approve, {
            approvalId: pendingId,
            allow: false,
          });
        }
      }
      if (commands.cancelTurn) {
        await tauriInvoke(
          commands.cancelTurn,
          providerId === "opencode"
            ? opencodeSessionArgs(get, providerId, threadId)
            : { threadId },
        );
      }
    } catch (e) {
      const message = String(e);
      if (!isUserCancellation(message)) {
        patchProvider(set, providerId, { error: message });
      }
    }

    await finalizeCancelledTurn(get, set, providerId, {
      skipImmediateNotice: true,
    });
  },

  refreshPendingApproval: async () => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.thread || !isGenerating(slice)) return;

    const commands = getAgentCommands(providerId);
    if (!commands.getPendingApproval) return;

    try {
      const pending = await tauriInvoke<{
        id: string;
        description: string;
      } | null>(
        commands.getPendingApproval,
        providerId === "opencode"
          ? opencodeSessionArgs(get, providerId, slice.thread.id)
          : { threadId: slice.thread.id },
      );
      if (pending) {
        cancelScheduledCompleteTurn(providerId);
        const current = getProviderSlice(get, providerId);
        patchActiveTurn(
          set,
          providerId,
          current.activeTurn
            ? withTurnPhase(current.activeTurn, "awaiting_approval")
            : current.activeTurn,
          { pendingApproval: pending },
        );
        ensureStreamingHistorySync(get, set, providerId);
      }
    } catch {
      // ignore
    }
  },

  approve: async (allow) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.pendingApproval || !slice.thread) return;
    if (!slice.pendingApproval.id) {
      await get().refreshPendingApproval();
      const refreshed = getProviderSlice(get, providerId);
      if (!refreshed.pendingApproval?.id) {
        patchProvider(set, providerId, {
          error: t("error.approvalIdMissing"),
        });
        return;
      }
    }

    const active = getProviderSlice(get, providerId);
    const commands = getAgentCommands(providerId);
    try {
      if (providerId === "opencode") {
        await tauriInvoke(commands.approve, {
          threadId: active.thread!.id,
          approvalId: active.pendingApproval!.id,
          allow,
        });
      } else {
        await tauriInvoke(commands.approve, {
          approvalId: active.pendingApproval!.id,
          allow,
        });
      }
      patchProvider(set, providerId, {
        pendingApproval: null,
        streaming: allow,
        error: null,
      });
      if (allow) {
        ensureStreamingHistorySync(get, set, providerId);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("404") || msg.includes("no pending approval")) {
        patchProvider(set, providerId, {
          pendingApproval: null,
          error: t("error.approvalExpired"),
        });
      } else {
        patchProvider(set, providerId, { error: msg });
      }
    }
  },

  setupEventListener: async () => {
    if (!isTauri()) {
      return () => {};
    }

    const applyToProvider = (
      targetProviderId: string,
      updater: (slice: ProviderChatSlice) => Partial<ProviderChatSlice>,
    ) => {
      const resolvedId = targetProviderId || get().providerId;
      const slice = getProviderSlice(get, resolvedId);
      patchProvider(set, resolvedId, updater(slice));
    };

    const unlistenEvent = await listen<Record<string, unknown>>(
      "agent-event",
      (event) => {
        try {
          const { providerId: eventProviderId, mapped } = parseAgentEnvelope(
            event.payload,
          );
          if (!mapped) return;
          const resolvedId = eventProviderId || get().providerId;

          const isActiveStreamingTurn = () => {
            const slice = getProviderSlice(get, resolvedId);
            return acceptsAgentStreamUpdates(slice.activeTurn, slice.streaming);
          };

          if (mapped.type === "text_delta") {
            if (!isActiveStreamingTurn() || !mapped.partId) return;
            markOpencodeAnswerTextSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
            applyToProvider(resolvedId, (slice) => ({
              messages: appendTextDelta(
                slice.messages,
                mapped.partId!,
                mapped.content,
                slice.activeTurn?.anchorId,
                slice.activeTurn?.baselineEntryIds,
                parentMessageIdForEvent(slice, mapped.messageId),
              ),
            }));
            ensureStreamingHistorySync(get, set, resolvedId);
          } else if (mapped.type === "text_snapshot") {
            if (!isActiveStreamingTurn() || !mapped.partId) return;
            markOpencodeAnswerTextSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
            applyToProvider(resolvedId, (slice) => ({
              messages: setTextSnapshot(
                slice.messages,
                mapped.partId!,
                mapped.content,
                slice.activeTurn?.anchorId,
                slice.activeTurn?.baselineEntryIds,
                parentMessageIdForEvent(slice, mapped.messageId),
              ),
            }));
          } else if (mapped.type === "reasoning_delta") {
            if (!isActiveStreamingTurn() || !mapped.partId) return;
            markOpencodeStreamSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
            applyToProvider(resolvedId, (slice) => ({
              messages: appendReasoningDelta(
                slice.messages,
                mapped.partId!,
                mapped.content,
                slice.activeTurn?.anchorId,
                slice.activeTurn?.baselineEntryIds,
                parentMessageIdForEvent(slice, mapped.messageId),
              ),
            }));
          } else if (mapped.type === "reasoning_snapshot") {
            if (!isActiveStreamingTurn() || !mapped.partId) return;
            markOpencodeStreamSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
            applyToProvider(resolvedId, (slice) => ({
              messages: setReasoningSnapshot(
                slice.messages,
                mapped.partId!,
                mapped.content,
                slice.activeTurn?.anchorId,
                slice.activeTurn?.baselineEntryIds,
                parentMessageIdForEvent(slice, mapped.messageId),
              ),
            }));
          } else if (mapped.type === "tool_call") {
            if (!isActiveStreamingTurn()) return;
            if (!isMeaningfulToolArgs(mapped.args, mapped.name)) {
              return;
            }
            if (!mapped.partId) return;

            markOpencodeStreamSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
            applyToProvider(resolvedId, (slice) => {
              const toolContent =
                typeof mapped.args === "string"
                  ? mapped.args
                  : JSON.stringify(mapped.args, null, 2);
              return {
                messages: upsertToolEntry(
                  slice.messages,
                  mapped.partId!,
                  mapped.name,
                  toolContent,
                  slice.activeTurn?.anchorId,
                  slice.activeTurn?.baselineEntryIds,
                  parentMessageIdForEvent(slice, mapped.messageId),
                ),
              };
            });
          } else if (mapped.type === "assistant_message") {
            if (!isActiveStreamingTurn()) return;
            rememberAssistantMessageId(get, set, resolvedId, mapped.messageId);
          } else if (mapped.type === "file_change") {
            const workspace = useWorkspaceStore.getState();
            if (mapped.path) {
              workspace.reloadOpenFilesIfClean([mapped.path]);
            }
            workspace.bumpExplorerRefresh();
          }

          if (mapped.type === "approval_required") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (
              !acceptsAgentStreamUpdates(
                activeSlice.activeTurn,
                activeSlice.streaming,
              )
            ) {
              return;
            }
            cancelScheduledCompleteTurn(resolvedId);
            patchActiveTurn(
              set,
              resolvedId,
              activeSlice.activeTurn
                ? withTurnPhase(activeSlice.activeTurn, "awaiting_approval")
                : activeSlice.activeTurn,
              {
                pendingApproval: {
                  id: mapped.id,
                  description: mapped.description,
                },
              },
            );
            ensureStreamingHistorySync(get, set, resolvedId);

            const commands = getAgentCommands(resolvedId);
            if (commands.getPendingApproval) {
              const refresh = async () => {
                const slice = getProviderSlice(get, resolvedId);
                if (!slice.thread) return;
                try {
                  const pending = await tauriInvoke<{
                    id: string;
                    description: string;
                  } | null>(
                    commands.getPendingApproval!,
                    resolvedId === "opencode"
                      ? opencodeSessionArgs(get, resolvedId, slice.thread.id)
                      : { threadId: slice.thread.id },
                  );
                  if (pending) {
                    patchProvider(set, resolvedId, { pendingApproval: pending });
                  }
                } catch {
                  // keep event-derived approval card
                }
              };
              refresh().catch(() => undefined);
            }
          }

          if (mapped.type === "approval_resolved") {
            const activeSlice = getProviderSlice(get, resolvedId);
            patchActiveTurn(
              set,
              resolvedId,
              activeSlice.activeTurn
                ? withTurnPhase(activeSlice.activeTurn, "streaming")
                : activeSlice.activeTurn,
              { pendingApproval: null },
            );
          }

          if (mapped.type === "session_busy") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!isGenerating(activeSlice)) return;
            if (shouldIgnoreStreamingReactivation(resolvedId)) return;
            cancelScheduledCompleteTurn(resolvedId);
            keepTurnStreaming(get, set, resolvedId);
            ensureStreamingHistorySync(get, set, resolvedId);
          }

          if (mapped.type === "session_idle") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!isGenerating(activeSlice)) return;
            if (resolvedId === "opencode") {
              clearOpencodeSseActivity(resolvedId);
              markTurnIdleSignal(resolvedId);
              ensureStreamingHistorySync(get, set, resolvedId);
              void tryFinalizeTurnIfReady(get, set, resolvedId);
            }
          }

          if (mapped.type === "turn_completed") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!isGenerating(activeSlice)) return;
            void endTurnFromRuntimeEvent(get, set, resolvedId, {
              forceFullHistory: true,
              reason: "completed",
            });
          }

          if (mapped.type === "turn_aborted") {
            cancelScheduledCompleteTurn(resolvedId);
            void finalizeCancelledTurn(get, set, resolvedId, {
              notice: "Aborted",
              formatAsError: true,
            });
          }

          if (mapped.type === "turn_error") {
            if (isUserCancellation(mapped.message)) {
              cancelScheduledCompleteTurn(resolvedId);
              void finalizeCancelledTurn(get, set, resolvedId, {
                notice: mapped.message,
                formatAsError: true,
              });
              return;
            }
            const errorSlice = getProviderSlice(get, resolvedId);
            const messages = [...errorSlice.messages];
            for (let i = messages.length - 1; i >= 0; i -= 1) {
              if (messages[i].role === "assistant") {
                const prefix = messages[i].content ? "\n\n" : "";
                messages[i] = {
                  ...messages[i],
                  content: `${messages[i].content}${prefix}${t("error.withMessage", { message: mapped.message })}`,
                };
                break;
              }
            }
            patchActiveTurn(set, resolvedId, null, {
              messages,
              error: mapped.message,
            });
            saveProviderChatLocally(get, resolvedId).catch(() => undefined);
          }
        } catch (e) {
          console.error("agent-event handler failed:", e);
          const { providerId } = get();
          patchProvider(set, providerId, {
            streaming: false,
            error: String(e),
          });
        }
      },
    );

    const unlistenError = await listen<unknown>("agent-error", (event) => {
      const { providerId: eventProviderId, message } = parseAgentError(
        event.payload,
      );
      const resolvedId = eventProviderId || get().providerId;
      const slice = getProviderSlice(get, resolvedId);
      if (
        message.includes("SSE stream error") ||
        message.includes("SSE connect failed")
      ) {
        if (slice.thread?.id) {
          void ensureEventSubscription(resolvedId, slice.thread.id);
        }
        if (slice.streaming) {
          clearOpencodeSseActivity(resolvedId);
          ensureStreamingHistorySync(get, set, resolvedId);
        }
        return;
      }
      if (isPollOnlyMessageProvider(resolvedId)) return;
      patchProvider(set, resolvedId, {
        error: message,
        streaming: false,
        pendingApproval: null,
        runtime: { running: slice.runtime.running, owned: slice.runtime.owned ?? false },
      });
    });

    return () => {
      unlistenEvent();
      unlistenError();
    };
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  const debugWindow = window as Window & {
    __xcoderChat?: {
      getState: typeof useChatStore.getState;
      diagnoseOpencode: () => Promise<Record<string, unknown>>;
    };
  };
  debugWindow.__xcoderChat = {
    getState: useChatStore.getState,
    diagnoseOpencode: async () => {
      const slice = useChatStore.getState().providerStates.opencode;
      const sessionId = slice?.thread?.id;
      if (!sessionId) {
        return { error: "no thread" };
      }
      const workspace =
        slice.thread?.workspace ?? slice.chatWorkspace ?? undefined;
      try {
        const [poll, pending] = await Promise.all([
          tauriInvoke<{
            messages: HistoryMessage[];
            busy: boolean;
            pending: { id: string; description: string } | null;
            turn_complete: boolean;
          }>("opencode_poll_turn", {
            sessionId,
            workspace,
            limit: 40,
          }),
          tauriInvoke<{ id: string; description: string } | null>(
            "opencode_get_pending_approval",
            { sessionId, workspace },
          ),
        ]);
        const synced = syncEntriesFromServer(slice.messages, poll.messages, {
          anchorUserId: slice.activeTurn?.anchorId ?? null,
          baselineEntryIds: slice.activeTurn?.baselineEntryIds,
          full: !slice.streaming,
        });
        const projected = projectEntriesToChatMessages(synced);
        return {
          streaming: slice.streaming,
          pendingApproval: slice.pendingApproval,
          busy: poll.busy,
          turnComplete: poll.turn_complete,
          pending: poll.pending ?? pending,
          messageCount: slice.messages.length,
          polledMessages: poll.messages.length,
          syncedCount: synced.length,
          mergedAssistantPreview: projected
            .filter((item) => item.role === "assistant")
            .slice(-1)[0]?.content?.slice(0, 120),
        };
      } catch (error) {
        return {
          streaming: slice.streaming,
          pendingApproval: slice.pendingApproval,
          error: String(error),
        };
      }
    },
  };
}

export function useActiveProviderChat() {
  const view = useChatStore(
    useShallow((state) => {
      const slice =
        state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId);
      return {
        config: state.config,
        providerId: state.providerId,
        initialized: state.initialized,
        entries: slice.messages,
        runtime: slice.runtime,
        connectedIntent: slice.connectedIntent,
        thread: slice.thread,
        chatWorkspace: slice.chatWorkspace,
        threads: slice.threads,
        threadsLoading: slice.threadsLoading,
        mode: slice.mode,
        model: slice.model,
        dynamicModes: slice.dynamicModes,
        opencodeModelCatalog: slice.opencodeModelCatalog,
        opencodeConnectedProviders: slice.opencodeConnectedProviders,
        opencodeVendor: slice.opencodeVendor,
        streaming: slice.streaming,
        activeTurn: slice.activeTurn,
        runtimeBusy: slice.runtimeBusy,
        runtimeAction: slice.runtimeAction,
        pendingApproval: slice.pendingApproval,
        error: slice.error,
      };
    }),
  );

  const messages = useMemo(
    () => projectEntriesToChatMessages(view.entries ?? []),
    [view.entries],
  );

  const generating = isGenerating({
    streaming: view.streaming,
    activeTurn: view.activeTurn,
  });

  return { ...view, messages, generating };
}
