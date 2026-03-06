# Antigravity Auto Accept

> [English](#english) | [中文](#中文)

<p align="center">
  <img src="settings-panel.png" alt="Settings Panel" width="460">
</p>

**Tired of clicking "Run", "Accept All", "Allow" hundreds of times a day?** Let this plugin handle it for you — automatically accept file changes, execute terminal commands, and approve permission dialogs while you focus on what matters.

💤 **Leave it running overnight** — your Agent keeps coding while you sleep. The built-in **110+ rule blacklist** ensures dangerous commands are automatically blocked, so you can trust it to work safely unattended.

> ⚠️ **PLEASE READ THE USAGE GUIDE BELOW BEFORE USE!**
> 
> ⚠️ **使用前请务必阅读下方使用教程！**
> 
> ⚠️ **MUST READ! 必看！**

---

## English

> Automatically accept Antigravity Agent's file changes and terminal commands, with built-in dangerous command blacklist protection.

### ⚡ Features

- ✅ **Auto Accept Files** — Automatically switch tab and Accept when Agent modifies files
- ✅ **Auto Run Terminal** — Automatically click Run / Allow for Agent commands
- ✅ **Multi-target CDP** — Connect to both sidebar Agent panel and Agent Manager
- ✅ **Safe OFF** — Injected scripts fully cleaned up when disabled
- 🛡️ **Dangerous Command Blacklist** — 110+ rules (substring + regex), supports Reject or Stop
- ⚙️ **Settings Panel** — Fine-grained control for File Accept, Terminal Run, Blacklist behavior
- 🌐 **Bilingual UI** — Settings panel supports English / 中文
- 🔄 **Race Condition Protection** — Auto retry when command text hasn't rendered yet
- 🎉 **Welcome Guide** — First-run notification guides you to the built-in User Guide
- 📖 **Built-in User Guide** — Collapsible help section in Settings with usage notes, feature explanations, and links

### 🚀 Installation

#### 1. Launch Antigravity with CDP

Manually add `--remote-debugging-port=9222` to the shortcut target.

#### 2. Install the Extension

**Option A: Download from Release (recommended)**

1. Go to [Releases](https://github.com/git-buster/antigravity-auto-accept/releases) → Download the latest `.vsix`
2. `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → Select the `.vsix` file

**Option B: Build from source**

```bash
git clone https://github.com/git-buster/antigravity-auto-accept.git
cd antigravity-auto-accept
npm install
npx @vscode/vsce package --allow-missing-repository --skip-license
```

Then `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → Select the generated `.vsix` file

#### ⚠️ Important

- **Do not install other auto-accept extensions** (e.g. `pesosz`) — they will conflict
- **Security tip**: Set **Terminal Command Auto Execution** to **Request Review** in Antigravity settings for double protection

### 📋 Usage

#### ⚠️ Prerequisites for Terminal Auto-Run

Terminal auto Run/Reject **requires Agent Manager**:

1. Open **Agent Manager** (not the sidebar Toggle Agent)
2. **Switch to the corresponding chat window** in Agent Manager — the plugin can only detect command buttons for the active session
3. Enter commands in Agent Manager for the Agent to execute
4. **Keep Agent Manager open** — closing it breaks CDP connection

> Status bar shows `CDP x2` when both Agent Manager and Toggle Agent are connected.

#### 🎉 First-Run Notification

After installing or updating, a notification will appear guiding you to the **📖 User Guide** in the Settings panel.

- Click **OK** → Notification will appear again next launch
- Click **OK, Don't Show Again** → Won't show for this version (will reappear after the next update)

#### Settings Panel

**Click the status bar** (bottom right) to open the settings panel:

| Item | Description |
|------|-------------|
| Master Switch | Toggle plugin on/off |
| Auto Accept Files | Toggle auto file acceptance |
| Auto Run Terminal | Toggle auto command execution |
| Blacklist Action | Reject dangerous commands or Stop plugin |
| Language / 语言 | Switch between English / 中文 |

#### 🌐 How to Switch Language

1. Click the **status bar** (bottom right) → Settings panel opens
2. Find **Language / 语言** dropdown
3. Select **English** or **中文**
4. The panel and all tooltips update immediately

#### Status Bar

| Status | Meaning |
|--------|---------|
| `✓ ON \| CDP x2` | ✅ Normal |
| `✓ ON \| CDP x1` | ⚠️ Only 1 panel connected |
| `⚠ ON \| CDP Disconnected` | ❌ Check launch parameters |
| `✕ OFF` | Disabled |

### 🛡️ Blacklist

Configure in `settings.json` (`Ctrl+,` → search `autoAccept`).

> ⚠️ Values in settings.json **override** defaults (not merge).

**Blacklist Action Modes:**

| Mode | Behavior |
|------|----------|
| 🔴 **Reject** | Auto-click the **Reject** button to block the dangerous command. The plugin **continues running** and will keep monitoring subsequent commands. |
| 🛑 **Stop Plugin** | Skip clicking any button. The plugin **automatically turns OFF** the master switch and stops all automation, **waiting for manual intervention**. Use this mode if you want full human review after a dangerous command is detected. |

### 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| CDP Disconnected | Ensure `--remote-debugging-port=9222` is set |
| Blacklist not blocking | Run Diagnose to check debug log |
| CDP fails after packaging | Don't use `--no-dependencies` flag |

### 💬 Feedback

If you encounter any issues or have suggestions, please submit feedback on [GitHub Issues](https://github.com/git-buster/antigravity-auto-accept/issues). Thank you for your support!

---

## 中文

**每天反复点击 "Run"、"Accept All"、"Allow"，烦不烦？** 这个插件帮你全自动处理 — 文件改动自动接受，终端命令自动执行，权限弹窗自动通过。

💤 **晚上挂机睡觉，Agent 帮你写代码。** 内置 **110+ 条高危命令拦截规则**，遇到恶意命令自动阻止，无人值守也安全无忧。

> 自动接受 Antigravity Agent 的文件改动和终端命令，内置高危命令黑名单保护。

### ⚡ 功能

- ✅ **自动接受文件改动** — Agent 修改文件时自动切换 tab 并 Accept
- ✅ **自动执行终端命令** — Agent 运行命令时自动点击 Run / Allow
- ✅ **多目标 CDP** — 同时连接侧边 Agent 面板和 Agent Manager
- ✅ **OFF 安全停止** — 关闭后注入脚本完全清除
- 🛡️ **高危命令黑名单** — 预置 110+ 条规则（子串 + 正则），支持主动拒绝 (Reject) 或停止插件 (Stop)
- ⚙️ **弹出设置菜单** — 细分控制文件 Accept、终端 Run、黑名单行为
- 🌐 **中英文双语** — 设置面板可切换语言
- 🔄 **防竞态机制** — 命令文本未渲染完时自动重试，避免绕过黑名单
- 🎉 **首次使用引导** — 安装或更新后弹出通知，引导查看内置使用说明
- 📖 **内置使用说明** — 设置面板内可折叠的帮助区，包含注意事项、功能介绍、黑名单模式说明

### 🚀 安装

#### 1. 以 CDP 模式启动 Antigravity

手动在快捷方式目标末尾加 `--remote-debugging-port=9222`

#### 2. 安装插件

**方式 A：从 Release 下载（推荐）**

1. 前往 [Releases](https://github.com/git-buster/antigravity-auto-accept/releases) → 下载最新的 `.vsix` 文件
2. `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择 `.vsix` 文件

**方式 B：从源码构建**

```bash
git clone https://github.com/git-buster/antigravity-auto-accept.git
cd antigravity-auto-accept
npm install
npx @vscode/vsce package --allow-missing-repository --skip-license
```

然后 `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择生成的 `.vsix` 文件

#### ⚠️ 注意

- **不要同时安装其他 auto-accept 插件**（如 `pesosz` 的），会冲突
- **安全建议**：在 Antigravity 设置中将 **Terminal Command Auto Execution** 设为 **Request Review**，配合本插件的黑名单可以双重保护

### 📋 使用

#### ⚠️ 终端自动执行前提条件

终端命令的自动 Run/Reject 功能**必须通过 Agent Manager 窗口**运行：

1. 打开 **Agent Manager**（不是侧边栏的 Toggle Agent）
2. **切换到对应的聊天窗口** — 插件只能检测当前活跃会话的命令按钮
3. 在 Agent Manager 中输入命令让 Agent 执行
4. **Agent Manager 窗口不能关闭**，否则 CDP 连接会断开，自动执行失效

> 状态栏显示 `CDP x2` 表示 Agent Manager 和 Toggle Agent 都已连接。

#### 🎉 首次使用提示

安装或更新后会弹出通知，引导你到设置面板查看 **📖 使用说明**。

- 点击 **知道了** → 下次启动仍会提示
- 点击 **知道了，不再提示** → 当前版本不再弹出（更新后会重新提示）

#### 设置菜单

**点击右下角状态栏**弹出设置菜单：

| 菜单项 | 说明 |
|--------|------|
| 总开关 | 控制插件整体启停 |
| 自动接受文件改动 | 单独控制是否自动 Accept 文件 |
| 自动执行终端命令 | 单独控制是否自动 Run 命令 |
| 黑名单行为 | 选择拦截后是点击 Reject 还是停止插件 |
| 语言 / Language | 切换 English / 中文 |

#### 🌐 如何切换语言

1. 点击**右下角状态栏** → 设置面板打开
2. 找到 **语言 / Language** 下拉框
3. 选择 **中文** 或 **English**
4. 面板和所有提示文本立即更新

#### 状态栏

| 状态 | 含义 |
|------|------|
| `✓ ON \| CDP x2` | ✅ 正常 |
| `✓ ON \| CDP x1` | ⚠️ 只连了 1 个面板 |
| `⚠ ON \| CDP Disconnected` | ❌ 检查启动参数 |
| `✕ OFF` | 已关闭 |

### 🛡️ 黑名单

在 `settings.json` 中配置（`Ctrl+,` → 搜索 `autoAccept`）。

> ⚠️ settings.json 的值**覆盖**默认值（不是合并）。

**黑名单触发模式：**

| 模式 | 行为 |
|------|------|
| 🔴 **主动拒绝 (Reject)** | 自动点击 **Reject** 按钮拦截该危险命令。插件**继续运行**，后续命令仍会正常监控和执行。 |
| 🛑 **停止插件 (Stop)** | 不点击任何按钮，插件**自动关闭总开关**，停止所有自动化操作，**等待人工干预**。适用于检测到危险命令后希望完全由人工接管的场景。 |

### 🔧 常见问题

| 问题 | 解决 |
|------|------|
| CDP Disconnected | 确保用 `--remote-debugging-port=9222` 启动 |
| 黑名单没拦截 | 运行诊断查看 debug log |
| 打包后 CDP 连不上 | 不要加 `--no-dependencies` |

### 💬 问题反馈

如果你遇到任何问题或有建议，请在 [GitHub Issues](https://github.com/git-buster/antigravity-auto-accept/issues) 中提交反馈，感谢你的支持！
