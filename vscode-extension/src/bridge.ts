import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import {
  defaultAppConfig,
  appConfigPath,
  loadAppConfig,
  loadOpencodeConfigView,
  readAuthKeys,
  removeProviderAuth,
  saveAppConfig,
  saveOpencodeConfigView,
  setProviderAuth,
} from "./config";
import {
  deleteLocalSession,
  getActiveLocalSession,
  listLocalSessions,
  loadLocalSession,
  saveLocalSession,
  setActiveLocalSession,
} from "./localHistory";
import { OpenCodeService } from "./opencode";
import {
  ensureProjectConfig,
  loadProjectConfig,
  saveProjectConfig,
  syncProjectOpenCodeFromConfig,
  type ProjectConfig,
} from "./projectConfig";
import {
  installProjectSkill,
  listProjectSkills,
  loadSkillCatalog,
  removeProjectSkill,
} from "./skills";
import type { HistoryMessage, LocalChatSession } from "./types";

type InvokeArgs = Record<string, unknown>;

interface BridgeOptions {
  post: (message: unknown) => void;
  service: OpenCodeService;
  context: vscode.ExtensionContext;
  getWorkspace: () => string | null;
}

function stringArg(args: InvokeArgs, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function numberArg(args: InvokeArgs, key: string) {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}

function sameDirectory(left: string, right: string) {
  const normalize = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return normalize(left) === normalize(right);
}

export class XcoderBridge {
  private readonly listeners = new Map<number, string>();

  constructor(private readonly options: BridgeOptions) {}

  private get workspace() {
    return this.options.getWorkspace();
  }

  async handleInvoke(
    command: string,
    args: InvokeArgs,
  ): Promise<unknown> {
    switch (command) {
      case "plugin:event|listen": {
        const handler = numberArg(args, "handler");
        const event = stringArg(args, "event");
        if (handler !== undefined && event) {
          this.listeners.set(handler, event);
        }
        return handler ?? 0;
      }
      case "plugin:event|unlisten": {
        const eventId = numberArg(args, "eventId");
        if (eventId !== undefined) this.listeners.delete(eventId);
        return null;
      }
      case "xcoder_clipboard_read":
        return vscode.env.clipboard.readText();
      case "xcoder_clipboard_write":
        await vscode.env.clipboard.writeText(stringArg(args, "text"));
        return null;

      case "plugin:dialog|open":
        return this.openDialog(args);
      case "plugin:dialog|save":
        return this.saveDialog(args);
      case "plugin:dialog|message":
        return this.messageDialog(args);
      case "plugin:opener|open_url": {
        const url = stringArg(args, "url");
        if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
        return null;
      }
      case "plugin:opener|open_path": {
        const filePath = stringArg(args, "path");
        if (filePath) {
          await vscode.commands.executeCommand(
            "vscode.open",
            vscode.Uri.file(filePath),
          );
        }
        return null;
      }
      case "plugin:opener|reveal_item_in_dir": {
        const paths = args.paths;
        const first = Array.isArray(paths) ? paths[0] : undefined;
        if (typeof first === "string") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(first),
          );
        }
        return null;
      }

      case "load_config":
        return this.withRuntimePort(
          loadAppConfig(
            this.options.context.globalStorageUri.fsPath,
            this.options.service.port,
          ),
        );
      case "save_config": {
        const config = args.config;
        saveAppConfig(this.options.context.globalStorageUri.fsPath, config);
        return null;
      }
      case "get_config_paths": {
        const dir = this.options.context.globalStorageUri.fsPath;
        const file = appConfigPath(dir);
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file)) {
          fs.writeFileSync(
            file,
            `${JSON.stringify(
              defaultAppConfig(this.options.service.port),
              null,
              2,
            )}\n`,
            "utf8",
          );
        }
        return { dir, file };
      }

      case "ensure_project_config_cmd": {
        const workspace = stringArg(args, "workspace") || this.workspace;
        if (!workspace) throw new Error("Workspace is required");
        const app = loadAppConfig(
          this.options.context.globalStorageUri.fsPath,
          this.options.service.port,
        );
        return ensureProjectConfig(
          workspace,
          app.app.default_provider,
          app.app.default_model,
        );
      }
      case "load_project_config_cmd": {
        const workspace = stringArg(args, "workspace") || this.workspace;
        if (!workspace) throw new Error("Workspace is required");
        return {
          config: loadProjectConfig(workspace),
          path: path.join(workspace, ".xcoder", "config.json"),
        };
      }
      case "save_project_config_cmd": {
        const workspace = stringArg(args, "workspace") || this.workspace;
        const config = args.config;
        if (!workspace) throw new Error("Workspace is required");
        if (!config || typeof config !== "object") {
          throw new Error("Invalid project config");
        }
        return saveProjectConfig(workspace, config as ProjectConfig);
      }

      case "load_opencode_provider_config":
        return loadOpencodeConfigView();
      case "save_opencode_provider_config": {
        const config = args.config;
        if (!config || typeof config !== "object") {
          throw new Error("Invalid OpenCode config");
        }
        saveOpencodeConfigView(
          config as Parameters<typeof saveOpencodeConfigView>[0],
        );
        return { warnings: [] };
      }
      case "get_opencode_provider_auth_status": {
        const provider = stringArg(args, "provider");
        return Boolean(readAuthKeys()[provider]);
      }
      case "set_opencode_provider_auth":
        setProviderAuth(
          stringArg(args, "provider"),
          stringArg(args, "apiKey"),
        );
        return null;
      case "clear_opencode_provider_auth":
        removeProviderAuth(stringArg(args, "provider"));
        return null;

      case "opencode_doctor":
        return {
          installed: true,
          command: this.options.service.command,
        };
      case "opencode_start_runtime": {
        const workspace = stringArg(args, "workspace") || this.workspace;
        if (workspace) syncProjectOpenCodeFromConfig(workspace);
        if (args.spawnIfMissing === false) {
          return this.options.service.status();
        }
        return this.options.service.start(workspace);
      }
      case "opencode_restart_runtime": {
        const workspace = stringArg(args, "workspace") || this.workspace;
        if (workspace) syncProjectOpenCodeFromConfig(workspace);
        return this.options.service.restart(workspace);
      }
      case "opencode_stop_runtime":
        await this.options.service.stop();
        return null;
      case "opencode_runtime_status":
        return this.options.service.status();
      case "opencode_list_agents":
        return this.options.service.listAgents();
      case "opencode_list_provider_models":
        return this.options.service.listProviderModels();
      case "opencode_set_thread_mode":
        return null;
      case "opencode_subscribe_events":
        return null;
      case "opencode_create_thread": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        return this.options.service.createThread(
          workspace,
          stringArg(args, "mode") || "build",
          stringArg(args, "title"),
        );
      }
      case "opencode_send_turn":
        await this.options.service.sendTurn({
          threadId: stringArg(args, "threadId"),
          message: stringArg(args, "message"),
          mode: stringArg(args, "mode") || "build",
          model: stringArg(args, "model") || null,
          workspace: stringArg(args, "workspace") || this.workspace,
          messageId: stringArg(args, "messageId") || null,
        });
        return null;
      case "opencode_cancel_turn":
        await this.options.service.cancelTurn(
          stringArg(args, "sessionId"),
          stringArg(args, "workspace") || this.workspace,
        );
        return null;
      case "opencode_approve":
        await this.options.service.approve(
          stringArg(args, "threadId"),
          stringArg(args, "approvalId"),
          args.allow === true,
          this.workspace,
        );
        return null;
      case "opencode_list_sessions": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        return this.options.service.listSessions(
          workspace,
          numberArg(args, "limit") ?? 50,
        );
      }
      case "opencode_load_session_history": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        return this.options.service.messages(
          stringArg(args, "sessionId"),
          workspace,
          numberArg(args, "limit"),
        );
      }
      case "opencode_poll_turn": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        return this.options.service.pollTurn(
          stringArg(args, "sessionId"),
          workspace,
          numberArg(args, "limit"),
        );
      }
      case "opencode_poll_status": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        return this.options.service.statusPoll(
          stringArg(args, "sessionId"),
          workspace,
        );
      }
      case "opencode_is_session_busy": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        const status = await this.options.service.statusPoll(
          stringArg(args, "sessionId"),
          workspace,
        );
        return status.busy;
      }
      case "opencode_get_pending_approval": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        const status = await this.options.service.statusPoll(
          stringArg(args, "sessionId"),
          workspace,
        );
        return status.pending;
      }
      case "opencode_get_pending_question": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        const status = await this.options.service.statusPoll(
          stringArg(args, "sessionId"),
          workspace,
        );
        return status.pending_question;
      }
      case "opencode_reply_question":
        await this.options.service.replyQuestion(
          stringArg(args, "requestId"),
          Array.isArray(args.answers) ? (args.answers as string[][]) : [],
          stringArg(args, "workspace") || this.workspace,
        );
        return null;
      case "opencode_reject_question":
        await this.options.service.rejectQuestion(
          stringArg(args, "requestId"),
          stringArg(args, "workspace") || this.workspace,
        );
        return null;
      case "opencode_delete_session":
        await this.options.service.deleteSession(
          stringArg(args, "sessionId"),
          stringArg(args, "workspace") || this.workspace,
        );
        return null;
      case "opencode_update_session_title":
        await this.options.service.updateTitle(
          stringArg(args, "sessionId"),
          stringArg(args, "title"),
          stringArg(args, "workspace") || this.workspace || "",
        );
        return null;
      case "opencode_list_migratable_sessions":
        return this.options.service.listMigratableSessions(
          numberArg(args, "limit") ?? 500,
        );
      case "opencode_migrate_sessions": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        if (!workspace) throw new Error("Workspace is required");
        const sessionIds = Array.isArray(args.sessionIds)
          ? args.sessionIds.filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            )
          : [];
        return this.options.service.migrateSessions(sessionIds, workspace);
      }

      case "load_skill_catalog_cmd":
        return loadSkillCatalog(this.options.context.extensionUri.fsPath);
      case "list_project_skills_cmd":
        return listProjectSkills(
          stringArg(args, "workspace") || this.workspace || "",
          stringArg(args, "providerId"),
        );
      case "install_project_skill_cmd": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        const providerId = stringArg(args, "providerId");
        await installProjectSkill(
          workspace,
          providerId,
          stringArg(args, "source"),
          stringArg(args, "skillName"),
        );
        return listProjectSkills(workspace, providerId);
      }
      case "remove_project_skill_cmd": {
        const workspace = stringArg(args, "workspace") || this.workspace || "";
        const providerId = stringArg(args, "providerId");
        await removeProjectSkill(
          workspace,
          providerId,
          stringArg(args, "skillName"),
        );
        return listProjectSkills(workspace, providerId);
      }

      case "list_local_chat_sessions":
        return listLocalSessions(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
        );
      case "load_local_chat_session":
        return loadLocalSession(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
          stringArg(args, "sessionId"),
        );
      case "save_local_chat_history": {
        const messages = Array.isArray(args.messages)
          ? (args.messages as HistoryMessage[])
          : [];
        const session: LocalChatSession = {
          id: stringArg(args, "sessionId"),
          title: stringArg(args, "title"),
          mode: stringArg(args, "mode") || undefined,
          model: stringArg(args, "model") || undefined,
          messages,
          updated_at: stringArg(args, "updatedAt") || new Date().toISOString(),
        };
        const meta = saveLocalSession(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
          session,
          args.setActive !== false,
        );
        return meta;
      }
      case "delete_local_chat_session":
        deleteLocalSession(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
          stringArg(args, "sessionId"),
        );
        return null;
      case "get_local_active_session_id":
        return getActiveLocalSession(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
        );
      case "set_local_active_session_id":
        setActiveLocalSession(
          stringArg(args, "workspace"),
          stringArg(args, "provider"),
          stringArg(args, "sessionId") || null,
        );
        return null;

      case "query_opencode_mcp_status":
        return {
          output: "MCP management is not available in the VS Code extension yet.",
          servers: [],
        };
      case "apply_mcp_server_connection":
        return {
          output: "Save the provider configuration to apply MCP changes.",
          servers: Array.isArray(args.servers) ? args.servers : [],
        };

      case "list_directory":
        return this.listDirectory(stringArg(args, "path"));
      case "read_file":
        return this.readFile(stringArg(args, "path"));
      case "write_file":
        fs.writeFileSync(stringArg(args, "path"), stringArg(args, "content"));
        return null;
      case "create_path":
        return this.createPath(args);
      case "rename_path": {
        const source = stringArg(args, "path");
        const newName = stringArg(args, "newName");
        const target = path.join(path.dirname(source), newName);
        fs.renameSync(source, target);
        return target;
      }
      case "delete_path":
        fs.rmSync(stringArg(args, "path"), { recursive: true, force: true });
        return null;
      case "copy_paths_into_directory":
        return this.copyOrMove(args, "copy");
      case "move_paths_into_directory":
        return this.copyOrMove(args, "move");
      case "reveal_path_in_explorer":
      case "open_directory_in_explorer": {
        const target = stringArg(args, "path");
        if (target) {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(target),
          );
        }
        return null;
      }
      case "start_workspace_watch":
      case "stop_workspace_watch":
        return null;

      default:
        throw new Error(`Unsupported xcoder command: ${command}`);
    }
  }

  private withRuntimePort<T>(config: T): T {
    const record = config as
      | { providers?: { id?: string; args?: unknown }[] }
      | undefined;
    const provider = record?.providers?.find(
      (item) => item.id === "opencode",
    );
    if (!provider) return config;
    const args = Array.isArray(provider.args)
      ? [...(provider.args as string[])]
      : [];
    const setArg = (flag: string, value: string) => {
      const index = args.indexOf(flag);
      if (index >= 0) {
        args[index + 1] = value;
      } else {
        args.push(flag, value);
      }
    };
    setArg("--hostname", "127.0.0.1");
    setArg("--port", String(this.options.service.port));
    provider.args = args;
    return config;
  }

  private async openDialog(args: InvokeArgs) {
    const options = (args.options ?? {}) as Record<string, unknown>;
    const canSelectFolders = options.directory === true;
    const canSelectMany = options.multiple === true;
    const defaultPath =
      typeof options.defaultPath === "string" ? options.defaultPath : undefined;
    const selected = await vscode.window.showOpenDialog({
      canSelectFolders,
      canSelectFiles: !canSelectFolders,
      canSelectMany,
      defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
      openLabel: typeof options.title === "string" ? options.title : undefined,
    });
    if (!selected || selected.length === 0) return null;
    const paths = selected.map((uri) => uri.fsPath);
    return canSelectMany ? paths : paths[0];
  }

  private async saveDialog(args: InvokeArgs) {
    const options = (args.options ?? {}) as Record<string, unknown>;
    const defaultPath =
      typeof options.defaultPath === "string" ? options.defaultPath : undefined;
    const selected = await vscode.window.showSaveDialog({
      defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
      saveLabel: typeof options.title === "string" ? options.title : undefined,
    });
    return selected?.fsPath ?? null;
  }

  private async messageDialog(args: InvokeArgs) {
    const message = stringArg(args, "message");
    const kind = stringArg(args, "kind");
    const buttons = args.buttons as
      | string
      | { ok?: string; cancel?: string; yes?: string; no?: string }
      | undefined;

    if (typeof buttons === "string") {
      if (buttons.includes("Cancel")) {
        const okLabel = buttons.startsWith("YesNo") ? "Yes" : "Ok";
        const pick = await vscode.window.showWarningMessage(
          message,
          { modal: true },
          okLabel,
          "Cancel",
        );
        return pick ?? null;
      }
      const okLabel = buttons === "Ok" ? "Ok" : buttons;
      const pick = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        okLabel,
      );
      return pick ?? null;
    }

    if (buttons && typeof buttons === "object") {
      const labels = [buttons.yes ?? buttons.ok, buttons.no, buttons.cancel]
        .filter((label): label is string => !!label);
      if (labels.length > 0) {
        const pick =
          kind === "error"
            ? await vscode.window.showErrorMessage(
                message,
                { modal: true },
                ...labels,
              )
            : kind === "warning"
              ? await vscode.window.showWarningMessage(
                  message,
                  { modal: true },
                  ...labels,
                )
              : await vscode.window.showInformationMessage(
                  message,
                  { modal: true },
                  ...labels,
                );
        return pick ?? null;
      }
    }

    if (kind === "error") {
      await vscode.window.showErrorMessage(message, { modal: true });
    } else if (kind === "warning") {
      await vscode.window.showWarningMessage(message, { modal: true });
    } else {
      await vscode.window.showInformationMessage(message, { modal: true });
    }
    return "Ok";
  }

  private listDirectory(dirPath: string) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const skip = new Set([
      ".git",
      "node_modules",
      "target",
      "dist",
      ".specstory",
      ".cursor",
    ]);
    return entries
      .filter((entry) => !(entry.name.startsWith(".") && skip.has(entry.name)))
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        return {
          name: entry.name,
          path: fullPath,
          is_dir: entry.isDirectory(),
        };
      })
      .sort((left, right) => {
        if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }

  private async readFile(filePath: string) {
    const content = fs.readFileSync(filePath, "utf8");
    const workspace = this.workspace;
    const outsideWorkspace =
      !workspace || !sameDirectory(path.dirname(filePath), workspace);
    if (outsideWorkspace) {
      await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
        preview: true,
      });
    }
    return content;
  }

  private createPath(args: InvokeArgs) {
    const parent = stringArg(args, "parent");
    const name = stringArg(args, "name");
    const isDir = args.isDir === true;
    const target = path.join(parent, name);
    if (isDir) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
    return target;
  }

  private copyOrMove(args: InvokeArgs, mode: "copy" | "move") {
    const destination = stringArg(args, "destinationDir");
    const sources = Array.isArray(args.sources)
      ? (args.sources as string[])
      : [];
    const results: string[] = [];
    for (const source of sources) {
      const target = path.join(destination, path.basename(source));
      if (mode === "copy") {
        fs.cpSync(source, target, { recursive: true });
      } else {
        fs.renameSync(source, target);
      }
      results.push(target);
    }
    return results;
  }

  emit(event: string, payload: unknown) {
    const eventId = `${event}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    for (const [callbackId, name] of this.listeners) {
      if (name !== event) continue;
      this.options.post({
        type: "event",
        callbackId,
        event,
        eventId,
        payload,
      });
    }
  }
}
