/**
 * Web 产物访问。
 *
 * 为什么不落沙箱：第一版是把 rawfile 里的 www 整份拷到 filesDir 再读，
 * 代价是首启多花约 2 秒（297 个文件 / 11.3 MB），而且磁盘上平白多一份。
 * 实测 `getRawFileContentSync` 直接读 rawfile 完全够快——拦截回调本来就是
 * 同步的，读完进内存缓存，同一个文件只读一次。
 *
 * 清单（_assets.json）仍然要在构建期生成：rawfile 不能列目录，没有清单就
 * 分不清"文件不存在"和"读失败"，而前者要用 index.html 兜底、后者不该兜底。
 */
import { common } from '@kit.AbilityKit'
import { resourceManager } from '@kit.LocalizationKit'
import { util } from '@kit.ArkTS'

const MANIFEST = 'www/_assets.json'

export class WebAssets {
  private static manager: resourceManager.ResourceManager | null = null
  /** 清单里的相对路径集合，用来快速判断存在性 */
  private static known: Set<string> = new Set<string>()
  /** 读过一次就留在内存里，拦截回调不该反复走 IO */
  private static cache: Map<string, ArrayBuffer> = new Map<string, ArrayBuffer>()

  /** 装载清单，返回给调用方看的标识 */
  static install(context: common.UIAbilityContext): Promise<string> {
    if (WebAssets.manager !== null) {
      return Promise.resolve('rawfile:www')
    }
    const manager = context.resourceManager
    const raw = manager.getRawFileContentSync(MANIFEST)
    const list = JSON.parse(WebAssets.decode(raw)) as string[]
    const known = new Set<string>()
    for (const rel of list) {
      known.add(rel)
    }
    WebAssets.known = known
    WebAssets.manager = manager
    return Promise.resolve('rawfile:www')
  }

  /** 读一份产物；不存在返回 null */
  static read(rel: string): ArrayBuffer | null {
    const manager = WebAssets.manager
    if (manager === null) {
      return null
    }
    const safe = WebAssets.sanitize(rel)
    if (safe === null || !WebAssets.known.has(safe)) {
      return null
    }
    const cached = WebAssets.cache.get(safe)
    if (cached !== undefined) {
      return cached
    }
    try {
      const bytes = manager.getRawFileContentSync('www/' + safe)
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      WebAssets.cache.set(safe, buf)
      return buf
    } catch (error) {
      return null
    }
  }

  /** 按后缀猜 Content-Type；猜不出就走八位字节流 */
  static mime(rel: string): string {
    const lower = rel.toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      return 'text/html; charset=utf-8'
    }
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
      return 'text/javascript; charset=utf-8'
    }
    if (lower.endsWith('.css')) {
      return 'text/css; charset=utf-8'
    }
    if (lower.endsWith('.json') || lower.endsWith('.map')) {
      return 'application/json; charset=utf-8'
    }
    if (lower.endsWith('.webmanifest')) {
      return 'application/manifest+json; charset=utf-8'
    }
    if (lower.endsWith('.svg')) {
      return 'image/svg+xml'
    }
    if (lower.endsWith('.png')) {
      return 'image/png'
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg'
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp'
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif'
    }
    if (lower.endsWith('.ico')) {
      return 'image/x-icon'
    }
    if (lower.endsWith('.woff2')) {
      return 'font/woff2'
    }
    if (lower.endsWith('.woff')) {
      return 'font/woff'
    }
    if (lower.endsWith('.ttf')) {
      return 'font/ttf'
    }
    if (lower.endsWith('.txt')) {
      return 'text/plain; charset=utf-8'
    }
    return 'application/octet-stream'
  }

  /** 去掉查询串与开头的斜杠，拒绝穿越 */
  static sanitize(rel: string): string | null {
    let path = rel
    const cut = path.search(/[?#]/)
    if (cut >= 0) {
      path = path.slice(0, cut)
    }
    while (path.startsWith('/')) {
      path = path.slice(1)
    }
    if (path.length === 0) {
      return null
    }
    if (path.indexOf('..') >= 0) {
      return null
    }
    return decodeURIComponent(path)
  }

  private static decode(bytes: Uint8Array): string {
    const decoder = util.TextDecoder.create('utf-8')
    return decoder.decodeWithStream(bytes, { stream: false })
  }
}
