export interface RuntimeStatus {
  running: boolean;
  base_url?: string;
  owned?: boolean;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_name?: string;
  turn_id?: string;
  timestamp: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  preview?: string;
  workspace?: string;
  updated_at?: string;
}

export interface ThreadInfo {
  id: string;
  mode?: string;
  model?: string;
  workspace?: string;
}

export interface PendingApproval {
  id: string;
  description: string;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  id: string;
  questions: QuestionInfo[];
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

export interface TurnPoll {
  messages: HistoryMessage[];
  busy: boolean;
  pending: PendingApproval | null;
  pending_question: PendingQuestion | null;
  turn_complete: boolean;
}

export interface StatusPoll {
  busy: boolean;
  pending: PendingApproval | null;
  pending_question: PendingQuestion | null;
}

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
  messages: HistoryMessage[];
  updated_at: string;
}
