import { getTool } from '../registry.js'
import { createArtifact, formatBytes } from '../artifacts.js'
import * as db from '../../chat/db.js'
import { workspaceSnapshot } from '../../workspace/store.js'
import { isPublicWebUrl } from '../../../utils/url.js'
import {
  downscaleImage,
  readBase64Payload,
  splitDataUrl,
  type ImagePayload,
} from '../../../utils/imageData.js'
import type { RegisteredTool } from '../types.js'
import {
  bool,
  clip,
  defineTool,
  fail,
  num,
  objectSchema,
  ok,
  str,
} from '../toolKit.js'

/** 天气码（WMO）到中文描述 */
const WEATHER_CODES: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴小冰雹',
  99: '雷阵雨伴大冰雹',
}

const describeWeather = (code: number) => WEATHER_CODES[code] ?? `天气码 ${code}`

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const timeTool = defineTool(
  {
    name: 'get_datetime',
    label: '时间日期',
    description:
      '获取当前日期与时间。可指定 IANA 时区（如 Asia/Shanghai），缺省使用浏览器本地时区。返回本地化日期、ISO 时间、星期与时区偏移。',
    inputSchema: objectSchema({
      timezone: {
        type: 'string',
        description: 'IANA 时区名，例如 Asia/Shanghai、America/New_York；省略则用本地时区',
      },
      locale: { type: 'string', description: 'BCP 47 语言标签，默认 zh-CN' },
    }),
  },
  async (input) => {
    const timezone = str(input, 'timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone
    const locale = str(input, 'locale') || 'zh-CN'
    let now: Date
    try {
      now = new Date()
      // 提前校验时区，非法值会抛 RangeError
      new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(now)
    } catch {
      return fail(`无效的时区或语言：${timezone} / ${locale}`)
    }
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour12: false,
    }).formatToParts(now)
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? ''
    const offsetMinutes = -now.getTimezoneOffset()
    const offset =
      timezone === Intl.DateTimeFormat().resolvedOptions().timeZone
        ? `${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`
        : '见时区'
    return ok(
      [
        `当前时间：${formatted}`,
        `时区：${timezone}（UTC${offset}）`,
        `ISO：${now.toISOString()}`,
        `本地时间戳：${now.getTime()}`,
        `周几：${weekday} / ${WEEKDAYS[now.getDay()]}`,
      ].join('\n'),
      { meta: { iso: now.toISOString(), timezone, weekday } }
    )
  },
  'browser'
)

type Coords = { latitude: number; longitude: number; accuracy: number }

const getCoordinates = (highAccuracy: boolean) =>
  new Promise<Coords>((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('当前浏览器不支持定位'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        const reasons: Record<number, string> = {
          1: '定位权限被拒绝，请在浏览器地址栏的权限设置中允许',
          2: '暂时无法获取位置，请检查系统定位服务',
          3: '定位超时，请重试',
        }
        reject(new Error(reasons[error.code] ?? error.message))
      },
      { enableHighAccuracy: highAccuracy, timeout: 12000, maximumAge: 60_000 }
    )
  })

/** 逆地理编码：免费接口，失败时只返回坐标 */
const reverseGeocode = async (coords: Coords) => {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.latitude}&longitude=${coords.longitude}&localityLanguage=zh`
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as {
      city?: string
      locality?: string
      principalSubdivision?: string
      countryName?: string
    }
    const name = [data.countryName, data.principalSubdivision, data.city || data.locality]
      .filter(Boolean)
      .join(' · ')
    return name || null
  } catch {
    return null
  }
}

const locationTool = defineTool(
  {
    name: 'get_location',
    label: '网络定位',
    description:
      '获取用户当前地理位置。浏览器会弹出定位授权，返回经纬度、精度与逆地理得到的城市名。仅在用户明确需要位置时调用。',
    inputSchema: objectSchema({
      high_accuracy: { type: 'boolean', description: '是否要求高精度定位，默认 false' },
    }),
  },
  async (input) => {
    try {
      const coords = await getCoordinates(bool(input, 'high_accuracy'))
      const place = await reverseGeocode(coords)
      return ok(
        [
          `纬度：${coords.latitude.toFixed(5)}`,
          `经度：${coords.longitude.toFixed(5)}`,
          `精度：约 ${Math.round(coords.accuracy)} 米`,
          place ? `位置：${place}` : '位置：未能解析城市名',
        ].join('\n'),
        { meta: { ...coords, place } }
      )
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
  'browser'
)

type GeocodeResult = {
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

const geocode = async (name: string): Promise<GeocodeResult | null> => {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { results?: GeocodeResult[] }
  return data.results?.[0] ?? null
}

type ForecastResponse = {
  timezone?: string
  current?: {
    time?: string
    temperature_2m?: number
    relative_humidity_2m?: number
    apparent_temperature?: number
    weather_code?: number
    wind_speed_10m?: number
    precipitation?: number
  }
  daily?: {
    time?: string[]
    weather_code?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
    sunrise?: string[]
    sunset?: string[]
  }
}

const weatherTool = defineTool(
  {
    name: 'get_weather',
    label: '天气',
    description:
      '查询城市天气（Open-Meteo，无需 API Key）。可传城市名，或直接传经纬度；都不传时尝试使用浏览器定位。返回当前天气与未来数日预报。',
    inputSchema: objectSchema({
      location: { type: 'string', description: '城市名，如「杭州」「Tokyo」' },
      latitude: { type: 'number', description: '纬度，与 longitude 同时提供时优先于城市名' },
      longitude: { type: 'number', description: '经度' },
      days: { type: 'number', description: '预报天数 1-7，默认 3' },
    }),
  },
  async (input, context) => {
    let latitude = num(input, 'latitude')
    let longitude = num(input, 'longitude')
    let place = str(input, 'location')
    const days = Math.min(7, Math.max(1, Math.round(num(input, 'days') ?? 3)))

    if (latitude === undefined || longitude === undefined) {
      if (!place) {
        context.progress('正在获取定位…')
        try {
          const coords = await getCoordinates(false)
          latitude = coords.latitude
          longitude = coords.longitude
          place = (await reverseGeocode(coords)) ?? '当前位置'
        } catch (error) {
          return fail(
            `未提供城市，且定位失败：${error instanceof Error ? error.message : String(error)}。请传入 location 或经纬度。`
          )
        }
      } else {
        context.progress(`正在解析 ${place}…`)
        const found = await geocode(place)
        if (!found) {
          return fail(`找不到城市「${place}」，请换一个更常见的名称，或直接提供经纬度。`)
        }
        latitude = found.latitude
        longitude = found.longitude
        place = [found.name, found.admin1, found.country].filter(Boolean).join(' · ')
      }
    }

    context.progress('正在获取天气…')
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
      `&timezone=auto&forecast_days=${days}`
    const response = await fetch(url, { signal: context.signal })
    if (!response.ok) {
      return fail(`天气服务返回 ${response.status}`)
    }
    const data = (await response.json()) as ForecastResponse
    const current = data.current
    const lines: string[] = [`地点：${place ?? `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`}`, `时区：${data.timezone ?? '未知'}`]
    if (current) {
      lines.push(
        '',
        `当前：${describeWeather(current.weather_code ?? -1)}，${current.temperature_2m ?? '?'}°C`,
        `体感 ${current.apparent_temperature ?? '?'}°C，湿度 ${current.relative_humidity_2m ?? '?'}%，风速 ${current.wind_speed_10m ?? '?'} km/h`,
        `降水 ${current.precipitation ?? 0} mm，更新于 ${current.time ?? ''}`
      )
    }
    const daily = data.daily
    if (daily?.time?.length) {
      lines.push('', '预报：')
      daily.time.forEach((date, index) => {
        lines.push(
          `- ${date}：${describeWeather(daily.weather_code?.[index] ?? -1)}，${daily.temperature_2m_min?.[index] ?? '?'}~${daily.temperature_2m_max?.[index] ?? '?'}°C，降水概率 ${daily.precipitation_probability_max?.[index] ?? 0}%`
        )
      })
    }
    return ok(lines.join('\n'), {
      meta: { place, latitude, longitude, current, daily, timezone: data.timezone },
    })
  },
  'browser'
)

const notificationTool = defineTool(
  {
    name: 'send_notification',
    label: '发送通知',
    description:
      '发送系统桌面通知。首次使用需要用户授予通知权限；页面处于后台时最有用。返回是否成功送达。',
    inputSchema: objectSchema(
      {
        title: { type: 'string', description: '通知标题' },
        body: { type: 'string', description: '通知正文' },
        tag: { type: 'string', description: '可选去重标签，同 tag 的通知会替换' },
      },
      ['title']
    ),
  },
  async (input) => {
    const title = str(input, 'title') || 'Agent 通知'
    const body = str(input, 'body')
    // 鸿蒙原生壳：ArkWeb 没实现 Web Notification（实测 'Notification' in window 为 false），
    // 壳会注入 __DS_SHELL__.notify 走系统通知。浏览器里没有这个桥，照旧走 Web API。
    const shell = (
      window as unknown as {
        __DS_SHELL__?: { notify?: (title: string, body: string) => Promise<boolean> }
      }
    ).__DS_SHELL__
    if (shell !== undefined && typeof shell.notify === 'function') {
      const delivered = await shell.notify(title, body)
      return delivered
        ? ok(`已发送通知「${title}」`)
        : fail('系统通知未送达，可能未授予通知权限')
    }
    if (!('Notification' in window)) {
      return fail('当前浏览器不支持通知')
    }
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return fail('通知权限未授予，请在浏览器站点设置中允许通知')
    }
    new Notification(title, { body, tag: str(input, 'tag') || undefined })
    return ok(`已发送通知「${title}」`)
  },
  'browser'
)

const clipboardReadTool = defineTool(
  {
    name: 'read_clipboard',
    label: '读取剪贴板',
    description: '读取剪贴板中的纯文本。浏览器可能要求页面处于焦点状态并授予剪贴板权限。',
    inputSchema: objectSchema({}),
    requiresApproval: true,
  },
  async () => {
    try {
      const text = await navigator.clipboard.readText()
      return ok(text ? clip(text, 8000) : '（剪贴板为空）')
    } catch (error) {
      return fail(
        `读取剪贴板失败：${error instanceof Error ? error.message : String(error)}。请确认页面在前台并已授予剪贴板权限。`
      )
    }
  },
  'browser'
)

const clipboardWriteTool = defineTool(
  {
    name: 'write_clipboard',
    label: '写入剪贴板',
    description: '把文本写入系统剪贴板。',
    inputSchema: objectSchema({ text: { type: 'string', description: '要复制的文本' } }, ['text']),
  },
  async (input) => {
    const text = str(input, 'text')
    try {
      await navigator.clipboard.writeText(text)
      return ok(`已复制 ${text.length} 个字符到剪贴板`)
    } catch (error) {
      return fail(`写入剪贴板失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

/** 从 HTML 中抽取标题与正文，优先 article/main，去掉脚本与样式 */
const extractReadable = (html: string, url: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const node of doc.querySelectorAll('script, style, noscript, svg, iframe, form, nav, footer, aside')) {
    node.remove()
  }
  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title
  const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body
  const text = (root?.textContent ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: title?.trim() || url, text }
}

const fetchPageTool = defineTool(
  {
    name: 'fetch_webpage',
    label: '抓取网页',
    description:
      '抓取指定 URL 的网页正文并转为纯文本。优先通过浏览器扩展抓取（不受跨域限制）；未安装扩展时用页面 fetch，可能因目标站点 CORS 失败。',
    inputSchema: objectSchema(
      {
        url: { type: 'string', description: '完整 URL，需包含 http(s) 协议' },
        max_chars: { type: 'number', description: '正文最大字符数，默认 12000' },
      },
      ['url']
    ),
    risk: 'network',
  },
  async (input, context) => {
    const url = str(input, 'url')
    const max = Math.min(60000, Math.max(1000, Math.round(num(input, 'max_chars') ?? 12000)))
    let parsed: URL
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return fail('只支持 http/https 链接')
      }
    } catch {
      return fail(`无效的 URL：${url}`)
    }
    // 防止被网页内容诱导去访问本机管理接口或云元数据服务
    if (!isPublicWebUrl(parsed.href)) {
      return fail('出于安全考虑，不抓取本机、内网或带账号密码的地址')
    }

    // 扩展具备 host_permissions，可绕过 CORS
    const viaExtension = getTool('browser_fetch_page')
    if (viaExtension) {
      context.progress('通过扩展抓取…')
      const result = await viaExtension.execute({ url, max_chars: max }, context)
      if (!result.isError) {
        return result
      }
    }

    // 鸿蒙壳：原生 http 请求不受 CORS 约束，优先走它
    const shell = (window as unknown as {
      __DS_SHELL__?: { fetchUrl?: (url: string) => Promise<string> }
    }).__DS_SHELL__
    if (shell?.fetchUrl) {
      context.progress('通过系统网络抓取…')
      try {
        const raw = await shell.fetchUrl(parsed.href)
        const payload = JSON.parse(raw) as { ok?: boolean; status?: number; html?: string; error?: string }
        if (payload.ok && typeof payload.html === 'string') {
          const html = payload.html
          const { title, text } = html.trimStart().startsWith('<')
            ? extractReadable(html, parsed.href)
            : { title: parsed.href, text: html }
          return ok(
            [`标题：${title}`, `链接：${parsed.href}`, '', clip(text, max)].join('\n'),
            { meta: { title, url: parsed.href, length: text.length } }
          )
        }
        if (payload.error) {
          return fail(`请求失败：${payload.error}`)
        }
        return fail(`请求失败：HTTP ${payload.status ?? 0}`)
      } catch (error) {
        // 壳这边出问题就继续走页面 fetch，别把整条路堵死
        context.progress('系统请求失败，改用页面请求…')
      }
    }

    context.progress('正在请求…')
    try {
      const response = await fetch(parsed.href, {
        signal: context.signal,
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' },
      })
      if (!response.ok) {
        return fail(`请求失败：HTTP ${response.status}`)
      }
      const type = response.headers.get('content-type') ?? ''
      const raw = await response.text()
      const { title, text } =
        type.includes('html') || raw.trimStart().startsWith('<')
          ? extractReadable(raw, parsed.href)
          : { title: parsed.href, text: raw }
      return ok(
        [`标题：${title}`, `链接：${parsed.href}`, '', clip(text, max)].join('\n'),
        { meta: { title, url: parsed.href, length: text.length } }
      )
    } catch (error) {
      return fail(
        `抓取失败：${error instanceof Error ? error.message : String(error)}。可能是目标站点未开放跨域（CORS），安装浏览器扩展后可由扩展代抓。`
      )
    }
  },
  'browser'
)

const createFileTool = defineTool(
  {
    name: 'create_file',
    label: '生成文件',
    description:
      '在对话中生成一个可预览、可下载的文件（Markdown、HTML、CSV、JSON、SVG、代码等）。适合把结果整理成报告、表格或网页。文件只保存在浏览器本地。',
    inputSchema: objectSchema(
      {
        name: { type: 'string', description: '文件名，需带扩展名，例如 report.md' },
        content: { type: 'string', description: '完整的文件文本内容' },
        mime: { type: 'string', description: '可选 MIME，缺省按扩展名推断' },
        description: { type: 'string', description: '一句话说明这个文件是什么' },
      },
      ['name', 'content']
    ),
    risk: 'write',
  },
  async (input, context) => {
    const name = str(input, 'name').trim() || 'output.txt'
    const content = str(input, 'content')
    if (!content) {
      return fail('content 不能为空')
    }
    if (content.length > 2_000_000) {
      return fail('文件过大（超过 2MB），请拆分或缩小内容')
    }
    const meta = await createArtifact({
      name,
      text: content,
      mime: str(input, 'mime') || undefined,
      source: 'browser',
      tool: 'create_file',
      sessionId: context.sessionId,
    })
    const note = str(input, 'description')
    return ok(
      `已生成文件「${meta.name}」（${formatBytes(meta.size)}，${meta.kind}）${note ? `：${note}` : ''}。文件已展示在对话中，用户可预览或下载。`,
      { artifacts: [meta], meta: { name: meta.name, size: meta.size } }
    )
  },
  'browser'
)

const openUrlTool = defineTool(
  {
    name: 'open_url',
    label: '打开链接',
    description: '在新标签页打开链接，供用户查看。可能被浏览器的弹窗拦截策略阻止。',
    inputSchema: objectSchema(
      {
        url: { type: 'string', description: '要打开的完整 URL' },
      },
      ['url']
    ),
    risk: 'network',
  },
  async (input) => {
    const url = str(input, 'url')
    try {
      const parsed = new URL(url)
      if (!isPublicWebUrl(parsed.href)) {
        return fail('只允许打开公网的 http/https 链接，本机与内网地址已拦截')
      }
      const opened = window.open(parsed.href, '_blank', 'noopener,noreferrer')
      return opened
        ? ok(`已在新标签页打开 ${parsed.href}`)
        : fail('浏览器拦截了新标签页，请允许本站弹窗')
    } catch {
      return fail(`无效的 URL：${url}`)
    }
  },
  'browser'
)

/**
 * view_image：把图片以 base64 交给模型。
 * 浏览器扩展截图、产物图片、远程图片都可以走这里，避免「模型只看到一句描述」。
 */
const viewImageTool = defineTool(
  {
    name: 'view_image',
    label: '查看图片',
    description:
      '把一张图片交给模型查看。支持三种来源：data_url（base64 或 data URL）、artifact_id（此前生成的图片产物）、image_url（远程图片地址）。' +
      '浏览器扩展截图如果只返回了文字，可以把截图产物的 artifact_id 传进来重新读取。',
    inputSchema: objectSchema({
      data_url: { type: 'string', description: 'base64 字符串或 data:image/...;base64,... 形式的地址' },
      artifact_id: { type: 'string', description: '图片产物的 id' },
      image_url: { type: 'string', description: '远程图片的 http(s) 地址' },
      max_edge: { type: 'number', description: '长边上限，默认 1568，超过会等比缩小' },
    }),
    risk: 'safe',
    icon: 'eye',
  },
  async (input, context) => {
    const maxEdge = Math.min(2048, Math.max(256, Math.round(num(input, 'max_edge') ?? 1568)))
    let payload: ImagePayload | null = null
    const artifactId = str(input, 'artifact_id').trim()
    const imageUrl = str(input, 'image_url').trim()
    const dataUrl = str(input, 'data_url').trim()

    if (artifactId) {
      context.progress('读取产物…')
      const stored = await db.loadArtifact(artifactId)
      if (!stored?.dataUrl) {
        return fail(`产物 ${artifactId} 不是图片或已丢失`)
      }
      payload = splitDataUrl(stored.dataUrl) ?? readBase64Payload(stored.dataUrl)
    } else if (dataUrl) {
      payload = readBase64Payload(dataUrl)
    } else if (imageUrl) {
      if (!isPublicWebUrl(imageUrl)) {
        return fail('image_url 只支持公网 http/https 地址，本机与内网地址已拦截')
      }
      context.progress('下载图片…')
      try {
        const response = await fetch(imageUrl, { signal: context.signal })
        if (!response.ok) {
          return fail(`下载失败：HTTP ${response.status}`)
        }
        const blob = await response.blob()
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        payload = splitDataUrl(encoded)
      } catch (error) {
        return fail(`下载图片失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (!payload) {
      return fail('没有可用的图片：请传 data_url、artifact_id 或 image_url 之一')
    }
    const scaled = await downscaleImage(payload, maxEdge)
    const size = Math.round((scaled.data.length * 3) / 4 / 1024)
    return ok(
      `已读取图片（${scaled.mediaType}，约 ${size} KB，长边 ≤ ${maxEdge}px）`,
      { images: [{ mediaType: scaled.mediaType, data: scaled.data }], meta: { mediaType: scaled.mediaType, size } }
    )
  },
  'browser'
)

/**
 * preview_file：把文件以内联 widget 放在回答底部，代码、图片、网页都能直接看。
 * 内容可以是模型生成的，也可以是工作区里的文件或一个远程地址。
 */
const previewFileTool = defineTool(
  {
    name: 'preview_file',
    label: '预览文件',
    description:
      '在回答底部生成一个内联预览卡片，支持代码、Markdown、HTML 网页、图片、CSV/JSON。' +
      '可以传 content 生成新文件，传 path 预览工作区里的文件，或传 url 预览一个网页。适合把结果直接摆在用户面前。',
    inputSchema: objectSchema({
      name: { type: 'string', description: '文件名，需带扩展名，例如 report.md；传 url 时可省略' },
      content: { type: 'string', description: '文件文本内容；传 path 或 url 时省略' },
      path: { type: 'string', description: '工作区里的相对路径' },
      url: { type: 'string', description: '要预览的网页地址（http/https）' },
      caption: { type: 'string', description: '一句话说明' },
    }),
    risk: 'safe',
    icon: 'layers',
  },
  async (input, context) => {
    const caption = str(input, 'caption').trim()
    const remote = str(input, 'url').trim()
    if (remote) {
      if (!isPublicWebUrl(remote)) {
        return fail('url 只支持公网 http/https 地址，本机与内网地址已拦截')
      }
      return ok(`已在回答底部预览 ${remote}`, {
        meta: {
          preview: { url: remote, name: remote, kind: 'html', caption },
        },
      })
    }

    let name = str(input, 'name').trim()
    let content = str(input, 'content')
    const path = str(input, 'path').trim()
    if (path) {
      const snapshot = workspaceSnapshot()
      if (!snapshot) {
        return fail('工作区还没有打开，无法按路径预览。请改用 content 直接传内容。')
      }
      const file = snapshot.files[path]
      if (file === undefined) {
        return fail(`文件不存在：${path}`)
      }
      name = name || path
      content = file
    }
    if (!content) {
      return fail('content、path、url 至少提供一个')
    }
    if (content.length > 2_000_000) {
      return fail('文件过大（超过 2MB），请拆分后再预览')
    }
    if (!name) {
      name = 'preview.txt'
    }
    context.progress('准备预览…')
    const meta = await createArtifact({
      name,
      text: content,
      source: 'browser',
      tool: 'preview_file',
      sessionId: context.sessionId,
    })
    return ok(`已在回答底部预览「${meta.name}」${caption ? `：${caption}` : ''}`, {
      artifacts: [meta],
      meta: {
        preview: {
          id: meta.id,
          name: meta.name,
          kind: meta.kind,
          mime: meta.mime,
          size: meta.size,
          caption,
        },
      },
    })
  },
  'browser'
)

/**
 * 操控内嵌浏览器。
 *
 * fetch_webpage 拿的是服务端原始 HTML，读不到 JS 渲染出来的内容，也不能点击。
 * 这个工具用壳里那个隐藏的 WebView：真正加载页面、跑脚本、读 DOM，
 * 所以能点按钮、填表单、等异步加载完再取文本。
 */
const browseTool = defineTool(
  {
    name: 'browse_web',
    label: '操控浏览器',
    description:
      '在设备内置浏览器里打开网页并执行 JavaScript，返回脚本结果。适合需要 JS 渲染、点击、填表单或读取动态内容的页面。script 缺省时返回页面标题和正文文本。',
    inputSchema: objectSchema(
      {
        url: { type: 'string', description: '完整 URL，需包含 http(s) 协议' },
        script: {
          type: 'string',
          description:
            "要执行的 JS 表达式字符串。可用 document/querySelector/click 等。示例：'document.title' 或 \"document.querySelector('h1').innerText\"",
        },
        wait_ms: {
          type: 'number',
          description: '页面加载完后再等多少毫秒（默认 1200），给异步渲染留时间',
        },
      },
      ['url']
    ),
    risk: 'network',
  },
  async (input, context) => {
    const url = str(input, 'url')
    let parsed: URL
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return fail('只支持 http/https 链接')
      }
    } catch {
      return fail(`无效的 URL：${url}`)
    }
    if (!isPublicWebUrl(parsed.href)) {
      return fail('出于安全考虑，不打开本机、内网或带账号密码的地址')
    }
    const shell = (window as unknown as {
      __DS_SHELL__?: { browse?: (url: string, script: string) => Promise<string> }
    }).__DS_SHELL__
    if (!shell?.browse) {
      return fail('这台设备没有内置浏览器，请改用 fetch_webpage')
    }
    const script =
      str(input, 'script').trim() ||
      "JSON.stringify({ title: document.title, text: (document.body?.innerText || '').slice(0, 12000) })"
    context.progress('正在打开页面…')
    try {
      const raw = await shell.browse(parsed.href, script)
      if (!raw) {
        return fail('浏览器没有返回结果')
      }
      return ok(raw.slice(0, 20000), { meta: { url: parsed.href } })
    } catch (error) {
      return fail(`浏览器执行失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
)

export const browserTools: RegisteredTool[] = [
  browseTool,
  timeTool,
  locationTool,
  weatherTool,
  notificationTool,
  clipboardReadTool,
  clipboardWriteTool,
  fetchPageTool,
  createFileTool,
  openUrlTool,
  viewImageTool,
  previewFileTool,
]
