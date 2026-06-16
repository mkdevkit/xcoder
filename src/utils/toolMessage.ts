import { t } from "../i18n";
import type { TranslationKey } from "../i18n/types";

const PREVIEW_MAX = 100;

const TOOL_ROLE_KEYS: Record<string, TranslationKey> = {
  task: "tool.role.task",
  read: "tool.role.read",
  write: "tool.role.write",
  edit: "tool.role.edit",
  bash: "tool.role.bash",
  glob: "tool.role.glob",
  grep: "tool.role.grep",
  list: "tool.role.list",
};

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function displayPath(path: unknown): string {
  if (typeof path !== "string" || !path) return "";
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.split("/").pop();
  return name || path;
}

function statusLine(status: unknown): string | null {
  if (!status) return null;
  return t("tool.statusLine", { status: String(status) });
}

function formatTaskToolState(state: Record<string, unknown>): string {
  const lines: string[] = [];
  const title = state.title;
  const status = state.status;
  const input = asRecord(state.input);
  const metadata = asRecord(state.metadata);

  const heading =
    (typeof title === "string" && title) ||
    (typeof input?.description === "string" && input.description) ||
    t("tool.role.task");
  lines.push(`📋 ${heading}`);

  const statusText = statusLine(status);
  if (statusText) lines.push(statusText);
  if (input?.subagent_type) {
    lines.push(
      t("tool.agentTypeLine", { type: String(input.subagent_type) }),
    );
  }
  if (input?.description && input.description !== heading) {
    lines.push(
      t("tool.descriptionLine", { text: String(input.description) }),
    );
  }
  if (input?.prompt) {
    lines.push("", t("tool.promptHeader"), String(input.prompt));
  }
  if (metadata?.sessionId) {
    lines.push(
      "",
      t("tool.subSessionLine", { id: String(metadata.sessionId) }),
    );
  }

  return lines.join("\n");
}

function formatReadToolState(state: Record<string, unknown>): string {
  const input = asRecord(state.input);
  const filePath =
    input?.filePath ?? input?.path ?? state.title ?? t("tool.unknownPath");
  const lines = [`📄 ${String(filePath)}`];
  const statusText = statusLine(state.status);
  if (statusText) lines.push(statusText);

  const metadata = asRecord(state.metadata);
  const display = asRecord(metadata?.display);
  const preview = display?.text ?? metadata?.preview ?? state.output;

  if (preview) {
    lines.push("", String(preview));
  } else if (state.status === "running") {
    lines.push("", t("tool.reading"));
  }

  return lines.join("\n");
}

function formatWriteLikeToolState(
  state: Record<string, unknown>,
  action: string,
): string {
  const input = asRecord(state.input);
  const filePath =
    input?.filePath ?? input?.path ?? state.title ?? t("tool.unknownPath");
  const lines = [`📝 ${action} ${String(filePath)}`];
  const statusText = statusLine(state.status);
  if (statusText) lines.push(statusText);

  const metadata = asRecord(state.metadata);
  const preview = metadata?.preview ?? input?.content ?? state.output;
  if (preview) {
    lines.push("", String(preview));
  }

  return lines.join("\n");
}

function formatBashToolState(state: Record<string, unknown>): string {
  const input = asRecord(state.input);
  const command = input?.command ?? input?.cmd ?? state.title;
  const lines = [t("tool.bashTitle")];
  if (command) lines.push(String(command));
  const statusText = statusLine(state.status);
  if (statusText) lines.push(statusText);
  if (state.output) lines.push("", String(state.output));
  return lines.join("\n");
}

function formatSearchToolState(
  state: Record<string, unknown>,
  action: string,
): string {
  const input = asRecord(state.input);
  const pattern = input?.pattern ?? input?.query ?? input?.glob ?? state.title;
  const lines = [`🔍 ${action}`];
  if (pattern) lines.push(String(pattern));
  const statusText = statusLine(state.status);
  if (statusText) lines.push(statusText);
  if (state.output) lines.push("", truncate(String(state.output), 2000));
  return lines.join("\n");
}

export function parseToolContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export function isMeaningfulToolArgs(args: unknown, toolName?: string): boolean {
  if (args == null) return false;
  if (typeof args === "string") return args.trim().length > 0;
  const record = asRecord(args);
  if (!record) return true;
  if (Object.keys(record).length === 0) return false;

  if (toolName === "task") {
    const input = asRecord(record.input);
    return Boolean(
      record.title ||
        record.status ||
        input?.description ||
        input?.prompt ||
        input?.subagent_type,
    );
  }

  if (toolName === "read") {
    const input = asRecord(record.input);
    return Boolean(
      input?.filePath ||
        input?.path ||
        record.title ||
        record.output ||
        asRecord(record.metadata)?.preview,
    );
  }

  return true;
}

export function formatToolContent(args: unknown, toolName?: string): string {
  if (args == null) return "";
  if (typeof args === "string") return args;

  const record = asRecord(args);
  if (!record) {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }

  switch (toolName) {
    case "task":
      return formatTaskToolState(record);
    case "read":
      return formatReadToolState(record);
    case "write":
      return formatWriteLikeToolState(record, t("tool.actionWrite"));
    case "edit":
      return formatWriteLikeToolState(record, t("tool.actionEdit"));
    case "bash":
      return formatBashToolState(record);
    case "glob":
      return formatSearchToolState(record, t("tool.searchFiles"));
    case "grep":
      return formatSearchToolState(record, t("tool.searchContent"));
    case "list":
      return formatSearchToolState(record, t("tool.listDir"));
    default:
      break;
  }

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function getToolPreview(content: string, toolName?: string): string {
  const trimmed = content.trim();
  if (!trimmed) return t("tool.noOutput");

  const parsed = parseToolContent(trimmed);
  const record = asRecord(parsed);
  if (!record) {
    return truncate(trimmed.replace(/\s+/g, " "), PREVIEW_MAX);
  }

  if (toolName === "task") {
    const parts: string[] = [];
    const input = asRecord(record.input);
    if (record.status) parts.push(String(record.status));
    if (record.title) parts.push(String(record.title));
    if (input?.subagent_type) parts.push(String(input.subagent_type));
    if (input?.description) {
      parts.push(truncate(String(input.description).replace(/\s+/g, " "), 60));
    }
    if (parts.length > 0) return parts.join(" · ");
  }

  if (toolName === "read") {
    const input = asRecord(record.input);
    const path = input?.filePath ?? input?.path ?? record.title;
    const parts: string[] = [];
    if (record.status) parts.push(String(record.status));
    if (path) parts.push(displayPath(path));
    if (parts.length > 0) return parts.join(" · ");
  }

  if (toolName === "write" || toolName === "edit") {
    const input = asRecord(record.input);
    const path = input?.filePath ?? input?.path ?? record.title;
    const parts: string[] = [];
    if (record.status) parts.push(String(record.status));
    if (path) parts.push(displayPath(path));
    if (parts.length > 0) return parts.join(" · ");
  }

  if (toolName === "bash") {
    const input = asRecord(record.input);
    const parts: string[] = [];
    if (record.status) parts.push(String(record.status));
    if (input?.command) {
      parts.push(truncate(String(input.command).replace(/\s+/g, " "), 60));
    }
    if (parts.length > 0) return parts.join(" · ");
  }

  const parts: string[] = [];
  const status =
    record.status ??
    (typeof record.state === "object" && record.state !== null
      ? (record.state as Record<string, unknown>).status
      : record.state);
  if (status) parts.push(String(status));
  if (record.title) parts.push(String(record.title));
  if (record.tool) parts.push(String(record.tool));

  const input = record.input ?? record.arguments ?? record.args;
  if (input) {
    const inputRecord = asRecord(input);
    const path = inputRecord?.filePath ?? inputRecord?.path;
    if (path) {
      parts.push(displayPath(path));
    } else {
      parts.push(truncate(formatToolContent(input).replace(/\s+/g, " "), 60));
    }
  }

  const output =
    record.output ??
    (typeof record.state === "object" && record.state !== null
      ? (record.state as Record<string, unknown>).output
      : undefined);
  if (output) {
    parts.push(truncate(String(output).replace(/\s+/g, " "), 80));
  }

  if (parts.length > 0) return parts.join(" · ");

  return truncate(trimmed.replace(/\s+/g, " "), PREVIEW_MAX);
}

export function getToolRoleLabel(toolName?: string): string {
  if (!toolName) return t("tool.generic");
  const key = TOOL_ROLE_KEYS[toolName];
  return key ? t(key) : t("tool.genericNamed", { name: toolName });
}

const RUNNING_STATUSES = new Set([
  "running",
  "pending",
  "in_progress",
  "in-progress",
  "awaiting",
  "awaiting_approval",
]);

export function isToolRunning(content: string): boolean {
  const record = asRecord(parseToolContent(content));
  if (!record) return false;
  const status = String(record.status ?? "").trim().toLowerCase();
  if (!status) return false;
  return RUNNING_STATUSES.has(status);
}
