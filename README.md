# xcoder

An AI coding workbench built with Tauri, integrating [CodeWhale](https://www.codewhale.ai/) and [OpenCode](https://opencode.ai/).

**中文文档:** [README.zh.md](./README.zh.md)

## Features

- **Three-column layout**: Explorer · Monaco editor · AI chat, with draggable panel widths
- **Project browsing & editing**: Open local folders, multi-tab editing, save, auto-reload on external changes
- **Dual AI backends**: CodeWhale / OpenCode with streaming chat, tool calls, and approval gate
- **Sessions & history**: Per-project local chat history (`.codewhale/history`, `.opencode/history`)
- **Cursor-like workflow**: Drag files into chat, `@` path references, Markdown rendering, context menus
- **Integrated terminal**: Multi-tab PTY with project root as default cwd
- **Multilingual UI**: Chinese, English, Japanese, French, German, Russian, Spanish, Portuguese, Italian — switch instantly in Preferences

---

## Quick start

1. Install [prerequisites](#prerequisites) and at least one AI backend (CodeWhale or OpenCode).
2. Configure API keys and `config.toml` as described in [Configuration](#configuration).
3. Launch the app:
   ```bash
   npm install
   npm run tauri dev
   ```
   Use the **Tauri desktop window** — do not open `http://localhost:1420` in a browser.
4. **File → Open Project** and select the project root.
5. Click **Connect** in the chat panel (runs a health check and starts the runtime in the background).
6. **Select a session** from the dropdown, or click **+** to **create a new session**.
7. Type your task and **Send**; when the AI requests a sensitive tool, **Allow** or **Deny** in the chat stream.

---

## Usage guide

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Menu bar · workspace path · active file                         │
├──────────┬─────────────────────────────┬─────────────────────┤
│ Explorer │ Editor (multi-tab)            │ AI chat             │
│          │                             │                     │
│          ├─────────────────────────────┤                     │
│          │ Terminal (after first tab)  │                     │
└──────────┴─────────────────────────────┴─────────────────────┘
```

- Drag the **sidebar / chat** splitters to resize panel widths.
- When the terminal is visible, drag the **editor / terminal** splitter to resize terminal height.
- The terminal area hides automatically when all terminal tabs are closed.

### Menu bar

| Menu | Item | Description |
|------|------|-------------|
| **File** | Open Project | Select a local project root |
| | Preferences | Open visual settings (language, etc.) in the editor area |
| | **Configuration** → Open Config Folder | Open xcoder's config directory in the system file manager |
| | **Configuration** → Open config.toml | Edit xcoder's `config.toml` |
| | **Configuration** → Open opencode.json | Edit OpenCode global config |
| | **Configuration** → Open codewhale.json | Opens `~/.codewhale/config.toml` (TOML, not JSON) |
| **Terminal** | New Terminal | Start a PTY in the project directory (if open) |

### Explorer

- After **Open Project**, the file tree appears; click folders to expand/collapse, files to open in the editor.
- These **dot directories** are hidden by default: `.git`, `node_modules`, `target`, `dist`, `.specstory`, `.cursor`.  
  Other dot dirs such as `.codewhale` and `.opencode` **are shown** (including local chat history).
- **Select** a file or folder, then use shortcuts or the context menu (focus the explorer first by clicking it).

| Action | How |
|--------|-----|
| New file / folder | Right-click → New |
| Rename | Right-click → Rename, or **F2** |
| Delete | Right-click → Delete, or **Del** (native Tauri confirm dialog) |
| Copy path | Right-click → Copy Path |
| Refresh | Right-click → Refresh |
| Re-open project | Right-click → Open Project Folder |

### Editor

- **Multi-tab** editing; **●** on a tab means unsaved changes.
- **Ctrl+S**: save the active file.
- External file changes auto-reload when the tab is **not dirty**.
- **File → Preferences** opens a virtual tab `xcoder://preferences` (not a disk file).

Editor tab **right-click**:

| Item | Description |
|------|-------------|
| Save | Save current file (when dirty) |
| Reload File | Re-read from disk |
| Reveal in Explorer | Show file in system file manager |
| Close Tab | Close the tab |

### AI chat

#### Recommended workflow

1. **Open a project** (required before connecting with **OpenCode**).
2. Click **Connect** — xcoder starts `codewhale serve` or `opencode serve` in the background (release builds hide the CMD window).
3. Sessions are **not** auto-selected or created; pick a **historical session** or click **+** for a **new session**.
4. **Send** messages; **Enter** to send, **Shift+Enter** for a newline.
5. **Disconnect** stops the runtime and **clears** the current session and messages.

#### Panel controls

| Control | Description |
|---------|-------------|
| Provider dropdown | Switch when multiple providers are configured in `config.toml` |
| Mode | Fetched at runtime — CodeWhale: `plan` / `agent` / `yolo`; OpenCode: from `/agent` |
| Model provider | OpenCode only — lists configured providers (e.g. `deepseek`, `zhipu-coding`) |
| Model | Fetched at runtime — CodeWhale: `codewhale model list`; OpenCode: models for the selected provider |
| Connect / Disconnect | Start or stop the AI runtime |
| Session dropdown | Switch sessions (merged local + remote list) |
| × | Delete current session (with confirmation) |
| + | Create new session |

#### Drag file references (Cursor-like)

After a project is open, drag file references into the chat input (no need to connect first):

| Source | Action |
|--------|--------|
| Explorer | Drag a file or folder into the input |
| Editor tab | Drag an open file tab into the input |
| System file manager | Drop files onto the input (Tauri window drag-drop) |

Inserts **`@relative/path`** at the cursor, e.g. `@src/App.tsx`. Paths outside the project use an absolute `@` path. Multiple files are separated by spaces.

#### Tool approval

When the AI requests file writes, commands, etc., an **approval card** appears in the chat — click **Allow** or **Deny**. Policy can also be tuned in CodeWhale / OpenCode native config (`approval_mode`, etc.).

#### Message display

- User / assistant messages render **Markdown**.
- Tool calls appear as collapsible cards with expandable details.

### Terminal

- **Terminal → New Terminal**, or right-click empty area / terminal → New Terminal.
- Default cwd is the **project root** when a project is open.
- Multiple terminals show a **sidebar** to switch tabs; **+** creates, **×** closes the active one.
- Select text in the terminal, then **right-click → Copy**.
- **Clickable links** open in the system browser.

### Preferences & language

**File → Preferences** opens the settings page:

| Setting | Description |
|---------|-------------|
| Interface language | 9 languages; changes apply immediately |
| Appearance | Placeholder for future options |

Language is stored in `localStorage` (`xcoder:locale`).

### Global context menu

Right-click on empty/workbench area:

| Item | Description |
|------|-------------|
| Open Project Folder | Re-select project |
| New Terminal | Create terminal |
| Copy project path | Copy workspace root to clipboard |

### Keyboard shortcuts

| Shortcut | Scope | Action |
|----------|-------|--------|
| **Ctrl+S** | Global (editor focused) | Save active file |
| **F2** | Explorer selection | Rename |
| **Del** | Explorer selection | Delete (with confirm) |
| **Enter** | Chat input | Send message |
| **Shift+Enter** | Chat input | New line |
| **Esc** | Menu bar | Close menu |

> F2 / Del do not affect the explorer when focus is in an input, Monaco, or the chat box.

### Local chat history

- Paths: `<project>/.codewhale/history/` or `<project>/.opencode/history/`.
- **Auto-saved** on send, turn complete, or error.
- Session list **merges** local and runtime records, preferring meaningful local titles.
- Deleting a session removes local files and runtime records (when connected).

---

## Prerequisites

1. **Node.js** 18+
2. **Rust** — https://www.rust-lang.org/learn/get-started
3. **Tauri system dependencies** — https://tauri.app/start/prerequisites/
4. **AI backend (install at least one)**

```bash
# CodeWhale
npm install -g codewhale
codewhale auth set --provider deepseek --api-key <your-key>
codewhale doctor

# OpenCode
npm install -g opencode
opencode --version
```

---

## Configuration

xcoder uses a **two-layer configuration model**: its own `config.toml` controls which backend to use and how to start it; each AI tool keeps its **native config file** (API keys, models, approval policy, etc.). Chat panel modes and models are **fetched at runtime** after you connect.

| Config file | Purpose | Typical path |
|-------------|---------|--------------|
| `config.toml` | xcoder app: default provider, launch command, health check | Windows: `%APPDATA%\xcoder\config.toml`<br>Linux/macOS: `~/.config/xcoder/config.toml` |
| `config.toml` (CodeWhale) | CodeWhale native: API key, default model, approval mode | `~/.codewhale/config.toml` |
| `opencode.json` | OpenCode native: providers, models, permissions | `~/.config/opencode/opencode.json` |

On first launch, xcoder creates `config.toml` automatically. You can also open configs from the app menu:

- **File → Configuration → Open Config Folder**
- **File → Configuration → Open config.toml** → xcoder's `config.toml`
- **File → Configuration → Open opencode.json**
- **File → Configuration → Open codewhale.json** → actually opens CodeWhale's `~/.codewhale/config.toml` (TOML, not JSON)

Change the UI language under **File → Preferences** (Chinese, English, Japanese, French, German, Russian, Spanish, Portuguese, Italian).

### 1. `config.toml` (xcoder app config)

Example with DeepSeek and both providers:

```toml
[app]
default_provider = "codewhale"   # codewhale | opencode
theme = "dark"

# ── CodeWhale ──────────────────────────────────────────
[[providers]]
id = "codewhale"
type = "http"
command = "codewhale"
args = ["serve", "--http", "--port", "7878", "--insecure"]
config_path = "~/.codewhale/config.toml"
health_cmd = ["codewhale", "doctor", "--json"]

# ── OpenCode ───────────────────────────────────────────
[[providers]]
id = "opencode"
type = "http"
command = "opencode"
args = ["serve", "--hostname", "127.0.0.1", "--port", "4096"]
config_path = "~/.config/opencode/opencode.json"
health_cmd = ["opencode", "--version"]
```

Field reference:

- `default_provider`: backend used by default in the chat panel
- `command` / `args`: command xcoder runs when you click Connect (ports must match `config_path`)
- `config_path`: native config path for that provider; `~` is expanded
- `health_cmd`: health check before connecting

After connecting, **modes** and **models** in the chat panel are fetched at runtime:

| Provider | Mode source | Model source | Default model |
|----------|-------------|--------------|---------------|
| **CodeWhale** | Fixed `plan` / `agent` / `yolo` | `codewhale model list` | `doctor --json` → `default_text_model` |
| **OpenCode** | `GET /agent` | Provider API + `~/.config/opencode/opencode.json` | First connected provider/model, or `opencode.json` `model` |

If you add or change providers in `opencode.json`, click **Disconnect** then **Connect** so xcoder restarts the OpenCode runtime and refreshes the model list.

If `codewhale` / `opencode` is not on PATH, use an absolute path in `command`, for example:

```toml
command = "C:\\Users\\you\\AppData\\Roaming\\npm\\codewhale.cmd"
```

### 2. CodeWhale config (`~/.codewhale/config.toml`)

> The menu item is named "Open codewhale.json", but the file is **TOML**.

**Option A: set API key via CLI (recommended)**

```bash
codewhale auth set --provider deepseek --api-key <your-deepseek-key>
```

**Option B: edit the config file directly**

```toml
api_key = "<your-deepseek-key>"
provider = "deepseek"
auth_mode = "api_key"
default_text_model = "deepseek-v4-pro"

[providers.deepseek]
api_key = "<your-deepseek-key>"

[ui]
default_mode = "agent"        # plan | agent | yolo
approval_mode = "suggest"     # suggest | auto | never
reasoning_effort = "high"     # off | high | max

[runtime_api]
cors_origins = ["http://localhost:1420"]
```

Common DeepSeek model IDs:

| Model ID | Notes |
|----------|-------|
| `deepseek-v4-pro` | Main model (recommended) |
| `deepseek-v4-flash` | Faster, lower cost |

Verify:

```bash
codewhale doctor
codewhale doctor --json
```

`default_text_model` is also used as the initial model in xcoder's chat panel after you click **Connect** (the full list comes from `codewhale model list`).

### 3. OpenCode config (`opencode.json`)

Global config path: `~/.config/opencode/opencode.json` (you can also place `opencode.json` in the project root to override global settings).

DeepSeek example (compatible with the current xcoder setup):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-v4-pro",
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "<your-deepseek-key>",
        "setCacheKey": true
      },
      "models": {
        "deepseek-v4-pro": { "name": "deepseek-v4-pro" },
        "deepseek-v4-flash": { "name": "deepseek-v4-flash" }
      }
    }
  }
}
```

Notes:

- Set `apiKey` to your DeepSeek platform key (https://platform.deepseek.com)
- Model keys must be `deepseek-v4-pro` / `deepseek-v4-flash` — **not** `v4-pro` (that causes API 400 errors)
- `model` format is `providerID/modelID`, e.g. `deepseek/deepseek-v4-pro`
- After connecting, xcoder reads providers and models from the OpenCode API and merges `opencode.json`; use the **provider** and **model** dropdowns in the chat panel to switch
- Custom providers (e.g. `zhipu-coding`) must appear in `opencode.json` **and** be loaded by OpenCode (`connected`); reconnect if you edit the config while xcoder is already connected

Verify:

```bash
opencode --version
opencode serve --hostname 127.0.0.1 --port 4096
```

### Configuration overview

```
~/.config/xcoder/config.toml          ← xcoder: provider, launch args, health check
        │                                 (modes/models fetched at runtime after connect)
        ├─ config_path ──→ ~/.codewhale/config.toml     ← API key, default model, approval
        │
        └─ config_path ──→ ~/.config/opencode/opencode.json  ← providers, models, permissions

<project>/.codewhale/history/         ← CodeWhale local chat history (written by xcoder)
<project>/.opencode/history/          ← OpenCode local chat history (written by xcoder)
```

See [architecture.md](./architecture.md) for a fuller architecture description.

---

## Development

```bash
npm install
npm run tauri dev
```

Use the Tauri desktop window (`npm run tauri dev`). Do not open `http://localhost:1420` directly in a browser.

## Build

```bash
npm run tauri build
```

Output:

- Executable: `src-tauri/target/release/xcoder.exe`
- Installer (NSIS): `src-tauri/target/release/bundle/nsis/xcoder_0.1.0_x64-setup.exe`

By default only the **NSIS** installer is built (common on Windows), not MSI, to avoid WiX download failures during the build.

If you see `timeout: global` or WiX/NSIS download errors, the Tauri CLI downloader may be timing out on GitHub (PowerShell often works fine). Run this first:

```powershell
npm run tauri:setup-bundle-tools
npm run tauri build
```

This pre-installs NSIS tools to `%LOCALAPPDATA%\tauri\NSIS`. You can also use the compiled exe directly without waiting for the installer.

## FAQ

| Issue | Fix |
|-------|-----|
| Browser at `localhost:1420` does not work | Use the desktop window from `npm run tauri dev`; Tauri APIs are desktop-only |
| "codewhale/opencode not found" on connect | Install the CLI globally, or set an absolute `.cmd` / `.exe` path in `config.toml` `command` |
| CMD window flashes on connect (older builds) | Fixed via `CREATE_NO_WINDOW` for child processes; rebuild with the latest code |
| OpenCode connect fails | **Open a project** first; ensure `opencode.json` port matches `config.toml` `args` |
| OpenCode provider/model missing in chat | Edit `opencode.json`, then **Disconnect → Connect** to restart the runtime; custom providers need valid `apiKey` / `opencode auth login` |
| Chat errors / API 400 | Use model id `deepseek-v4-pro`, not `v4-pro` |
| WiX/NSIS download timeout on build | Run `npm run tauri:setup-bundle-tools`, then build again |

## Project layout

```
src/           React frontend (panels, chat, i18n, state)
src-tauri/     Rust backend (filesystem, config, agent adapters, terminal PTY)
```
