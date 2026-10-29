import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { XcoderBridge } from "./bridge";
import { OpenCodeService } from "./opencode";

let service: OpenCodeService | undefined;
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

function hasXcoderDir(workspace: string | null) {
  if (!workspace) return false;
  try {
    return fs.statSync(path.join(workspace, ".xcoder")).isDirectory();
  } catch {
    return false;
  }
}

function shouldAutoOpen() {
  return vscode.workspace.isTrusted && hasXcoderDir(workspacePath());
}

function collectUriPaths(values: unknown[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (value instanceof vscode.Uri) {
      const fsPath = value.fsPath;
      if (fsPath && !seen.has(fsPath)) {
        seen.add(fsPath);
        paths.push(fsPath);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      visit(record.resourceUri ?? record.uri);
    }
  };
  for (const value of values) visit(value);
  return paths;
}

function buildWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri) {
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

class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pendingAttachments: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: OpenCodeService,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void | Thenable<void> {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "resources"),
      ],
    };
    view.webview.html = buildWebviewHtml(
      view.webview,
      this.context.extensionUri,
    );
    const bridge = new XcoderBridge({
      post: (message) => {
        void view.webview.postMessage(message);
      },
      service: this.service,
      context: this.context,
      getWorkspace: workspacePath,
    });
    webviews.set(view.webview, bridge);

    view.webview.onDidReceiveMessage((message) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: unknown }).type === "ready"
      ) {
        this.ready = true;
        this.flushAttachments();
      }
      void handleWebviewMessage(message, view.webview, bridge, "chat");
    });
    view.onDidDispose(() => {
      webviews.delete(view.webview);
      this.ready = false;
      if (this.view === view) this.view = undefined;
    });
    postInit(view.webview, "chat");
  }

  async attach(paths: string[]) {
    const unique = Array.from(
      new Set(paths.filter((path) => typeof path === "string" && path)),
    );
    if (unique.length === 0) return;
    this.pendingAttachments.push(...unique);
    await this.show();
    this.flushAttachments();
  }

  private flushAttachments() {
    if (!this.ready || !this.view || this.pendingAttachments.length === 0) {
      return;
    }
    const paths = this.pendingAttachments.splice(0);
    void this.view.webview.postMessage({ type: "attach-paths", paths });
  }

  async show() {
    try {
      await vscode.commands.executeCommand(
        "workbench.action.focusAuxiliaryBar",
      );
    } catch {
      // older builds may not expose this command
    }
    if (this.view) {
      this.view.show(false);
      postInit(this.view.webview, "chat");
      this.flushAttachments();
      return;
    }
    try {
      await vscode.commands.executeCommand("xcoder-chat-right.focus");
    } catch {
      // the view will be resolved when the user opens it manually
    }
  }
}

function openPreferences(
  context: vscode.ExtensionContext,
  service: OpenCodeService,
) {
  if (preferencesPanel) {
    preferencesPanel.reveal(undefined, true);
    postInit(preferencesPanel.webview, "preferences");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "xcoder.preferences",
    "Xcoder Preferences",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "media"),
        vscode.Uri.joinPath(context.extensionUri, "resources"),
      ],
    },
  );
  preferencesPanel = panel;
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
    void handleWebviewMessage(message, panel.webview, bridge, "preferences");
  });
  panel.onDidDispose(() => {
    webviews.delete(panel.webview);
    preferencesPanel = undefined;
  });
  postInit(panel.webview, "preferences");
}

export function activate(context: vscode.ExtensionContext) {
  service = new OpenCodeService(context);
  const sharedService = service;
  const chatProvider = new ChatViewProvider(context, sharedService);

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
    vscode.window.registerWebviewViewProvider("xcoder-chat-right", chatProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand("xcoder.openChat", () => {
      void chatProvider.show();
    }),
    vscode.commands.registerCommand("xcoder.openPreferences", () => {
      openPreferences(context, sharedService);
    }),
    vscode.commands.registerCommand(
      "xcoder.attachToChat",
      async (...args: unknown[]) => {
        const paths = collectUriPaths(args);
        if (paths.length > 0) await chatProvider.attach(paths);
      },
    ),
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
      if (shouldAutoOpen()) {
        void chatProvider.show();
      }
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

  if (shouldAutoOpen()) {
    void chatProvider.show();
  }
}

export async function deactivate() {
  await service?.dispose();
  service = undefined;
}
