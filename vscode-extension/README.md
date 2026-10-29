# Xcoder for VS Code

This extension embeds Xcoder's chat panel and OpenCode preferences inside VS Code.

## Usage

- Open a folder in VS Code.
- If the opened folder contains a `.xcoder` directory, chat opens automatically on the right and connects to OpenCode.
- Otherwise click the **Xcoder** status bar item or run `Xcoder: Open Chat` to open and connect the chat panel.
- Attach files with the `@` button in the chat header, or right-click files/folders in Explorer and choose `Xcoder: Add to Chat`.
- Run `Xcoder: Open Preferences` to edit general settings, OpenCode providers, OpenCode Go credentials, and project settings.
- Project preferences are stored in `.xcoder/config.json`.
- Local chat history is stored in `.opencode/history`.
- Project skills are read from `.opencode/skills` (also `.agents/skills` and `.claude/skills`).
- Run `Xcoder: Restart OpenCode Runtime` after changing provider credentials or config.

## Settings

- `xcoder.opencodePort` (default `4096`): port of the shared OpenCode server. Use the same port as the desktop app to share one OpenCode process.
- `xcoder.opencodeCommand` (default `opencode`): OpenCode executable name or path.

## Build

Requires Node.js 18+ and VS Code 1.85+.

From the repository root:

```bash
npm install
npm run vscode:export
```

This builds the webview, compiles the extension host, and packages:

```text
dist-vscode/xcoder-vscode.vsix
```

To compile without creating a VSIX:

```bash
npm run vscode:package
```

Install or update the extension:

```bash
code --install-extension dist-vscode/xcoder-vscode.vsix --force
```

Then run **Developer: Reload Window** from the Command Palette. View contributions are not reloaded until the window reloads.

The chat view uses the Secondary Side Bar to stay full height beside the bottom Terminal panel. This layout requires VS Code; Cursor currently rejects extension `secondarySidebar` contributions.
