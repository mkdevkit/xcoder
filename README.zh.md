# xcoder

基于 Tauri 的 AI 编程工作台，集成 [CodeWhale](https://www.codewhale.ai/) 与 [OpenCode](https://opencode.ai/)。

**English:** [README.md](./README.md)

## 功能（当前版本）

- 三栏布局：文件树 · Monaco 编辑器 · AI 聊天
- 打开本地工程目录，浏览与编辑文件
- 连接 CodeWhale / OpenCode Runtime，流式对话
- 本地聊天历史（`.codewhale/history`、`.opencode/history`）
- 工具审批门禁（approval gate）
- 终端、Markdown 渲染、右键菜单、多语言界面等

## 前置依赖

1. **Node.js** 18+
2. **Rust** — https://www.rust-lang.org/learn/get-started
3. **Tauri 系统依赖** — https://tauri.app/start/prerequisites/
4. **AI 后端（至少装一个）**

```bash
# CodeWhale
npm install -g codewhale
codewhale auth set --provider deepseek --api-key <your-key>
codewhale doctor

# OpenCode
npm install -g opencode
opencode --version
```

## 配置说明

xcoder 采用**两层配置**：应用自己的 `config.toml` 负责「连哪个后端、怎么启动」；各 AI 工具保留**原生配置文件**（API Key、模型、审批策略等），xcoder 不重复维护第二套语义。

| 配置文件 | 作用 | 典型路径 |
|----------|------|----------|
| `config.toml` | xcoder 应用级：默认 Provider、启动命令、UI 选项 | Windows: `%APPDATA%\xcoder\config.toml`<br>Linux/macOS: `~/.config/xcoder/config.toml` |
| `config.toml`（CodeWhale） | CodeWhale 原生：API Key、默认模型、审批模式 | `~/.codewhale/config.toml` |
| `opencode.json` | OpenCode 原生：Provider、模型、权限 | `~/.config/opencode/opencode.json` |

首次启动 xcoder 会自动生成 `config.toml`。也可在应用内通过菜单打开：

- **文件 → 配置 → 打开配置目录**
- **文件 → 配置 → 打开配置文件** → xcoder 的 `config.toml`
- **文件 → 配置 → 打开 opencode.json**
- **文件 → 配置 → 打开 codewhale.json** → 实际打开 CodeWhale 的 `~/.codewhale/config.toml`（CodeWhale 官方格式为 TOML，不是 JSON）

界面语言可在 **文件 → 首选项** 中切换（中/英/日/法/德/俄/西/葡/意）。

---

### 1. `config.toml`（xcoder 应用配置）

以 DeepSeek + 双 Provider 为例：

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

字段说明：

- `default_provider`：聊天面板默认使用的后端
- `command` / `args`：xcoder 点击「连接」时启动的命令（需与 `config_path` 中的端口一致）
- `config_path`：该 Provider 原生配置文件路径，支持 `~` 展开
- `health_cmd`：连接前的健康检查命令
- `ui_options`：聊天面板下拉框中的模式、模型列表（模型名须与原生配置一致）

若系统找不到 `codewhale` / `opencode`，可在 `command` 中写绝对路径，例如：

```toml
command = "C:\\Users\\you\\AppData\\Roaming\\npm\\codewhale.cmd"
```

---

### 2. CodeWhale 配置（`~/.codewhale/config.toml`）

> 菜单项名为「打开 codewhale.json」，实际文件是 **TOML** 格式。

**方式 A：命令行写入 API Key（推荐）**

```bash
codewhale auth set --provider deepseek --api-key <your-deepseek-key>
```

**方式 B：直接编辑配置文件**

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

常用 DeepSeek 模型名：

| 模型 ID | 说明 |
|---------|------|
| `deepseek-v4-pro` | 主力模型（推荐） |
| `deepseek-v4-flash` | 更快、更省 |

验证：

```bash
codewhale doctor
codewhale doctor --json
```

---

### 3. OpenCode 配置（`opencode.json`）

全局配置文件路径：`~/.config/opencode/opencode.json`（也可在项目根目录放置 `opencode.json` 覆盖全局设置）。

以 DeepSeek 为例（与 xcoder 当前环境兼容的写法）：

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

要点：

- `apiKey` 填 DeepSeek 平台的 Key（https://platform.deepseek.com）
- `models` 中的 key 必须使用 `deepseek-v4-pro` / `deepseek-v4-flash`，**不要**写成 `v4-pro`（会导致 API 400 错误）
- `model` 格式为 `providerID/modelID`，例如 `deepseek/deepseek-v4-pro`
- xcoder 连接 OpenCode 时模型由 `opencode.json` 决定，聊天面板不显示模型下拉框

验证：

```bash
opencode --version
opencode serve --hostname 127.0.0.1 --port 4096
```

---

### 配置关系一览

```
~/.config/xcoder/config.toml          ← xcoder：选 Provider、启动参数、UI 选项
        │
        ├─ config_path ──→ ~/.codewhale/config.toml     ← API Key、模型、审批
        │
        └─ config_path ──→ ~/.config/opencode/opencode.json  ← Provider、模型、权限

<工程目录>/.codewhale/history/        ← CodeWhale 本地聊天历史（xcoder 写入）
<工程目录>/.opencode/history/         ← OpenCode 本地聊天历史（xcoder 写入）
```

更完整的架构说明见 [architecture.md](./architecture.md)。

## 开发

```bash
npm install
npm run tauri dev
```

请在 Tauri 桌面窗口中使用（`npm run tauri dev`），不要直接在浏览器打开 `http://localhost:1420`。

## 构建

```bash
npm run tauri build
```

产物位置：

- 可执行文件：`src-tauri/target/release/xcoder.exe`
- 安装包（NSIS）：`src-tauri/target/release/bundle/nsis/xcoder_0.1.0_x64-setup.exe`

默认只打 **NSIS** 安装包（Windows 常用），不打 MSI，避免构建时从 GitHub 下载 WiX 工具失败。

若构建报错 `timeout: global` 或下载 WiX/NSIS 失败，通常是 Tauri CLI 内置下载器访问 GitHub 超时（PowerShell 往往可以正常下载）。可先执行：

```powershell
npm run tauri:setup-bundle-tools
npm run tauri build
```

该脚本会把 NSIS 工具预装到 `%LOCALAPPDATA%\tauri\NSIS`。也可直接使用已编译好的 exe，不必等安装包。

## 项目结构

```
src/           React 前端
src-tauri/     Rust 后端（文件系统、配置、Agent 适配）
```
