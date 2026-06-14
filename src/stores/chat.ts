import { create } from "zustand";
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
} from "../types/agent";
import { mapRuntimeEvent } from "../types/agent";
import { mapHistoryToChatMessages } from "../utils/chatHistory";
import { translate } from "../i18n/locales";
import { useSettingsStore } from "./settings";
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

interface ChatState {
  config: AppConfig | null;
  providerId: string;
  runtime: RuntimeStatus;
  thread: ThreadInfo | null;
  chatWorkspace: string | null;
  threads: ThreadSummary[];
  threadsLoading: boolean;
  mode: string;
  model: string;
  dynamicModes: string[];
  messages: ChatMessage[];
  streaming: boolean;
  pendingApproval: { id: string; description: string } | null;
  error: string | null;
  initialized: boolean;

  loadConfig: () => Promise<void>;
  setProvider: (providerId: string) => Promise<void>;
  connectRuntime: (workspace?: string) => Promise<void>;
  disconnectRuntime: () => Promise<void>;
  loadThreads: (workspace: string) => Promise<void>;
  selectThread: (threadId: string, workspace: string) => Promise<void>;
  createNewThread: (workspace: string) => Promise<void>;
  deleteThread: (threadId: string, workspace: string) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  setModel: (model: string) => void;
  sendMessage: (text: string) => Promise<void>;
  approve: (allow: boolean) => Promise<void>;
  refreshPendingApproval: () => Promise<void>;
  setupEventListener: () => Promise<() => void>;
  getActiveProvider: () => ProviderConfig | null;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyProviderDefaults(
  provider: ProviderConfig | undefined,
  providerId: string,
) {
  const ui = provider?.ui_options;
  return {
    providerId,
    mode: ui?.default_mode ?? "agent",
    model: ui?.default_model ?? "",
    dynamicModes: ui?.modes ?? [],
  };
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

async function saveCurrentChatLocally(get: () => ChatState, workspace?: string) {
  const { thread, messages, mode, model, providerId, chatWorkspace } = get();
  const resolvedWorkspace = workspace ?? thread?.workspace ?? chatWorkspace;
  if (!thread || !resolvedWorkspace) return;

  await persistLocalChatSession({
    workspace: resolvedWorkspace,
    providerId,
    sessionId: thread.id,
    title: sessionTitleFromMessages(messages, thread.id),
    mode,
    model,
    messages,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  config: null,
  providerId: "codewhale",
  runtime: { running: false },
  thread: null,
  chatWorkspace: null,
  threads: [],
  threadsLoading: false,
  mode: "agent",
  model: "",
  dynamicModes: [],
  messages: [],
  streaming: false,
  pendingApproval: null,
  error: null,
  initialized: false,

  getActiveProvider: () => {
    const { config, providerId } = get();
    return config?.providers.find((p) => p.id === providerId) ?? null;
  },

  loadConfig: async () => {
    const config = await tauriInvoke<AppConfig>("load_config");
    const providerId = config.app.default_provider || "codewhale";
    const provider = config.providers.find((p) => p.id === providerId);
    set({
      config,
      initialized: true,
      ...applyProviderDefaults(provider, providerId),
    });
  },

  setProvider: async (providerId) => {
    const { runtime, disconnectRuntime, config } = get();
    if (runtime.running) {
      await disconnectRuntime();
    }

    const provider = config?.providers.find((p) => p.id === providerId);
    set({
      ...applyProviderDefaults(provider, providerId),
      thread: null,
      threads: [],
      chatWorkspace: null,
      messages: [],
      streaming: false,
      pendingApproval: null,
      error: null,
      runtime: { running: false },
    });
  },

  connectRuntime: async (workspace) => {
    const { providerId } = get();
    const commands = getAgentCommands(providerId);
    set({ error: null });

    try {
      await tauriInvoke(commands.doctor);
      if (providerId === "opencode") {
        if (!workspace) {
          throw new Error("请先打开工程目录");
        }
        const runtime = await tauriInvoke<RuntimeStatus>(commands.startRuntime, {
          workspace,
        });
        set({ runtime, chatWorkspace: workspace });

        if (commands.listAgents) {
          try {
            const agents = await tauriInvoke<string[]>(commands.listAgents);
            if (agents.length > 0) {
              set((state) => ({
                dynamicModes: agents,
                mode: agents.includes(state.mode) ? state.mode : agents[0],
              }));
            }
          } catch {
            // ignore dynamic agent fetch failures
          }
        }
        await get().loadThreads(workspace);
        return;
      }

      const runtime = await tauriInvoke<RuntimeStatus>(commands.startRuntime);
      set({
        runtime,
        ...(workspace ? { chatWorkspace: workspace } : {}),
      });
      if (workspace) {
        await get().loadThreads(workspace);
      }
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  disconnectRuntime: async () => {
    const { providerId } = get();
    const commands = getAgentCommands(providerId);
    await tauriInvoke(commands.stopRuntime);
    set({
      runtime: { running: false },
      thread: null,
      chatWorkspace: null,
      threads: [],
      messages: [],
      streaming: false,
      pendingApproval: null,
      error: null,
    });
  },

  loadThreads: async (workspace) => {
    const { providerId, runtime } = get();
    if (!runtime.running) return;

    const commands = getAgentCommands(providerId);
    set({ threadsLoading: true, error: null });
    try {
      const [remote, local] = await Promise.all([
        tauriInvoke<ThreadSummary[]>(commands.listThreads, {
          workspace,
          limit: 50,
        }),
        listLocalChatSessions(workspace, providerId),
      ]);
      set({
        threads: mergeThreadLists(remote, local),
        threadsLoading: false,
      });
    } catch (e) {
      set({ threadsLoading: false, error: String(e) });
      throw e;
    }
  },

  selectThread: async (threadId, workspace) => {
    const { thread, providerId, runtime } = get();
    if (thread?.id === threadId) return;
    if (!runtime.running) {
      await get().connectRuntime(workspace);
    }

    const commands = getAgentCommands(providerId);
    set({ error: null, streaming: false, pendingApproval: null });

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
        // Local-only restored sessions may not exist on the runtime anymore.
      }

      const messages = mapHistoryToChatMessages(history);
      set({
        thread: {
          id: threadId,
          workspace,
          mode: get().mode,
          model: get().model || undefined,
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
        mode: get().mode,
        model: get().model,
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
      set({ error: String(e) });
      throw e;
    }
  },

  createNewThread: async (workspace) => {
    const { mode, model, providerId, runtime } = get();
    if (!runtime.running) {
      await get().connectRuntime(workspace);
    }

    const commands = getAgentCommands(providerId);
    const created = await tauriInvoke<ThreadInfo>(commands.createThread, {
      workspace,
      mode,
      model: providerId === "codewhale" ? model : undefined,
    });

    await tauriInvoke(commands.subscribeEvents, { threadId: created.id });
    set({
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
      mode,
      model,
      messages: [],
    });
    await get().loadThreads(workspace);
  },

  deleteThread: async (threadId, workspace) => {
    const { providerId, thread } = get();
    const current = get().threads.find((item) => item.id === threadId);
    const label = current?.title || current?.preview || translate(useSettingsStore.getState().locale, "chat.sessionFallback");
    const confirmed = window.confirm(
      translate(useSettingsStore.getState().locale, "chat.deleteConfirm", { label }),
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
      set({ error: String(e) });
      throw e;
    }

    if (readSavedThreadId(providerId, workspace) === threadId) {
      await clearRememberedSession(providerId, workspace);
    }
    await deleteLocalChatSession(workspace, providerId, threadId);

    const wasCurrent = thread?.id === threadId;
    await get().loadThreads(workspace);

    if (!wasCurrent) return;

    set({ thread: null, messages: [], streaming: false, pendingApproval: null });
  },

  setMode: async (mode) => {
    const { thread, providerId } = get();
    set({ mode });
    if (thread && providerId === "codewhale") {
      const commands = getAgentCommands(providerId);
      await tauriInvoke(commands.setThreadMode, {
        threadId: thread.id,
        mode,
        model: get().model,
      });
    }
  },

  setModel: (model) => set({ model }),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const assistantId = uid();
    set((state) => ({
      messages: [
        ...state.messages,
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
    }));

    const { thread, mode, model, providerId } = get();
    if (!thread) {
      set({ streaming: false, error: "未创建会话线程" });
      return;
    }

    await saveCurrentChatLocally(get).catch(() => undefined);

    const commands = getAgentCommands(providerId);
    try {
      if (providerId === "opencode") {
        await tauriInvoke(commands.sendTurn, {
          threadId: thread.id,
          message: trimmed,
          mode,
          model: model || null,
        });
      } else {
        await tauriInvoke(commands.sendTurn, {
          threadId: thread.id,
          message: trimmed,
        });
      }
    } catch (e) {
      set({ streaming: false, error: String(e) });
    }
  },

  refreshPendingApproval: async () => {
    const { thread, providerId } = get();
    if (!thread) return;

    const commands = getAgentCommands(providerId);
    if (!commands.getPendingApproval) return;

    try {
      const pending = await tauriInvoke<{
        id: string;
        description: string;
      } | null>(
        commands.getPendingApproval,
        providerId === "opencode"
          ? { sessionId: thread.id }
          : { threadId: thread.id },
      );
      set({ pendingApproval: pending ?? null });
    } catch {
      // ignore fetch failures; stale UI is cleared on approve errors
    }
  },

  approve: async (allow) => {
    const { pendingApproval, thread, providerId } = get();
    if (!pendingApproval || !thread) return;

    const commands = getAgentCommands(providerId);
    try {
      if (providerId === "opencode") {
        await tauriInvoke(commands.approve, {
          threadId: thread.id,
          approvalId: pendingApproval.id,
          allow,
        });
      } else {
        await tauriInvoke(commands.approve, {
          approvalId: pendingApproval.id,
          allow,
        });
      }
      set({ pendingApproval: null, error: null });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("404") || msg.includes("no pending approval")) {
        set({
          pendingApproval: null,
          error: "该审批已过期或已处理，请重新发起操作。",
        });
      } else {
        set({ error: msg });
      }
    }
  },

  setupEventListener: async () => {
    if (!isTauri()) {
      return () => {};
    }

    const unlistenEvent = await listen<Record<string, unknown>>(
      "agent-event",
      (event) => {
        try {
          const mapped = mapRuntimeEvent(event.payload);
          if (!mapped) return;

        if (mapped.type === "text_delta") {
          set((state) => {
            const messages = [...state.messages];
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
          set((state) => {
            const messages = [...state.messages];
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
          const { providerId } = get();
          const commands = getAgentCommands(providerId);
          if (commands.getPendingApproval) {
            get()
              .refreshPendingApproval()
              .then(() => {
                if (!get().pendingApproval && mapped.id) {
                  set({
                    pendingApproval: {
                      id: mapped.id,
                      description: mapped.description,
                    },
                  });
                }
              })
              .catch(() => undefined);
            return;
          }
          set({
            pendingApproval: {
              id: mapped.id,
              description: mapped.description,
            },
          });
        }

        if (mapped.type === "approval_resolved") {
          set({ pendingApproval: null });
        }

        if (mapped.type === "tool_call") {
          set((state) => {
            const messages = [...state.messages];
            let insertAt = messages.length;
            for (let i = messages.length - 1; i >= 0; i -= 1) {
              if (messages[i].role === "assistant") {
                insertAt = i + 1;
                break;
              }
            }

            messages.splice(insertAt, 0, {
              id: uid(),
              role: "tool",
              content: formatToolContent(mapped.args),
              toolName: mapped.name,
              timestamp: Date.now(),
            }, {
              id: uid(),
              role: "assistant",
              content: "",
              timestamp: Date.now(),
            });

            return { messages };
          });
        }

        if (mapped.type === "turn_completed") {
          set((state) => {
            const messages = [...state.messages];
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
          const { thread, messages, mode, model, providerId, chatWorkspace } =
            get();
          const workspace = thread?.workspace ?? chatWorkspace;
          if (workspace && thread) {
            const title = sessionTitleFromMessages(messages, thread.id);
            persistLocalChatSession({
              workspace,
              providerId,
              sessionId: thread.id,
              title,
              mode,
              model,
              messages,
            }).catch(() => undefined);
            const commands = getAgentCommands(providerId);
            if (
              commands.updateThreadTitle &&
              !isGenericSessionTitle(title)
            ) {
              tauriInvoke(commands.updateThreadTitle, {
                sessionId: thread.id,
                title,
              }).catch(() => undefined);
            }
            get().loadThreads(workspace).catch(() => undefined);
          }
        }

        if (mapped.type === "turn_error") {
          set((state) => {
            const messages = [...state.messages];
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
            return { messages, streaming: false, error: mapped.message };
          });
          saveCurrentChatLocally(get).catch(() => undefined);
        }
        } catch (e) {
          console.error("agent-event handler failed:", e);
          set({ streaming: false, error: String(e) });
        }
      },
    );

    const unlistenError = await listen<string>("agent-error", (event) => {
      set({ error: event.payload, streaming: false });
    });

    return () => {
      unlistenEvent();
      unlistenError();
    };
  },
}));
