import { t } from "../i18n";

export type AgentEvent =
  | { type: "text_delta"; content: string; partId?: string }
  | { type: "text_snapshot"; content: string; partId?: string }
  | { type: "reasoning_delta"; content: string; partId?: string }
  | { type: "reasoning_snapshot"; content: string; partId?: string }
  | { type: "tool_call"; name: string; args: unknown; partId?: string }
  | { type: "tool_result"; output: string }
  | { type: "approval_required"; id: string; description: string }
  | { type: "approval_resolved" }
  | { type: "file_change"; path: string; diff: string }
  | { type: "turn_completed" }
  | { type: "session_idle" }
  | { type: "session_busy" }
  | { type: "turn_aborted" }
  | { type: "turn_error"; message: string }
  | { type: "raw"; payload: unknown };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  approvalId?: string;
  turnId?: string;
}

export interface ThreadInfo {
  id: string;
  mode?: string;
  model?: string;
  workspace?: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  preview?: string;
  workspace?: string;
  updated_at?: string;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_name?: string;
  turn_id?: string;
  timestamp: number;
}

export interface RuntimeStatus {
  running: boolean;
  base_url?: string;
  owned?: boolean;
}

export interface AgentEventEnvelope {
  providerId: string;
  event: Record<string, unknown>;
}

export interface OpencodeModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  value: string;
}

export interface OpencodeProviderCatalog {
  models: OpencodeModelOption[];
  connectedProviderIds: string[];
}

export interface UiOptions {
  modes: string[];
  default_mode: string;
  approval_modes: string[];
  models: string[];
  default_model: string;
}

export interface ProviderConfig {
  id: string;
  type: string;
  command: string;
  args: string[];
  config_path?: string;
  health_cmd: string[];
  ui_options?: UiOptions;
}

export interface AppConfig {
  app: {
    default_provider: string;
    theme: string;
    default_model: string;
  };
  providers: ProviderConfig[];
}

export function mapRuntimeEvent(raw: Record<string, unknown>): AgentEvent | null {
  const event = String(raw.event ?? raw.kind ?? "");
  const payload = (raw.payload ?? {}) as Record<string, unknown>;

  if (event === "item.delta") {
    const delta = String(payload.delta ?? "");
    const kind = String(payload.kind ?? "agent_message");
    const partId = String(payload.partId ?? payload.part_id ?? "");
    if (kind === "reasoning") {
      return {
        type: "reasoning_delta",
        content: delta,
        ...(partId ? { partId } : {}),
      };
    }
    return {
      type: "text_delta",
      content: delta,
      ...(partId ? { partId } : {}),
    };
  }

  if (event === "item.text") {
    const text = String(payload.text ?? "");
    const kind = String(payload.kind ?? "agent_message");
    const partId = String(payload.partId ?? payload.part_id ?? "");
    if (kind === "reasoning") {
      return {
        type: "reasoning_snapshot",
        content: text,
        ...(partId ? { partId } : {}),
      };
    }
    return {
      type: "text_snapshot",
      content: text,
      ...(partId ? { partId } : {}),
    };
  }

  if (event === "approval.required") {
    const approvalId = String(
      payload.approval_id ??
        payload.id ??
        (payload.approval as Record<string, unknown> | undefined)?.id ??
        "",
    );
    const description = String(
      payload.description ?? payload.summary ?? t("approval.required"),
    );
    if (!approvalId && !description) {
      return null;
    }
    if (approvalId.startsWith("item_")) {
      return null;
    }
    return {
      type: "approval_required",
      id: approvalId,
      description,
    };
  }

  if (event === "approval.decided" || event === "approval.timeout") {
    return { type: "approval_resolved" };
  }

  if (event === "approval.resolved") {
    return { type: "approval_resolved" };
  }

  if (event === "turn.completed" || event === "session.turn.completed") {
    return { type: "turn_completed" };
  }

  if (event === "session.idle") {
    return { type: "session_idle" };
  }

  if (event === "session.busy") {
    return { type: "session_busy" };
  }

  if (event === "turn.error") {
    return {
      type: "turn_error",
      message: String(payload.message ?? t("error.opencodeSession")),
    };
  }

  if (event === "turn.aborted") {
    return { type: "turn_aborted" };
  }

  if (event === "file_change") {
    return {
      type: "file_change",
      path: String(payload.path ?? ""),
      diff: String(payload.diff ?? ""),
    };
  }

  if (event === "item.updated" || event === "item.completed") {
    const kind = String(payload.kind ?? "");
    if (kind === "tool_call") {
      const partId = String(payload.id ?? payload.part_id ?? "");
      return {
        type: "tool_call",
        name: String(payload.name ?? "tool"),
        args: payload.args ?? {},
        ...(partId ? { partId } : {}),
      };
    }
    if (kind === "file_change") {
      return {
        type: "file_change",
        path: String(payload.path ?? ""),
        diff: String(payload.diff ?? ""),
      };
    }
  }

  return { type: "raw", payload: raw };
}
