import type {
  ChatMessage,
  CodewhaleModelOption,
  OpencodeModelOption,
  RuntimeStatus,
  ThreadInfo,
  ThreadSummary,
} from "../types/agent";
import { CODEWHALE_MODES } from "../utils/codewhaleModels";

export interface ProviderChatSlice {
  runtime: RuntimeStatus;
  connectedIntent: boolean;
  thread: ThreadInfo | null;
  chatWorkspace: string | null;
  threads: ThreadSummary[];
  threadsLoading: boolean;
  mode: string;
  model: string;
  dynamicModes: string[];
  opencodeModelCatalog: OpencodeModelOption[];
  opencodeConnectedProviders: string[];
  opencodeVendor: string;
  codewhaleModelCatalog: CodewhaleModelOption[];
  messages: ChatMessage[];
  streaming: boolean;
  runtimeBusy: boolean;
  runtimeAction: "connect" | "disconnect" | "restart" | null;
  pendingApproval: { id: string; description: string } | null;
  error: string | null;
}

export function createProviderChatSlice(providerId: string): ProviderChatSlice {
  return {
    runtime: { running: false, owned: false },
    connectedIntent: false,
    thread: null,
    chatWorkspace: null,
    threads: [],
    threadsLoading: false,
    mode:
      providerId === "codewhale"
        ? "agent"
        : providerId === "opencode"
          ? "build"
          : "agent",
    model: "",
    dynamicModes: providerId === "codewhale" ? [...CODEWHALE_MODES] : [],
    opencodeModelCatalog: [],
    opencodeConnectedProviders: [],
    opencodeVendor: "",
    codewhaleModelCatalog: [],
    messages: [],
    streaming: false,
    runtimeBusy: false,
    runtimeAction: null,
    pendingApproval: null,
    error: null,
  };
}

export function ensureProviderSlice(
  states: Record<string, ProviderChatSlice>,
  providerId: string,
): Record<string, ProviderChatSlice> {
  if (states[providerId]) return states;
  return { ...states, [providerId]: createProviderChatSlice(providerId) };
}
