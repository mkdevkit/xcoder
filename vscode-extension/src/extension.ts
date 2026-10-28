import fs from "node:fs";
import * as vscode from "vscode";
import { XcoderBridge } from "./bridge";
import { OpenCodeService } from "./opencode";

let service: OpenCodeService | undefined;
let chatPanel: vscode.WebviewPanel | undefined;
let preferencesPanel: vscode.WebviewPanel | undefined;
const webviews = new Map<vscode.Webview, XcoderBridge>();

type WebviewKind = "chat" | "preferences";

function workspacePath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function themeName() {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
    ? "light"
    : "dark";
}

function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
) {
  const htmlPath = vscode.Uri.joinPath(
    extensionUri,
    "media",
    "vscode-webview.html",
  );
  if (!fs.existsSync(htmlPath.fsPath)) {
    return `<!doctype html><html><body style="padding:24px;font-family:sans-serif">
      <h3>xcoder webview is not built</h3>
      <p>Run <code>npm run build:vscode</code> and reload the extension.</p>
    </body></html>`;
  }

  const mediaUri = vscode.Uri.joinPath(extensionUri, "media");
  const base = `${webview.asWebviewUri(mediaUri).toString()}/`;
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: https:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `font-src ${webview.cspSource} data:`,
    `connect-src ${webview.cspSource} http://127.0.0.1:* ws://127.0.0.1:*`,
  ].join("; ");

  const raw = fs.readFileSync(htmlPath.fsPath, "utf8");
  return raw.replace(
    "<head>",
    `<head>
  <base href="${base}">
  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
  );
}

function postInit(webview: vscode.Webview, view: WebviewKind) {
  void webview.postMessage({
    type: "init",
    view,
    workspace: workspacePath(),
    theme: themeName(),
  });
}

async function handleWebviewMessage(
  message: unknown,
  webview: vscode.Webview,
  bridge: XcoderBridge,
  view: WebviewKind,
) {
  if (!message || typeof message !== "object") return;
  const record = message as Record<string, unknown>;
  if (record.type === "ready") {
    postInit(webview, view);
    return;
  }
  if (record.type !== "invoke") return;
  const id = record.id;
  const command = record.cmd;
  if (typeof id !== "number" || typeof command !== "string") return;
  const args =
    record.args && typeof record.args === "object"
      ? (record.args as Record<string, unknown>)
      : {};
  try {
    const result = await bridge.handleInvoke(command, args);
    await webview.postMessage({
      type: "invoke-result",
      id,
      ok: true,
      result,
    });
  } catch (error) {
    await webview.postMessage({
      type: "invoke-result",
      id,
      ok: false,
      error: String(error),
    });
  }
}

function openWebviewPanel(
  context: vscode.ExtensionContext,
  service: OpenCodeService,
  view: WebviewKind,
) {
  const existing = view === "chat" ? chatPanel : preferencesPanel;
  if (existing) {
    existing.reveal(undefined, view !== "chat");
    postInit(existing.webview, view);
    return existing;
  }

  const title = view === "chat" ? "Xcoder Chat" : "Xcoder Preferences";
  const column =
    view === "chat" ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
  const panel = vscode.window.createWebviewPanel(
    `xcoder.${view}`,
    title,
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "media"),
        vscode.Uri.joinPath(context.extensionUri, "resources"),
      ],
    },
  );

  if (view === "chat") {
    chatPanel = panel;
  } else {
    preferencesPanel = panel;
  }

  panel.webview.html = buildWebviewHtml(panel.webview, context.extensionUri);
  const bridge = new XcoderBridge({
    post: (message) => {
      void panel.webview.postMessage(message);
    },
    service,
    context,
    getWorkspace: workspacePath,
  });
  webviews.set(panel.webview, bridge);
  panel.webview.onDidReceiveMessage((message) => {
    void handleWebviewMessage(message, panel.webview, bridge, view);
  });
  panel.onDidDispose(() => {
    webviews.delete(panel.webview);
    if (view === "chat") {
      chatPanel = undefined;
    } else {
      preferencesPanel = undefined;
    }
  });
  postInit(panel.webview, view);
  return panel;
}

export function activate(context: vscode.ExtensionContext) {
  service = new OpenCodeService(context);
  const sharedService = service;

  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90,
  );
  statusItem.name = "Xcoder";
  statusItem.text = "$(comment-discussion) Xcoder";
  statusItem.tooltip = "Open Xcoder Chat";
  statusItem.command = "xcoder.openChat";
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("xcoder.openChat", () => {
      openWebviewPanel(context, sharedService, "chat");
    }),
    vscode.commands.registerCommand("xcoder.openPreferences", () => {
      openWebviewPanel(context, sharedService, "preferences");
    }),
    vscode.commands.registerCommand("xcoder.restartRuntime", async () => {
      try {
        await sharedService.restart(workspacePath());
        void vscode.window.showInformationMessage("OpenCode runtime restarted");
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to restart OpenCode runtime: ${String(error)}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const workspace = workspacePath();
      for (const webview of webviews.keys()) {
        void webview.postMessage({ type: "workspace", workspace });
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      for (const webview of webviews.keys()) {
        void webview.postMessage({
          type: "init",
          workspace: workspacePath(),
          theme: themeName(),
        });
      }
    }),
  );
}

export async function deactivate() {
  await service?.dispose();
  service = undefined;
}
