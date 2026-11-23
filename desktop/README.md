# AgentDesk

把本机能力安全地交给网页里的 Agent。Python + rich，单进程，无外部服务依赖。

## 安装

```sh
cd desktop
pip install -r requirements.txt
```

或开发模式安装命令入口：

```sh
pip install -e .
agentdesk
```

## 使用

```sh
python -m agentdesk
```

启动后终端显示面板与访问令牌：

```text
  AgentDesk · 本机 Agent 能力
  端点  ws://127.0.0.1:8765
  令牌  K7pQm2xR9tLw4bZc
  沙箱  /Users/you/AgentWorkspace
```

把端点与令牌填到网页的 **Agent 能力 → 桌面端**，或直接访问：

```text
http://localhost:8090/?desktop=ws%3A//127.0.0.1%3A8765&token=<令牌>
```

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `--host` | 监听地址，默认 `127.0.0.1`，不要随意改成 `0.0.0.0` |
| `--port` | WebSocket 端口，默认 `8765` |
| `--sandbox` | 工作目录，所有文件操作限制在此，默认 `~/AgentWorkspace` |
| `--allow-path` | 额外放行的目录，可重复；默认已放行 `~/.skills`（用 `AGENTDESK_SKILLS` 可改路径） |
| `--token` | 固定令牌；默认生成并保存到 `~/.agentdesk/config.json` |
| `--new-token` | 重新生成令牌 |
| `--no-shell` | 禁用 `desk_shell_exec` 与 `desk_python_exec` |
| `--serve-web` | 同时托管构建产物目录，便于本地同源调试 |
| `--web-port` | 静态站点端口，默认 `8890` |
| `--mcp-config` | 指定本地 MCP 配置文件 |
| `--allow-origin` | 额外允许的网页来源，可重复 |
| `--no-tui` | 不渲染面板，只输出启动信息 |

## 工具

沙箱以外的目录默认只有 `~/.skills` 可读写：技能说明（`SKILL.md`）和随附脚本放在这里，
Agent 用 `desk_fs_read`/`desk_fs_list` 传绝对路径或 `~/.skills/...` 就能直接读取，
其余路径仍然越界报错。需要额外放行别的目录时用 `--allow-path` 追加。

| 名称 | 说明 |
| --- | --- |
| `desk_fs_read` | 读取文本文件，支持行范围；二进制返回元信息 |
| `desk_fs_list` | 列目录，树形输出，可控制深度 |
| `desk_fs_stat` | 文件/目录元信息 |
| `desk_fs_write` | 写入或追加文本，自动创建父目录 |
| `desk_fs_delete` | 删除文件或目录（目录需显式递归） |
| `desk_fs_move` | 移动或重命名 |
| `desk_shell_exec` | 执行命令，返回退出码、stdout/stderr、耗时 |
| `desk_python_exec` | 用当前解释器执行 Python 代码片段 |
| `desk_system_info` | 平台、Python 版本、CPU/内存概况 |
| `desk_screen_capture` | 截取整个屏幕，返回 PNG，网页存成图片产物 |
| `desk_mouse` | 移动鼠标或点击坐标（左/右/中键，1-3 次） |
| `desk_keyboard` | 输入文本（中文走剪贴板）、发送组合键 |
| `desk_window` | 列出可见窗口、按标题聚焦 |

本地 MCP 服务器的工具以 `desk_mcp_<服务器>_<工具>` 暴露。

### 电脑操作依赖

| 平台 | 截屏 | 鼠标 / 键盘 | 窗口 |
| --- | --- | --- | --- |
| Linux (X11) | ImageMagick `import` 或 `scrot` | `xdotool`，中文输入需要 `xclip` | `xdotool`，需要窗口管理器 |
| macOS | `screencapture` | 鼠标需要 `cliclick`，键盘用 `osascript` | `osascript` |
| Windows | PowerShell + System.Drawing | PowerShell + user32 | PowerShell |

macOS 首次使用需要在 **系统设置 → 隐私与安全性 → 辅助功能 / 屏幕录制** 里给终端授权。Wayland 会话下 `xdotool` 无法获取全局输入，请切换到 X11。

## 安全边界

- **目录沙箱**：路径先 `resolve()` 再判断是否位于沙箱内，`..`、符号链接越界都会被拒绝
- **令牌**：`secrets.token_urlsafe(18)`，写入 `~/.agentdesk/config.json` 并 `chmod 600`
- **Origin 校验**：握手阶段检查 `Origin`，默认放行 `localhost` / `127.0.0.1` / `*.github.io` / `file://`
- **输出截断**：单次输出超过 200k 字符会截断，避免撑爆上下文
- **超时**：命令默认 120 秒，超时后 kill 进程组

> 电脑操作会真实接管鼠标键盘：`desk_mouse` / `desk_keyboard` / `desk_window` 默认都要审批，`desk_screen_capture` 只读但会把屏幕内容回传给模型。

> `desk_shell_exec` 的能力边界就是 shell 本身：命令在沙箱目录内启动，但进程仍可访问沙箱外路径。不要把桌面端暴露到公网，也不要在不可信环境下关闭审批。

## 本地 MCP

`mcp.json` 放在项目根目录或 `~/.agentdesk/mcp.json`，格式与 Claude Desktop 一致：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/AgentWorkspace"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

配置项支持 `command`、`args`、`env`、`disabled`。启动时会逐个拉起并握手，失败的服务器会在面板里显示原因，不影响其他服务器。

## 结构

```text
agentdesk/
  __main__.py    命令行入口
  config.py      配置、令牌、MCP 清单
  sandbox.py     路径解析与越界检查
  tools.py       13 个本机工具（文件、命令、Python、电脑操作）
  computer.py    跨平台截屏、鼠标、键盘与窗口
  mcp_bridge.py  stdio MCP 客户端池
  server.py      WebSocket JSON-RPC 与静态托管
  tui.py         rich 面板
tools/
  render_tui.py  生成文档用的面板截图
  term_shot.py   ANSI → PNG 渲染器
```

## 协议

WebSocket 上跑的是 MCP 风格的 JSON-RPC 子集：

- `initialize` → `{ serverInfo, protocolVersion }`
- `tools/list` → `{ tools: [...] }`
- `tools/call` → `{ content: [{ type: "text", text }], isError? }`
- `ping`

握手需要 `?token=<令牌>`，非浏览器客户端可以不传 `Origin`。
