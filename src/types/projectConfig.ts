import type { OpencodePermissionsView } from "./providerConfig";

export interface ProjectConfig {
  provider: string;
  defaultModel: string;
  opencodePermissions: OpencodePermissionsView;
  codewhaleApprovalMode: string;
}

export interface ProjectConfigInfo {
  config: ProjectConfig;
  path: string;
}
