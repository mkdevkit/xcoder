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
import { mapHistoryToChatMessages } from "../utils/chatHistory";
import { translate } from "../i18n/locales";
import { useSettingsStore } from "./settings";
import { useWorkspaceStore } from "./workspace";
import { formatToolContent } from "../utils/toolMessage";
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
  approve: (allow: boolean) => Promise<void>;
  refreshPendingApproval: () => Promise<void>;
  setupEventListener: () => Promise<() => void>;
  getActiveProvider: () => ProviderConfig | null;
  getActiveSlice: () => ProviderChatSlice;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    await useChatStore.getState().loadThreads(workspace, providerId);
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
  return slice.chatWorkspace ?? slice.thread?.workspace ?? undefined;
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
    if (slice.thread?.id === threadId) return;
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
            ? { sessionId: threadId }
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

      try {
        await tauriInvoke(commands.subscribeEvents, { threadId });
      } catch {
        // local-only session
      }

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

    await tauriInvoke(commands.subscribeEvents, { threadId: created.id });
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
    try {
      await tauriInvoke(
        commands.deleteThread,
        providerId === "opencode"
          ? { sessionId: threadId }
          : { threadId },
      );
    } catch (e) {
      patchProvider(set, providerId, { error: String(e) });
      throw e;
    }

    if (readSavedThreadId(providerId, workspace) === threadId) {
      await clearRememberedSession(providerId, workspace);
    }
    await deleteLocalChatSession(workspace, providerId, threadId);

    const wasCurrent = slice.thread?.id === threadId;
    await get().loadThreads(workspace, providerId);

    if (!wasCurrent) return;

    patchProvider(set, providerId, {
      thread: null,
      messages: [],
      streaming: false,
      pendingApproval: null,
    });
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
      if (providerId === "opencode") {
        await tauriInvoke(commands.sendTurn, {
          threadId: current.thread.id,
          message: trimmed,
          mode: current.mode,
          model: current.model || null,
        });
      } else {
        await tauriInvoke(commands.sendTurn, {
          threadId: current.thread.id,
          message: trimmed,
        });
      }
    } catch (e) {
      patchProvider(set, providerId, {
        streaming: false,
        error: String(e),
        runtime: { running: false, owned: current.runtime.owned },
      });
    }
  },

  refreshPendingApproval: async () => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.thread) return;

    const commands = getAgentCommands(providerId);
    if (!commands.getPendingApproval) return;

    try {
      const pending = await tauriInvoke<{
        id: string;
        description: string;
      } | null>(
        commands.getPendingApproval,
        providerId === "opencode"
          ? { sessionId: slice.thread.id }
          : { threadId: slice.thread.id },
      );
      patchProvider(set, providerId, {
        pendingApproval: pending ?? null,
      });
    } catch {
      // ignore
    }
  },

  approve: async (allow) => {
    const { providerId } = get();
    const slice = getProviderSlice(get, providerId);
    if (!slice.pendingApproval || !slice.thread) return;

    const commands = getAgentCommands(providerId);
    try {
      if (providerId === "opencode") {
        await tauriInvoke(commands.approve, {
          threadId: slice.thread.id,
          approvalId: slice.pendingApproval.id,
          allow,
        });
      } else {
        await tauriInvoke(commands.approve, {
          approvalId: slice.pendingApproval.id,
          allow,
        });
      }
      patchProvider(set, providerId, {
        pendingApproval: null,
        error: null,
      });
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

          if (mapped.type === "text_delta") {
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              for (let i = messages.length - 1; i >= 0; i -= 1) {
                if (messages[i].role === "assistant") {
                  messages[i] = {
                    ...messages[i],
                    content: messages[i].content + mapped.content,
                  };
                  break;
                }
              }
              return { messages };
            });
          }

          if (mapped.type === "reasoning_delta") {
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              for (let i = messages.length - 1; i >= 0; i -= 1) {
                if (messages[i].role === "assistant") {
                  const prefix = messages[i].content ? "\n\n" : "";
                  messages[i] = {
                    ...messages[i],
                    content: `${messages[i].content}${prefix}> ${mapped.content}`,
                  };
                  break;
                }
              }
              return { messages };
            });
          }

          if (mapped.type === "approval_required") {
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
                      ? { sessionId: slice.thread.id }
                      : { threadId: slice.thread.id },
                  );
                  if (pending) {
                    patchProvider(set, resolvedId, { pendingApproval: pending });
                  } else if (mapped.id) {
                    patchProvider(set, resolvedId, {
                      pendingApproval: {
                        id: mapped.id,
                        description: mapped.description,
                      },
                    });
                  }
                } catch {
                  if (mapped.id) {
                    patchProvider(set, resolvedId, {
                      pendingApproval: {
                        id: mapped.id,
                        description: mapped.description,
                      },
                    });
                  }
                }
              };
              refresh().catch(() => undefined);
              return;
            }
            patchProvider(set, resolvedId, {
              pendingApproval: {
                id: mapped.id,
                description: mapped.description,
              },
            });
          }

          if (mapped.type === "approval_resolved") {
            patchProvider(set, resolvedId, { pendingApproval: null });
          }

          if (mapped.type === "tool_call") {
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              let insertAt = messages.length;
              for (let i = messages.length - 1; i >= 0; i -= 1) {
                if (messages[i].role === "assistant") {
                  insertAt = i + 1;
                  break;
                }
              }
              messages.splice(
                insertAt,
                0,
                {
                  id: uid(),
                  role: "tool",
                  content: formatToolContent(mapped.args),
                  toolName: mapped.name,
                  timestamp: Date.now(),
                },
                {
                  id: uid(),
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                },
              );
              return { messages };
            });
          }

          if (mapped.type === "turn_completed") {
            applyToProvider(resolvedId, (slice) => {
              const messages = [...slice.messages];
              while (messages.length > 0) {
                const last = messages[messages.length - 1];
                if (last.role === "assistant" && !last.content.trim()) {
                  messages.pop();
                } else {
                  break;
                }
              }
              return { streaming: false, messages };
            });

            const slice = getProviderSlice(get, resolvedId);
            const workspace = slice.thread?.workspace ?? slice.chatWorkspace;
            if (workspace && slice.thread) {
              const title = sessionTitleFromMessages(
                slice.messages,
                slice.thread.id,
              );
              persistLocalChatSession({
                workspace,
                providerId: resolvedId,
                sessionId: slice.thread.id,
                title,
                mode: slice.mode,
                model: slice.model,
                messages: slice.messages,
              }).catch(() => undefined);
              const commands = getAgentCommands(resolvedId);
              if (
                commands.updateThreadTitle &&
                !isGenericSessionTitle(title)
              ) {
                tauriInvoke(commands.updateThreadTitle, {
                  sessionId: slice.thread.id,
                  title,
                }).catch(() => undefined);
              }
              get().loadThreads(workspace, resolvedId).catch(() => undefined);
            }
          }

          if (mapped.type === "turn_error") {
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
      const slice = getProviderSlice(get, resolvedId);
      patchProvider(set, resolvedId, {
        error: message,
        streaming: false,
        pendingApproval: null,
        runtime: { running: false, owned: slice.runtime.owned ?? false },
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
