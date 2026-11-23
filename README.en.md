> **HarmonyOS NEXT shell:** this fork adds a native ArkWeb container (`harmony/`)
> so the web build runs directly on a phone — signed, installed and verified on a
> real Mate 60 Pro. Build instructions, measured behaviour and the list of things
> that cannot work on a phone are in [HARMONY.md](HARMONY.md); the reasoning is in
> [harmony/CHANGELOG.md](harmony/CHANGELOG.md).
>
> The README below is upstream and still accurate for the web build.

# DeepSeek Agent

English | [简体中文](README.md)

An agentic fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). The chat UI and design system come from upstream; on top of it this fork adds a full tool-calling loop, a Python desktop bridge, a Chrome extension bridge, MCP servers, multi-workspace diffs, background tasks and subagents.

No application backend is required: the browser talks to the configured API service directly. Enter your API key in Settings before the first chat.

## Getting started

Requires Node.js 22.12+ and pnpm.

```sh
git clone https://github.com/aoan2011/DeepSeek-Agent.git
cd DeepSeek-Agent
pnpm install
pnpm dev
```

Open http://localhost:8090. To build the static site:

```sh
pnpm build
```

Output goes to `dist/`. The bundled Pages workflow publishes it to GitHub Pages; relative asset paths mean it also works from a custom root or `file://`.

## Desktop bridge (optional)

The desktop bridge lets the agent use your machine: files, shell, Python, screen, mouse and keyboard, plus local stdio MCP servers.

```sh
cd desktop
pip install -r requirements.txt
python -m agentdesk
```

Then open the agent panel → **Desktop** in the web UI and connect with the printed URL and token. Every destructive tool asks for approval first; commands that are obviously irreversible are blocked even after approval.

Available tools (48 in total):

- **Files & workspaces**: `fs_read` `fs_list` `fs_stat` `fs_write` `fs_delete` `fs_move` `glob` `tree` `dupes` `replace` `workspace`
- **Execution & system**: `shell_exec` `python_exec` `system_info` `process_list` `system` `cron` `text_stats`
- **Search & format**: `grep` `diff` `calculate` `time` `regex` `codec` `csv` `sqlite` `markdown` `similarity`
- **Data**: `hash` `archive` `json_query` `json` `text` `clipboard` `password`
- **Network**: `net_probe` `net` `http` `download`
- **Media**: `pdf` `image` `qr` `office`
- **Screen & input**: `screen_capture` `mouse` `keyboard` `window`
- **Git**: `git` (read-only: status / log / diff / branch / show)

`replace` previews every change by default (`dry_run=true`); `http` only reaches public addresses and validates redirects, so a page cannot lure the agent into hitting localhost or cloud metadata endpoints.

Every command runs inside a sandbox directory (`~/AgentWorkspace` by default). Paths are resolved and checked, so `..` and absolute escapes are rejected; `~/.skills` is allow-listed read-only.

Multiple desktop workspaces are supported: list extra roots in `~/.agentdesk/config.json` (`{"workspaces": ["/path/a", "/path/b"]}`) or in `AGENTDESK_WORKSPACES`, then pick one from the composer's workspace selector (or let the agent call `desk_workspace`).

## Browser extension (optional)

`extension/` is a Manifest V3 extension that gives the agent control of a real tab: read the page, click, type, scroll, extract, screenshot, manage tabs and navigate.

While the agent works on a page it draws a marquee along the viewport edges and a large cursor that follows the target element, so you can see what is being clicked. Screenshots are downscaled and sent back to the model as real image blocks instead of just a text note.

Load it via `chrome://extensions` → Developer mode → Load unpacked → `extension/`. A packaged build is in `dist-ext/`.

## Features

### Conversation

- Multiple conversations with automatic titles, renaming and deletion; edit prompts, regenerate replies, switch between branches.
- Streaming replies, deep thinking, smart search, link reading, source citations; stop or continue eligible replies.
- Attachments by upload / paste / drag-and-drop, voice input, read-aloud, mobile audio spectrum.
- Markdown, syntax highlighting, KaTeX, Mermaid; `==highlight==`, `~wavy~`, `> [!IMPORTANT]` alerts.
- Simplified Chinese and English, light and dark themes, mobile layouts, history import/export.

### Tool calling

- **Compact tool rows.** Each call is a single line — icon, the purpose the model wrote for it, status and duration — matching the search-step rows instead of a separate card. Click to expand arguments and output.
- **Inline diffs.** File edits show `+N / −M` and open the workspace diff for that exact file when clicked.
- **Parallel execution.** Up to 8 tools per round (configurable). Approvals are still requested one at a time so the confirmation panel never stacks.
- **Background tasks.** Long-running tools move to the task panel (manually, or automatically after 20 s). Chat is not blocked; the panel shows live progress, lets you cancel, inspect the output and hand the result back to the agent. The model can inspect the same tasks through `task_status` (list / read output) and cancel them with `task_cancel`.
- **Model & reasoning picker.** The composer footer shows `model · level`; clicking it opens one panel with the model list and a purple/blue gradient reasoning slider (off / low / medium / high / max), modelled on the reference video.
- **Subagents** via `spawn_subagent`: independent context, read-only tools by default, only the conclusion returns — and they show up in the task panel too.
- **Agent-built tools** via `create_tool`: the model composes existing tools into a new named tool (no generated code), which is registered and reusable. `delete_tool` removes it.
- **Inline previews** via `preview_file`: code, Markdown, HTML pages, images and CSV are rendered in a widget at the bottom of the answer.
- **Image reading** via `view_image`: base64 data URLs, artifact ids or remote URLs are downscaled and sent to the model as image blocks.
- **Questions** via `ask_user`, **widgets** via `show_widget` (sandboxed iframe).
- **26 browser-side utilities ported from one_cedric**: `calculate`, `random_number`, `random_bytes`, `password_gen`, `hash_text`, `base64_codec`, `url_codec`, `jwt_decode`, `json_format`, `json_query`, `json_diff`, `csv_to_json`, `json_to_csv`, `text_stats`, `word_frequency`, `dedupe_lines`, `strip_invisible`, `regex_extract`, `text_similarity`, `markdown_toc`, `template_render`, `diff_text`, `date_calc`, `timezone_convert`, `cron_next`, `qrcode_generate`. All run locally with no backend.
- **Request sanitising.** Tool output from pages and screenshots can contain lone surrogates or raw control characters; they are replaced before the request is serialised, truncation never splits a surrogate pair, and a 400 JSON-parse error triggers one retry with images stripped and long results clipped.

### Goals

- Goals survive across turns and are injected into the system prompt, so the agent keeps working towards the same target.
- The goal panel (target icon next to the composer) creates, edits, completes, drops and reopens goals; completed goals keep their outcome text.
- Three editable templates (feature delivery / research / debugging) fill the detail with a skeleton you can rewrite.
- The agent can maintain goals itself through `manage_goals` (list / create / update / complete / drop / reopen / remove).

### Permissions

- The approval mode lives in the composer (`Default permission` / `Full access`) instead of a settings page, so the current mode is always visible before sending.
- Confirmation requests appear **above the composer**, in the same place as agent questions, instead of a modal over the middle of the screen.
- When the page is in the background, a system notification and a `●` title badge tell you that the agent is waiting.

### Workspaces

- Multiple workspaces: the built-in demo repo plus any number of local folders (handles persisted in IndexedDB, permissions re-checked on reload).
- Pick the active workspace from the composer; all workspace tools operate on that one.
- File tree of changes, branch switcher, Monaco diff editor, and `Ctrl/Cmd + Shift + E` to open the panel.

### Stats and token counting

- The bottom bar refreshes exactly once per second. It subscribes only to the run's `active` / `session` / `model` slices, so streaming tokens no longer re-render the whole bar.
- Draft token count while typing, with a 220 ms debounce.
- Optional **exact** counting using the real DeepSeek vocabulary (BPE, from `tokenizer.json`), loaded lazily as a separate 1.5 MB asset; the app falls back to a calibrated estimate when the asset is unavailable (`file://`).

### Usage and budget

The bottom of the sidebar shows a local usage card modelled on the DeepSeek console: budget progress, today's spend and share of budget, today's tokens and model count, the current rate window (peak / off-peak / weekend / holiday) with a countdown to the next switch, and the API-key sign-in state. "Official rates" opens DeepSeek's price list.

Costs are estimated from the official rates (CNY per 1M tokens):

| Model | Cache hit (off-peak / peak) | Cache miss (off-peak / peak) | Output (off-peak / peak) |
| --- | --- | --- | --- |
| `deepseek-flash` | ¥0.02 / ¥0.04 | ¥1 / ¥2 | ¥4 / ¥8 |
| `deepseek-v4-pro` | ¥0.15 / ¥0.30 | ¥4.5 / ¥9 | ¥13.5 / ¥27 |

Peak hours are 09:00–12:00 and 14:00–18:00 Beijing time, Monday to Friday, excluding Chinese public holidays; weekends and all other hours are billed off-peak. The [official price list](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) is authoritative. The local ledger stores token counts and estimated cost only — never conversation content — and can be edited or cleared under **Settings → General → Usage and budget**.

### Performance and motion

- Settings surfaces (Settings, Agent capabilities, Workspaces) use plain frosted glass: one translucent layer plus a single `backdrop-filter`.
- The sidebar, composer and right-hand question navigator use **liquid-glass refraction** again (canvas displacement map + `backdrop-filter: url(#filter)`), matching the original look. The navigator keeps the same glass as the composer at all times.
- Settings → General ends with a **GitHub card**: repo link plus star count from the public API, cached locally for an hour.
- Settings → Appearance & motion can switch the glass effect to liquid / frost / off. If the device struggles, frost keeps the same layout with a single blur.
- The composer starts at one line and grows to about seven; long prompts no longer take over the screen.
- Settings → **Appearance & motion**: global intensity, animation speed multiplier, and per-feature toggles (aurora, shimmer, transitions, running pulse).
- Reduced motion is honoured from the OS as well; `html[data-motion]` and the `--ds-anim-scale` variable drive every animation.

## Settings layout

| Group | Contents |
| --- | --- |
| General | Theme, language, read-aloud voice, location, usage budget and price rates |
| Appearance & motion | Visual style, glass strength, motion intensity, animation speed, per-effect toggles |
| Agent | Tool toggle, approval default, max steps, parallel tools, background tasks, token counting, **pre-filled system prompt** (editable, reset to default), custom prompts (four seeded templates), sampling, demo mode |
| Workspaces | List, refresh and remove workspaces |
| Data | API key, import, export, delete everything |

## Security

- **Network egress.** `fetch_webpage`, remote `view_image`, `open_url`, extension navigate/fetch and preview URLs accept only public `http(s)` addresses. `localhost`, private IPv4/IPv6 ranges, `.local` / `.internal` hosts and URLs with embedded credentials are rejected to reduce SSRF risk from injected page content.
- **HTML injection.** Mermaid renders with `securityLevel: 'strict'`, and the resulting SVG is sanitised again right before `dangerouslySetInnerHTML` (scripts, iframes, event handlers, `javascript:` links and CSS expressions removed). KaTeX and Prism output remain generated-only HTML.
- **Links.** Every `target="_blank"` link uses `rel="noopener noreferrer"`; the page declares a `referrer` policy.
- **Content Security Policy.** `index.html` ships a minimal CSP: `object-src 'none'; base-uri 'self'; form-action 'none'`.
- **Extension bridge.** `postMessage` targets the current origin instead of `'*'`, and incoming messages are accepted only from the same window and origin.
- **Local data.** The API key and settings live in `localStorage`; conversations and artifacts live in `IndexedDB`. Exported archives and shared conversations never include the API key.

## Data and storage

API key and settings live in `localStorage`; conversations, original attachments and artifacts live in `IndexedDB`. Everything is isolated per browser profile and origin. Sending messages, uploading attachments and using speech send the relevant content to the configured API service.

History import/export uses ZIP archives. Import replaces all local conversations after confirmation. See [history import/export](src/services/chat/history/README.md) for the archive format.

## Development

| Command | Description |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Build into `dist/` |
| `pnpm type` | TypeScript checks |
| `pnpm lint` | oxlint |
| `pnpm format` | oxfmt |

Desktop tests:

```sh
cd desktop
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

`scripts/build-tokenizer.mjs` regenerates `src/services/tokenizer/dsv4-merges.txt` from a DeepSeek `tokenizer.json`:

```sh
node scripts/build-tokenizer.mjs /path/to/tokenizer.json
```

### CI

`.github/workflows/ci.yml` runs three jobs:

1. **web** — typecheck, lint and build on Ubuntu.
2. **desktop** — `pytest` on Ubuntu / macOS / Windows × Python 3.9 / 3.11 / 3.13, plus an import smoke test.
3. **tokenizer** — asserts the vocabulary asset is committed and non-empty.

### Layout

```text
src/
  app/                  Layout, theme, motion setup
  components/
    agent/              Tool rows, approval panel, task panel, previews, artifacts
    chatInput/          Composer, pickers (model / permission / workspace / prompts), stats bar
    workspace/          Workspace panel, diff viewer, file tree
  services/
    agent/              Tool registry, runtime, tasks, subagents, tools/*
    chat/               Conversations, branches, storage, history
    tokenizer/          BPE tokenizer for exact token counting
    workspace/          Multi-workspace store, git info, local FS access
  utils/                Shared helpers (URL checks, image data, image resizing)
desktop/agentdesk/      Python desktop bridge (tools, sandbox, server, TUI)
extension/              MV3 browser extension
scripts/                Build helpers
```

## Upstream sync

This fork cannot merge upstream directly, so relevant fixes are ported by hand:

- `4ee2972` — attachment previews are chosen by filename extension; links from the server are restricted to HTTP(S) (`isWebUrl`).
- `b53b77f` — oversized images are downscaled before they are reused as Files API attachments (`imageSizeChecked`).
- `429af5a` / `8ad7b56` — version bumps only, not applicable.

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing. Third-party dependencies keep their own licenses.
