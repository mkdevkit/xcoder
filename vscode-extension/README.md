# Xcoder for VS Code

This extension embeds Xcoder's chat panel and OpenCode preferences inside VS Code.

## Usage

- Open a folder in VS Code.
- Click the **Xcoder** status bar item or run `Xcoder: Open Chat` to open the chat panel on the right side of the editor.
- Run `Xcoder: Open Preferences` to edit general settings, OpenCode providers, OpenCode Go credentials, and project settings.
- Project preferences are stored in `.xcoder/config.json`.
- Local chat history is stored in `.opencode/history`.
- Project skills are read from `.opencode/skills` (also `.agents/skills` and `.claude/skills`).
- Run `Xcoder: Restart OpenCode Runtime` after changing provider credentials or config.

## Settings

- `xcoder.opencodePort` (default `4097`): port used by the OpenCode server started by the extension.
- `xcoder.opencodeCommand` (default `opencode`): OpenCode executable name or path.

## Build

From the repository root:

```bash
npm run build:vscode
npx tsc -p vscode-extension/tsconfig.json
```

To produce a `.vsix` package:

```bash
npm run vscode:export
```
