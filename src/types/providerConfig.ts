import type { McpServerEntry } from "./mcp";

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
  name: string;
  npm: string;
  baseUrl: string;
  apiKey: string;
  setCacheKey: boolean;
  models: OpencodeModelEntry[];
}

export interface SaveOpencodeConfigResult {
  warnings: string[];
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
  mcpServers: McpServerEntry[];
}
