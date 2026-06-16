export interface CodewhaleProviderEntry {
  id: string;
  apiKey: string;
}

export interface CodewhaleConfigView {
  path: string;
  installed: boolean;
  apiKey: string;
  provider: string;
  authMode: string;
  providers: CodewhaleProviderEntry[];
  defaultMode: string;
  approvalMode: string;
  reasoningEffort: string;
}

export const OPENCODE_MODALITY_OPTIONS = [
  "text",
  "audio",
  "image",
  "video",
  "pdf",
] as const;

export type OpencodeModality = (typeof OPENCODE_MODALITY_OPTIONS)[number];

export interface OpencodeModelEntry {
  id: string;
  name: string;
  limitContext: number | null;
  limitOutput: number | null;
  modalitiesInput: string[];
  modalitiesOutput: string[];
}

export interface OpencodeProviderEntry {
  id: string;
  npm: string;
  baseUrl: string;
  apiKey: string;
  setCacheKey: boolean;
  models: OpencodeModelEntry[];
}

export interface OpencodePermissionsView {
  edit: string;
  bash: string;
  read: string;
  webfetch: string;
}

export interface OpencodeConfigView {
  path: string;
  installed: boolean;
  defaultAgent: string;
  permissions: OpencodePermissionsView;
  providers: OpencodeProviderEntry[];
}
