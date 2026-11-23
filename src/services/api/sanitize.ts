/**
 * 请求体净化。
 *
 * 工具结果来自网页、文件与截图，可能含有孤立代理项（截断字符串时被切断的 emoji）
 * 或裸控制字符。这些字符在 JSON 里能编码，但对端解析后无法还原成合法文本，
 * 服务端会直接报 “unexpected end of hex escape” 之类的解析错误。
 * 发送前统一替换成 U+FFFD、去掉控制字符，避免整轮请求失败。
 */

/** 按码点遍历，孤立代理项会被单独取出，成对的代理项则整体保留 */
const cleanString = (value: string, onFix: () => void): string => {
  let out = ''
  let changed = false
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    // 落在代理区且没有配对 → 孤立代理项
    if (code >= 0xd800 && code <= 0xdfff) {
      out += '\uFFFD'
      changed = true
      continue
    }
    // C0 控制字符（保留 \t \n \r）与 DEL
    if ((code < 0x20 && code !== 9 && code !== 10 && code !== 13) || code === 0x7f) {
      changed = true
      continue
    }
    // C1 控制字符与非字符
    if ((code >= 0x80 && code <= 0x9f) || code === 0xfffe || code === 0xffff) {
      changed = true
      continue
    }
    out += char
  }
  if (changed) {
    onFix()
  }
  return out
}

let fixed = 0

/** 最近一次净化改动了多少个字符串，便于排查问题来源 */
export const sanitizeReport = () => fixed

/** 深度净化任意可 JSON 序列化的值；非字符串原样返回 */
export const sanitizeForTransport = <T>(value: T): T => {
  fixed = 0
  const bump = () => {
    fixed += 1
  }
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') {
      return cleanString(input, bump)
    }
    if (Array.isArray(input)) {
      return input.map(walk)
    }
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, walk(item)])
      )
    }
    return input
  }
  return walk(value) as T
}

/**
 * 发请求前的统一出口：净化后序列化。
 * 放在这里而不是分散到各调用方，避免新增字段时漏掉。
 */
export const stringifyBody = (body: unknown): string => JSON.stringify(sanitizeForTransport(body))
