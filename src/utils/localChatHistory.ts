import { APP_LOCALES } from "../i18n/types";
import { translate } from "../i18n/locales";
import { useSettingsStore } from "../stores/settings";
import type { ChatMessage, ThreadSummary } from "../types/agent";
import { isTauri, tauriInvoke } from "./tauri";

export interface LocalSessionMeta {
  id: string;
  title: string;
  updated_at: string;
  markdown_file: string;
  data_file: string;
  preview?: string;
}

export interface LocalChatSession {
  id: string;
  title: string;
  mode?: string;
  model?: string;
  messages: ChatMessage[];
  updated_at: string;
}

import { isMeaningfulToolArgs, parseToolContent } from "./toolMessage";

function toHistoryMessages(messages: ChatMessage[]) {
  return messages
    .filter((msg) => {
      if (msg.role === "tool") {
        return isMeaningfulToolArgs(
          parseToolContent(msg.content),
          msg.toolName,
        );
      }
      return msg.content.trim().length > 0;
    })
    .map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tool_name: msg.toolName,
      timestamp: msg.timestamp,
    }));
}

export async function listLocalChatSessions(
  workspace: string,
  providerId: string,
): Promise<LocalSessionMeta[]> {
  if (!isTauri()) return [];
  try {
    return await tauriInvoke<LocalSessionMeta[]>("list_local_chat_sessions", {
      workspace,
      provider: providerId,
    });
  } catch {
    return [];
  }
}

export async function readLocalActiveSessionId(
  workspace: string,
  providerId: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await tauriInvoke<string | null>("get_local_active_session_id", {
      workspace,
      provider: providerId,
    });
  } catch {
    return null;
  }
}

export async function writeLocalActiveSessionId(
  workspace: string,
  providerId: string,
  sessionId: string | null,
) {
  if (!isTauri()) return;
  try {
    await tauriInvoke("set_local_active_session_id", {
      workspace,
      provider: providerId,
      sessionId,
    });
  } catch {
    // ignore storage failures
  }
}

export async function loadLocalChatSession(
  workspace: string,
  providerId: string,
  sessionId: string,
): Promise<LocalChatSession | null> {
  if (!isTauri()) return null;
  try {
    const session = await tauriInvoke<LocalChatSession | null>(
      "load_local_chat_session",
      {
        workspace,
        provider: providerId,
        sessionId,
      },
    );
    if (!session) return null;
    return {
      ...session,
      messages: session.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        toolName: (msg as { tool_name?: string }).tool_name,
      })),
    };
  } catch {
    return null;
  }
}

export async function persistLocalChatSession(options: {
  workspace: string;
  providerId: string;
  sessionId: string;
  title?: string;
  mode?: string;
  model?: string;
  messages: ChatMessage[];
  setActive?: boolean;
}) {
  if (!isTauri()) return;

  const {
    workspace,
    providerId,
    sessionId,
    title = "",
    mode,
    model,
    messages,
    setActive = true,
  } = options;

  try {
    await tauriInvoke("save_local_chat_history", {
      workspace,
      provider: providerId,
      sessionId,
      title,
      mode: mode ?? null,
      model: model ?? null,
      messages: toHistoryMessages(messages),
      updatedAt: new Date().toISOString(),
      setActive,
    });
  } catch (error) {
    console.error("Failed to persist local chat history:", error);
  }
}

export async function deleteLocalChatSession(
  workspace: string,
  providerId: string,
  sessionId: string,
) {
  if (!isTauri()) return;
  try {
    await tauriInvoke("delete_local_chat_session", {
      workspace,
      provider: providerId,
      sessionId,
    });
  } catch (error) {
    console.error("Failed to delete local chat history:", error);
  }
}

const GENERIC_SESSION_TITLES = new Set<string>(["xcoder", "新会话", "未命名会话"]);
for (const locale of APP_LOCALES) {
  GENERIC_SESSION_TITLES.add(translate(locale, "chat.newSessionTitle"));
  GENERIC_SESSION_TITLES.add(translate(locale, "session.unnamed"));
}

const GENERIC_NEW_SESSION_TITLES = new Set<string>(["新会话"]);
const GENERIC_UNNAMED_TITLES = new Set<string>(["未命名会话"]);
for (const locale of APP_LOCALES) {
  GENERIC_NEW_SESSION_TITLES.add(translate(locale, "chat.newSessionTitle"));
  GENERIC_UNNAMED_TITLES.add(translate(locale, "session.unnamed"));
}

export function isGenericSessionTitle(title: string) {
  const trimmed = title.trim();
  return !trimmed || GENERIC_SESSION_TITLES.has(trimmed);
}

export function localizeSessionTitle(title: string) {
  const locale = useSettingsStore.getState().locale;
  const trimmed = title.trim();
  if (!trimmed || GENERIC_UNNAMED_TITLES.has(trimmed)) {
    return translate(locale, "session.unnamed");
  }
  if (GENERIC_NEW_SESSION_TITLES.has(trimmed)) {
    return translate(locale, "chat.newSessionTitle");
  }
  return title;
}

export function mergeThreadLists(
  remote: ThreadSummary[],
  local: LocalSessionMeta[],
): ThreadSummary[] {
  const localById = new Map(local.map((item) => [item.id, item]));

  return remote
    .map((item) => {
      const localItem = localById.get(item.id);
      const title =
        localItem &&
        isGenericSessionTitle(item.title) &&
        !isGenericSessionTitle(localItem.title)
          ? localItem.title
          : item.title;
      return {
        ...item,
        title,
        preview: item.preview ?? localItem?.preview,
      };
    })
    .sort((a, b) => {
      const left = Date.parse(a.updated_at ?? "") || 0;
      const right = Date.parse(b.updated_at ?? "") || 0;
      return right - left;
    });
}

export function sessionTitleFromMessages(messages: ChatMessage[], fallback: string) {
  const firstUser = messages.find(
    (msg) => msg.role === "user" && msg.content.trim().length > 0,
  );
  if (!firstUser) return fallback;
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}
