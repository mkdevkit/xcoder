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

export interface OpencodeProviderEntry {
  id: string;
  npm: string;
  baseUrl: string;
  apiKey: string;
  setCacheKey: boolean;
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
