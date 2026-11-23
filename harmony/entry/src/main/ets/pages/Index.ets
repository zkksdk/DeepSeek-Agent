import { common, ConfigurationConstant } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { fileIo as fs, picker } from '@kit.CoreFileKit'
import { notificationManager } from '@kit.NotificationKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { window } from '@kit.ArkUI'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { http } from '@kit.NetworkKit'
import { util } from '@kit.ArkTS'
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

/**
 * 摘掉 showDirectoryPicker。
 *
 * 手机上它会退化成系统的文件选择器（图库/拍照/文件），返回的是 File 而不是
 * DirectoryHandle；上游 pickDirectory 不做类型校验，直接当目录用，后面
 * dir.values() 一类调用就是 TypeError。
 *
 * 摘掉之后 pickDirectory 走「showDirectoryPicker 不存在」的分支抛 unsupported，
 * 上游 catch 里把它设成 error: 'open'，用户看到的是明确的失败提示而不是崩。
 */
/**
 * 账号凭据补丁。
 *
 * DeepSeek 的账号登录换来的不是 API Key，而是一个 OAuth token，它要走
 * `x-dsh-auth-token` 请求头而不是 `Authorization: Bearer`。实测两者扣的是同一个
 * 余额（/user/balance 返回 200），只是鉴权头不同；CORS 预检也明确放行了这个头。
 *
 * 为了不动上游代码：约定用户填的 key 以 "dsh:" 开头表示「这是账号 token」。
 * 这里劫持 fetch，把 `Authorization: Bearer dsh:xxx` 换成 `x-dsh-auth-token: xxx`。
 *
 * 已知限制：上传附件走的是 `x-api-key`（Anthropic 兼容路径），不经过这个改写，
 * 所以账号 token 模式下附件上传不可用。
 */
/** 把 hash 变化报给原生，供设置页判断 */
/** 账号登录的回调地址。服务端只接受 localhost，我们靠拦截器接住它。 */
const OAUTH_REDIRECT: string = 'http://localhost:8080/oauth/callback'
const OAUTH_INIT_URL: string = 'https://platform.deepseek.com/auth-api/v0/dsh/auth_init'
const OAUTH_EXCHANGE_URL: string = 'https://platform.deepseek.com/auth-api/v0/dsh/auth_exchange'

const HASH_WATCH: string =
  "(function(){" +
  "if(window.__DS_HASH_WATCH__)return 'already';" +
  "window.__DS_HASH_WATCH__=true;" +
  "var send=function(){try{window.__DS_SHELL__.onHash(location.hash||'')}catch(e){}};" +
  "window.addEventListener('hashchange',send);" +
  "send();" +
  "return 'watching'})()"

const AUTH_TOKEN_PATCH: string =
  "(function(){" +
  "if(window.__DS_AUTH_PATCH__)return 'already';" +
  "window.__DS_AUTH_PATCH__=true;" +
  "var P='dsh:';" +
  "var orig=window.fetch;" +
  "window.fetch=function(input,init){" +
  "try{" +
  "if(init&&init.headers){" +
  "var h=init.headers;" +
  "var pick=function(n){" +
  "if(h instanceof Headers)return h.get(n);" +
  "if(Array.isArray(h)){for(var i=0;i<h.length;i++){if(String(h[i][0]).toLowerCase()===n)return h[i][1];}return null;}" +
  "for(var k in h){if(k.toLowerCase()===n)return h[k];}" +
  "return null;};" +
  "var tok=null;" +
  "var a=pick('authorization');" +
  "if(a&&a.indexOf('Bearer '+P)===0)tok=a.slice(('Bearer '+P).length);" +
  "var xk=pick('x-api-key');" +
  "if(!tok&&xk&&xk.indexOf(P)===0)tok=xk.slice(P.length);" +
  "if(tok){" +
  "var nh=new Headers(h);" +
  "nh.delete('authorization');" +
  "nh.delete('x-api-key');" +
  "nh.set('x-dsh-auth-token',tok);" +
  "init=Object.assign({},init,{headers:nh});" +
  "}}}catch(e){}" +
  "return orig.apply(window,[input,init]);};" +
  "return 'patched'})()"

const DIRECTORY_PICKER_PATCH: string =
  "(function(){try{delete window.showDirectoryPicker}catch(e){}" +
  "try{Object.defineProperty(window,'showDirectoryPicker'," +
  "{value:undefined,configurable:true,writable:true})}catch(e){}" +
  "return typeof window.showDirectoryPicker})()"

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
/** auth_init 的响应形状 */
interface OAuthInitBody {
  authorize_url: string
  authorize_id: string
  expires_in: number
}

interface OAuthInitEnvelope {
  code: number
  msg: string
  data: OAuthInitBody | null
}

/** 平台接口统一用 { code, data: { biz_data } } 包一层 */
interface PlatformEnvelope<T> {
  code: number
  msg: string
  data: PlatformData<T> | null
}

interface PlatformData<T> {
  biz_code: number
  biz_msg: string
  biz_data: T
}

interface OAuthExchangeBody {
  token: string
  authorized_url: string
}

class ShellBridge {
  private context: common.UIAbilityContext

  constructor(context: common.UIAbilityContext) {
    this.context = context
  }

  /** 设置页点「账号登录」时调用 */
  login(): void {
    this.onLogin?.()
  }

  /** 由 Index 注入 */
  onLogin: (() => void) | undefined = undefined

  /** 页面 hash 变化时报给原生，用来判断是否在设置页 */
  onHash(hash: string): void {
    this.onHashChange?.(hash)
  }

  /** 由 Index 注入的回调 */
  onHashChange: ((hash: string) => void) | undefined = undefined

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
  /** 当前页面 hash，用来判断是否在设置页（SPA 路由不触发 onPageEnd） */
  @State private currentHash: string = ''
  /** OAuth 中间态：PKCE verifier 和本次授权的 id */
  private pendingVerifier: string = ''
  private pendingAuthorizeId: string = ''

  aboutToAppear(): void {
    // 远程调试开关。需要连 DevTools 查 console / storage 时打开，配合
    // `hdc fport tcp:9222 tcp:9222`；正式包必须关掉。
    // webview.WebviewController.setWebDebuggingAccess(true)
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext
    this.abilityContext = context
    this.bridge = new ShellBridge(context)
    this.bridge.onHashChange = (hash: string) => {
      this.currentHash = hash
    }
    this.bridge.onLogin = () => {
      this.startAccountLogin()
    }
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

  /** 生成 PKCE 的 verifier / challenge（S256） */
  private async makePkce(): Promise<[string, string]> {
    const random = cryptoFramework.createRandom()
    const bytes = random.generateRandomSync(32)
    const b64 = new util.Base64Helper()
    const toUrlSafe = (raw: string): string => raw.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const verifier = toUrlSafe(b64.encodeToStringSync(bytes.data))

    const md = cryptoFramework.createMd('SHA256')
    await md.update({ data: bytes.data })
    const digest = await md.digest()
    const challenge = toUrlSafe(b64.encodeToStringSync(digest.data))
    return [verifier, challenge]
  }

  /** POST 一段 JSON，返回响应体文本 */
  private async postJson(url: string, body: string): Promise<string> {
    const request = http.createHttp()
    try {
      const response = await request.request(url, {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://platform.deepseek.com',
          'Referer': 'https://platform.deepseek.com/',
          'User-Agent': 'Mozilla/5.0 (Linux; HarmonyOS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        extraData: body,
        connectTimeout: 15000,
        readTimeout: 20000,
      })
      return typeof response.result === 'string' ? response.result : JSON.stringify(response.result)
    } finally {
      request.destroy()
    }
  }

  /** 用拿到的 code 换 token，写进 dsh: 通道，然后回到 Agent 首页 */
  private async exchangeCode(code: string): Promise<void> {
    if (this.pendingVerifier.length === 0) {
      hilog.error(DOMAIN, TAG, 'exchange skipped: no verifier')
      return
    }
    const body = JSON.stringify({
      code: code,
      code_verifier: this.pendingVerifier,
      redirect_uri: OAUTH_REDIRECT,
      device_id: this.pendingAuthorizeId,
      'device_model': 'HUAWEI-HarmonyOS',
      'os_version': 'HarmonyOS',
    })
    const raw = await this.postJson(OAUTH_EXCHANGE_URL, body)
    hilog.info(DOMAIN, TAG, 'exchange response: %{public}s', raw.slice(0, 300))
    const envelope = JSON.parse(raw) as PlatformEnvelope<OAuthExchangeBody>
    if (envelope.code !== 0 || envelope.data === null) {
      hilog.error(DOMAIN, TAG, 'exchange failed: code=%{public}d msg=%{public}s', envelope.code, envelope.msg)
      return
    }
    const token = envelope.data.biz_data.token
    const script = "localStorage.setItem('" + API_KEY_STORAGE + "', " + JSON.stringify('dsh:' + token) + ")"
    await this.controller.runJavaScript(script)
    hilog.info(DOMAIN, TAG, 'account token stored, reloading')
    this.pendingVerifier = ''
    this.controller.loadUrl(HOME_URL)
  }

  /**
   * 账号登录。
   *
   * 走 DeepSeek 官方的 OAuth（PKCE）：先 auth_init 拿授权页地址，在 WebView 里
   * 打开让用户登录，服务端会 302 回 http://localhost:<port>/oauth/callback?code=…，
   * 拦截到 code 后再 auth_exchange 换 token，写进 dsh: 通道。
   */
  private startAccountLogin(): void {
    hilog.info(DOMAIN, TAG, 'account login requested')
    this.runAccountLogin().catch((error: Error) => {
      hilog.error(DOMAIN, TAG, 'account login failed: %{public}s', error.message)
    })
  }

  /** PKCE → auth_init → 打开官方授权页；回调由 intercept 接住 */
  private async runAccountLogin(): Promise<void> {
    const pkce = await this.makePkce()
    const verifier = pkce[0]
    const challenge = pkce[1]
    this.pendingVerifier = verifier
    const body = JSON.stringify({
      'code_challenge': challenge,
      'code_challenge_method': 'S256',
      'state': verifier.slice(0, 16),
      'redirect_uri': OAUTH_REDIRECT,
      'locale': 'zh_CN',
      'login_source': 'web',
    })
    const raw = await this.postJson(OAUTH_INIT_URL, body)
    hilog.info(DOMAIN, TAG, 'auth_init(raw): %{public}s', raw.slice(0, 700))
    const envelope = JSON.parse(raw) as PlatformEnvelope<OAuthInitBody>
    if (envelope.code !== 0 || envelope.data === null) {
      hilog.error(DOMAIN, TAG, 'auth_init rejected: %{public}d %{public}s', envelope.code, envelope.msg)
      return
    }
    this.pendingAuthorizeId = envelope.data.biz_data.authorize_id
    this.controller.loadUrl(envelope.data.biz_data.authorize_url)
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
    // 账号登录的回调：服务端 302 到 localhost，这里接住 code
    if (url.startsWith(OAUTH_REDIRECT)) {
      const marker = url.indexOf('code=')
      if (marker >= 0) {
        const rest = url.slice(marker + 5)
        const amp = rest.indexOf('&')
        const code = amp >= 0 ? rest.slice(0, amp) : rest
        this.exchangeCode(decodeURIComponent(code)).catch((error: Error) => {
          hilog.error(DOMAIN, TAG, 'exchange failed: %{public}s', error.message)
        })
      }
      const html = '<!doctype html><meta charset="utf-8"><body style="background:#111;color:#eee;font:16px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>授权完成，正在返回应用…</p></body>'
      const bytes = new util.TextEncoder().encodeInto(html).buffer as ArrayBuffer
      return this.response(200, 'OK', 'text/html; charset=utf-8', bytes)
    }
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
            methodList: ['notify', 'onHash', 'login'],
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
            this.controller
              .runJavaScript(AUTH_TOKEN_PATCH)
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'auth patch failed: %{public}s', error.message)
              })
            this.controller
              .runJavaScript(HASH_WATCH)
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'hash watch failed: %{public}s', error.message)
              })
            this.controller
              .runJavaScript(DIRECTORY_PICKER_PATCH)
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'picker patch failed: %{public}s', error.message)
              })
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