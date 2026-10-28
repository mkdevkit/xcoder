import fs from "node:fs";
import path from "node:path";

export interface OpencodePermissions {
  edit: string;
  bash: string;
  read: string;
  webfetch: string;
}

export interface ProjectConfig {
  provider: string;
  defaultModel: string;
  opencodePermissions: OpencodePermissions;
}

export interface ProjectConfigInfo {
  config: ProjectConfig;
  path: string;
}

function emptyPermissions(): OpencodePermissions {
  return { edit: "", bash: "", read: "", webfetch: "" };
}

function normalizeProjectConfig(
  value: Partial<ProjectConfig> | undefined,
): ProjectConfig {
  return {
    provider: value?.provider?.trim() || "opencode",
    defaultModel: value?.defaultModel?.trim() || "",
    opencodePermissions: {
      ...emptyPermissions(),
      ...(value?.opencodePermissions ?? {}),
    },
  };
}

export function projectConfigPath(workspace: string) {
  return path.join(workspace, ".xcoder", "config.json");
}

export function loadProjectConfig(workspace: string): ProjectConfig {
  const filePath = projectConfigPath(workspace);
  if (!fs.existsSync(filePath)) {
    throw new Error("Project config not found");
  }
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content) as Partial<ProjectConfig>;
  return normalizeProjectConfig(parsed);
}

export function saveProjectConfig(
  workspace: string,
  config: ProjectConfig,
): ProjectConfigInfo {
  const filePath = projectConfigPath(workspace);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeProjectConfig(config);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return { config: normalized, path: filePath };
}

export function ensureProjectConfig(
  workspace: string,
  defaultProvider: string,
  defaultModel: string,
): ProjectConfigInfo {
  const filePath = projectConfigPath(workspace);
  if (fs.existsSync(filePath)) {
    const config = loadProjectConfig(workspace);
    return { config, path: filePath };
  }
  return saveProjectConfig(workspace, {
    provider: defaultProvider.trim() || "opencode",
    defaultModel: defaultModel.trim(),
    opencodePermissions: emptyPermissions(),
  });
}

function readProjectOpenCodeJson(workspace: string) {
  const filePath = path.join(workspace, "opencode.json");
  if (!fs.existsSync(filePath)) return { filePath, json: {} as Record<string, unknown> };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return {
      filePath,
      json:
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {},
    };
  } catch {
    return { filePath, json: {} as Record<string, unknown> };
  }
}

export function syncProjectOpenCodePermissions(
  workspace: string,
  permissions: OpencodePermissions,
) {
  const { filePath, json } = readProjectOpenCodeJson(workspace);
  if (!json.$schema) json.$schema = "https://opencode.ai/config.json";

  const existing = json.permission;
  const permission: Record<string, unknown> =
    existing && typeof existing === "object"
      ? { ...(existing as Record<string, unknown>) }
      : {};

  for (const key of ["edit", "bash", "read", "webfetch"] as const) {
    const value = permissions[key]?.trim() ?? "";
    if (value) {
      permission[key] = value;
    } else {
      delete permission[key];
    }
  }

  if (Object.keys(permission).length > 0) {
    json.permission = permission;
  } else {
    delete json.permission;
  }

  const keys = Object.keys(json).filter((key) => key !== "$schema");
  if (keys.length === 0) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    return;
  }

  fs.writeFileSync(
    filePath,
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );
}

export function syncProjectOpenCodeFromConfig(workspace: string) {
  try {
    const config = loadProjectConfig(workspace);
    syncProjectOpenCodePermissions(workspace, config.opencodePermissions);
  } catch {
    // no project config; nothing to sync
  }
}
