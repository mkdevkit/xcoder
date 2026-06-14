import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { isTauri, tauriInvoke } from "../utils/tauri";
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
import { useSettingsStore } from "./settings";
import { useWorkspaceStore } from "./workspace";
import { workspacesMatch } from "../utils/path";
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
  pickOpencodeDefaults,
  resolveOpencodeVendor,
} from "../utils/opencodeModels";
import {
  CODEWHALE_MODES,
  pickCodewhaleDefaults,
} from "../utils/codewhaleModels";
import {
  createProviderChatSlice,
  ensureProviderSlice,
  type ProviderChatSlice,
} from "./providerChatSlice";

interface ChatState {
  config: AppConfig | null;
  providerId: string;
  providerStates: Record<string, ProviderChatSlice>;
  initialized: boolean;

  loadConfig: () => Promise<void>;
  setProvider: (providerId: string) => void;
  onProjectOpened: (workspace: string) => Promise<void>;
  connectRuntime: (workspace?: string) => Promise<void>;
  disconnectRuntime: () => Promise<void>;
  restartRuntime: (workspace?: string) => Promise<void>;
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

function findAssistantTextTargetIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return -1;
    if (messages[i].role === "assistant") {
      if (!messages[i].content.trim()) {
        for (let j = i - 1; j >= 0; j -= 1) {
          if (messages[j].role === "user") break;
          if (messages[j].role === "assistant" && messages[j].content.trim()) {
            return i;
          }
          if (messages[j].role === "tool") continue;
        }
      }
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
  return lastAssistant + 1;
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

const historySyncTimers = new Map<string, ReturnType<typeof setInterval>>();
const historySyncChains = new Map<string, Promise<void>>();
const historySyncSnapshots = new Map<
  string,
  { count: number; textLen: number }
>();

function historySnapshot(history: HistoryMessage[]) {
  return {
    count: history.length,
    textLen: history.reduce((sum, item) => sum + item.content.length, 0),
  };
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
  if (!isTauri() || isPollOnlyMessageProvider(providerId)) return;
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
) {
  const previous = historySyncChains.get(providerId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() =>
      syncMessagesFromServerOnce(get, set, providerId, force),
    );
  historySyncChains.set(providerId, current);
  try {
    await current;
  } finally {
    if (historySyncChains.get(providerId) === current) {
      historySyncChains.delete(providerId);
    }
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
) {
  const slice = getProviderSlice(get, providerId);
  if (!slice.thread) return;
  if (!slice.streaming && !force) return;

  const commands = getAgentCommands(providerId);
  const threadId = slice.thread.id;
  try {
    const history = await tauriInvoke<HistoryMessage[]>(
      commands.loadThreadHistory,
      providerId === "opencode"
        ? opencodeSessionArgs(get, providerId, threadId)
        : { threadId },
    );
    const latest = getProviderSlice(get, providerId);
    if (!latest.thread || latest.thread.id !== threadId) return;

    const merged = mergeServerMessagesWithLocal(latest.messages, history, {
      pollOnly: isPollOnlyMessageProvider(providerId),
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
    }

    const snapshot = historySnapshot(history);
    const previousSnapshot = historySyncSnapshots.get(providerId);
    historySyncSnapshots.set(providerId, snapshot);

    if (providerId === "opencode" && commands.getPendingApproval) {
      if (await runPendingApprovalCheck(get, set, providerId)) {
        cancelScheduledCompleteTurn(providerId);
        ensureStreamingHistorySync(get, set, providerId);
        return;
      }
    }

    const active = getProviderSlice(get, providerId);
    if (
      active.streaming &&
      providerId === "opencode" &&
      commands.isSessionBusy &&
      active.thread?.id === threadId
    ) {
      try {
        const busy = await tauriInvoke<boolean>(commands.isSessionBusy, {
          ...opencodeSessionArgs(get, providerId, threadId),
        });
        const historyStable =
          previousSnapshot !== undefined &&
          previousSnapshot.count === snapshot.count &&
          previousSnapshot.textLen === snapshot.textLen;
        if (!busy && historyStable) {
          scheduleCompleteTurn(get, set, providerId, 600);
        }
      } catch {
        // ignore
      }
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
  void syncMessagesFromServer(get, set, providerId, true);
  historySyncTimers.set(
    providerId,
    setInterval(() => {
      void syncMessagesFromServer(get, set, providerId, true);
    }, 1000),
  );
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
  if (historySyncTimers.has(providerId)) return;
  startStreamingHistorySync(get, set, providerId);
}

function stopStreamingHistorySync(providerId: string) {
  const timer = historySyncTimers.get(providerId);
  if (timer !== undefined) {
    clearInterval(timer);
    historySyncTimers.delete(providerId);
  }
  historySyncSnapshots.delete(providerId);
}

const completeTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelScheduledCompleteTurn(resolvedId: string) {
  const existing = completeTurnTimers.get(resolvedId);
  if (existing !== undefined) {
    clearTimeout(existing);
    completeTurnTimers.delete(resolvedId);
  }
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
  if (!options?.force && (await runPendingApprovalCheck(get, set, resolvedId))) {
    cancelScheduledCompleteTurn(resolvedId);
    patchProvider(set, resolvedId, { streaming: true });
    ensureStreamingHistorySync(get, set, resolvedId);
    return;
  }

  const before = getProviderSlice(get, resolvedId);
  if (before.thread && before.streaming) {
    await syncMessagesFromServer(get, set, resolvedId, true);
  }
  stopStreamingHistorySync(resolvedId);
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
  if (slice.pendingApproval) return true;

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
      if (pending) {
        cancelScheduledCompleteTurn(resolvedId);
        patchProvider(set, resolvedId, {
          pendingApproval: pending,
          streaming: true,
        });
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function scheduleCompleteTurn(
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((state: ChatState) => Partial<ChatState>),
  ) => void,
  resolvedId: string,
  delayMs: number,
) {
  cancelScheduledCompleteTurn(resolvedId);
  completeTurnTimers.set(
    resolvedId,
    setTimeout(() => {
      completeTurnTimers.delete(resolvedId);
      void (async () => {
        const slice = getProviderSlice(get, resolvedId);
        const last = slice.messages[slice.messages.length - 1];
        if (
          slice.streaming &&
          last?.role === "assistant" &&
          !last.content.trim()
        ) {
          scheduleCompleteTurn(get, set, resolvedId, 1500);
          patchProvider(set, resolvedId, { streaming: true });
          return;
        }

        const commands = getAgentCommands(resolvedId);
        if (commands.isSessionBusy && slice.thread) {
          try {
            const busy = await tauriInvoke<boolean>(commands.isSessionBusy, {
              ...opencodeSessionArgs(get, resolvedId, slice.thread.id),
            });
            if (busy) {
              scheduleCompleteTurn(get, set, resolvedId, 1500);
              patchProvider(set, resolvedId, { streaming: true });
              return;
            }
          } catch {
            // ignore
          }
        }
        if (await runPendingApprovalCheck(get, set, resolvedId)) return;
        await completeTurnForProvider(get, set, resolvedId);
      })();
    }, delayMs),
  );
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
          patch.mode = agents.includes(slice.mode) ? slice.mode : agents[0];
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
          const defaults = pickOpencodeDefaults(catalog.models, slice.model);
          patch.opencodeModelCatalog = catalog.models;
          patch.opencodeConnectedProviders = catalog.connectedProviderIds;
          if (slice.model) {
            patch.opencodeVendor = resolveOpencodeVendor(
              slice.model,
              slice.opencodeVendor || defaults.vendor,
            );
          } else {
            patch.opencodeVendor = defaults.vendor;
            patch.model = defaults.model;
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
        const [catalog, doctor] = await Promise.all([
          tauriInvoke<CodewhaleModelOption[]>(commands.listProviderModels),
          tauriInvoke<{ default_text_model?: string }>(commands.doctor),
        ]);
        if (catalog.length > 0) {
          const preferred = slice.model || doctor.default_text_model || "";
          const defaults = pickCodewhaleDefaults(catalog, preferred);
          patch.codewhaleModelCatalog = catalog;
          if (!slice.model) patch.model = defaults.model;
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
      throw new Error("请先打开工程目录");
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
  if (providerId === "opencode" && !resolvedWorkspace) return;

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
    const providerId = config.app.default_provider || "codewhale";
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

  onProjectOpened: async (workspace) => {
    const { config } = get();
    if (!config) return;
    for (const provider of config.providers) {
      try {
        const runtime = await startProviderRuntime(
          provider.id,
          workspace,
          false,
        );
        if (!runtime.running) continue;
        await hydrateProviderAfterConnect(
          provider.id,
          workspace,
          runtime,
          set,
          get,
        );
      } catch {
        // service not running
      }
    }
  },

  connectRuntime: async (workspace) => {
    const { providerId } = get();
    set((state) => ({
      providerStates: ensureProviderSlice(state.providerStates, providerId),
    }));
    patchProvider(set, providerId, { error: null });

    try {
      const runtime = await startProviderRuntime(providerId, workspace, true);
      if (!runtime.running) {
        throw new Error("AI 服务未能启动");
      }
      await hydrateProviderAfterConnect(
        providerId,
        workspace,
        runtime,
        set,
        get,
      );
    } catch (e) {
      patchProvider(set, providerId, { error: String(e) });
      throw e;
    }
  },

  disconnectRuntime: async () => {
    const { providerId } = get();
    const commands = getAgentCommands(providerId);
    await tauriInvoke(commands.stopRuntime);
    patchProvider(set, providerId, {
      runtime: { running: false, owned: false },
      connectedIntent: false,
      streaming: false,
      pendingApproval: null,
      error: null,
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

    if (providerId === "opencode" && !resolvedWorkspace) {
      throw new Error("请先打开工程目录");
    }

    patchProvider(set, providerId, {
      error: null,
      streaming: false,
      pendingApproval: null,
    });

    try {
      const commands = getAgentCommands(providerId);
      const runtime =
        providerId === "opencode"
          ? await tauriInvoke<RuntimeStatus>(commands.restartRuntime, {
              workspace: resolvedWorkspace,
            })
          : await tauriInvoke<RuntimeStatus>(commands.restartRuntime);

      if (!runtime.running) {
        throw new Error("AI 服务重启失败");
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
    } catch (e) {
      patchProvider(set, providerId, { error: String(e) });
      throw e;
    }
  },

  loadThreads: async (workspace, providerId) => {
    const id = providerId ?? get().providerId;
    const slice = getProviderSlice(get, id);
    if (!slice.runtime.running) return;

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
      if (!slice.runtime.running) {
        await get().connectRuntime(workspace);
      }
      await ensureEventSubscription(providerId, threadId);
      return;
    }
    if (!slice.runtime.running) {
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
        if (!local) throw new Error("无法加载该会话的历史记录");
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
    if (!slice.runtime.running) {
      await get().connectRuntime(workspace);
    }
    const current = getProviderSlice(get, providerId);
    const commands = getAgentCommands(providerId);
    const created = await tauriInvoke<ThreadInfo>(commands.createThread, {
      workspace,
      mode: current.mode,
      model: providerId === "codewhale" ? current.model : undefined,
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
      title: "新会话",
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
    const confirmed = window.confirm(
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
    const slice = getProviderSlice(get, providerId);
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const assistantId = uid();

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
        error: "未创建会话线程",
      });
      return;
    }

    await saveProviderChatLocally(get, providerId).catch(() => undefined);

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

      startStreamingHistorySync(get, set, providerId);

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
          error: "无法获取审批 ID，请稍后重试。",
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
          error: "该审批已过期或已处理，请重新发起操作。",
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
          if (isPollOnlyMessageProvider(resolvedId)) return;

          if (mapped.type === "text_delta") {
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
          } else if (mapped.type === "text_snapshot") {
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

              const last = messages[messages.length - 1];
              const hasTrailingEmptyAssistant =
                last?.role === "assistant" && !last.content.trim();

              messages.splice(insertAt, 0, {
                id: toolId,
                role: "tool",
                content: toolContent,
                toolName: mapped.name,
                timestamp: Date.now(),
              });

              if (!hasTrailingEmptyAssistant) {
                messages.push({
                  id: uid(),
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                });
              }

              return { messages, streaming: true };
            });
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
            cancelScheduledCompleteTurn(resolvedId);
            patchProvider(set, resolvedId, { streaming: true });
            ensureStreamingHistorySync(get, set, resolvedId);
          }

          if (mapped.type === "session_idle" || mapped.type === "turn_completed") {
            scheduleCompleteTurn(
              get,
              set,
              resolvedId,
              mapped.type === "session_idle" ? 400 : 1500,
            );
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
                    content: `${messages[i].content}${prefix}错误：${mapped.message}`,
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
      if (isPollOnlyMessageProvider(resolvedId)) return;
      const slice = getProviderSlice(get, resolvedId);
      if (
        message.includes("SSE stream error") ||
        message.includes("SSE connect failed")
      ) {
        if (slice.thread?.id) {
          void ensureEventSubscription(resolvedId, slice.thread.id);
        }
        return;
      }
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
