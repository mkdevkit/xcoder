import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { isTauri, tauriInvoke } from "../utils/tauri";
import { safeConfirm } from "../utils/tauriDialog";
import { getAgentCommands } from "../utils/agentProvider";
import type {
  AppConfig,
  ChatMessage,
  HistoryMessage,
  ProviderConfig,
  RuntimeStatus,
  ThreadInfo,
  ThreadSummary,
  OpencodeProviderCatalog,
  CodewhaleModelOption,
} from "../types/agent";
import { mapRuntimeEvent } from "../types/agent";
import {
  mapHistoryToChatMessages,
  mergeServerMessagesWithLocal,
  normalizePlanningMessageOrder,
} from "../utils/chatHistory";
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
  sessionTitleFromMessages,
  isGenericSessionTitle,
  writeLocalActiveSessionId,
} from "../utils/localChatHistory";
import {
  modelsForOpencodeVendor,
  normalizeOpencodeDefaultAgent,
  pickOpencodeDefaults,
  resolveOpencodeVendor,
} from "../utils/opencodeModels";
import {
  CODEWHALE_MODES,
  pickCodewhaleDefaults,
} from "../utils/codewhaleModels";
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
  patchProvider(set, providerId, {
    connectedIntent: false,
    streaming: false,
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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function lastUserMessageText(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return undefined;
}

function mergeAssistantText(
  current: string,
  incoming: string,
  lastUserText?: string,
): string {
  if (!incoming) return current;
  const trimmedIncoming = incoming.trim();
  if (lastUserText && trimmedIncoming === lastUserText.trim()) {
    return current;
  }
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  if (current.endsWith(incoming)) return current;
  if (incoming.length > 20 && current.includes(incoming)) return current;
  return current + incoming;
}

function mergeReasoningText(current: string, incoming: string): string {
  const chunk = incoming.trim();
  if (!chunk) return current;
  if (!current) return `> ${chunk}`;
  if (current.includes(chunk) && chunk.length > 16) return current;

  const lines = current.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine.startsWith("> ")) {
    const existingReasoning = lastLine.slice(2);
    if (chunk.startsWith(existingReasoning)) {
      lines[lines.length - 1] = `> ${chunk}`;
      return lines.join("\n");
    }
    if (existingReasoning.endsWith(chunk)) return current;
    lines[lines.length - 1] = `${lastLine}${incoming}`;
    return lines.join("\n");
  }

  const prefix = current ? "\n\n" : "";
  return `${current}${prefix}> ${chunk}`;
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

function shouldSkipAssistantSnapshot(
  text: string,
  lastUserText?: string,
): boolean {
  if (!text.trim()) return true;
  if (lastUserText && text.trim() === lastUserText.trim()) return true;
  return false;
}

function findLastToolIndexInTurn(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return -1;
    if (messages[i].role === "tool") return i;
  }
  return -1;
}

function findAssistantTextTargetIndex(messages: ChatMessage[]): number {
  const trailingEmpty = findTrailingEmptyAssistantIndex(messages);
  if (trailingEmpty >= 0) return trailingEmpty;

  const lastTool = findLastToolIndexInTurn(messages);
  if (lastTool >= 0) {
    for (let i = lastTool + 1; i < messages.length; i += 1) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return -1;
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

function findTrailingEmptyAssistantIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") break;
    if (messages[i].role === "assistant" && !messages[i].content.trim()) {
      return i;
    }
  }
  return -1;
}

function findToolInsertIndex(
  messages: ChatMessage[],
  toolName: string,
): number {
  if (toolName === "task") {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") break;
      if (messages[i].role === "assistant") return i;
    }
    return messages.length;
  }

  const trailingEmpty = findTrailingEmptyAssistantIndex(messages);
  if (trailingEmpty >= 0) {
    return trailingEmpty;
  }

  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") break;
    if (messages[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant < 0) return messages.length;
  if (!messages[lastAssistant].content.trim()) {
    return lastAssistant;
  }

  // Tool runs after any text already emitted in this turn.
  return lastAssistant + 1;
}

function ensureAssistantAfterTools(messages: ChatMessage[]) {
  const lastTool = findLastToolIndexInTurn(messages);
  if (lastTool < 0) return;

  for (let i = lastTool + 1; i < messages.length; i += 1) {
    if (messages[i].role === "assistant") return;
  }

  messages.push({
    id: uid(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  });
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
    title: sessionTitleFromMessages(slice.messages, slice.thread.id),
    mode: slice.mode,
    model: slice.model,
    messages: slice.messages,
  });
}

const STREAMING_POLL_MS: Record<string, number> = {
  opencode: 200,
  codewhale: 250,
};
const OPENCODE_SSE_POLL_MS = 120;
const DEFAULT_STREAMING_POLL_MS = 1000;
const OPENCODE_SSE_FALLBACK_MS = 1800;
const TURN_COMPLETE_CONFIRMATIONS = 2;
const OPENCODE_STREAMING_MESSAGE_LIMIT_MIN = 48;
const OPENCODE_STREAMING_MESSAGE_LIMIT_MAX = 160;

function streamingPollIntervalMs(providerId: string) {
  return STREAMING_POLL_MS[providerId] ?? DEFAULT_STREAMING_POLL_MS;
}

function opencodeStreamingPollDelayMs(providerId: string) {
  const sseFresh =
    Date.now() - (lastOpencodeTextSseAt.get(providerId) ?? 0) <
    OPENCODE_SSE_FALLBACK_MS;
  return sseFresh ? OPENCODE_SSE_POLL_MS : streamingPollIntervalMs(providerId);
}

function nextStreamingPollDelayMs(providerId: string) {
  return providerId === "opencode"
    ? opencodeStreamingPollDelayMs(providerId)
    : streamingPollIntervalMs(providerId);
}

function opencodeStreamingMessageLimit(
  messages: ChatMessage[],
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
const lastOpencodeTextSseAt = new Map<string, number>();
const turnCompleteStreak = new Map<string, number>();

function resetTurnCompleteStreak(providerId: string) {
  turnCompleteStreak.delete(providerId);
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

  if (providerId === "codewhale") {
    const poll = await tauriInvoke<{
      busy: boolean;
      turn_complete: boolean;
      pending: { id: string; description: string } | null;
    }>("codewhale_poll_turn", { threadId: slice.thread.id });
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
  if (!slice.streaming || !slice.thread) return;

  try {
    const state = await fetchTurnCompleteState(get, providerId);
    if (state.pending) {
      resetTurnCompleteStreak(providerId);
      patchProvider(set, providerId, { streaming: true });
      ensureStreamingHistorySync(get, set, providerId);
      return;
    }

    if (state.busy || !state.turn_complete) {
      resetTurnCompleteStreak(providerId);
      patchProvider(set, providerId, { streaming: true });
      ensureStreamingHistorySync(get, set, providerId);
      return;
    }

    const streak = (turnCompleteStreak.get(providerId) ?? 0) + 1;
    turnCompleteStreak.set(providerId, streak);
    if (streak < TURN_COMPLETE_CONFIRMATIONS) {
      patchProvider(set, providerId, { streaming: true });
      ensureStreamingHistorySync(get, set, providerId);
      return;
    }

    resetTurnCompleteStreak(providerId);
    await tryFinishOpencodeTurn(get, set, providerId, { force: true });
  } catch {
    patchProvider(set, providerId, { streaming: true });
    ensureStreamingHistorySync(get, set, providerId);
  }
}

function lastAssistantMessage(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }
  return undefined;
}

function markOpencodeSseActivity(providerId: string) {
  if (providerId === "opencode") {
    lastOpencodeTextSseAt.set(providerId, Date.now());
  }
}

function isPollOnlyMessageProvider(providerId: string) {
  return providerId === "opencode";
}

function finalizeTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  const result = [...messages];
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === "assistant" && !last.content.trim()) {
      result.pop();
    } else {
      break;
    }
  }
  return normalizePlanningMessageOrder(result);
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
  if (!slice.streaming && !force) return;

  const commands = getAgentCommands(providerId);
  const threadId = slice.thread.id;
  const useOpencodeStreaming =
    providerId === "opencode" && slice.streaming;
  const useCodewhaleStreaming =
    providerId === "codewhale" && slice.streaming;
  const assistantEmpty = !lastAssistantMessage(slice.messages)?.content?.trim();
  const opencodeSseRecent =
    useOpencodeStreaming &&
    slice.streaming &&
    Date.now() - (lastOpencodeTextSseAt.get(providerId) ?? 0) <
      OPENCODE_SSE_FALLBACK_MS;
  const sseFresh =
    !forceFullHistory && useOpencodeStreaming && opencodeSseRecent;
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
    } else if (useCodewhaleStreaming) {
      const poll = await tauriInvoke<{
        messages: HistoryMessage[];
        busy: boolean;
        pending: { id: string; description: string } | null;
        turn_complete: boolean;
      }>("codewhale_poll_turn", { threadId });
      history = poll.messages;
      polledPending = poll.pending;
      polledTurnComplete = poll.turn_complete;
    } else {
      history = await tauriInvoke<HistoryMessage[]>(
        commands.loadThreadHistory,
        providerId === "opencode"
          ? opencodeSessionArgs(get, providerId, threadId)
          : { threadId },
      );
    }

    const latest = getProviderSlice(get, providerId);
    if (!latest.thread || latest.thread.id !== threadId) return;

    if (history) {
      const merged = mergeServerMessagesWithLocal(latest.messages, history, {
        pollOnly: isPollOnlyMessageProvider(providerId),
        limitedRemote: useOpencodeStreaming && !forceFullHistory,
      });
      const changed =
        merged.length !== latest.messages.length ||
        merged.some((msg, index) => {
          const prev = latest.messages[index];
          return (
            !prev ||
            prev.id !== msg.id ||
            prev.content !== msg.content ||
            prev.role !== msg.role ||
            prev.toolName !== msg.toolName
          );
        });
      if (changed) {
        patchProvider(set, providerId, {
          messages: merged,
          streaming: true,
        });
      } else if (
        import.meta.env.DEV &&
        providerId === "opencode" &&
        history.length > 0 &&
        assistantEmpty
      ) {
        console.warn("[chat sync] opencode poll returned data but merge unchanged", {
          localCount: latest.messages.length,
          remoteCount: history.length,
          remotePreview: history
            .filter((item) => item.role === "assistant")
            .slice(-1)[0]?.content?.slice(0, 80),
        });
      }
    }

    if (providerId === "opencode" || providerId === "codewhale") {
      if (polledPending?.id) {
        cancelScheduledCompleteTurn(providerId);
        patchProvider(set, providerId, {
          pendingApproval: polledPending,
          streaming: true,
        });
        ensureStreamingHistorySync(get, set, providerId);
        return;
      }
      const afterPendingCheck = getProviderSlice(get, providerId);
      if (afterPendingCheck.pendingApproval) {
        patchProvider(set, providerId, { pendingApproval: null });
      }

      if (polledTurnComplete && !getProviderSlice(get, providerId).pendingApproval) {
        await syncMessagesFromServerOnce(
          get,
          set,
          providerId,
          true,
          providerId === "opencode",
        );
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
        if (!slice.thread || !slice.streaming) {
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
    if (!slice.thread || !slice.streaming) {
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
  if (!slice.thread || !slice.streaming) return;
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
  lastOpencodeTextSseAt.delete(providerId);
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
  if (await runPendingApprovalCheck(get, set, providerId)) {
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
      patchProvider(set, resolvedId, { streaming: true });
      ensureStreamingHistorySync(get, set, resolvedId);
      return;
    }

    const before = getProviderSlice(get, resolvedId);
    if (before.thread && before.streaming) {
      await syncMessagesFromServer(get, set, resolvedId, true, true);
    }
    stopStreamingHistorySync(resolvedId);
    cancelScheduledCompleteTurn(resolvedId);
    const current = getProviderSlice(get, resolvedId);
    patchProvider(set, resolvedId, {
      streaming: false,
      messages: finalizeTurnMessages(current.messages),
      error: null,
      pendingApproval: null,
    });

    const updated = getProviderSlice(get, resolvedId);
    const workspace = updated.thread?.workspace ?? updated.chatWorkspace;
    if (workspace && updated.thread) {
      const title = sessionTitleFromMessages(
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
  if (!slice.streaming) return false;

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
        patchProvider(set, resolvedId, {
          pendingApproval: pending,
          streaming: true,
        });
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
    (providerId === "opencode" || providerId === "codewhale")
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
  } else if (providerId === "codewhale") {
    patch.dynamicModes = [...CODEWHALE_MODES];
    patch.mode = CODEWHALE_MODES.includes(
      slice.mode as (typeof CODEWHALE_MODES)[number],
    )
      ? slice.mode
      : "agent";
    if (commands.listProviderModels) {
      try {
        const catalog = await tauriInvoke<CodewhaleModelOption[]>(
          commands.listProviderModels,
        );
        if (catalog.length > 0) {
          const preferredModel = resolveProjectPreferredModel(
            useWorkspaceStore.getState().projectConfig,
            get().config,
          );
          const defaults = pickCodewhaleDefaults(catalog, preferredModel);
          patch.codewhaleModelCatalog = catalog;
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
  if (providerId === "opencode") {
    return tauriInvoke<RuntimeStatus>(commands.restartRuntime, {
      workspace: workspace ?? "",
    });
  }
  return tauriInvoke<RuntimeStatus>(commands.restartRuntime);
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
  if (providerId === "opencode" || providerId === "codewhale") {
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
  if ((providerId === "opencode" || providerId === "codewhale") && !resolvedWorkspace) return;

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
  providerId: "codewhale",
  providerStates: {
    codewhale: createProviderChatSlice("codewhale"),
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
    let providerId = config.app.default_provider || "codewhale";
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
      : config.app.default_provider || "codewhale";

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

    if ((providerId === "opencode" || providerId === "codewhale") && !resolvedWorkspace) {
      throw new Error(t("error.openProjectFirst"));
    }

    await runRuntimeAction(providerId, "restart", set, get, async () => {
      patchProvider(set, providerId, {
        streaming: false,
        pendingApproval: null,
      });

      const commands = getAgentCommands(providerId);
      const runtime =
        providerId === "opencode"
          ? await tauriInvoke<RuntimeStatus>(commands.restartRuntime, {
              workspace: resolvedWorkspace,
            })
          : await tauriInvoke<RuntimeStatus>(commands.restartRuntime);

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
    if (providerId !== "opencode" && providerId !== "codewhale") {
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
    if (id !== "opencode" && id !== "codewhale") {
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
      await ensureEventSubscription(providerId, threadId);
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
      let history: HistoryMessage[] = [];
      try {
        history = await tauriInvoke<HistoryMessage[]>(
          commands.loadThreadHistory,
          providerId === "opencode"
            ? opencodeSessionArgs(get, providerId, threadId, workspace)
            : { threadId },
        );
      } catch {
        const local = await loadLocalChatSession(
          workspace,
          providerId,
          threadId,
        );
        if (!local) throw new Error(t("error.sessionHistoryLoadFailed"));
        history = local.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          tool_name: msg.toolName,
          timestamp: msg.timestamp,
        }));
      }

      await ensureEventSubscription(providerId, threadId);

      const current = getProviderSlice(get, providerId);
      const messages = mapHistoryToChatMessages(history);
      patchProvider(set, providerId, {
        thread: {
          id: threadId,
          workspace,
          mode: current.mode,
          model: current.model || undefined,
        },
        chatWorkspace: workspace,
        messages,
      });

      if (providerId === "opencode" && commands.isSessionBusy) {
        try {
          const busy = await tauriInvoke<boolean>(commands.isSessionBusy, {
            ...opencodeSessionArgs(get, providerId, threadId, workspace),
          });
          if (busy) {
            patchProvider(set, providerId, { streaming: true });
            startStreamingHistorySync(get, set, providerId);
          }
        } catch {
          // ignore
        }
      }

      await rememberActiveSession(providerId, workspace, threadId);
      const title = sessionTitleFromMessages(messages, threadId);
      await persistLocalChatSession({
        workspace,
        providerId,
        sessionId: threadId,
        title,
        mode: current.mode,
        model: current.model,
        messages,
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
      await get().refreshPendingApproval();
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
      ...(providerId === "codewhale"
        ? { model: current.model }
        : { title: t("chat.newSessionTitle") }),
    });

    await ensureEventSubscription(providerId, created.id);
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
    const slice = getProviderSlice(get, providerId);
    patchProvider(set, providerId, { mode });
    if (slice.thread && providerId === "codewhale") {
      const commands = getAgentCommands(providerId);
      await tauriInvoke(commands.setThreadMode, {
        threadId: slice.thread.id,
        mode,
        model: getProviderSlice(get, providerId).model,
      });
    }
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
    lastOpencodeTextSseAt.delete(providerId);
    const slice = getProviderSlice(get, providerId);
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const assistantId = uid();

    resetTurnCompleteStreak(providerId);
    patchProvider(set, providerId, {
      messages: [
        ...slice.messages,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        },
      ],
      streaming: true,
      error: null,
    });

    const current = getProviderSlice(get, providerId);
    if (!current.thread) {
      patchProvider(set, providerId, {
        streaming: false,
        error: t("error.noSessionThread"),
      });
      return;
    }

    startStreamingHistorySync(get, set, providerId);
    void saveProviderChatLocally(get, providerId).catch(() => undefined);

    const commands = getAgentCommands(providerId);
    try {
      await ensureEventSubscription(providerId, current.thread.id);

      if (providerId === "opencode") {
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
        });
      } else {
        await tauriInvoke(commands.sendTurn, {
          threadId: current.thread.id,
          message: trimmed,
        });
      }

      if (providerId === "opencode" || providerId === "codewhale") {
        window.setTimeout(() => {
          get().refreshPendingApproval().catch(() => undefined);
        }, 400);
      }
    } catch (e) {
      stopStreamingHistorySync(providerId);
      patchProvider(set, providerId, {
        streaming: false,
        error: String(e),
        runtime: { running: false, owned: current.runtime.owned },
      });
    }
  },

  cancelGeneration: async () => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.streaming || !slice.thread) return;

    const threadId = slice.thread.id;
    const pendingId = slice.pendingApproval?.id;
    const commands = getAgentCommands(providerId);

    stopStreamingHistorySync(providerId);
    cancelScheduledCompleteTurn(providerId);
    patchProvider(set, providerId, {
      streaming: false,
      pendingApproval: null,
      error: null,
    });

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

    await syncMessagesFromServer(get, set, providerId, true);
    const current = getProviderSlice(get, providerId);
    patchProvider(set, providerId, {
      messages: finalizeTurnMessages(current.messages),
      streaming: false,
      pendingApproval: null,
    });
    await saveProviderChatLocally(get, providerId).catch(() => undefined);
  },

  refreshPendingApproval: async () => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.thread || !slice.streaming) return;

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
        patchProvider(set, providerId, {
          pendingApproval: pending,
          streaming: true,
        });
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

          if (mapped.type === "text_delta") {
            markOpencodeSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              const lastUserText = lastUserMessageText(messages);
              const targetIndex = findAssistantTextTargetIndex(messages);
              if (targetIndex >= 0) {
                messages[targetIndex] = {
                  ...messages[targetIndex],
                  content: mergeAssistantText(
                    messages[targetIndex].content,
                    mapped.content,
                    lastUserText,
                  ),
                };
                return { messages, streaming: true };
              }

              const content = mergeAssistantText("", mapped.content, lastUserText);
              if (content) {
                messages.push({
                  id: uid(),
                  role: "assistant",
                  content,
                  timestamp: Date.now(),
                });
              }
              return { messages, streaming: true };
            });
            ensureStreamingHistorySync(get, set, resolvedId);
          } else if (mapped.type === "text_snapshot") {
            markOpencodeSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              const lastUserText = lastUserMessageText(messages);
              if (shouldSkipAssistantSnapshot(mapped.content, lastUserText)) {
                return { messages, streaming: true };
              }
              const targetIndex = findAssistantTextTargetIndex(messages);
              if (targetIndex >= 0) {
                const current = messages[targetIndex].content;
                if (
                  current === mapped.content ||
                  current.trim() === mapped.content.trim()
                ) {
                  return { messages, streaming: true };
                }
                messages[targetIndex] = {
                  ...messages[targetIndex],
                  content:
                    mapped.content.startsWith(current) || !current.trim()
                      ? mapped.content
                      : mergeAssistantText(
                          current,
                          mapped.content,
                          lastUserText,
                        ),
                };
                return { messages, streaming: true };
              }

              messages.push({
                id: uid(),
                role: "assistant",
                content: mapped.content,
                timestamp: Date.now(),
              });
              return { messages, streaming: true };
            });
          } else if (mapped.type === "reasoning_delta") {
            markOpencodeSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              const targetIndex = findAssistantTextTargetIndex(messages);
              if (targetIndex >= 0) {
                messages[targetIndex] = {
                  ...messages[targetIndex],
                  content: mergeReasoningText(
                    messages[targetIndex].content,
                    mapped.content,
                  ),
                };
                return { messages, streaming: true };
              }

              messages.push({
                id: uid(),
                role: "assistant",
                content: mergeReasoningText("", mapped.content),
                timestamp: Date.now(),
              });
              return { messages, streaming: true };
            });
          } else if (mapped.type === "reasoning_snapshot") {
            markOpencodeSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              const targetIndex = findAssistantTextTargetIndex(messages);
              const block = mapped.content.trim();
              if (!block) {
                return { messages, streaming: true };
              }
              if (targetIndex >= 0) {
                messages[targetIndex] = {
                  ...messages[targetIndex],
                  content: mergeReasoningText(
                    messages[targetIndex].content,
                    block,
                  ),
                };
                return { messages, streaming: true };
              }

              messages.push({
                id: uid(),
                role: "assistant",
                content: mergeReasoningText("", block),
                timestamp: Date.now(),
              });
              return { messages, streaming: true };
            });
          } else if (mapped.type === "tool_call") {
            if (!isMeaningfulToolArgs(mapped.args, mapped.name)) {
              return;
            }

            markOpencodeSseActivity(resolvedId);
            cancelScheduledCompleteTurn(resolvedId);
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              const toolContent =
                typeof mapped.args === "string"
                  ? mapped.args
                  : JSON.stringify(mapped.args, null, 2);
              const toolId = mapped.partId || uid();
              const existingIndex = mapped.partId
                ? messages.findIndex(
                    (msg) => msg.role === "tool" && msg.id === mapped.partId,
                  )
                : -1;

              if (existingIndex >= 0) {
                messages[existingIndex] = {
                  ...messages[existingIndex],
                  content: toolContent,
                  toolName: mapped.name,
                };
                return { messages, streaming: true };
              }

              const insertAt = findToolInsertIndex(messages, mapped.name);
              const insertedBeforeEmptyAssistant =
                insertAt < messages.length &&
                messages[insertAt]?.role === "assistant" &&
                !messages[insertAt].content.trim();

              messages.splice(insertAt, 0, {
                id: toolId,
                role: "tool",
                content: toolContent,
                toolName: mapped.name,
                timestamp: Date.now(),
              });

              if (!insertedBeforeEmptyAssistant) {
                ensureAssistantAfterTools(messages);
              }

              return { messages, streaming: true };
            });
          } else if (mapped.type === "file_change") {
            const workspace = useWorkspaceStore.getState();
            if (mapped.path) {
              workspace.reloadOpenFilesIfClean([mapped.path]);
            }
            workspace.bumpExplorerRefresh();
          }

          if (mapped.type === "approval_required") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!activeSlice.streaming) {
              return;
            }
            cancelScheduledCompleteTurn(resolvedId);
            patchProvider(set, resolvedId, {
              pendingApproval: {
                id: mapped.id,
                description: mapped.description,
              },
              streaming: true,
            });
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
            patchProvider(set, resolvedId, {
              pendingApproval: null,
              streaming: true,
            });
          }

          if (mapped.type === "session_busy") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!activeSlice.streaming) return;
            cancelScheduledCompleteTurn(resolvedId);
            patchProvider(set, resolvedId, { streaming: true });
            ensureStreamingHistorySync(get, set, resolvedId);
          }

          if (mapped.type === "session_idle") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!activeSlice.streaming) return;
            if (resolvedId === "opencode") {
              lastOpencodeTextSseAt.delete(resolvedId);
              void (async () => {
                await syncMessagesFromServerOnce(
                  get,
                  set,
                  resolvedId,
                  true,
                  true,
                );
                await verifyAndCompleteTurn(get, set, resolvedId);
              })();
              return;
            }
            ensureStreamingHistorySync(get, set, resolvedId);
          }

          if (mapped.type === "turn_completed") {
            const activeSlice = getProviderSlice(get, resolvedId);
            if (!activeSlice.streaming) return;
            void (async () => {
              await syncMessagesFromServerOnce(
                get,
                set,
                resolvedId,
                true,
                resolvedId === "opencode",
              );
              await verifyAndCompleteTurn(get, set, resolvedId);
            })();
          }

          if (mapped.type === "turn_aborted") {
            cancelScheduledCompleteTurn(resolvedId);
            void completeTurnForProvider(get, set, resolvedId);
          }

          if (mapped.type === "turn_error") {
            if (isUserCancellation(mapped.message)) {
              cancelScheduledCompleteTurn(resolvedId);
              void completeTurnForProvider(get, set, resolvedId);
              return;
            }
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
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
              return {
                messages,
                streaming: false,
                error: mapped.message,
              };
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
          lastOpencodeTextSseAt.delete(resolvedId);
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
        return {
          streaming: slice.streaming,
          pendingApproval: slice.pendingApproval,
          busy: poll.busy,
          turnComplete: poll.turn_complete,
          pending: poll.pending ?? pending,
          messageCount: slice.messages.length,
          polledMessages: poll.messages.length,
          mergedCount: mergeServerMessagesWithLocal(
            slice.messages,
            poll.messages,
            { pollOnly: true, limitedRemote: slice.streaming },
          ).length,
          mergedAssistantPreview: mergeServerMessagesWithLocal(
            slice.messages,
            poll.messages,
            { pollOnly: true, limitedRemote: slice.streaming },
          )
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
  return useChatStore(
    useShallow((state) => {
      const slice =
        state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId);
      return {
        config: state.config,
        providerId: state.providerId,
        initialized: state.initialized,
        ...slice,
      };
    }),
  );
}
