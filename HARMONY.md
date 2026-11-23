# 鸿蒙手机版（HarmonyOS NEXT）

把 **DeepSeek-Agent** 的 web 产物原封不动装进鸿蒙原生壳：ArkTS Stage 工程 + ArkWeb 容器，
业务代码不需要为平台改一行。

> 这个仓库原来是 `deepseek-ai/chat-demo` 的 fork，后来整体换成了
> [Aoan2011/DeepSeek-Agent](https://github.com/Aoan2011/DeepSeek-Agent) 的源码（MIT），
> 鸿蒙壳保留并套在它的产物上。

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
- **工作区的本地文件夹模式**：依赖 File System Access API，ArkWeb 不支持。
  内置演示仓库那套是纯前端的，能用。
- **Monaco diff**：能加载（2.7 MB chunk 正常拿到），但手机屏幕太小，体验一般。

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

## 已知限制

- 未签名。模拟器能装，真机不行，需要在 DevEco 里配 `signingConfigs`。
- 真机没测过，只在模拟器上验证。
- 输入区在窄屏（<768px）已改成单行横向滑动，四行压回一行。代价是靠右的胶囊
  （工作区、提示词）藏在滑动区里，需要横滑才看得到；要彻底解决得把它们收进菜单。
- 工程路径必须是 ASCII。

## 调试开关

`harmony/entry/src/main/ets/pages/Index.ets` 顶部有三个常量，平时都应该是空串：

| 常量 | 作用 |
| --- | --- |
| `DEBUG_API_KEY` | 页面加载完写进 `localStorage`，免去每次手输 Key（模拟器软键盘会卡） |
| `DEBUG_HASH` | 页面加载完跳到指定 hash，例如 `#/settings/data` 直达数据页 |
| `DEBUG_JS` | 页面加载完执行一次任意 JS，用来联调 H5 端的下载、存储之类 |

另外 `webview.WebviewController.setWebDebuggingAccess(true)` 那一行默认注释着，
需要连 DevTools 时打开，配合 `hdc fport tcp:9222 tcp:9222`。

**发布前务必确认这三个常量都是空串、调试开关已注释**，否则等于在正式包里留了后门。
