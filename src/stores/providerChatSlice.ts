import type {
  HistoryMessage,
  OpencodeModelOption,
  PendingQuestion,
  RuntimeStatus,
  ThreadInfo,
  ThreadSummary,
} from "../types/agent";
import type { ActiveTurn } from "../utils/turnState";

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
  messages: HistoryMessage[];
  streaming: boolean;
  activeTurn: ActiveTurn | null;
  runtimeBusy: boolean;
  runtimeAction: "connect" | "disconnect" | "restart" | null;
  pendingApproval: { id: string; description: string } | null;
  pendingQuestion: PendingQuestion | null;
  error: string | null;
}

export function createProviderChatSlice(_providerId: string): ProviderChatSlice {
  return {
    runtime: { running: false, owned: false },
    connectedIntent: false,
    thread: null,
    chatWorkspace: null,
    threads: [],
    threadsLoading: false,
    mode: "build",
    model: "",
    dynamicModes: [],
    opencodeModelCatalog: [],
    opencodeConnectedProviders: [],
    opencodeVendor: "",
    messages: [],
    streaming: false,
    activeTurn: null,
    runtimeBusy: false,
    runtimeAction: null,
    pendingApproval: null,
    pendingQuestion: null,
    error: null,
  };
}

export function ensureProviderSlice(
  states: Record<string, ProviderChatSlice>,
  providerId: string,
): Record<string, ProviderChatSlice> {
  const existing = states[providerId];
  if (existing) {
    if (!Array.isArray(existing.messages)) {
      return {
        ...states,
        [providerId]: { ...existing, messages: [] },
      };
    }
    return states;
  }
  return { ...states, [providerId]: createProviderChatSlice(providerId) };
}
