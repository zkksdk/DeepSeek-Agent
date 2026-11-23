# Agent Bridge 浏览器扩展

把浏览器的页面读取与操作能力交给网页版 Agent。MV3，无外部依赖，不需要构建。

## 安装

Chrome / Edge 已禁止直接安装非商店的 `.crx`，请用开发者模式加载源码目录：

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本目录 `extension/`
4. 回到 Agent 页面刷新一次，侧栏「Agent 能力 → 浏览器扩展」应显示已连接

也可以把本目录打包成 zip 分发，接收方解压后同样按上面步骤加载。

## 能做什么

| 工具 | 作用 |
| --- | --- |
| `browser_get_page` | 读取标题、URL、正文、选中文字与标题结构 |
| `browser_fetch_page` | 后台抓取任意 URL 的正文，不受页面跨域限制 |
| `browser_click` | 按选择器或可见文字点击元素 |
| `browser_type` | 在输入框、文本域、contenteditable 中输入，可回车提交 |
| `browser_scroll` | 滚动到指定方向或页面顶部/底部 |
| `browser_screenshot` | 截取可视区域或滚动拼接整页，产物可在对话中预览下载 |
| `browser_tabs` | 列出、切换、打开、关闭标签页 |
| `browser_navigate` | 让标签页跳转到指定 URL |
| `browser_extract` | 按选择器批量提取文本或属性，适合抓列表与表格 |

## 目标标签页的选择规则

- 默认操作**用户最近查看的网页**：优先当前窗口的活动标签页，其次最近激活过的网页标签页
- 始终排除 Agent 页面自身，避免「总结当前网页」变成总结自己
- 调用时传 `tab_id` 可精确指定，`browser_tabs` 的 `list` 会返回所有 id

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `tabs` | 列出、切换、关闭标签页，读取标题与 URL |
| `scripting` | 在未注入的标签页里补注入 content script |
| `activeTab` | 用户主动操作时访问当前页 |
| `<all_urls>` | 在所有网页提供读取与操作能力 |

扩展**不会**主动上传任何数据。所有页面内容只在被 Agent 调用时读取，并直接回传给当前对话。

## 已知限制

- 扩展商店页（`chrome://`、`chromewebstore.google.com`）、PDF 预览页不允许注入，工具会返回明确错误
- 整页截图最多拼接 8 屏，受 `captureVisibleTab` 每秒 2 次的配额限制，单次约需 5–8 秒
- 依赖 Shadow DOM 的组件可能需要用 `browser_extract` 配合具体选择器读取

## 调试

在 `chrome://extensions` 点击本扩展的 **Service Worker** 链接可打开后台控制台；页面侧错误会输出在网页 DevTools 的 Console 中。
