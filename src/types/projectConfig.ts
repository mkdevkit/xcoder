import type { OpencodePermissionsView } from "./providerConfig";

export interface ProjectConfig {
  provider: string;
  defaultModel: string;
  opencodePermissions: OpencodePermissionsView;
}

export interface ProjectConfigInfo {
  config: ProjectConfig;
  path: string;
}
