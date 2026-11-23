/**
 * DeepSeek 官方价格（人民币 / 百万 tokens）与高峰时段判断。
 *
 * 价格来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * - deepseek-flash：缓存命中 0.02 / 0.04，未命中 1 / 2，输出 4 / 8（空闲 / 高峰）
 * - deepseek-v4-pro：缓存命中 0.15 / 0.30，未命中 4.5 / 9，输出 13.5 / 27（空闲 / 高峰）
 *
 * 高峰时段为北京时间周一至周五（不含法定节假日）9:00-12:00、14:00-18:00，
 * 其余时间（含周末与节假日全天）为空闲时段，空闲价是高峰价的一半。
 * 价格可能调整，这里只用于本地估算，实际扣费以官方账单为准。
 */

export type PricingModel = 'deepseek-flash' | 'deepseek-v4-pro'

/** [空闲价, 高峰价] */
const RATES: Record<PricingModel, { hit: [number, number]; miss: [number, number]; output: [number, number] }> = {
  'deepseek-flash': {
    hit: [0.02, 0.04],
    miss: [1, 2],
    output: [4, 8],
  },
  'deepseek-v4-pro': {
    hit: [0.15, 0.3],
    miss: [4.5, 9],
    output: [13.5, 27],
  },
}

export const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

/** 2026 年法定节假日（含调休放假日）；如与官方安排不同，以官方公告为准 */
const HOLIDAYS = new Set([
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
])

const BEIJING = 'Asia/Shanghai'
const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
})

export type BeijingParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0=周日 … 6=周六 */
  weekday: number
  dateKey: string
}

/** 拆出北京时间；北京无夏令时，固定 UTC+8 */
export const beijingParts = (date: Date = new Date()): BeijingParts => {
  const parts = beijingFormatter.formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekdayText = get('weekday')
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const hour = Number(get('hour')) % 24
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  return {
    year,
    month,
    day,
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[weekdayText] ?? 0,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

export const isHoliday = (date: Date = new Date()) => HOLIDAYS.has(beijingParts(date).dateKey)

/** 是否处于高峰时段（北京时间工作日 9-12、14-18，排除节假日） */
export const isPeak = (date: Date = new Date()): boolean => {
  const parts = beijingParts(date)
  if (parts.weekday === 0 || parts.weekday === 6) {
    return false
  }
  if (HOLIDAYS.has(parts.dateKey)) {
    return false
  }
  const minutes = parts.hour * 60 + parts.minute
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/** 当前时段说明，用于侧栏底部一行字 */
export const rateLabel = (date: Date = new Date()): string => {
  const parts = beijingParts(date)
  if (parts.weekday === 0 || parts.weekday === 6) {
    return '周末时段'
  }
  if (HOLIDAYS.has(parts.dateKey)) {
    return '节假日'
  }
  return isPeak(date) ? '高峰时段' : '空闲时段'
}

export const normalizePricingModel = (model: string | undefined): PricingModel =>
  (model ?? '').toLowerCase().includes('pro') ? 'deepseek-v4-pro' : 'deepseek-flash'

export type TokenUsage = {
  /** 缓存命中的输入 tokens */
  cacheHit: number
  /** 缓存未命中的输入 tokens（含 cache_creation） */
  cacheMiss: number
  /** 输出 tokens */
  output: number
}

/** 按当前时段估算一次用量的费用（人民币元） */
export const estimateCost = (
  model: PricingModel,
  usage: TokenUsage,
  date: Date = new Date()
): number => {
  const rate = RATES[model]
  const index = isPeak(date) ? 1 : 0
  const perMillion =
    usage.cacheHit * rate.hit[index] +
    usage.cacheMiss * rate.miss[index] +
    usage.output * rate.output[index]
  return perMillion / 1_000_000
}

export const currentRates = (model: PricingModel, date: Date = new Date()) => {
  const rate = RATES[model]
  const index = isPeak(date) ? 1 : 0
  return {
    peak: index === 1,
    hit: rate.hit[index],
    miss: rate.miss[index],
    output: rate.output[index],
    /** 给 title / 说明用的一行文字 */
    text: `缓存命中 ¥${rate.hit[index]} · 未命中 ¥${rate.miss[index]} · 输出 ¥${rate.output[index]} / 百万 tokens`,
  }
}

/** 北京墙上时间 → UTC 时间戳（固定 +8） */
const beijingWallToUtc = (year: number, month: number, day: number, hour: number, minute: number) =>
  Date.UTC(year, month - 1, day, hour, minute) - 8 * 3_600_000

/**
 * 下一次「空闲 ↔ 高峰」切换的时间与目标状态。
 * 逐个候选日检查 9:00、12:00、14:00、18:00 四个边界，最多看 14 天。
 */
export const nextRateChange = (
  date: Date = new Date()
): { at: number; toPeak: boolean; label: string } => {
  const now = date.getTime()
  const current = isPeak(date)
  const base = beijingParts(date)
  for (let offset = 0; offset < 14; offset += 1) {
    const probe = new Date(beijingWallToUtc(base.year, base.month, base.day, 12, 0) + offset * 86_400_000)
    const parts = beijingParts(probe)
    for (const [hour, minute] of [
      [9, 0],
      [12, 0],
      [14, 0],
      [18, 0],
    ]) {
      const at = beijingWallToUtc(parts.year, parts.month, parts.day, hour, minute)
      if (at <= now) {
        continue
      }
      const after = isPeak(new Date(at + 60_000))
      if (after === current) {
        continue
      }
      return {
        at,
        toPeak: after,
        label: after ? '进入高峰' : '回到空闲',
      }
    }
  }
  return { at: now + 86_400_000, toPeak: !current, label: '时段切换' }
}

/** 22 小时 50 分 */
export const formatDuration = (milliseconds: number): string => {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours <= 0) {
    return `${rest} 分钟`
  }
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

export const formatMoney = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0.00'
  }
  if (value === 0) {
    return '0.00'
  }
  if (value < 0.01) {
    return value.toFixed(4)
  }
  return value.toFixed(2)
}

export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`
  }
  return String(Math.round(value))
}

/** 北京时间的 YYYY-MM 与 YYYY-MM-DD，用于账本分桶 */
export const monthKey = (date: Date = new Date()): string => {
  const parts = beijingParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

export const dayKey = (date: Date = new Date()): string => beijingParts(date).dateKey

export const PRICING_TABLE = RATES
