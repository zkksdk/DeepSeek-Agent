const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const toDate = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (
  value: string | number | Date,
  separator: '/' | '-' = '-'
): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join(separator)
}

export const monthKey = (value: string | number | Date): string | null => {
  const date = toDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : null
}

/**
 * 按字符长度截断，但不把代理对切成两半。
 * 直接在 emoji 中间切片会产生孤立代理项，JSON 里能编码、对端却解析不出合法文本。
 */
export const clipText = (text: string, max: number): string => {
  if (text.length <= max) {
    return text
  }
  let cut = Math.max(0, max)
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) {
    cut -= 1
  }
  return text.slice(0, cut)
}
