# 鸿蒙手机版（HarmonyOS NEXT）

把 **DeepSeek-Agent** 的 web 产物原封不动装进鸿蒙原生壳：ArkTS Stage 工程 + ArkWeb 容器，
业务代码不需要为平台改一行。

> 这个仓库原来是 `deepseek-ai/chat-demo` 的 fork，后来整体换成了
> [Aoan2011/DeepSeek-Agent](https://github.com/Aoan2011/DeepSeek-Agent) 的源码（MIT），
> 鸿蒙壳保留并套在它的产物上。

## 当前状态

一句话：**能构建、能装、能对话、能调工具**，只在模拟器上验证过。

- 一键回归：`harmony\acceptance.cmd` —— 13 项检查，见下文的[一键验收](#一键验收)
- 想知道**为什么**这么设计（而不是怎么用），看 [harmony/CHANGELOG.md](harmony/CHANGELOG.md)
- 已实测通过：安装、首屏渲染、权限申请、API Key、单轮对话、单工具、多工具链与后台任务、
  工作区文件树、Monaco diff、导出下载、原生通知、附件上传、朗读、深色模式跟随、
  横屏布局、返回键、冷启动耗时
- 没做的三件，都卡在设备或材料上：

  1. **签名** —— 需要华为账号（DevEco 自动签名）或 p12 / cer / p7b，没有就只能装模拟器
  2. **真机** —— 模拟器是 x86，真机是 ARM，没跑过就是没跑过
  3. **语音输入** —— 模拟器麦克风没有真实输入，测不准

## 环境

- DevEco Studio 6.1.1 及以上（内置 SDK API 24 / OpenHarmony 6.1.1）
  实测路径：`C:\Program Files\Huawei\DevEco Studio\`
- Node 22.12+ 与 pnpm

**工程必须放在纯 ASCII 路径下。** hvigor 会检查工程路径，只接受字母、数字、`-`、`_`、`.`、
英文括号、空格、`@`；路径里带中文会直接报 `00306003 Specification Limit Violation`。

## 构建

```sh
pnpm install
pnpm build:harmony        # web 产物 → harmony/entry/src/main/resources/rawfile/www
```

然后用 DevEco Studio 打开 `harmony/`，或者在命令行：

```sh
cd harmony
set DEVECO_SDK_HOME=C:\Program Files\Huawei\DevEco Studio\sdk
"%DEVECO_SDK_HOME%\..\tools\hvigor\bin\hvigorw.bat" assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

产物：`harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`
（约 11.4 MB，其中 web 产物 11.3 MB —— Monaco 2.7 MB、BPE 词表 1.6 MB）。

**没配签名。** 模拟器能直接装（实测未签名 HAP 系统不拦），真机装不上，
需要在 DevEco 里配 `signingConfigs`（自动签名或手动导入 p7b + p12）。

## 为什么要劫持请求，而不是直接 `file://`

壳里的页面地址是 `https://app.local/index.html`，全部由 `onInterceptRequest` 从应用沙箱里读文件返回。

关键原因是**安全上下文**。`file://` 和 `resource://rawfile/` 都不是安全上下文：

- `IndexedDB` 会话库需要安全上下文，`file://` 下各站点的 origin 是 `null`，库分不出来
- `navigator.clipboard` 在非安全上下文里不可用，复制按钮会静默失败
- `fetch` 到 `api.deepseek.com` 时 `Origin` 是 `null`，CORS 基本过不去

用 `https://app.local` 之后，上面三件全部恢复成和线上一致的行为，浏览器也不知道自己在壳里。
hash 路由（`#/settings/data` 之类）同样正常工作。

另一个细节是 **Service Worker**：壳里把 `sw.js` 拦成 404，让 `register()` 自然失败。
当前这版产物没有 SW，这条是给将来留的保险。

## 结构

```text
harmony/
  AppScope/app.json5                    bundleName / 版本 / 图标
  build-profile.json5                   compatibleSdkVersion = 5.0.0(12)
  entry/src/main/
    module.json5                        权限：INTERNET、定位、麦克风
    ets/entryability/EntryAbility.ets   启动、加载首页、申请运行时权限
    ets/pages/Index.ets                 ArkWeb 容器 + 请求拦截 + 权限放行 + 返回键
    ets/web/WebAssets.ets               按需从 rawfile 读产物并内存缓存
    resources/rawfile/www/              构建产物（不入库，见 .gitignore）
scripts/sync-harmony-assets.mjs         拷 dist 并生成 _assets.json
```

`_assets.json` 是构建期生成的资源清单。必须这么做：`onInterceptRequest` 要求**同步**返回响应，
而 rawfile 只能按已知文件名读、**不能列目录**，没有清单就分不清"文件不存在"（要用
`index.html` 兜底）和"读失败"（不该兜底）。

早期版本是先把整份产物拷进 `filesDir` 再读，实测首启多花约 1.1 秒、磁盘上还多一份 11.3 MB。
现在直接 `getRawFileContentSync` 读 rawfile，命中过的进内存缓存，同一个文件只读一次。

## 实测记录

在 DevEco 6.1.1 自带模拟器（Pura 90，HarmonyOS 6.1.0.117，API 24）上跑过：

| 项 | 结果 |
| --- | --- |
| 安装未签名 HAP | 通过（`hdc install`，系统没拦签名） |
| 首屏渲染 | 通过，HTML/CSS/JS 全部经拦截器返回 |
| 资源读取 | 通过，297 个文件 / 11.3 MB 直接从 rawfile 读，`filesDir` 不再留副本 |
| 定位 + 麦克风权限 | 两个弹窗都正常，授权结果 `[0,0,0]` |
| API Key 写入与掩码显示 | 通过 |
| SSE 对话 | 通过，发一句英文正常收到回复并自动生成标题 |
| BPE 词表 | 通过，「草稿 8 tok」说明 1.6 MB 词表加载并解析成功 |
| 实时状态条 | 通过，显示「输入 10.9k tok / 输出 5 tok / 首字 1.09s / 缓存 0.0% / 速度 21」 |
| 预算面板、空闲时段提示 | 通过 |
| hash 路由 | 通过，`#/settings/data` 正常 |
| Agent 能力面板 | 通过，工具页列出 **50 个工具**并分组，带「需要确认」标记 |
| 工作区面板 | 通过，文件树、`A +19 -0` 改动统计、演示仓库数据都正常 |
| Monaco diff | 加载中提示正常显示（2.7 MB chunk 经拦截器拿到） |
| 工具调用 | 通过，问北京天气，真实调用天气工具拉到 Open-Meteo 数据并渲染成表格 |
| 多轮用量统计 | 通过，「输入 22.1k tok / 输出 254 tok / 首字 6.34s / 缓存 97.9%」 |
| 并行 / 后台工具 | 通过，时间 → 天气（自动转后台）→ 读任务结果三步链，卡片带「已转后台」状态与 JSON 参数 |
| 附件上传 | 通过，回形针 → 系统「选择上传」→ 图库（最多 50 张）/ 拍照或录像 / 文件 |
| 朗读（服务端 TTS） | 通过，点喇叭后按钮进播放态，`AudioRenderSink` 在渲染音频帧 |
| 深色模式跟随系统 | 通过，应用级切 `ColorMode` 后整个 WebView 跟到深色 |
| 横屏 | 通过，自动切到桌面两栏布局：侧栏常驻、输入区控件展开成一行、不再需要横滑 |
| 下载落盘 | 通过，blob 下载 → 系统保存面板 → 文件进 `/storage/media/100/local/files/Docs` |
| 返回键 | 通过，首页按返回回桌面，不再黑屏 |
| 冷启动 | 首启 3.43 s、有缓存 2.6 s（`onCreate` → `page end`） |

## 实测踩到的坑

这几条都是真跑出来才发现的：

1. **MIME 不能带 charset。** `setResponseMimeType('text/html; charset=utf-8')` 会被当成未知类型，
   整页 HTML 直接以纯文本显示。裸类型给 mimeType，带参数的完整值放 `setResponseHeader`。
2. **同步拷资源会卡死生命周期。** 同步写几百个文件触发 `LIFECYCLE_TIMEOUT`
   （faultlogger 里就写着这个 Reason）。必须异步，首帧先出加载态。
3. **`accessBackward()` 在初始导航下也可能为 true。** 照它退会退成空白页，整屏黑。
   要同时判断当前 URL 仍在 `APP_ORIGIN` 下。
4. **模拟器上中文输入法会让整屏卡黑**（英文直接注入没问题）。这是模拟器渲染的问题，
   不是应用逻辑，重启应用即可恢复。

## 手机上跑不了的部分

DeepSeek-Agent 有三块能力依赖「桌面浏览器 / 本机」，在手机壳里不可用或不完整：

- **桌面端（`desktop/` 的 Python agentdesk）**：靠 WebSocket 连本机执行命令、读写文件。
  手机上连不上，相关工具会失败。要真用，得把 agentdesk 跑在另一台机器上再让它连过去。
- **浏览器扩展（`extension/`）**：MV3 扩展，与壳无关。
- **工作区的本地文件夹模式**：`showDirectoryPicker` 在 ArkWeb 里存在，但会退化成系统的
  「选择上传」，返回的是 File 而不是 DirectoryHandle，上游不做类型校验，选完任何东西后面都是
  TypeError。壳里在页面加载后把这个 API 删掉了，于是上游走自己的「不支持」分支，
  **「打开文件夹」按钮直接置灰**——实测如此。内置演示仓库那套是纯前端数据，不受影响。
- **Monaco diff**：实测**能用**——工作区里并排 diff 正常渲染出源码和 `+9 −4` 统计。
  只是手机屏窄，读起来挤，不是不能跑。

## 下载与导出

Web 端保存文件的写法是 `URL.createObjectURL(blob)` + `a[download].click()`，
ArkWeb 不会像桌面浏览器那样自己落盘，得接 `setDownloadDelegate` 才有人管。

实测 **blob: URL 确实会被 `onBeforeDownload` 接住**，链路是：

1. `onBeforeDownload` → `item.start(filesDir/downloads/<name>)` 先落沙箱
2. `onDownloadFinish` → `picker.DocumentViewPicker.save()` 弹系统保存面板
3. 用户选位置 → 把沙箱文件拷过去 → 删掉临时文件

跑出来的日志：

```text
download before: url=blob:https://app.local/8ffac9bb-... name=shell-test.txt
download progress: 100
download finish: /data/storage/el2/base/haps/entry/files/downloads/shell-test.txt
handover done: shell-test.txt -> file://docs/storage/Users/currentUser/shell-test.txt
```

文件最终在 `/storage/media/100/local/files/Docs/shell-test.txt`，16 字节内容一致，
沙箱里的临时文件已删除。同一条路径覆盖「导出所有历史对话（ZIP）」和「保存分享图（PNG）」。

## ArkWeb 的 Web 能力实测

用 `DEBUG_JS` 在页面里跑了一段探测，结果：

| 能力 | 结果 | 说明 |
| --- | --- | --- |
| `isSecureContext` | **true** | `https://app.local` 拿到了安全上下文，这是选它而不用 `file://` 的原因 |
| localStorage / IndexedDB | true | 会话库、设置、附件都正常 |
| `origin` | `https://app.local` | 稳定，重启不变 |
| serviceWorker | 存在 | 但壳里把 `sw.js` 拦成 404，注册会失败并落到 web 端自己的 catch |
| **Notification** | **false** | ArkWeb 没实现 Web Notification，见下一节 |
| 剪贴板读写 | true | `navigator.clipboard` 读写都在 |
| 定位 | true | `navigator.geolocation`，配系统权限 |
| 录音 | true | `getUserMedia` + `MediaRecorder` 都在，语音输入可用 |
| 朗读 | true | 见下：这条路和 `speechSynthesis` 无关 |
| Web Crypto | true | `crypto.subtle` 在 |
| Worker / WASM / OffscreenCanvas | true | Monaco 和并行计算都能跑 |
| `navigator.share` | **false** | 系统分享面板用不了，下载走了 `DocumentViewPicker` |
| Web Speech (`speechSynthesis`) | 对象在，但 **`getVoices()` 返回 0** | 看起来像"朗读废了"，其实**不影响**——见下面的说明 |
| `showSaveFilePicker` / `showDirectoryPicker` | 存在但**退化** | 见下 |
| `<input type="file">` | true | 触发系统「选择上传」：图库（最多 50 张）/ 拍照或录像 / 文件 |

两条有实际后果：

**Notification 缺失** —— 上游那个「发送通知」工具直接 `new Notification(...)`，在壳里必然失败，所以加了一层原生桥（下一节）。

**`speechSynthesis` 没有语音** —— 别被它骗了。这个应用的朗读**不走 Web Speech**：
它请求服务端 TTS 拿 16-bit PCM 流，用 `AudioContext` 排程播放（`services/speech/readAloud.ts`）。
所以真正的前提是 `AudioContext`，那条是 true。实测点喇叭后状态进播放态，
系统日志里能看到 `AudioRenderSink: [RenderFrame] len: [3840]`，确实在出声。
顺带一提：这个 SDK 里**没有** ArkTS 侧的 TTS API（只有 `@ohos.ai.mindSporeLite`），
想做原生朗读桥也没得做，好在也不需要。

**File System Access 是退化的** —— `showDirectoryPicker` 存在，但它弹的是系统的「选择上传」
（图库 / 拍照或录像 / 文件），不是目录树选择器，拿到的不是可遍历的目录句柄。
所以上游「工作区」里的**本地文件夹模式**在手机上是废的；内置演示仓库那套纯前端数据不受影响。

顺带确认：**Monaco 可用**。工作区面板里并排 diff 正常渲染（`src/agent/` 的代码行都在），
那个 2.7 MB 的 chunk 经拦截器返回没问题。手机屏窄，读起来挤，但功能是通的。

## 原生桥：通知

`ShellBridge`（`Index.ets`）用 `@kit.NotificationKit` 的 `notificationManager.publish`
发系统通知，通过 `javaScriptProxy` 注入成 `window.__DS_SHELL__`：

- 页面侧 `send_notification` 先看有没有 `__DS_SHELL__.notify`，有就走原生，没有才回退到 Web API
- 原生侧第一次会调 `requestEnableNotification` 让用户授权
- 实测调用返回 `true`，日志：`ARKWEB-CONSOLE: "NOTIFY_RESULT=true"`

浏览器里没有这个桥，行为不变——桥是"有就用，没有照旧"的加法。

## 已知限制

- 未签名。模拟器能装（实测系统不拦 unsigned），真机装不上。
  补签名的两种做法写在 `harmony/build-profile.json5` 的 `signingConfigs` 注释里了，
  拿到 p12 / cer / p7b 填进去就行。注意 profile 里绑定的是 `com.zkksdk.chatdemo`，
  换 bundleName 或换真机都要重新申请。
- 真机没测过，只在模拟器上验证过。
- 输入区在窄屏（<768px）已改成单行横向滑动，四行压回一行，代价是靠右的胶囊
  （工作区、提示词）藏在滑动区里，需要横滑才看得到。**横屏下没有这个问题**——宽度够了，
  全套控件自然展开成一行，所以爱看长内容的话横过来体验更好。
- 工程路径必须是 ASCII。

## 一键验收

改完代码跑一条命令回归：

```sh
harmony\acceptance.cmd
```

它会重装 HAP、启动、点掉两个权限弹窗、截图，然后逐项检查：

| 检查 | 判据 |
| --- | --- |
| 应用启动 | 进程存活（`onCreate` 会很快被 hilog 缓冲区冲掉，不能当判据） |
| 页面加载 | hilog 里出现 `page end: https://app.local` |
| 无生命周期超时 | **本次运行期间**没有新的 sysfreeze 记录（老文件不算） |
| 资源直读 | 沙箱 `files/` 下没有 `www` 副本 |
| 返回键 | 按返回后进程仍在后台，既不是黑屏也没被杀死 |

截图落在 `.out/acceptance/`，退出码 0 表示全过。只跑检查不重装：
`harmony\acceptance.cmd -SkipInstall`。

脚本本身踩过两个编码坑，改它的人注意：

- **`.cmd` 里不能写中文**。cmd 用系统代码页（GBK）解码脚本，UTF-8 的中文会被拆成乱码再当成命令执行。
- **`.ps1` 必须存成 UTF-8 with BOM**。不然 PowerShell 5.1 按 GBK 解码，中文字符串里的引号错位，直接报"字符串缺少终止符"。

## 调试开关

`harmony/entry/src/main/ets/pages/Index.ets` 顶部有三个常量，平时都应该是空串：

| 常量 | 作用 |
| --- | --- |
| `DEBUG_API_KEY` | 页面加载完写进 `localStorage`，免去每次手输 Key（模拟器软键盘会卡） |
| `DEBUG_HASH` | 页面加载完跳到指定 hash，例如 `#/settings/data` 直达数据页 |
| `DEBUG_JS` | 页面加载完执行一次任意 JS，用来联调 H5 端的下载、存储之类 |
| `DEBUG_COLOR_MODE` | `dark` / `light`，启动时用 `setColorMode` 强制颜色模式，用来验证深色跟随 |
| `DEBUG_ORIENTATION` | `landscape` / `portrait`，启动后用 `setPreferredOrientation` 转屏，用来验证横屏布局 |

另外 `webview.WebviewController.setWebDebuggingAccess(true)` 那一行默认注释着，
需要连 DevTools 时打开，配合 `hdc fport tcp:9222 tcp:9222`。

**发布前务必确认这三个常量都是空串、调试开关已注释**，否则等于在正式包里留了后门。