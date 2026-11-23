/**
 * Web 产物装载。
 *
 * 为什么要有这一层：ArkWeb 的 onInterceptRequest 必须**同步**返回响应，
 * 而 rawfile 只能按已知名字同步读、不能列目录。所以启动时把 rawfile 里的
 * www 整份落到应用沙箱，之后拦截回调直接读文件系统，还能自己挂一层内存缓存。
 *
 * 版本用资源清单的签名（条目数 + 内容哈希），清单不变就不重复拷贝。
 */
import { common } from '@kit.AbilityKit'
import { fileIo as fs } from '@kit.CoreFileKit'
import { util } from '@kit.ArkTS'

const MANIFEST = 'www/_assets.json'
const VERSION_FILE = 'www.version'

export class WebAssets {
  private static rootDir: string = ''
  private static cache: Map<string, ArrayBuffer> = new Map<string, ArrayBuffer>()

  /** 装载（或跳过）web 产物，返回沙箱内 www 目录的绝对路径 */
  static install(context: common.UIAbilityContext): string {
    if (WebAssets.rootDir.length > 0) {
      return WebAssets.rootDir
    }
    const base = context.filesDir
    const root = base + '/www'
    const raw = context.resourceManager.getRawFileContentSync(MANIFEST)
    const text = WebAssets.decode(raw)
    const list = JSON.parse(text) as string[]
    const version = WebAssets.signature(list)
    const versionPath = base + '/' + VERSION_FILE
    if (WebAssets.readText(versionPath) !== version) {
      WebAssets.materialize(context, root, list)
      WebAssets.writeText(versionPath, version)
      WebAssets.cache.clear()
    }
    WebAssets.rootDir = root
    return root
  }

  /** 读一份产物；不存在返回 null */
  static read(rel: string): ArrayBuffer | null {
    if (WebAssets.rootDir.length === 0) {
      return null
    }
    const safe = WebAssets.sanitize(rel)
    if (safe === null) {
      return null
    }
    const cached = WebAssets.cache.get(safe)
    if (cached !== undefined) {
      return cached
    }
    const full = WebAssets.rootDir + '/' + safe
    if (!fs.accessSync(full)) {
      return null
    }
    const stat = fs.statSync(full)
    const buf = new ArrayBuffer(stat.size)
    const file = fs.openSync(full, fs.OpenMode.READ_ONLY)
    try {
      fs.readSync(file.fd, buf)
    } finally {
      fs.closeSync(file)
    }
    WebAssets.cache.set(safe, buf)
    return buf
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

  // ---------- 内部 ----------

  private static materialize(
    context: common.UIAbilityContext,
    root: string,
    list: string[]
  ): void {
    if (!fs.accessSync(root)) {
      fs.mkdirSync(root, true)
    }
    for (const rel of list) {
      const bytes = context.resourceManager.getRawFileContentSync('www/' + rel)
      const target = root + '/' + rel
      WebAssets.ensureDir(target)
      WebAssets.writeBytes(target, bytes)
    }
  }

  private static ensureDir(filePath: string): void {
    const at = filePath.lastIndexOf('/')
    if (at <= 0) {
      return
    }
    const dir = filePath.slice(0, at)
    if (!fs.accessSync(dir)) {
      fs.mkdirSync(dir, true)
    }
  }

  private static writeBytes(target: string, bytes: Uint8Array): void {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const file = fs.openSync(target, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    try {
      fs.writeSync(file.fd, buf)
    } finally {
      fs.closeSync(file)
    }
  }

  private static writeText(target: string, text: string): void {
    const file = fs.openSync(target, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    try {
      fs.writeSync(file.fd, text)
    } finally {
      fs.closeSync(file)
    }
  }

  private static readText(target: string): string {
    if (!fs.accessSync(target)) {
      return ''
    }
    const stat = fs.statSync(target)
    const buf = new ArrayBuffer(stat.size)
    const file = fs.openSync(target, fs.OpenMode.READ_ONLY)
    try {
      fs.readSync(file.fd, buf)
    } finally {
      fs.closeSync(file)
    }
    return WebAssets.decode(new Uint8Array(buf))
  }

  private static decode(bytes: Uint8Array): string {
    const decoder = util.TextDecoder.create('utf-8')
    return decoder.decodeWithStream(bytes, { stream: false })
  }

  /** 清单签名：条目数 + 路径哈希。清单变了就重装。 */
  private static signature(list: string[]): string {
    let hash = 5381
    for (const item of list) {
      for (let i = 0; i < item.length; i += 1) {
        hash = ((hash * 33) ^ item.charCodeAt(i)) >>> 0
      }
    }
    return list.length.toString() + '-' + hash.toString(16)
  }
}
