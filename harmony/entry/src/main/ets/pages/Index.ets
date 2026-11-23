import { common, ConfigurationConstant } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { fileIo as fs, picker } from '@kit.CoreFileKit'
import { notificationManager } from '@kit.NotificationKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { window } from '@kit.ArkUI'
import { WebAssets } from '../web/WebAssets'

const DOMAIN: number = 0x0000
const TAG: string = 'DSChat'

/**
 * 页面 origin。用 https 而不是 file:// 或 resource://，是为了拿到**安全上下文**：
 * localStorage、IndexedDB、Web Crypto、navigator.clipboard 在 file:// 下要么被禁、
 * 要么 origin 是 null，导致 IndexedDB 分不出站点、fetch 到 api.deepseek.com 的
 * CORS 也无法通过。这里把 https://app.local/* 全部由拦截器映射到沙箱文件。
 */
const APP_ORIGIN: string = 'https://app.local'
const HOME_URL: string = APP_ORIGIN + '/index.html'

/**
 * 壳里不放行 Service Worker 脚本：资源由拦截器供，SW 一旦装上就会把首启那版缓存下来，
 * 应用升级后仍跑旧的。返回 404 让 register() 自然失败（web 端本来就 catch 掉了）。
 */
const SERVICE_WORKER_PATHS: string[] = ['sw.js', 'service-worker.js']

/** 与 src/services/settings.ts 里的 KEYS.apiKey 保持一致 */
const API_KEY_STORAGE: string = 'chat-demo:api-key'

/**
 * 临时验证通道：模拟器里点输入框会拉起软键盘，重绘时整屏卡黑，
 * 没法用键盘敲 key。非空时页面加载完直接写进 localStorage 再刷新一次。
 * 验证完毕必须置空 —— 正式包里不该有这个。
 */
const DEBUG_API_KEY: string = ''

/** 测试用：非空时页面加载完跳到该 hash（例如 '#/settings/data'）。验证完置空。 */
const DEBUG_HASH: string = ''

/**
 * 测试用：非空时页面加载完执行一次这段 JS。验证完必须置空。
 * 联调 H5 端的下载、存储、上报之类时，比改代码重装快得多。
 */
const DEBUG_JS: string = ''

/**
 * 测试用：非空时在启动时强制切颜色模式（'dark' / 'light'），用来验证
 * Web 的 prefers-color-scheme 是否跟着走。验证完必须置空。
 */
const DEBUG_COLOR_MODE: string = ''

/**
 * 测试用：非空时启动后强制屏幕方向（'landscape' / 'portrait'），
 * 用来验证横屏下的布局。验证完必须置空。
 */
const DEBUG_ORIENTATION: string = ''

/**
 * 注入给页面的原生能力。
 *
 * ArkWeb 没有实现 Web Notification（实测 `'Notification' in window` 为 false），
 * 所以上游那个「发送通知」工具在壳里必然失败。这里用系统通知补上，
 * 页面侧检测到 `__DS_SHELL__.notify` 就走原生，浏览器里仍旧走 Web API。
 */
class ShellBridge {
  private context: common.UIAbilityContext

  constructor(context: common.UIAbilityContext) {
    this.context = context
  }

  async notify(title: string, body: string): Promise<boolean> {
    try {
      const enabled = await notificationManager.isNotificationEnabled()
      if (!enabled) {
        await notificationManager.requestEnableNotification(this.context)
      }
      const normal: notificationManager.NotificationBasicContent = {
        title: title,
        text: body,
      }
      const content: notificationManager.NotificationContent = {
        notificationContentType:
          notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: normal,
      }
      const request: notificationManager.NotificationRequest = {
        id: Math.floor(Date.now() % 100000),
        content: content,
      }
      await notificationManager.publish(request)
      return true
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'notify failed: %{public}s', (error as Error).message)
      return false
    }
  }
}

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()
  private injected: boolean = false
  private navigated: boolean = false
  private scriptRan: boolean = false
  /** 下载落地目录：先存沙箱，再交给用户 */
  private downloadDir: string = ''
  /** 交给用户时要用 picker，picker 需要 UIAbilityContext */
  private abilityContext: common.UIAbilityContext | undefined = undefined
  /** 注入给页面的原生桥，见 ShellBridge */
  private bridge: ShellBridge | undefined = undefined
  @State private assetsReady: boolean = false
  @State private failure: string = ''

  aboutToAppear(): void {
    // 远程调试开关。需要连 DevTools 查 console / storage 时打开，配合
    // `hdc fport tcp:9222 tcp:9222`；正式包必须关掉。
    // webview.WebviewController.setWebDebuggingAccess(true)
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext
    this.abilityContext = context
    this.bridge = new ShellBridge(context)
    if (DEBUG_ORIENTATION.length > 0) {
      window.getLastWindow(context).then((win) => {
        const target = DEBUG_ORIENTATION === 'landscape'
          ? window.Orientation.LANDSCAPE
          : window.Orientation.PORTRAIT
        win.setPreferredOrientation(target).catch((error: Error) => {
          hilog.error(DOMAIN, TAG, 'orientation failed: %{public}s', error.message)
        })
      })
    }
    if (DEBUG_COLOR_MODE.length > 0) {
      const mode = DEBUG_COLOR_MODE === 'dark'
        ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
        : ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
      context.getApplicationContext().setColorMode(mode)
    }
    this.downloadDir = context.filesDir + '/downloads'
    if (!fs.accessSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, true)
    }
    // 异步装载：同步拷 5.2 MB 会卡死生命周期，见 WebAssets 顶部注释
    WebAssets.install(context)
      .then(() => {
        this.assetsReady = true
      })
      .catch((error: Error) => {
        this.failure = error.message
        hilog.error(DOMAIN, TAG, 'web assets install failed: %{public}s', error.message)
      })
  }

  /**
   * 下载代理。
   *
   * Web 端导出历史对话、保存分享图都是 URL.createObjectURL(blob) + a.click()，
   * ArkWeb 默认不会像桌面浏览器那样落盘，必须自己接 downloadDelegate。
   * 这里统一落到应用沙箱 downloads/，再由 onDownloadFinish 交给用户。
   */
  /**
   * 把系统给的文件名收敛成安全的单段名字。
   *
   * 名字来自页面（a[download]），理论上可以带 / 、.. 或者 Windows 的非法字符；
   * 直接拼进沙箱路径就是路径穿越。这里统一削掉。
   */
  private safeFileName(raw: string): string {
    const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim()
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'download'
  }

  private setupDownload(): void {
    const delegate = new webview.WebDownloadDelegate()
    delegate.onBeforeDownload((item: webview.WebDownloadItem) => {
      const rawName = item.getSuggestedFileName()
      const name = this.safeFileName(
        rawName.length > 0 ? rawName : 'download-' + Date.now().toString()
      )
      const target = this.downloadDir + '/' + name
      hilog.info(
        DOMAIN,
        TAG,
        'download before: url=%{public}s name=%{public}s',
        item.getUrl(),
        name
      )
      item.start(target)
    })
    delegate.onDownloadUpdated((item: webview.WebDownloadItem) => {
      hilog.info(DOMAIN, TAG, 'download progress: %{public}d', item.getPercentComplete())
    })
    delegate.onDownloadFinish((item: webview.WebDownloadItem) => {
      const path = item.getFullPath()
      hilog.info(DOMAIN, TAG, 'download finish: %{public}s', path)
      this.handOverDownload(path, item.getSuggestedFileName())
    })
    delegate.onDownloadFailed((item: webview.WebDownloadItem) => {
      hilog.error(
        DOMAIN,
        TAG,
        'download failed: url=%{public}s state=%{public}d',
        item.getUrl(),
        item.getState()
      )
    })
    this.controller.setDownloadDelegate(delegate)
  }

  /**
   * 下载完成后把文件交到用户手上。
   *
   * 直接落在应用沙箱里用户是拿不到的（微信、文件管理都看不到），所以弹系统
   * 保存面板让用户挑位置，再把沙箱里的临时文件拷过去、删掉。
   */
  private async handOverDownload(path: string, suggested: string): Promise<void> {
    if (this.abilityContext === undefined) {
      hilog.error(DOMAIN, TAG, 'handover skipped: no context')
      return
    }
    const name = this.safeFileName(suggested)
    try {
      const documentPicker = new picker.DocumentViewPicker(this.abilityContext)
      const options = new picker.DocumentSaveOptions()
      options.newFileNames = [name]
      const uris = await documentPicker.save(options)
      if (uris.length === 0) {
        hilog.info(DOMAIN, TAG, 'handover cancelled by user')
        return
      }
      const written = await this.copyToUri(path, uris[0])
      fs.unlinkSync(path)
      hilog.info(
        DOMAIN,
        TAG,
        'handover done: %{public}s (%{public}d bytes) -> %{public}s',
        name,
        written,
        uris[0]
      )
    } catch (error) {
      const err = error as Error
      hilog.error(DOMAIN, TAG, 'handover failed: %{public}s', err.message)
    }
  }

  /**
   * 分块把沙箱文件拷到用户选的位置，返回写入字节数。
   *
   * 不能一次 new ArrayBuffer(stat.size)：导出的历史对话 ZIP 可能几十上百 MB，
   * 整块读进内存会直接把应用顶爆。256 KB 一块足够快，也不会撑破内存。
   */
  private async copyToUri(source: string, uri: string): Promise<number> {
    const CHUNK = 256 * 1024
    const stat = fs.statSync(source)
    const src = await fs.open(source, fs.OpenMode.READ_ONLY)
    const dst = await fs.open(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC)
    let offset = 0
    try {
      while (offset < stat.size) {
        const size = Math.min(CHUNK, stat.size - offset)
        const buf = new ArrayBuffer(size)
        await fs.read(src.fd, buf, { offset: offset, length: size })
        await fs.write(dst.fd, buf)
        offset += size
      }
    } finally {
      await fs.close(src)
      await fs.close(dst)
    }
    return offset
  }

  /** 返回键先退 web 历史，退不动才交给系统 */
  onBackPress(): boolean {
    if (!this.assetsReady) {
      return false
    }
    try {
      const url = this.controller.getUrl()
      // 光看 accessBackward 不够：初始导航时它也可能是 true，一退就退成空白页（实测整屏黑）。
      if (url.startsWith(APP_ORIGIN) && this.controller.accessBackward()) {
        this.controller.backward()
        return true
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'backward failed: %{public}s', (error as Error).message)
    }
    return false
  }

  /** 造一个完整响应；ArkWeb 的 WebResourceResponse 只能 new + setter 填 */
  private response(code: number, reason: string, mime: string, data: ArrayBuffer | null): WebResourceResponse {
    const response = new WebResourceResponse()
    response.setResponseCode(code)
    response.setReasonMessage(reason)
    if (data === null) {
      response.setResponseHeader([
        { headerKey: 'Content-Type', headerValue: 'text/plain; charset=utf-8' },
      ])
      return response
    }
    // setResponseMimeType 只认裸类型，塞 "text/html; charset=utf-8" 进去会让它认不出，
    // 结果整页被当成纯文本显示。带参数的完整值走响应头，裸类型走 mimeType。
    const semi = mime.indexOf(';')
    const bare = semi >= 0 ? mime.slice(0, semi).trim() : mime
    response.setResponseMimeType(bare)
    if (bare.startsWith('text/') || bare === 'application/json' || bare === 'application/manifest+json') {
      response.setResponseEncoding('utf-8')
    }
    response.setResponseHeader([
      { headerKey: 'Content-Type', headerValue: mime },
      { headerKey: 'Cache-Control', headerValue: 'no-cache' },
    ])
    response.setResponseData(data)
    response.setResponseIsReady(true)
    return response
  }

  private intercept(url: string): WebResourceResponse | null {
    if (!url.startsWith(APP_ORIGIN + '/')) {
      return null
    }
    const rel = url.slice(APP_ORIGIN.length + 1)
    const safe = WebAssets.sanitize(rel)
    if (safe === null) {
      return null
    }
    // 拒掉 Service Worker，别让旧版本被缓存住
    for (const blocked of SERVICE_WORKER_PATHS) {
      if (safe === blocked) {
        return this.response(404, 'Not Found', 'text/plain; charset=utf-8', null)
      }
    }
    const bytes = WebAssets.read(safe)
    if (bytes !== null) {
      return this.response(200, 'OK', WebAssets.mime(safe), bytes)
    }
    // 没有对应文件就落到 index.html，当作单页应用
    const fallback = WebAssets.read('index.html')
    if (fallback === null) {
      return null
    }
    return this.response(200, 'OK', 'text/html; charset=utf-8', fallback)
  }

  build() {
    Stack() {
      if (this.assetsReady) {
        Web({ src: HOME_URL, controller: this.controller })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .databaseAccess(true)
          .geolocationAccess(true)
          .fileAccess(false)
          .imageAccess(true)
          .onlineImageAccess(true)
          .mixedMode(MixedMode.All)
          .cacheMode(CacheMode.Default)
          .darkMode(WebDarkMode.Auto)
          .onControllerAttached(() => {
            // 下载代理要在 controller 绑定之后才能设
            this.setupDownload()
          })
          .javaScriptProxy({
            object: this.bridge as ShellBridge,
            name: '__DS_SHELL__',
            methodList: ['notify'],
            controller: this.controller,
          })
          .onInterceptRequest((event) => {
            if (!event) {
              return null
            }
            return this.intercept(event.request.getRequestUrl())
          })
          .onPermissionRequest((event) => {
            if (event) {
              event.request.grant(event.request.getAccessibleResource())
            }
          })
          .onPageEnd((event) => {
            hilog.info(DOMAIN, TAG, 'page end: %{public}s', event.url)
            if (DEBUG_API_KEY.length > 0 && !this.injected) {
              this.injected = true
              const script = "localStorage.setItem('" + API_KEY_STORAGE + "', '" + DEBUG_API_KEY + "')"
              this.controller
                .runJavaScript(script)
                .then(() => this.controller.refresh())
                .catch((error: Error) => {
                  hilog.error(DOMAIN, TAG, 'inject failed: %{public}s', error.message)
                })
              return
            }
            if (DEBUG_HASH.length > 0 && !this.navigated) {
              this.navigated = true
              this.controller.loadUrl(HOME_URL + DEBUG_HASH)
              return
            }
            if (DEBUG_JS.length > 0 && !this.scriptRan) {
              this.scriptRan = true
              this.controller
                .runJavaScript(DEBUG_JS)
                .then((result) => {
                  hilog.info(DOMAIN, TAG, 'debug js result: %{public}s', JSON.stringify(result))
                })
                .catch((error: Error) => {
                  hilog.error(DOMAIN, TAG, 'debug js failed: %{public}s', error.message)
                })
            }
          })
          .onErrorReceive((event) => {
            if (event) {
              hilog.error(
                DOMAIN,
                TAG,
                'resource error: %{public}s %{public}s',
                event.request.getRequestUrl(),
                event.error.getErrorInfo()
              )
            }
          })
      } else {
        Column({ space: 16 }) {
          LoadingProgress().width(40).height(40)
          Text(this.failure.length > 0 ? '页面装载失败：' + this.failure : '正在装载…')
            .fontSize(14)
            .fontColor('#666666')
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .padding(24)
      }
    }
    .width('100%')
    .height('100%')
  }
}