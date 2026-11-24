import { common, ConfigurationConstant } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { geoLocationManager } from '@kit.LocationKit'
import { fileIo as fs, picker } from '@kit.CoreFileKit'
import { notificationManager } from '@kit.NotificationKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { KeyboardAvoidMode, window } from '@kit.ArkUI'
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
/** 登录中途应用被杀时，PKCE verifier 靠它活下来 */
const OAUTH_VERIFIER_KEY: string = 'oauth:pending-verifier'
/** 稳定设备标识的存储键 */
const OAUTH_DEVICE_KEY: string = 'oauth:device-id'

/** 把未捕获异常和 console.error 转给原生，黑屏才有据可查 */
const ERROR_WATCH: string =
  "(function(){" +
  "if(window.__DS_ERR_WATCH__)return 'already';" +
  "window.__DS_ERR_WATCH__=true;" +
  "var send=function(m){try{window.__DS_SHELL__.log(String(m).slice(0,300))}catch(e){}};" +
  "window.addEventListener('error',function(e){send('ERROR '+(e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||0))});" +
  "window.addEventListener('unhandledrejection',function(e){send('REJECT '+(e.reason&&e.reason.message?e.reason.message:String(e.reason)).slice(0,200))});" +
  "var ce=console.error;console.error=function(){try{send('console.error '+Array.prototype.join.call(arguments,' ').slice(0,250))}catch(e){};return ce.apply(console,arguments)};" +
  "return 'watching'})()"

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

/** 遍历文件夹时跳过的目录，跟 web 端保持一致 */
const SKIP_DIRS: Set<string> = new Set<string>([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt',
  '.cache', '.turbo', '.venv', 'venv', '__pycache__', 'target',
  'vendor', 'coverage', '.idea', '.vscode'
])

/** 与 src/services/settings.ts 里的 KEYS.apiKey 保持一致 */
const API_KEY_STORAGE: string = 'chat-demo:api-key'






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

  /** 页面把 console/error 转给原生，方便在 hilog 里看 */
  /** 页面上的胶囊点了「展开」，把窗口叫回来 */
  async openBrowser(): Promise<void> {
    if (this.lastBrowserUrl !== '') {
      this.onBrowserShow?.(this.lastBrowserUrl)
    }
  }

  log(message: string): void {
    hilog.info(DOMAIN, TAG, 'web: %{public}s', message.slice(0, 400))
  }

  /** 由 Index 注入：隐藏浏览器的 controller */
  browseController: webview.WebviewController | null = null
  /** 最近一次打开的地址，页面点「展开」时用它 */
  private lastBrowserUrl: string = ''

  /**
   * 在内嵌浏览器里打开页面并执行脚本。
   *
   * 抓 HTML 用 fetchUrl 就够，但很多页面要靠 JS 才出内容、才有交互。
   * 这里用一个隐藏的 Web 组件（用户看不见），加载完再跑脚本，
   * 脚本里可以 click、填表单、读 DOM。
   */
  /** 由 Index 注入：让页面弹出/收起浏览器小窗 */
  onBrowserShow: ((url: string) => void) | undefined = undefined
  /** 由 Index 注入：把浏览器状态推给页面，让 web 自己画胶囊 */
  notifyBrowserState: ((visible: boolean, url: string) => void) | undefined = undefined
  /** 由 Index 注入：当前是不是用户接管中 */
  isUserTakeover: (() => boolean) | undefined = undefined
  /** 由 Index 注入：Agent 在等用户交还时通知界面 */
  onWaitUser: ((waiting: boolean) => void) | undefined = undefined

  async browse(url: string, script: string): Promise<string> {
    const controller = this.browseController
    if (controller === null) {
      return JSON.stringify({ ok: false, error: 'browser not ready' })
    }
    // 用户接管期间不抢操作，等着。
    // 等 25 秒就收手——再久的话上层会把整个调用转后台，用户反而看不到反馈。
    const takeover = this.isUserTakeover
    if (takeover !== undefined && takeover()) {
      this.onWaitUser?.(true)
      const limit = Date.now() + 25000
      while (takeover()) {
        if (Date.now() > limit) {
          this.onWaitUser?.(false)
          hilog.info(DOMAIN, TAG, 'browse gave up: user still operating')
          return JSON.stringify({
            ok: false,
            error: '用户正在操作浏览器，等了 25 秒还没交还。可以稍后再试，或者直接问用户。'
          })
        }
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 300))
      }
      this.onWaitUser?.(false)
    }
    try {
      this.lastBrowserUrl = url
      this.onBrowserShow?.(url)
      this.notifyBrowserState?.(true, url)
      controller.loadUrl(url)
      const deadline = Date.now() + 12000
      for (;;) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 400))
        if (controller.getProgress() >= 100 || Date.now() > deadline) {
          break
        }
      }
      // 再等一会儿，让首屏脚本渲染完
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 1200))
      const result = await controller.runJavaScript(script)
      const text: string = typeof result === 'string' ? result : JSON.stringify(result)
      hilog.info(DOMAIN, TAG, 'browse done, %{public}d chars', text.length)
      return text
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'browse failed: %{public}s', (error as Error).message)
      return JSON.stringify({ ok: false, error: (error as Error).message })
    }
  }

  /**
   * 选一个文件夹并把里面的文本文件读出来。
   *
   * ArkWeb 没有 showDirectoryPicker，上游那套 FileSystemDirectoryHandle
   * 在鸿蒙上跑不起来，所以把「选目录 + 遍历 + 读文本」整个搬到壳里，
   * 结果按 { files: { path: content }, truncated, name } 回给页面。
   */
  async pickFolder(): Promise<string> {
    try {
      const documentPicker = new picker.DocumentViewPicker(this.context)
      const options = new picker.DocumentSelectOptions()
      options.maxSelectNumber = 1
      options.selectMode = picker.DocumentSelectMode.FOLDER
      const uris = await documentPicker.select(options)
      if (uris.length === 0) {
        return ''
      }
      const rootUri: string = uris[0]
      const files: Record<string, string> = {}
      let truncated = false
      let count = 0
      const walk = (dirUri: string, prefix: string, depth: number): void => {
        if (depth > 8 || truncated) {
          return
        }
        let names: string[] = []
        try {
          names = fs.listFileSync(dirUri)
        } catch (error) {
          hilog.warn(DOMAIN, TAG, 'list failed: %{public}s', (error as Error).message)
          return
        }
        for (const name of names) {
          if (count >= 400) {
            truncated = true
            return
          }
          if (SKIP_DIRS.has(name) || name.startsWith('.')) {
            continue
          }
          const childUri: string = dirUri + '/' + name
          const childPath: string = prefix.length > 0 ? prefix + '/' + name : name
          let stat: fs.Stat | null = null
          try {
            stat = fs.statSync(childUri)
          } catch (error) {
            continue
          }
          if (stat.isDirectory()) {
            walk(childUri, childPath, depth + 1)
            continue
          }
          if (stat.size > 160 * 1024) {
            continue
          }
          try {
            files[childPath] = fs.readTextSync(childUri)
            count += 1
          } catch (error) {
            // 非文本文件读不出来，跳过
          }
        }
      }
      walk(rootUri, '', 0)
      const payload: Record<string, Object> = {
        'files': files,
        'truncated': truncated,
        'name': decodeURIComponent(rootUri.slice(rootUri.lastIndexOf('/') + 1))
      }
      hilog.info(DOMAIN, TAG, 'pickFolder: %{public}d files', count)
      return JSON.stringify(payload)
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'pickFolder failed: %{public}s', (error as Error).message)
      return ''
    }
  }

  /**
   * 抓一个网页的 HTML。
   *
   * 走系统的 http 模块，不受浏览器 CORS 约束——页面里 fetch 跨域会被拦，
   * 原生请求不会。拿回来的是服务端原始 HTML，不含 JS 渲染后的内容；
   * 需要渲染的页面得靠隐藏的 Web 组件，那是下一步。
   */
  async fetchUrl(url: string): Promise<string> {
    const request = http.createHttp()
    try {
      const response = await request.request(url, {
        method: http.RequestMethod.GET,
        header: {
          // 不少站点对空 UA 直接返回 403
          'User-Agent': 'Mozilla/5.0 (Linux; HarmonyOS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        connectTimeout: 15000,
        readTimeout: 20000,
        expectDataType: http.HttpDataType.STRING,
      })
      const body: string = typeof response.result === 'string' ? response.result : ''
      const payload: Record<string, Object> = {
        'ok': response.responseCode >= 200 && response.responseCode < 300,
        'status': response.responseCode,
        'html': body.slice(0, 400000)
      }
      hilog.info(DOMAIN, TAG, 'fetchUrl %{public}d %{public}d chars', response.responseCode, body.length)
      return JSON.stringify(payload)
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'fetchUrl failed: %{public}s', (error as Error).message)
      const failed: Record<string, Object> = {
        'ok': false,
        'status': 0,
        'error': (error as Error).message
      }
      return JSON.stringify(failed)
    } finally {
      request.destroy()
    }
  }

  /**
   * 系统定位 + 系统逆地理编码。
   *
   * 用 HarmonyOS 自带的 LocationKit：先取当前位置，再让系统反查地址，
   * 不需要接任何第三方地图服务。拿不到就返回空字符串，页面安静地忽略。
   */
  async locate(): Promise<string> {
    try {
      const position = await geoLocationManager.getCurrentLocation({
        priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
        scenario: geoLocationManager.LocationRequestScenario.UNSET,
        timeoutMs: 8000,
      })
      const addresses = await geoLocationManager.getAddressesFromLocation({
        latitude: position.latitude,
        longitude: position.longitude,
        locale: 'zh',
        maxItems: 1,
      })
      const first: geoLocationManager.GeoAddress | null =
        addresses.length > 0 ? addresses[0] : null
      if (first === null) {
        return ''
      }
      const payload: Record<string, string> = {
        'region': first.countryCode ?? 'CN',
        'province': first.administrativeArea ?? '',
        'city': first.locality ?? first.subAdministrativeArea ?? ''
      }
      hilog.info(DOMAIN, TAG, 'locate: %{public}s', JSON.stringify(payload))
      return JSON.stringify(payload)
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'locate failed: %{public}s', (error as Error).message)
      return ''
    }
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
  /** 下载落地目录：先存沙箱，再交给用户 */
  private downloadDir: string = ''
  /** 交给用户时要用 picker，picker 需要 UIAbilityContext */
  private abilityContext: common.UIAbilityContext | undefined = undefined
  /** 注入给页面的原生桥，见 ShellBridge */
  private bridge: ShellBridge | undefined = undefined
  /** 隐藏的浏览器：给 Agent 用，跑 JS、点按钮、读内容，不影响用户看到的界面 */
  private browseController: webview.WebviewController = new webview.WebviewController()
  /** 当前内嵌浏览器是否就绪 */
  private browseReady: boolean = false
  /** Agent 用浏览器时弹出的小窗是否打开 */
  @State private showBrowser: boolean = false
  /** 小窗里当前显示的地址 */
  @State private browserUrl: string = ''
  /** 用户接管后暂停 Agent 的脚本注入 */
  @State private userTakeover: boolean = false
  /** 已经用过一次浏览器（收起后要留个入口能再打开） */
  @State private browserOpened: boolean = false
  /** Agent 正等着用户交还浏览器 */
  @State private browserWaiting: boolean = false

  @State private assetsReady: boolean = false
  /** 状态栏高度（vp）。全屏后窗口铺到状态栏后面，内容靠这个内边距避让。
   *  先给 36 兜底：aboutToAppear 阶段 getWindowAvoidArea 往往还没量出来，
   *  真要等它就等于让内容先压到状态栏下面去。 */
  @State @Watch('onSafeAreaChanged') private safeTop: number = 36
  /** 底部导航条高度（vp）。同理，底部也要让开，否则最下面那行字会被压住裁掉 */
  @State @Watch('onSafeAreaChanged') private safeBottom: number = 0
  @State private failure: string = ''
  /** 当前页面 hash，用来判断是否在设置页（SPA 路由不触发 onPageEnd） */
  @State private currentHash: string = ''
  /** OAuth 中间态：PKCE verifier 和本次授权的 id */
  private pendingVerifier: string = ''
  /** 设备标识：首次生成后固定下来，auth_exchange 的 device_id 用它 */
  private deviceId: string = ''
  /**
   * 待写入的账号 token。
   *
   * 关键：换 token 时页面还在 http://localhost:8080/oauth/callback 这个 origin 上，
   * 直接 runJavaScript 写 localStorage 会写进 localhost 的存储，等 loadUrl 回到
   * app.local 就是另一个 origin，读不到。所以先存字段，等回到 app.local 的
   * onPageEnd 再写。
   */
  private pendingToken: string = ''
  private pendingAuthorizeId: string = ''

  /** 把浏览器状态推给页面；页面据此决定要不要在输入框上方画胶囊 */
  private notifyBrowserStateToPage(visible: boolean, url: string): void {
    this.controller
      .runJavaScript(
        'window.__DS_BROWSER_STATE__ && window.__DS_BROWSER_STATE__(' +
          JSON.stringify(visible) + ',' + JSON.stringify(url) + ')'
      )
      .catch(() => {
        // 页面还没起来就算了，不值得为这个报错
      })
  }

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
    this.bridge.browseController = this.browseController
    // Agent 调浏览器时把窗口打开，用户能看到它在做什么
    this.bridge.onBrowserShow = (url: string) => {
      this.browserUrl = url
      this.userTakeover = false
      this.browserOpened = true
      this.showBrowser = true
    }
    // 接管期间 Agent 的脚本注入要让路，这里把状态喂给桥
    this.bridge.notifyBrowserState = (visible: boolean, url: string) => {
      // 让页面自己画胶囊：它跟着输入框排版，天然自适应任何屏幕
      this.notifyBrowserStateToPage(visible, url)
    }
    this.bridge.isUserTakeover = () => this.userTakeover
    this.bridge.onWaitUser = (waiting: boolean) => {
      this.browserWaiting = waiting
      // 它在等你的时候，窗口得让人看见，不然等了个寂寞
      if (waiting && this.browserUrl !== '') {
        this.showBrowser = true
      }
    }
    this.bridge.onLogin = () => {
      this.startAccountLogin()
    }
    // 键盘避让交给 ArkWeb 自己处理。
    // ArkUI 默认是 OFFSET：键盘弹出时把整个 Web 组件往上推；ArkWeb 内部也会把
    // 输入框滚进可视区。两者叠加会把画面顶崩——真机上表现为点 API Key 输入框后整屏黑。
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE)
    this.downloadDir = context.filesDir + '/downloads'
    setTimeout(() => {
      window.getLastWindow(context).then((win) => {
        const avoid = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM)
        const top = px2vp(avoid.topRect.height)
        if (top > 0) {
          this.safeTop = top + 8
        }
        const nav = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR)
        const bottom = px2vp(nav.bottomRect.height)
        hilog.info(DOMAIN, TAG, 'avoid top=%{public}d bottom=%{public}d vp', top, bottom)
        if (bottom > 0) {
          this.safeBottom = bottom
        }
      }).catch((error: Error) => {
        hilog.warn(DOMAIN, TAG, 'read avoid area failed: %{public}s', error.message)
      })
    }, 600)
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

    // PKCE 规范：challenge = BASE64URL(SHA256(ASCII(verifier)))，也就是对 verifier
    // 这个字符串本身做哈希。拿原始随机字节去 hash 会得到一对不配套的值，
    // 服务端校验时只回一个 INVALID_CODE，看不出是 PKCE 的锅。
    const encoder = new util.TextEncoder()
    const verifierBytes = encoder.encodeInto(verifier)
    const md = cryptoFramework.createMd('SHA256')
    await md.update({ data: verifierBytes })
    const digest = await md.digest()
    const challenge = toUrlSafe(b64.encodeToStringSync(digest.data))
    hilog.info(DOMAIN, TAG, 'pkce verifier=%{public}s', verifier)
    hilog.info(DOMAIN, TAG, 'pkce challenge=%{public}s', challenge)
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
          // 平台的 auth_exchange 校验客户端身份，缺 x-client-platform 直接 422：
          //   {"detail":[{"loc":"header.x-client-platform"}]}
          'x-client-platform': 'web',
          'x-client-type': 'DSH',
          'x-client-version': '1.0.1',
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
    try {
      const verifier = await this.resolveVerifier()
      if (verifier.length === 0) {
        hilog.error(DOMAIN, TAG, 'exchange skipped: no verifier in memory or storage')
        return
      }
      const body = JSON.stringify({
        code: code,
        code_verifier: verifier,
        redirect_uri: OAUTH_REDIRECT,
        device_id: this.deviceId,
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
      // 不能在这里写 localStorage：当前 origin 还是 localhost:8080。
      this.pendingToken = 'dsh:' + token
      hilog.info(DOMAIN, TAG, 'account token received (%{public}d chars), will store on app.local', this.pendingToken.length)
      this.pendingVerifier = ''
    } finally {
      // 不管换 token 成没成，都要离开回调页。否则页面停在 localhost 那屏，
      // 用户以为卡死，只能杀应用（而一杀，PKCE verifier 就没了）。
      this.controller.loadUrl(HOME_URL)
    }
  }

  /**
   * 把安全区尺寸推给页面。启动那一刻量不到真实值（先给 36 兜底），
   * 600ms 后测到真值必须重推一次，否则页面一直按兜底值排版，
   * 侧边栏标题就会压在状态栏上。
   */
  private injectSafeArea(): void {
    const script = 'document.documentElement.style.setProperty("--ds-safe-top","' +
      this.safeTop + 'px");document.documentElement.style.setProperty("--ds-safe-bottom","' +
      this.safeBottom + 'px");'
    this.controller.runJavaScript(script).catch((error: Error) => {
      hilog.warn(DOMAIN, TAG, 'safe area inject failed: %{public}s', error.message)
    })
  }

  onSafeAreaChanged(): void {
    if (this.assetsReady) {
      this.injectSafeArea()
    }
  }

  /** 设备标识：第一次生成后写进 localStorage，之后一直用它 */
  private async ensureDeviceId(): Promise<void> {
    if (this.deviceId.length > 0) {
      return
    }
    try {
      const saved = await this.controller.runJavaScript(
        "localStorage.getItem('" + OAUTH_DEVICE_KEY + "') || ''")
      if (typeof saved === 'string' && saved.length > 0) {
        this.deviceId = saved
        return
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'read device id failed: %{public}s', (error as Error).message)
    }
    this.deviceId = util.generateRandomUUID()
    try {
      await this.controller.runJavaScript(
        "localStorage.setItem('" + OAUTH_DEVICE_KEY + "', " + JSON.stringify(this.deviceId) + ")")
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'persist device id failed: %{public}s', (error as Error).message)
    }
    hilog.info(DOMAIN, TAG, 'device id ready')
  }

  /** 取 PKCE verifier：先看内存，再看上次登录时落盘的那份 */
  private async resolveVerifier(): Promise<string> {
    if (this.pendingVerifier.length > 0) {
      return this.pendingVerifier
    }
    try {
      const saved = await this.controller.runJavaScript(
        "localStorage.getItem('" + OAUTH_VERIFIER_KEY + "') || ''")
      if (typeof saved === 'string') {
        return saved
      }
      return ''
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'read saved verifier failed: %{public}s', (error as Error).message)
      return ''
    }
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
    await this.ensureDeviceId()
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
    // 落盘一份：授权页里用户可能退回、杀掉应用，回来时内存里那份已经没了
    try {
      await this.controller.runJavaScript(
        "localStorage.setItem('" + OAUTH_VERIFIER_KEY + "', " + JSON.stringify(verifier) + ")")
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'persist verifier failed: %{public}s', (error as Error).message)
    }
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

  /**
   * 返回键。
   *
   * 三个层次：外部页面直接回应用（账号登录的授权页跳出去以后必须能回来，否则人就
   * 困在浏览器里了）；应用内先退 web 历史；都退不动才交给系统。
   *
   * 光看 accessBackward 不够：初始导航时它也可能是 true，一退就退成空白页（实测整屏黑）。
   */
  onBackPress(): boolean {
    if (!this.assetsReady) {
      return false
    }
    try {
      const url = this.controller.getUrl()
      if (!url.startsWith(APP_ORIGIN)) {
        // 放弃这次登录，回到首页
        this.pendingVerifier = ''
        this.pendingAuthorizeId = ''
        this.controller.loadUrl(HOME_URL)
        return true
      }
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
    // 根节点给深色底：状态栏那段是窗口背景，不铺色就会露出白色，看起来像屏幕上方有一条白条。
    Column() {
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
            methodList: ['notify', 'onHash', 'login', 'log', 'locate', 'pickFolder', 'fetchUrl', 'browse', 'openBrowser'],
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
            this.controller
              .runJavaScript(AUTH_TOKEN_PATCH)
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'auth patch failed: %{public}s', error.message)
              })
            if (this.pendingToken.length > 0 && event.url.startsWith(APP_ORIGIN)) {
              const value = JSON.stringify(this.pendingToken)
              const script = "localStorage.setItem('" + API_KEY_STORAGE + "', " + value + ")" +
                "; localStorage.removeItem('" + OAUTH_VERIFIER_KEY + "')"
              this.controller
                .runJavaScript(script)
                .then(() => {
                  hilog.info(DOMAIN, TAG, 'account token stored to app.local')
                  this.pendingToken = ''
                  this.controller.loadUrl(HOME_URL)
                })
                .catch((error: Error) => {
                  hilog.error(DOMAIN, TAG, 'store token failed: %{public}s', error.message)
                })
            }
            this.controller
              .runJavaScript("(function(){try{" +
                "var s = window.__DS_SHELL__;" +
                "if(!s) return 'NO_SHELL';" +
                "return 'locate=' + typeof s.locate + ' pickFolder=' + typeof s.pickFolder;" +
                "}catch(e){return 'ERR ' + e.message}})()")
              .then((value) => {
                hilog.info(DOMAIN, TAG, 'bridge probe: %{public}s', String(value))
              })
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'bridge probe failed: %{public}s', error.message)
              })
this.controller
              .runJavaScript("(function(){try{" +
                "var q = document.querySelectorAll('[class*=quick]');" +
                "var out = 'count=' + q.length;" +
                "for (var i = 0; i < q.length && i < 3; i++) {" +
                " var s = getComputedStyle(q[i]);" +
                " out += ' | ' + q[i].className.slice(0,40) + ' display=' + s.display + ' h=' + Math.round(q[i].getBoundingClientRect().height);" +
                "}" +
                "return out}catch(e){return 'ERR ' + e.message}})()")
              .then((value) => {
                hilog.info(DOMAIN, TAG, 'quick probe: %{public}s', String(value))
              })
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'quick probe failed: %{public}s', error.message)
              })
            this.injectSafeArea()
            this.controller
              .runJavaScript("(function(){try{" +
                "var k = localStorage.getItem('" + API_KEY_STORAGE + "');" +
                "return k === null ? 'NO_KEY' : ('HAS_KEY len=' + k.length + ' head=' + k.slice(0,6));" +
                "}catch(e){return 'ERR ' + e.message}})()")
              .then((value) => {
                hilog.info(DOMAIN, TAG, 'api key state: %{public}s', String(value))
              })
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'api key probe failed: %{public}s', error.message)
              })
            this.controller
              .runJavaScript(ERROR_WATCH)
              .catch((error: Error) => {
                hilog.warn(DOMAIN, TAG, 'error watch failed: %{public}s', error.message)
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
      // Agent 的浏览器：默认收起，用它抓页面时弹出小窗，用户能看着也能接手
      // 注意：这里不能用 if 包住 Web 组件。
      // 条件渲染会销毁组件，WebviewController 失去绑定的 Web 后，
      // 下次调用就报 "must be associated with a Web component"。
      // 所以让它常驻，只切 visibility。
      Column() {
          Row() {
            Text(this.browserUrl)
              .fontSize(11)
              .fontColor('#888888')
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(
              this.browserWaiting
                ? '等你交还…'
                : this.userTakeover
                  ? '你正在操作'
                  : 'Agent 操作中'
            )
              .fontSize(11)
              .fontColor(
                this.browserWaiting
                  ? '#fbbf24'
                  : this.userTakeover
                    ? '#4ade80'
                    : '#888888'
              )
              .margin({ left: 8 })
            // 显式按钮接管：页面上的触摸不算，避免滚动查看时误判
            Button(this.userTakeover ? '交还给 Agent' : '我来操作')
              .fontSize(12)
              .height(28)
              .backgroundColor(this.userTakeover ? '#2f5d3f' : '#2a2a2a')
              .fontColor('#cccccc')
              .margin({ left: 8 })
              .onClick(() => {
                this.userTakeover = !this.userTakeover
              })
            Button('收起')
              .fontSize(12)
              .height(28)
              .backgroundColor('#2a2a2a')
              .fontColor('#cccccc')
              .margin({ left: 6 })
              .onClick(() => {
                this.showBrowser = false
                this.notifyBrowserStateToPage(false, this.browserUrl)
              })
          }
          .width('100%')
          .padding({ left: 14, right: 10, top: 8, bottom: 8 })

          Web({ src: this.browserUrl, controller: this.browseController })
            .width('100%')
            .layoutWeight(1)
            .javaScriptAccess(true)
            .domStorageAccess(true)
            .mixedMode(MixedMode.All)
            // 页面始终可交互：用户随时能滚、能点。接管只由上面那个按钮显式切换，
            // 之前用 onTouch 判定，滚动看一眼就被当成接管，太容易误触。
        }
        .width('92%')
        .height('62%')
        .margin({ top: 80 })
        .backgroundColor('#1c1c1e')
        .borderRadius(14)
        .border({ width: 1, color: '#333333' })
        .shadow({ radius: 24, color: '#00000088', offsetY: 8 })
        .visibility(this.showBrowser ? Visibility.Visible : Visibility.None)

      // 收起之后留一个悬浮胶囊，不然窗口一关就再也找不回来了。
      // 不能用 if 包着——被 if 包住的子组件吃不到 Stack 的对齐，会掉回中间。
      Row() {
          Text('🌐')
            .fontSize(13)
          Text(this.browserUrl)
            .fontSize(11)
            .fontColor('#cccccc')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
            .margin({ left: 6 })
          Text('展开')
            .fontSize(11)
            .fontColor('#6ea8fe')
            .margin({ left: 8 })
        }
        .width('88%')
        .padding({ left: 14, right: 14, top: 10, bottom: 10 })
        // 绝对定位钉在输入框上方。用 align+margin 试过两轮都不动，
        // Stack 的 alignContent 是 Top，子组件跟着走，只能写死位置。
        .position({ x: '6%', y: 2130 })
        .backgroundColor('#2a2a2c')
        .borderRadius(999)
        .border({ width: 1, color: '#3a3a3c' })
        .shadow({ radius: 12, color: '#00000066', offsetY: 4 })
        .onClick(() => {
          this.showBrowser = true
        })
        .visibility(
          !this.showBrowser && this.browserOpened ? Visibility.Visible : Visibility.None
        )
    }
    .width('100%')
    .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#11161d')
  }
}