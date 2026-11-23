# 打包成手机 App（Capacitor 路线）

本项目是纯前端应用（无后端），已经做了平台能力适配层与 PWA，可直接套 Capacitor 打包成
Android / iOS 原生壳，业务代码无需改动。

## 一、前置条件

- Node.js 22.12+
- Android：Android Studio（含 SDK）+ JDK 17
- iOS：macOS + Xcode（仅 iOS 需要）
- 项目依赖：`pnpm install`

## 二、首次接入 Capacitor

```bash
# 1. 安装 Capacitor
pnpm add @capacitor/core @capacitor/android
pnpm add -D @capacitor/cli

# 2. 初始化（appId 换成你自己的反向域名）
npx cap init "DS Chat" com.example.dschat --web-dir=dist

# 3. 构建前端产物
pnpm build

# 4. 添加 Android 平台
npx cap add android

# 5. 同步 web 产物到原生工程
npx cap sync android

# 6. 用 Android Studio 打开并运行/打包
npx cap open android
```

打 APK：Android Studio → Build → Generate Signed Bundle / APK。

## 三、配置要点

`capacitor.config.ts` 建议：

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.example.dschat',
  appName: 'DS Chat',
  webDir: 'dist',
  android: {
    // 允许 http 调试；正式包建议用 https
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
}
export default config
```

## 四、原生权限

定位工具需要权限，在 `android/app/src/main/AndroidManifest.xml` 添加：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

iOS 在 `ios/App/App/Info.plist` 添加：

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>用于获取当前位置以回答位置相关问题</string>
```

## 五、平台层替换点（只改这三处）

| 能力 | 文件 | Web 现状 | App 建议 |
| --- | --- | --- | --- |
| 存储 | `src/services/platform/storage.ts` | localStorage | `@capacitor/preferences` |
| 定位 | `src/services/platform/geolocation.ts` | navigator.geolocation | `@capacitor/geolocation` |
| 文件保存/分享 | `src/services/platform/download.ts` | a[download] | `@capacitor/filesystem` + `@capacitor/share` |
| 剪贴板 | `src/services/platform/clipboard.ts` | navigator.clipboard | `@capacitor/clipboard` |
| 输入弹窗 | `src/services/platform/dialog.ts` + `PromptDialog` | 应用内组件 | 无需改动 |

## 六、数据迁移

- 会话与附件在 IndexedDB（浏览器域内）。
- 换壳后是新的 origin/WebView，旧数据不会自动带过去。
- 迁移方式：Web 版 **设置 → 数据管理 → 导出** ZIP，再在 App 内 **导入**。
- 导入导出实现在 `src/services/chat/backup.ts`，格式稳定，可直接复用。

## 七、已知限制（移动端）

- 无法执行 shell、无法访问任意本地文件（系统沙箱）。
- stdio 类 MCP 不可用；只支持 HTTP/SSE 类 MCP，且服务器需允许 CORS。
- 后台长时间任务会被系统挂起（需原生后台任务支持）。
- 打包后 CORS 策略与浏览器一致，`androidScheme: 'https'` 时第三方 API 仍需允许跨域。
