import { common } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { hilog } from '@kit.PerformanceAnalysisKit'
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

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()
  private injected: boolean = false
  @State private assetsReady: boolean = false
  @State private failure: string = ''

  aboutToAppear(): void {
    // 远程调试开关。需要连 DevTools 查 console / storage 时打开，配合
    // `hdc fport tcp:9222 tcp:9222`；正式包必须关掉。
    // webview.WebviewController.setWebDebuggingAccess(true)
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext
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
