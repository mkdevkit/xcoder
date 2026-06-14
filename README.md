# xcoder

An AI coding workbench built with Tauri, integrating [CodeWhale](https://www.codewhale.ai/) and [OpenCode](https://opencode.ai/).

**中文文档:** [README.zh.md](./README.zh.md)

## Features (current version)

- Three-column layout: file tree · Monaco editor · AI chat
- Open local project folders, browse and edit files
- Connect to CodeWhale / OpenCode runtime with streaming chat
- Local chat history (`.codewhale/history`, `.opencode/history`)
- Tool approval gate
- Terminal, Markdown rendering, context menus, multilingual UI, and more

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

## Configuration

xcoder uses a **two-layer configuration model**: its own `config.toml` controls which backend to use and how to start it; each AI tool keeps its **native config file** (API keys, models, approval policy, etc.). xcoder does not duplicate that semantics in a second format.

| Config file | Purpose | Typical path |
|-------------|---------|--------------|
| `config.toml` | xcoder app: default provider, launch command, UI options | Windows: `%APPDATA%\xcoder\config.toml`<br>Linux/macOS: `~/.config/xcoder/config.toml` |
| `config.toml` (CodeWhale) | CodeWhale native: API key, default model, approval mode | `~/.codewhale/config.toml` |
| `opencode.json` | OpenCode native: providers, models, permissions | `~/.config/opencode/opencode.json` |

On first launch, xcoder creates `config.toml` automatically. You can also open configs from the app menu:

- **File → Configuration → Open Config Folder**
- **File → Configuration → Open config.toml** → xcoder's `config.toml`
- **File → Configuration → Open opencode.json**
- **File → Configuration → Open codewhale.json** → actually opens CodeWhale's `~/.codewhale/config.toml` (CodeWhale uses TOML, not JSON)

Change the UI language under **File → Preferences** (Chinese, English, Japanese, French, German, Russian, Spanish, Portuguese, Italian).

---

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

  [providers.ui_options]
  modes = ["plan", "agent", "yolo"]
  default_mode = "agent"
  approval_modes = ["suggest", "auto", "never"]
  models = ["deepseek-v4-pro", "deepseek-v4-flash", "auto"]
  default_model = "deepseek-v4-pro"

# ── OpenCode ───────────────────────────────────────────
[[providers]]
id = "opencode"
type = "http"
command = "opencode"
args = ["serve", "--hostname", "127.0.0.1", "--port", "4096"]
config_path = "~/.config/opencode/opencode.json"
health_cmd = ["opencode", "--version"]

  [providers.ui_options]
  modes = ["build", "plan"]
  default_mode = "build"
```

Field reference:

- `default_provider`: backend used by default in the chat panel
- `command` / `args`: command xcoder runs when you click Connect (ports must match `config_path`)
- `config_path`: native config path for that provider; `~` is expanded
- `health_cmd`: health check before connecting
- `ui_options`: modes and models shown in chat dropdowns (names must match native config)

If `codewhale` / `opencode` is not on PATH, use an absolute path in `command`, for example:

```toml
command = "C:\\Users\\you\\AppData\\Roaming\\npm\\codewhale.cmd"
```

---

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

---

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
- When connected to OpenCode, the model comes from `opencode.json`; the chat panel does not show a model dropdown

Verify:

```bash
opencode --version
opencode serve --hostname 127.0.0.1 --port 4096
```

---

### Configuration overview

```
~/.config/xcoder/config.toml          ← xcoder: provider, launch args, UI options
        │
        ├─ config_path ──→ ~/.codewhale/config.toml     ← API key, models, approval
        │
        └─ config_path ──→ ~/.config/opencode/opencode.json  ← providers, models, permissions

<project>/.codewhale/history/         ← CodeWhale local chat history (written by xcoder)
<project>/.opencode/history/          ← OpenCode local chat history (written by xcoder)
```

See [architecture.md](./architecture.md) for a fuller architecture description.

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

## Project layout

```
src/           React frontend
src-tauri/     Rust backend (filesystem, config, agent adapters)
```
