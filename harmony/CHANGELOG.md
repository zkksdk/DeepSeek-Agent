# 鸿蒙壳的演进纪要

按主题归纳，不是提交流水。想知道某个决定**为什么**这么做，看这里；想知道**怎么用**，看 [HARMONY.md](../HARMONY.md)。

## 起点

仓库本来是 `deepseek-ai/chat-demo` 的 fork，带一份本地做的 agent 改造（工具、MCP、技能、记忆、轨迹面板）。
后来整体换成了 [Aoan2011/DeepSeek-Agent](https://github.com/Aoan2011/DeepSeek-Agent)（MIT）——那套东西已经有工具运行时、审批、子 agent、MCP、工作区 diff、精确 token 统计，比手写的那份完整一个量级。

鸿蒙壳在这个替换前后都没改：它只认 `dist/` 目录，装什么都行。

## 壳的三个核心决定

### 1. 页面 origin 是 `https://app.local`，不是 `file://`

全部资源由 `onInterceptRequest` 从 rawfile 读出来返回。

原因只有一个：**安全上下文**。`file://` 和 `resource://rawfile` 下：

- IndexedDB 分不出站点，会话库用不了
- `navigator.clipboard` 直接不可用
- `fetch` 到 API 时 `Origin` 是 `null`，CORS 过不去

换成 https 之后这三件全好了。实测 `isSecureContext === true`。

### 2. 资源直接读 rawfile，不落沙箱

第一版是启动时把 `rawfile/www` 整份拷进 `filesDir`（297 文件 / 11.3 MB），因为拦截回调必须同步返回。

实测 `getRawFileContentSync` 够快，于是改成按需读 + 内存缓存。首启少 1.1 秒，磁盘上少一份 11 MB 副本。

`_assets.json` 清单还得保留——rawfile 不能列目录，没有清单就分不清"文件不存在"（要用 index.html 兜底）和"读失败"（不该兜底）。

### 3. 缺的 Web 能力用原生桥补

探测出来 ArkWeb 缺 `Notification`（`'Notification' in window === false`），上游的「发送通知」工具必然失败。所以用 `@kit.NotificationKit` 做了个 `ShellBridge`，通过 `javaScriptProxy` 注入成 `window.__DS_SHELL__`。

页面侧先看桥在不在，有就走原生，没有才回退 Web API——所以浏览器版行为一点没变。

下载同理，但走的是另一条路：`setDownloadDelegate` 接住 blob 下载，落沙箱后弹系统保存面板让用户选位置。

## 踩过的坑（按代价排序）

**假绿比红更危险。** 验收脚本第一版对着不存在的设备跑，四项明明失败了，结尾还是打印"全部通过"、退出码 0。根因是三个同源的毛病：`$script:Results += ` 在函数里重建了数组、所有断言都在判"输出非空"（hdc 失败时也往 stdout 写字）、读不到 faultlogger 当成"没有超时"。修完做了双向验证——坏设备 5 项红 exit 1，真设备全绿 exit 0。

**MIME 不能带 charset。** `setResponseMimeType('text/html; charset=utf-8')` 会让 ArkWeb 认不出类型，整页 HTML 当纯文本显示。裸类型给 mimeType，完整值放 header。

**同步 IO 会触发 LIFECYCLE_TIMEOUT。** 启动时同步拷几百个文件，faultlogger 里直接记一条 `Reason:LIFECYCLE_TIMEOUT`。改成异步，首帧先出加载态。

**`accessBackward()` 在初始导航后也可能是 true。** 照着它退，退成空白页，整屏黑。要同时判断当前 URL 还在不在我们的 origin 下。

**SVG 能当 media 资源编译，但桌面显示成默认拼图图标。** 必须 PNG。

**Windows 的两个编码坑。** `.cmd` 里的中文会被 cmd 按 GBK 拆成命令；`.ps1` 不存成 UTF-8 with BOM 会被 PowerShell 5.1 读成乱码再报语法错。

**PowerShell 的 `@()` 会包住 `ConvertFrom-Json` 的数组。** `$manifest.Count` 变成 1，`-contains` 永远为假。这个坑是它自己的检查项报红才露出来的。

## 一个差点写错的结论

环境探测显示 `speechSynthesis` 存在但 `getVoices()` 返回 0，看上去就是"朗读废了"。

其实没关系——这个应用的朗读**不走 Web Speech**，它请求服务端 TTS 拿 PCM 流，用 `AudioContext` 排程播放。真正的前提是 `AudioContext`（true）。实测点喇叭后系统日志里 `AudioRenderSink` 在渲染帧。

顺带确认这个 SDK 里没有 ArkTS 侧的 TTS API，想做原生朗读桥也没得做。

## 刻意没做的事

**没裁 Monaco。** 它占 2.7 MB，全量引入了 `editor.all.js` 和全部基础语言。裁掉能省 1–2 MB，但会丢掉某些语言的语法高亮，而且 Monaco 是懒加载、不占首屏。11 MB 的手机应用不算大，不值得为这点体积赌功能。

**没给 API Key 做粘贴桥。** 新用户输 30+ 字符的 key 确实烦，但那要改上游的输入区 UI，属于产品决定。

**没把冷启动耗时做成验收项。** 精度受日志时间戳和时钟同步影响，轮询又慢又脆。灾难性的启动回归已经被 LIFECYCLE_TIMEOUT 检查和二次冷启动兜住了，为了一个好指标引入五十行易碎代码不划算。

## 现在的验收

`harmony\acceptance.cmd`，13 项：

前 5 项纯本地（hdc、HAP 体积、资源清单一致性、调试开关为空），不需要设备；
后面是设备相关（连接、安装、启动、首屏非空白、页面加载、无生命周期超时、沙箱无副本、二次启动、返回键）。

`-SkipInstall` 只跳过重装，仍然重启应用，所以 11 项照跑。
