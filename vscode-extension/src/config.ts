import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

export interface OpencodeConfigView {
  path: string;
  installed: boolean;
  defaultAgent: string;
  permissions: {
    edit: string;
    bash: string;
    read: string;
    webfetch: string;
  };
  providers: OpencodeProviderEntry[];
  mcpServers: unknown[];
}

export function homeDir() {
  return os.homedir();
}

export function opencodeConfigPath() {
  const base = path.join(homeDir(), ".config", "opencode");
  const json = path.join(base, "opencode.json");
  const jsonc = path.join(base, "opencode.jsonc");
  if (fs.existsSync(json)) return json;
  if (fs.existsSync(jsonc)) return jsonc;
  return json;
}

export function authPath() {
  return path.join(homeDir(), ".local", "share", "opencode", "auth.json");
}

export function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) return {};
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readAuthKeys(): Record<string, string> {
  const filePath = authPath();
  const json = readJsonFile(filePath);
  const result: Record<string, string> = {};
  for (const [provider, value] of Object.entries(json)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.key !== "string") continue;
    const key = record.key.trim();
    if (key) result[provider] = key;
  }
  return result;
}

export function setProviderAuth(provider: string, apiKey: string) {
  const id = provider.trim();
  const key = apiKey.trim();
  if (!id || !key) throw new Error("Provider ID and API key are required");
  const filePath = authPath();
  const auth = readJsonFile(filePath);
  auth[id] = { type: "api", key };
  writeJsonFile(filePath, auth);
}

export function removeProviderAuth(provider: string) {
  const id = provider.trim();
  if (!id) return;
  const filePath = authPath();
  if (!fs.existsSync(filePath)) return;
  const auth = readJsonFile(filePath);
  if (!(id in auth)) return;
  delete auth[id];
  if (Object.keys(auth).length === 0) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  writeJsonFile(filePath, auth);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function permissionAction(permission: unknown, key: string) {
  if (typeof permission === "string") return permission;
  if (!permission || typeof permission !== "object") return "";
  const record = permission as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") {
    const star = (direct as Record<string, unknown>)["*"];
    if (typeof star === "string") return star;
  }
  const star = record["*"];
  if (typeof star === "string") return star;
  if (star && typeof star === "object") {
    const nested = (star as Record<string, unknown>)["*"];
    if (typeof nested === "string") return nested;
  }
  return "";
}

function parseModel(raw: unknown, id: string): OpencodeModelEntry {
  const value = (raw ?? {}) as Record<string, unknown>;
  const limit = (value.limit ?? {}) as Record<string, unknown>;
  const modalities = (value.modalities ?? {}) as Record<string, unknown>;
  const input = Array.isArray(modalities.input)
    ? modalities.input.filter((item): item is string => typeof item === "string")
    : [];
  const output = Array.isArray(modalities.output)
    ? modalities.output.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id,
    name: stringValue(value.name) || id,
    limitContext:
      typeof limit.context === "number" ? limit.context : null,
    limitOutput: typeof limit.output === "number" ? limit.output : null,
    modalitiesInput: input,
    modalitiesOutput: output,
  };
}

export function loadOpencodeConfigView(): OpencodeConfigView {
  const filePath = opencodeConfigPath();
  const installed = fs.existsSync(filePath);
  const json = installed ? readJsonFile(filePath) : {};
  const authKeys = readAuthKeys();

  const providers: OpencodeProviderEntry[] = [];
  const providerMap = json.provider;
  if (providerMap && typeof providerMap === "object") {
    for (const [id, raw] of Object.entries(
      providerMap as Record<string, unknown>,
    )) {
      if (!id) continue;
      const value = (raw ?? {}) as Record<string, unknown>;
      const options = (value.options ?? {}) as Record<string, unknown>;
      const modelsValue = value.models;
      const models: OpencodeModelEntry[] = [];
      if (modelsValue && typeof modelsValue === "object") {
        for (const [modelId, modelValue] of Object.entries(
          modelsValue as Record<string, unknown>,
        )) {
          if (!modelId) continue;
          models.push(parseModel(modelValue, modelId));
        }
      }
      models.sort((left, right) => left.id.localeCompare(right.id));
      providers.push({
        id,
        name: stringValue(value.name),
        npm: stringValue(value.npm) || "@ai-sdk/openai-compatible",
        baseUrl:
          stringValue(options.baseURL) || stringValue(options.baseUrl),
        apiKey: stringValue(options.apiKey) || authKeys[id] || "",
        setCacheKey: options.setCacheKey !== false,
        models,
      });
    }
  }
  providers.sort((left, right) => left.id.localeCompare(right.id));

  const permission = json.permission;
  return {
    path: filePath,
    installed,
    defaultAgent: stringValue(json.default_agent),
    permissions: {
      edit: permissionAction(permission, "edit"),
      bash: permissionAction(permission, "bash"),
      read: permissionAction(permission, "read"),
      webfetch: permissionAction(permission, "webfetch"),
    },
    providers,
    mcpServers: [],
  };
}

function buildModelJson(model: OpencodeModelEntry) {
  const result: Record<string, unknown> = {};
  if (model.name.trim() && model.name.trim() !== model.id.trim()) {
    result.name = model.name.trim();
  }
  if (model.limitContext !== null || model.limitOutput !== null) {
    result.limit = {
      ...(model.limitContext !== null ? { context: model.limitContext } : {}),
      ...(model.limitOutput !== null ? { output: model.limitOutput } : {}),
    };
  }
  if (model.modalitiesInput.length || model.modalitiesOutput.length) {
    result.modalities = {
      ...(model.modalitiesInput.length
        ? { input: model.modalitiesInput }
        : {}),
      ...(model.modalitiesOutput.length
        ? { output: model.modalitiesOutput }
        : {}),
    };
  }
  return result;
}

function buildProviderJson(entry: OpencodeProviderEntry) {
  const options: Record<string, unknown> = {};
  if (entry.baseUrl.trim()) options.baseURL = entry.baseUrl.trim();
  if (entry.setCacheKey) options.setCacheKey = true;
  const models: Record<string, unknown> = {};
  for (const model of entry.models) {
    const id = model.id.trim();
    if (!id) continue;
    models[id] = buildModelJson(model);
  }
  return {
    npm: entry.npm.trim() || "@ai-sdk/openai-compatible",
    ...(entry.name.trim() ? { name: entry.name.trim() } : {}),
    options,
    models,
  };
}

export function saveOpencodeConfigView(view: OpencodeConfigView) {
  const filePath = opencodeConfigPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(
      "OpenCode config file not found. Install and initialize OpenCode first.",
    );
  }
  const json = readJsonFile(filePath);
  const previousIds = new Set<string>();
  if (json.provider && typeof json.provider === "object") {
    for (const id of Object.keys(json.provider as Record<string, unknown>)) {
      previousIds.add(id);
    }
  }

  if (!json.$schema) json.$schema = "https://opencode.ai/config.json";

  const providerMap: Record<string, unknown> = {};
  const nextIds = new Set<string>();
  for (const entry of view.providers) {
    const id = entry.id.trim();
    if (!id) continue;
    nextIds.add(id);
    providerMap[id] = buildProviderJson(entry);
  }
  json.provider = providerMap;

  const defaultAgent = view.defaultAgent.trim();
  if (defaultAgent) {
    json.default_agent = defaultAgent;
  } else {
    delete json.default_agent;
  }

  const permission: Record<string, unknown> = {};
  for (const key of ["edit", "bash", "read", "webfetch"] as const) {
    const value = view.permissions[key].trim();
    if (value) permission[key] = value;
  }
  if (Object.keys(permission).length > 0) {
    json.permission = permission;
  } else {
    delete json.permission;
  }

  writeJsonFile(filePath, json);

  for (const id of previousIds) {
    if (!nextIds.has(id)) removeProviderAuth(id);
  }
  for (const entry of view.providers) {
    const id = entry.id.trim();
    if (!id) continue;
    if (entry.apiKey.trim()) {
      setProviderAuth(id, entry.apiKey);
    } else {
      removeProviderAuth(id);
    }
  }
}

export function defaultAppConfig(port: number) {
  return {
    app: {
      default_provider: "opencode",
      theme: "dark",
      default_model: "",
    },
    providers: [
      {
        id: "opencode",
        type: "http",
        command: "opencode",
        args: [
          "serve",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        config_path: opencodeConfigPath(),
        health_cmd: ["opencode", "--version"],
      },
    ],
  };
}

export function appConfigPath(storageDir: string) {
  return path.join(storageDir, "xcoder-config.json");
}

export function loadAppConfig(storageDir: string, port: number) {
  const defaults = defaultAppConfig(port);
  const filePath = appConfigPath(storageDir);
  if (!fs.existsSync(filePath)) return defaults;
  const stored = readJsonFile(filePath);
  const app =
    stored.app && typeof stored.app === "object"
      ? (stored.app as Record<string, unknown>)
      : {};
  return {
    app: {
      default_provider:
        stringValue(app.default_provider) || defaults.app.default_provider,
      theme: stringValue(app.theme) || defaults.app.theme,
      default_model: stringValue(app.default_model),
    },
    providers: Array.isArray(stored.providers)
      ? stored.providers
      : defaults.providers,
  };
}

export function saveAppConfig(storageDir: string, config: unknown) {
  writeJsonFile(appConfigPath(storageDir), config);
}
