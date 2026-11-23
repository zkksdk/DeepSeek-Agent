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

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()
  @State private assetsReady: boolean = false
  @State private failure: string = ''

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext
    try {
      WebAssets.install(context)
      this.assetsReady = true
    } catch (error) {
      const err = error as Error
      this.failure = err.message
      hilog.error(DOMAIN, TAG, 'web assets install failed: %{public}s', err.message)
    }
  }

  /** 返回键先退 web 历史，退不动才交给系统 */
  onBackPress(): boolean {
    if (!this.assetsReady) {
      return false
    }
    try {
      if (this.controller.accessBackward()) {
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
    if (data !== null) {
      response.setResponseMimeType(mime)
      response.setResponseEncoding('utf-8')
      response.setResponseData(data)
      response.setResponseIsReady(true)
    }
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
        Column({ space: 12 }) {
          Text('页面装载失败').fontSize(18).fontWeight(FontWeight.Medium)
          Text(this.failure).fontSize(13).fontColor('#666666').textAlign(TextAlign.Center)
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
