import type { AppConfig } from "../types/agent";
import type { OpencodePermissionsView } from "../types/providerConfig";
import type { ProjectConfig } from "../types/projectConfig";

export function emptyOpencodePermissions(): OpencodePermissionsView {
  return {
    edit: "",
    bash: "",
    read: "",
    webfetch: "",
  };
}

export function resolveProjectPreferredModel(
  projectConfig: ProjectConfig | null | undefined,
  appConfig: AppConfig | null | undefined,
): string {
  const project = projectConfig?.defaultModel?.trim();
  if (project) return project;
  return appConfig?.app.default_model?.trim() ?? "";
}

export function resolveProjectOpencodePermission(
  key: keyof OpencodePermissionsView,
  projectConfig: ProjectConfig | null | undefined,
  globalPermissions: OpencodePermissionsView | null | undefined,
): string {
  const project = projectConfig?.opencodePermissions?.[key]?.trim();
  if (project) return project;
  return globalPermissions?.[key]?.trim() ?? "";
}

export function resolveProjectCodewhaleApprovalMode(
  projectConfig: ProjectConfig | null | undefined,
  globalApprovalMode: string | null | undefined,
): string {
  const project = projectConfig?.codewhaleApprovalMode?.trim();
  if (project) return project;
  return globalApprovalMode?.trim() ?? "";
}

export function buildProjectConfigPayload(
  projectConfig: ProjectConfig | null | undefined,
  providerId: string,
  patch: Partial<Omit<ProjectConfig, "opencodePermissions">> & {
    opencodePermissions?: Partial<OpencodePermissionsView>;
    codewhaleApprovalMode?: string;
  } = {},
): ProjectConfig {
  return {
    provider: patch.provider ?? projectConfig?.provider ?? providerId,
    defaultModel: patch.defaultModel ?? projectConfig?.defaultModel ?? "",
    codewhaleApprovalMode:
      patch.codewhaleApprovalMode ?? projectConfig?.codewhaleApprovalMode ?? "",
    opencodePermissions: {
      ...emptyOpencodePermissions(),
      ...projectConfig?.opencodePermissions,
      ...patch.opencodePermissions,
    },
  };
}
