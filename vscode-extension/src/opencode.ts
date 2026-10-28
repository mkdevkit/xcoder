import { exec, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type {
  HistoryMessage,
  OpencodeModelOption,
  OpencodeProviderCatalog,
  PendingApproval,
  PendingQuestion,
  QuestionInfo,
  RuntimeStatus,
  StatusPoll,
  ThreadInfo,
  ThreadSummary,
  TurnPoll,
} from "./types";

const SYNTHETIC_USER_PREFIXES = [
  "The following tool was executed by the user",
  "Attached media from tool result:",
];

function isSyntheticUserContent(content: string) {
  const trimmed = content.trim();
  return (
    !trimmed ||
    trimmed === "What did we do so far?" ||
    SYNTHETIC_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  );
}

function partText(part: Record<string, unknown>) {
  const text = part.text;
  return typeof text === "string" ? text : "";
}

function partTimestamp(part: Record<string, unknown>, fallback: number) {
  const time = part.time as Record<string, unknown> | undefined;
  const start = time?.start;
  return typeof start === "number" ? start : fallback;
}

function normalizeDirectory(value: string) {
  return value
    .replace(/[\\/]+$/, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

function sameDirectory(left: string | undefined, right: string) {
  if (!left || !right) return false;
  return normalizeDirectory(left) === normalizeDirectory(right);
}

function asEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["data", "permissions", "items", "requests", "questions"]) {
      const items = record[key];
      if (Array.isArray(items)) return items as Record<string, unknown>[];
    }
  }
  return [];
}

function pendingPermissionFrom(entry: Record<string, unknown>): PendingApproval {
  const id =
    (typeof entry.id === "string" && entry.id) ||
    (typeof entry.requestID === "string" && entry.requestID) ||
    (typeof entry.permissionID === "string" && entry.permissionID) ||
    "";
  const description =
    (typeof entry.title === "string" && entry.title) ||
    (typeof entry.description === "string" && entry.description) ||
    (typeof entry.permission === "string" && entry.permission) ||
    (typeof entry.action === "string" && entry.action) ||
    "Permission required";
  return { id, description };
}

function questionInfos(value: unknown): QuestionInfo[] {
  if (!Array.isArray(value)) return [];
  const result: QuestionInfo[] = [];
  for (const item of value) {
    const record = item as Record<string, unknown>;
    const question =
      typeof record.question === "string" ? record.question : "";
    if (!question) continue;
    const options: QuestionInfo["options"] = [];
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        const opt = option as Record<string, unknown>;
        const label = typeof opt.label === "string" ? opt.label : "";
        if (!label) continue;
        options.push({
          label,
          description:
            typeof opt.description === "string" ? opt.description : "",
        });
      }
    }
    result.push({
      question,
      header: typeof record.header === "string" ? record.header : "",
      options,
      multiple: record.multiple === true,
      custom: record.custom !== false,
    });
  }
  return result;
}

export class OpenCodeService {
  private child: ChildProcess | null = null;
  private owned = false;
  private readonly output: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Xcoder");
  }

  async dispose() {
    await this.stop();
    this.output.dispose();
  }

  private get configuration() {
    return vscode.workspace.getConfiguration("xcoder");
  }

  get port() {
    const value = this.configuration.get<number>("opencodePort", 4097);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 4097;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  get command() {
    return this.configuration.get<string>("opencodeCommand", "opencode");
  }

  get workspace() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private async request<T>(
    pathname: string,
    init?: RequestInit,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `${init?.method ?? "GET"} ${pathname} failed (${response.status}): ${text}`,
        );
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? (JSON.parse(text) as T) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  private query(params: Record<string, string | number | undefined>) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/global/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealth(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.health()) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("OpenCode server failed to start");
  }

  private resolveCommand() {
    const raw = this.command.trim();
    if (!raw) return raw;
    if (path.isAbsolute(raw) || raw.includes("/") || raw.includes("\\")) {
      return raw;
    }
    if (process.platform === "win32") {
      const candidates = [
        process.env.APPDATA
          ? path.join(process.env.APPDATA, "npm", `${raw}.cmd`)
          : "",
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, "npm", `${raw}.cmd`)
          : "",
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return raw;
  }

  private async spawnServer(workspace?: string | null) {
    const cwd = workspace || this.workspace || os.homedir();
    const command = this.resolveCommand();
    const args = [
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(this.port),
    ];
    this.output.appendLine(`Starting ${command} ${args.join(" ")} (${cwd})`);
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    this.owned = true;
    child.stderr?.on("data", (chunk) => {
      this.output.append(String(chunk));
    });
    child.on("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.owned = false;
      }
    });
    await this.waitForHealth();
    return child;
  }

  private killChildTree() {
    const child = this.child;
    if (!child?.pid) return;
    this.child = null;
    this.owned = false;
    if (process.platform === "win32") {
      exec(`taskkill /PID ${child.pid} /T /F`, () => undefined);
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  private killPortListener() {
    const port = this.port;
    if (process.platform === "win32") {
      exec(`netstat -ano -p tcp | findstr :${port}`, (error, stdout) => {
        if (error || !stdout) return;
        const pids = new Set<string>();
        for (const line of stdout.split(/\r?\n/)) {
          if (!/LISTENING/i.test(line)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
        for (const pid of pids) {
          exec(`taskkill /PID ${pid} /T /F`, () => undefined);
        }
      });
      return;
    }
    exec(`lsof -ti tcp:${port}`, (error, stdout) => {
      if (error || !stdout) return;
      for (const pid of stdout.split(/\r?\n/)) {
        if (!pid.trim()) continue;
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
          // ignore
        }
      }
    });
  }

  async status(): Promise<RuntimeStatus> {
    const running = await this.health();
    return {
      running,
      base_url: running ? this.baseUrl : undefined,
      owned: this.owned,
    };
  }

  async start(workspace?: string | null): Promise<RuntimeStatus> {
    if (await this.health()) {
      return { running: true, base_url: this.baseUrl, owned: this.owned };
    }
    await this.spawnServer(workspace);
    return { running: true, base_url: this.baseUrl, owned: true };
  }

  async restart(workspace?: string | null): Promise<RuntimeStatus> {
    this.killChildTree();
    this.killPortListener();
    for (let i = 0; i < 20; i += 1) {
      if (!(await this.health())) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await this.spawnServer(workspace);
    return { running: true, base_url: this.baseUrl, owned: true };
  }

  async stop(): Promise<void> {
    this.killChildTree();
    this.killPortListener();
    for (let i = 0; i < 20; i += 1) {
      if (!(await this.health())) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async listSessions(workspace: string, limit = 50): Promise<ThreadSummary[]> {
    const items = await this.request<Record<string, unknown>[]>(
      `/session${this.query({
        directory: workspace,
        limit,
        roots: "true",
      })}`,
    );
    return (items ?? [])
      .filter((item) => {
        const parent = item.parentID;
        return !(typeof parent === "string" && parent.length > 0);
      })
      .filter((item) => {
        const directory =
          typeof item.directory === "string" ? item.directory : "";
        return sameDirectory(directory, workspace);
      })
      .map((item) => {
        const time = item.time as Record<string, unknown> | undefined;
        const updated = time?.updated;
        const directory =
          typeof item.directory === "string" ? item.directory : workspace;
        return {
          id: typeof item.id === "string" ? item.id : "",
          title: typeof item.title === "string" ? item.title : "",
          preview: undefined,
          workspace: directory,
          updated_at: typeof updated === "number" ? String(updated) : undefined,
        };
      })
      .filter((item) => !!item.id);
  }

  async listProviderModels(): Promise<OpencodeProviderCatalog> {
    const payload = await this.request<{
      all?: Record<string, unknown>[];
      connected?: string[];
    }>("/provider");
    const models: OpencodeModelOption[] = [];
    for (const provider of payload?.all ?? []) {
      const providerId =
        typeof provider.id === "string" ? provider.id : "";
      if (!providerId) continue;
      const providerName =
        (typeof provider.name === "string" && provider.name) || providerId;
      const providerModels = provider.models;
      if (!providerModels || typeof providerModels !== "object") continue;
      for (const [modelId, raw] of Object.entries(
        providerModels as Record<string, unknown>,
      )) {
        if (!modelId) continue;
        const model = (raw ?? {}) as Record<string, unknown>;
        models.push({
          providerId,
          providerName,
          modelId,
          modelName:
            (typeof model.name === "string" && model.name) || modelId,
          value: `${providerId}/${modelId}`,
        });
      }
    }
    models.sort((left, right) =>
      left.providerName === right.providerName
        ? left.modelName.localeCompare(right.modelName)
        : left.providerName.localeCompare(right.providerName),
    );
    return {
      models,
      connectedProviderIds: Array.isArray(payload?.connected)
        ? payload.connected.filter((id) => typeof id === "string")
        : [],
    };
  }

  async listAgents(): Promise<string[]> {
    const payload = await this.request<Record<string, unknown>[]>("/agent");
    return (payload ?? [])
      .filter((item) => item.hidden !== true)
      .filter((item) => {
        const mode = item.mode;
        return mode === undefined || mode === "primary";
      })
      .map((item) =>
        typeof item.name === "string"
          ? item.name
          : typeof item.id === "string"
            ? item.id
            : "",
      )
      .filter(Boolean);
  }

  private async messageEntries(
    sessionId: string,
    workspace: string,
    limit?: number,
  ) {
    const entries = await this.request<Record<string, unknown>[]>(
      `/session/${encodeURIComponent(sessionId)}/message${this.query({
        directory: workspace,
        limit: limit && limit > 0 ? limit : undefined,
      })}`,
    );
    return entries ?? [];
  }

  async messages(
    sessionId: string,
    workspace: string,
    limit?: number,
  ): Promise<HistoryMessage[]> {
    return this.mapMessages(
      await this.messageEntries(sessionId, workspace, limit),
    );
  }

  private mapMessages(entries: Record<string, unknown>[]): HistoryMessage[] {
    const messages: HistoryMessage[] = [];
    for (const entry of entries) {
      const info = (entry.info ?? {}) as Record<string, unknown>;
      const parts = Array.isArray(entry.parts)
        ? (entry.parts as Record<string, unknown>[])
        : [];
      const role = typeof info.role === "string" ? info.role : "";
      const messageId = typeof info.id === "string" ? info.id : "";
      const created =
        (info.time as Record<string, unknown> | undefined)?.created;
      const timestamp = typeof created === "number" ? created : Date.now();

      if (role === "user") {
        const content = parts
          .filter((part) => part.type === "text")
          .map((part) => partText(part))
          .filter((text) => !isSyntheticUserContent(text))
          .join("\n");
        if (content) {
          messages.push({
            id: messageId,
            role: "user",
            content,
            turn_id: messageId,
            timestamp,
          });
        }
        continue;
      }

      if (role !== "assistant") continue;

      const error = info.error as Record<string, unknown> | undefined;
      if (error) {
        const data = error.data as Record<string, unknown> | undefined;
        const message =
          (typeof data?.message === "string" && data.message) ||
          (typeof error.message === "string" && error.message) ||
          "OpenCode 会话出错";
        messages.push({
          id: `${messageId}-error`,
          role: "assistant",
          content: `错误：${message}`,
          turn_id: messageId,
          timestamp,
        });
      }

      for (const [index, part] of parts.entries()) {
        const type = typeof part.type === "string" ? part.type : "";
        const partId =
          (typeof part.id === "string" && part.id) ||
          `${messageId}-${index}`;
        const partTime = partTimestamp(part, timestamp);

        if (type === "text") {
          if (part.role === "user") continue;
          const text = partText(part);
          if (!text) continue;
          messages.push({
            id: partId,
            role: "assistant",
            content: text,
            turn_id: messageId,
            timestamp: partTime,
          });
          continue;
        }

        if (type === "reasoning") {
          const text = partText(part);
          if (!text) continue;
          messages.push({
            id: partId,
            role: "assistant",
            content: `> ${text}`,
            turn_id: messageId,
            timestamp: partTime,
          });
          continue;
        }

        if (type === "tool" || type === "tool-call") {
          const state = part.state ?? part.data;
          if (!state || typeof state !== "object") continue;
          if (Object.keys(state as Record<string, unknown>).length === 0) {
            continue;
          }
          messages.push({
            id: partId,
            role: "tool",
            content: JSON.stringify(state, null, 2),
            tool_name:
              (typeof part.tool === "string" && part.tool) ||
              (typeof part.name === "string" && part.name) ||
              "tool",
            turn_id: messageId,
            timestamp: partTime,
          });
        }
      }
    }
    return messages;
  }

  private async sessionStatusMap(workspace: string) {
    return (
      (await this.request<Record<string, { type?: string }>>(
        `/session/status${this.query({ directory: workspace })}`,
      )) ?? {}
    );
  }

  private async pendingApproval(
    sessionId: string,
    workspace: string,
  ): Promise<PendingApproval | null> {
    const payload = await this.request<unknown>(
      `/permission${this.query({ directory: workspace })}`,
    );
    for (const entry of asEntries(payload)) {
      if (entry.sessionID && entry.sessionID !== sessionId) continue;
      const permission = pendingPermissionFrom(entry);
      if (permission.id) return permission;
    }
    return null;
  }

  private async pendingQuestion(
    sessionId: string,
    workspace: string,
  ): Promise<PendingQuestion | null> {
    const payload = await this.request<unknown>(
      `/question${this.query({ directory: workspace })}`,
    );
    for (const entry of asEntries(payload)) {
      if (entry.sessionID && entry.sessionID !== sessionId) continue;
      const id = typeof entry.id === "string" ? entry.id : "";
      if (!id) continue;
      const questions = questionInfos(entry.questions);
      if (questions.length === 0) continue;
      return { id, questions };
    }
    return null;
  }

  async statusPoll(sessionId: string, workspace: string): Promise<StatusPoll> {
    const [statusMap, pending, pendingQuestion] = await Promise.all([
      this.sessionStatusMap(workspace).catch(
        () => ({}) as Record<string, { type?: string }>,
      ),
      this.pendingApproval(sessionId, workspace).catch(() => null),
      this.pendingQuestion(sessionId, workspace).catch(() => null),
    ]);
    const entry = statusMap[sessionId];
    const busy =
      !!entry &&
      (entry.type === "busy" || entry.type === "retry" || entry.type === "running");
    return { busy, pending, pending_question: pendingQuestion };
  }

  async pollTurn(
    sessionId: string,
    workspace: string,
    limit?: number,
  ): Promise<TurnPoll> {
    const [entries, status] = await Promise.all([
      this.messageEntries(sessionId, workspace, limit),
      this.statusPoll(sessionId, workspace),
    ]);
    const messages = this.mapMessages(entries);

    let lastUserIndex = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const info = (entries[index].info ?? {}) as Record<string, unknown>;
      if (info.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    let lastAssistant: Record<string, unknown> | undefined;
    for (let index = lastUserIndex + 1; index < entries.length; index += 1) {
      const info = (entries[index].info ?? {}) as Record<string, unknown>;
      if (info.role === "assistant") lastAssistant = info;
    }
    const assistantTime = lastAssistant?.time as
      | Record<string, unknown>
      | undefined;
    const assistantDone =
      !!lastAssistant &&
      (!!lastAssistant.error || typeof assistantTime?.completed === "number");

    return {
      messages,
      busy: status.busy,
      pending: status.pending,
      pending_question: status.pending_question,
      turn_complete:
        lastUserIndex >= 0 &&
        assistantDone &&
        !status.busy &&
        !status.pending &&
        !status.pending_question,
    };
  }

  async createThread(
    workspace: string,
    agent: string,
    title: string,
  ): Promise<ThreadInfo> {
    const created = await this.request<Record<string, unknown>>(
      `/session${this.query({ directory: workspace })}`,
      { method: "POST", body: "{}" },
    );
    const id = typeof created?.id === "string" ? created.id : "";
    if (!id) throw new Error("OpenCode did not return a session id");
    if (title.trim()) {
      await this.updateTitle(id, title, workspace).catch(() => undefined);
    }
    return { id, mode: agent, model: undefined, workspace };
  }

  async updateTitle(sessionId: string, title: string, workspace: string) {
    await this.request(
      `/session/${encodeURIComponent(sessionId)}${this.query({ directory: workspace })}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    );
  }

  async sendTurn(args: {
    threadId: string;
    message: string;
    mode: string;
    model?: string | null;
    workspace?: string | null;
    messageId?: string | null;
  }) {
    const workspace = args.workspace || this.workspace || "";
    const body: Record<string, unknown> = {
      agent: args.mode,
      parts: [{ type: "text", text: args.message }],
    };
    if (args.messageId) body.messageID = args.messageId;
    if (args.model) {
      const slash = args.model.indexOf("/");
      if (slash > 0) {
        body.model = {
          providerID: args.model.slice(0, slash),
          modelID: args.model.slice(slash + 1),
        };
      }
    }
    await this.request(
      `/session/${encodeURIComponent(args.threadId)}/prompt_async${this.query({ directory: workspace })}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async cancelTurn(sessionId: string, workspace?: string | null) {
    await this.request(
      `/session/${encodeURIComponent(sessionId)}/abort${this.query({
        directory: workspace || this.workspace || "",
      })}`,
      { method: "POST" },
    );
  }

  async approve(
    sessionId: string,
    approvalId: string,
    allow: boolean,
    workspace?: string | null,
  ) {
    const reply = allow ? "once" : "reject";
    await this.request(
      `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(approvalId)}${this.query({
        directory: workspace || this.workspace || "",
      })}`,
      {
        method: "POST",
        body: JSON.stringify({ response: reply, remember: false }),
      },
    );
  }

  async replyQuestion(
    requestId: string,
    answers: string[][],
    workspace?: string | null,
  ) {
    await this.request(
      `/question/${encodeURIComponent(requestId)}/reply${this.query({
        directory: workspace || this.workspace || "",
      })}`,
      { method: "POST", body: JSON.stringify({ answers }) },
    );
  }

  async rejectQuestion(requestId: string, workspace?: string | null) {
    await this.request(
      `/question/${encodeURIComponent(requestId)}/reject${this.query({
        directory: workspace || this.workspace || "",
      })}`,
      { method: "POST" },
    );
  }

  async deleteSession(sessionId: string, workspace?: string | null) {
    await this.request(
      `/session/${encodeURIComponent(sessionId)}${this.query({
        directory: workspace || this.workspace || "",
      })}`,
      { method: "DELETE" },
    );
  }
}

export function isOpenCodeInstalled(command: string) {
  return !!command.trim();
}
