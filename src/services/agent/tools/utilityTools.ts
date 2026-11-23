import { diffLines, diffWords } from 'diff'
import { createArtifact } from '../artifacts.js'
import { buildQr } from '../../../components/share/qrCode.js'
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

/**
 * 从 one_cedric 移植的纯浏览器工具。
 *
 * 只保留不依赖文件系统、Shell 或 Python 的部分：计算、编码、哈希、随机数、
 * 文本处理、结构化数据、时间与 diff。参数命名尽量与原来的工具保持一致，
 * 方便熟悉那套工具的模型直接迁移。
 */

const clampInt = (value: number | undefined, min: number, max: number, fallback: number) => {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

const randomUint32 = () => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]
}

/** 无偏随机整数 [0, maxExclusive) */
const randomBelow = (maxExclusive: number) => {
  if (maxExclusive <= 0) {
    return 0
  }
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  let value = randomUint32()
  while (value >= limit) {
    value = randomUint32()
  }
  return value % maxExclusive
}

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const base64ToBytes = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const utf8 = (text: string) => new TextEncoder().encode(text)
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// ---------------------------------------------------------------------------
// calculate
// ---------------------------------------------------------------------------

type Token = { type: 'number' | 'ident' | 'op' | '(' | ')' | ','; value: string }

const tokenizeExpression = (source: string): Token[] => {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      let value = ''
      while (index < source.length && /[0-9._]/.test(source[index])) {
        value += source[index]
        index += 1
      }
      if ((value.match(/\./g) ?? []).length > 1) {
        throw new Error(`数字格式错误：${value}`)
      }
      tokens.push({ type: 'number', value: value.replace(/_/g, '') })
      continue
    }
    if (/[a-zA-Z_]/.test(char)) {
      let value = ''
      while (index < source.length && /[a-zA-Z0-9_]/.test(source[index])) {
        value += source[index]
        index += 1
      }
      tokens.push({ type: 'ident', value: value.toLowerCase() })
      continue
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ type: char === '(' || char === ')' || char === ',' ? char : 'op', value: char })
      index += 1
      continue
    }
    throw new Error(`无法识别的字符：${char}`)
  }
  return tokens
}

const FUNCTIONS: Record<string, { arity: number | 'variadic'; fn: (...args: number[]) => number }> = {
  abs: { arity: 1, fn: Math.abs },
  sqrt: { arity: 1, fn: Math.sqrt },
  cbrt: { arity: 1, fn: Math.cbrt },
  round: { arity: 1, fn: Math.round },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  exp: { arity: 1, fn: Math.exp },
  ln: { arity: 1, fn: Math.log },
  log: { arity: 1, fn: Math.log10 },
  log2: { arity: 1, fn: Math.log2 },
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  min: { arity: 'variadic', fn: Math.min },
  max: { arity: 'variadic', fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

/** 递归下降：支持 + - * / % ^、括号、函数与常量，不使用 eval */
const evaluateExpression = (source: string): number => {
  if (source.length > 2000) {
    throw new Error('表达式过长（最多 2000 字符）')
  }
  const tokens = tokenizeExpression(source)
  let cursor = 0

  const peek = () => tokens[cursor]
  const eat = (type: Token['type'], value?: string) => {
    const token = tokens[cursor]
    if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`表达式在第 ${cursor + 1} 个记号处不完整`)
    }
    cursor += 1
    return token
  }

  const parsePrimary = (): number => {
    const token = peek()
    if (!token) {
      throw new Error('表达式意外结束')
    }
    if (token.type === 'number') {
      cursor += 1
      return Number(token.value)
    }
    if (token.type === 'ident') {
      cursor += 1
      const name = token.value
      if (peek()?.type === '(') {
        eat('(')
        const args: number[] = []
        if (peek()?.type !== ')') {
          args.push(parseSum())
          while (peek()?.type === ',') {
            eat(',')
            args.push(parseSum())
          }
        }
        eat(')')
        const fn = FUNCTIONS[name]
        if (!fn) {
          throw new Error(`未知函数：${name}`)
        }
        if (fn.arity !== 'variadic' && args.length !== fn.arity) {
          throw new Error(`${name} 需要 ${fn.arity} 个参数`)
        }
        return fn.fn(...args)
      }
      if (name in CONSTANTS) {
        return CONSTANTS[name]
      }
      throw new Error(`未知标识符：${name}`)
    }
    if (token.type === '(') {
      eat('(')
      const value = parseSum()
      eat(')')
      return value
    }
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      cursor += 1
      const value = parsePrimary()
      return token.value === '-' ? -value : value
    }
    throw new Error(`无法解析的记号：${token.value}`)
  }

  const parsePower = (): number => {
    const base = parsePrimary()
    if (peek()?.type === 'op' && peek()?.value === '^') {
      eat('op', '^')
      return Math.pow(base, parsePower())
    }
    return base
  }

  const parseProduct = (): number => {
    let value = parsePower()
    while (peek()?.type === 'op' && ['*', '/', '%'].includes(peek().value)) {
      const op = eat('op').value
      const right = parsePower()
      if ((op === '/' || op === '%') && right === 0) {
        throw new Error('不能除以 0')
      }
      value = op === '*' ? value * right : op === '/' ? value / right : value % right
    }
    return value
  }

  const parseSum = (): number => {
    let value = parseProduct()
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = eat('op').value
      const right = parseProduct()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  const result = parseSum()
  if (cursor !== tokens.length) {
    throw new Error('表达式末尾有多余内容')
  }
  if (!Number.isFinite(result)) {
    throw new Error('计算结果不是有限数值')
  }
  return result
}

const calculateTool = defineTool(
  {
    name: 'calculate',
    label: '计算',
    description:
      '计算算术表达式，支持 + - * / % ^、括号、常量 pi/e/tau，以及 abs、sqrt、round、floor、ceil、log、ln、sin、cos、tan、min、max、pow。不执行任何代码。',
    inputSchema: objectSchema({ expression: { type: 'string', description: '要计算的表达式' } }, [
      'expression',
    ]),
  },
  async (input) => {
    const expression = str(input, 'expression').trim()
    if (!expression) {
      return fail('expression 不能为空')
    }
    try {
      const value = evaluateExpression(expression)
      return ok(`${expression} = ${value}`, { meta: { expression, value } })
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
  'browser'
)

// ---------------------------------------------------------------------------
// random
// ---------------------------------------------------------------------------

const randomNumberTool = defineTool(
  {
    name: 'random_number',
    label: '随机数',
    description:
      '生成密码学安全的随机数。默认返回 0-100 的整数；可指定范围、数量、是否去重，或用 decimals 生成小数。适合抽签、掷骰子、随机抽样与测试数据。',
    inputSchema: objectSchema({
      min: { type: 'number', description: '最小值，默认 0' },
      max: { type: 'number', description: '最大值，默认 100' },
      count: { type: 'number', description: '生成个数 1-100，默认 1' },
      unique: { type: 'boolean', description: '是否去重，默认 false' },
      decimals: { type: 'number', description: '小数位数 0-10；大于 0 时生成小数' },
    }),
  },
  async (input) => {
    const min = num(input, 'min') ?? 0
    const max = num(input, 'max') ?? 100
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      return fail('需要满足 min ≤ max')
    }
    const count = clampInt(num(input, 'count'), 1, 100, 1)
    const decimals = clampInt(num(input, 'decimals'), 0, 10, 0)
    const unique = bool(input, 'unique')
    const span = max - min
    const integerCount = Math.floor(max) - Math.ceil(min) + 1
    if (unique && decimals === 0 && count > Math.max(0, integerCount)) {
      return fail('去重模式下个数不能超过范围内的整数个数')
    }

    const values: number[] = []
    const seen = new Set<number>()
    let guard = 0
    while (values.length < count && guard < count * 200) {
      guard += 1
      let value: number
      if (decimals > 0) {
        value = min + (randomUint32() / 0x1_0000_0000) * span
        value = Number(value.toFixed(decimals))
      } else {
        const low = Math.ceil(min)
        const high = Math.floor(max)
        value = low + randomBelow(high - low + 1)
      }
      if (unique) {
        const key = Number(value.toFixed(decimals))
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
      }
      values.push(value)
    }
    const label = values.length === 1 ? '随机数' : `随机数（${values.length} 个）`
    return ok(`${label}：${values.join(', ')}`, {
      meta: { min, max, count, unique, decimals, values },
    })
  },
  'browser'
)

const randomBytesTool = defineTool(
  {
    name: 'random_bytes',
    label: '随机字节',
    description:
      '生成密码学安全的随机字节串，可输出 hex、base64、URL-safe base64 或 UUID。用于密钥、盐、nonce、邀请码等。',
    inputSchema: objectSchema({
      length: { type: 'number', description: '字节数 1-4096，默认 32' },
      fmt: {
        type: 'string',
        enum: ['hex', 'base64', 'url', 'uuid'],
        description: '输出格式，默认 hex',
      },
    }),
  },
  async (input) => {
    const length = clampInt(num(input, 'length'), 1, 4096, 32)
    const format = (str(input, 'fmt') || 'hex').toLowerCase()
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    if (format === 'hex') {
      return ok(toHex(bytes), { meta: { length, fmt: format } })
    }
    if (format === 'base64') {
      return ok(bytesToBase64(bytes), { meta: { length, fmt: format } })
    }
    if (format === 'url') {
      return ok(bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), {
        meta: { length, fmt: format },
      })
    }
    if (format === 'uuid') {
      const uuid =
        length >= 16 && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : (() => {
              const hex = toHex(bytes.slice(0, 16)).padEnd(32, '0')
              return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
            })()
      return ok(uuid, { meta: { length, fmt: format } })
    }
    return fail(`不支持的格式：${format}`)
  },
  'browser'
)

const passwordTool = defineTool(
  {
    name: 'password_gen',
    label: '生成密码',
    description:
      '生成随机密码或密钥。可选字符集与符号，默认混合大小写、数字和符号；exclude_ambiguous 会去掉 0/O、1/l/I 这类易混字符。',
    inputSchema: objectSchema({
      length: { type: 'number', description: '长度 8-128，默认 20' },
      count: { type: 'number', description: '生成个数 1-20，默认 1' },
      charset: {
        type: 'string',
        enum: ['mixed', 'letters', 'digits', 'alnum'],
        description: '字符集，默认 mixed',
      },
      symbols: { type: 'boolean', description: '是否加入符号，默认 true（digits 除外）' },
      exclude_ambiguous: { type: 'boolean', description: '去掉易混字符，默认 false' },
    }),
  },
  async (input) => {
    const length = clampInt(num(input, 'length'), 8, 128, 20)
    const count = clampInt(num(input, 'count'), 1, 20, 1)
    const charset = (str(input, 'charset') || 'mixed').toLowerCase()
    const symbols = input.symbols === undefined ? charset !== 'digits' : bool(input, 'symbols')
    const exclude = bool(input, 'exclude_ambiguous')
    let lower = 'abcdefghijklmnopqrstuvwxyz'
    let upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let digits = '0123456789'
    const symbolSet = '!@#$%^&*()-_=+[]{};:,.?/'
    if (exclude) {
      lower = lower.replace(/[lo]/g, '')
      upper = upper.replace(/[IO]/g, '')
      digits = digits.replace(/[01]/g, '')
    }
    const pools: string[] = []
    if (charset === 'mixed' || charset === 'letters' || charset === 'alnum') {
      pools.push(lower, upper)
    }
    if (charset === 'mixed' || charset === 'digits' || charset === 'alnum') {
      pools.push(digits)
    }
    if (symbols && charset !== 'digits') {
      pools.push(symbolSet)
    }
    const all = pools.join('')
    if (!all) {
      return fail('字符集为空，请检查参数')
    }
    const passwords: string[] = []
    for (let index = 0; index < count; index += 1) {
      const chars: string[] = []
      // 先保证每个字符集至少出现一次，再随机补足
      for (const pool of pools) {
        if (chars.length < length && pool) {
          chars.push(pool[randomBelow(pool.length)])
        }
      }
      while (chars.length < length) {
        chars.push(all[randomBelow(all.length)])
      }
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = randomBelow(i + 1)
        ;[chars[i], chars[j]] = [chars[j], chars[i]]
      }
      passwords.push(chars.join(''))
    }
    return ok(passwords.join('\n'), { meta: { length, count, charset, symbols } })
  },
  'browser'
)

// ---------------------------------------------------------------------------
// encoding / hashing
// ---------------------------------------------------------------------------

const base64Tool = defineTool(
  {
    name: 'base64_codec',
    label: 'Base64',
    description: 'Base64 编码或解码 UTF-8 文本，可选 URL-safe 变体（+/ 换成 -_，去掉尾部 =）。',
    inputSchema: objectSchema(
      {
        action: { type: 'string', enum: ['encode', 'decode'] },
        data: { type: 'string', description: '要处理的文本' },
        url_safe: { type: 'boolean', description: '使用 URL-safe 变体，默认 false' },
      },
      ['action', 'data']
    ),
  },
  async (input) => {
    const action = str(input, 'action')
    const data = str(input, 'data')
    const urlSafe = bool(input, 'url_safe')
    try {
      if (action === 'encode') {
        let encoded = bytesToBase64(utf8(data))
        if (urlSafe) {
          encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        }
        return ok(encoded, { meta: { action, length: encoded.length } })
      }
      let normalized = data.trim().replace(/-/g, '+').replace(/_/g, '/')
      while (normalized.length % 4 !== 0) {
        normalized += '='
      }
      const decoded = fromUtf8(base64ToBytes(normalized))
      return ok(decoded, { meta: { action, length: decoded.length } })
    } catch {
      return fail('Base64 解码失败：输入不是合法的 Base64 文本')
    }
  },
  'browser'
)

const urlCodecTool = defineTool(
  {
    name: 'url_codec',
    label: 'URL 编解码',
    description: '对文本做 URL 百分号编码或解码。component=true 时按查询参数值编码（斜杠也会转义）。',
    inputSchema: objectSchema(
      {
        action: { type: 'string', enum: ['encode', 'decode'] },
        text: { type: 'string' },
        component: { type: 'boolean', description: '按参数值编码，默认 true' },
      },
      ['action', 'text']
    ),
  },
  async (input) => {
    const action = str(input, 'action')
    const text = str(input, 'text')
    const component = input.component === undefined ? true : bool(input, 'component')
    try {
      if (action === 'encode') {
        return ok(component ? encodeURIComponent(text) : encodeURI(text))
      }
      return ok(decodeURIComponent(text))
    } catch {
      return fail('URL 解码失败：输入包含非法的百分号序列')
    }
  },
  'browser'
)

const hashTool = defineTool(
  {
    name: 'hash_text',
    label: '哈希',
    description:
      '计算文本的 SHA-1 / SHA-256 / SHA-384 / SHA-512 摘要，可输出 hex 或 base64；提供 hmac_key 时计算 HMAC。MD5 不在浏览器 WebCrypto 中，本工具不支持。',
    inputSchema: objectSchema(
      {
        data: { type: 'string', description: '要哈希的文本' },
        algorithm: {
          type: 'string',
          enum: ['sha1', 'sha256', 'sha384', 'sha512'],
          description: '默认 sha256',
        },
        hmac_key: { type: 'string', description: '可选 HMAC 密钥' },
        encoding: { type: 'string', enum: ['hex', 'base64'], description: '输出编码，默认 hex' },
      },
      ['data']
    ),
  },
  async (input) => {
    const data = str(input, 'data')
    const algorithm = (str(input, 'algorithm') || 'sha256').toLowerCase()
    const names: Record<string, string> = {
      sha1: 'SHA-1',
      sha256: 'SHA-256',
      sha384: 'SHA-384',
      sha512: 'SHA-512',
    }
    const name = names[algorithm]
    if (!name) {
      return fail(`不支持的算法：${algorithm}`)
    }
    if (!crypto.subtle) {
      return fail('当前环境不支持 WebCrypto，请在 https 或 localhost 下使用哈希工具')
    }
    try {
      const key = str(input, 'hmac_key')
      const buffer = key
        ? await crypto.subtle.sign(
            'HMAC',
            await crypto.subtle.importKey(
              'raw',
              utf8(key),
              { name: 'HMAC', hash: name },
              false,
              ['sign']
            ),
            utf8(data)
          )
        : await crypto.subtle.digest(name, utf8(data))
      const bytes = new Uint8Array(buffer)
      const encoding = str(input, 'encoding') || 'hex'
      const digest = encoding === 'base64' ? bytesToBase64(bytes) : toHex(bytes)
      return ok(`${key ? 'HMAC-' : ''}${algorithm.toUpperCase()}：${digest}`, {
        meta: { algorithm, encoding, hmac: Boolean(key), length: data.length },
      })
    } catch (error) {
      return fail(`哈希失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

const jwtTool = defineTool(
  {
    name: 'jwt_decode',
    label: '解码 JWT',
    description: '解码 JWT 的 header 与 payload，不做签名校验。只用于查看内容，不要据此判断令牌可信。',
    inputSchema: objectSchema({ token: { type: 'string' } }, ['token']),
  },
  async (input) => {
    const token = str(input, 'token').trim()
    const parts = token.split('.')
    if (parts.length < 2) {
      return fail('不是合法的 JWT：至少需要 header.payload 两段')
    }
    const decode = (part: string) => {
      let normalized = part.replace(/-/g, '+').replace(/_/g, '/')
      while (normalized.length % 4 !== 0) {
        normalized += '='
      }
      const text = fromUtf8(base64ToBytes(normalized))
      return JSON.parse(text) as unknown
    }
    try {
      const header = decode(parts[0])
      const payload = decode(parts[1])
      const lines = [
        'Header:',
        JSON.stringify(header, null, 2),
        '',
        'Payload:',
        JSON.stringify(payload, null, 2),
      ]
      const exp = (payload as { exp?: unknown }).exp
      if (typeof exp === 'number') {
        lines.push(
          '',
          `过期时间：${new Date(exp * 1000).toISOString()}${
            exp * 1000 < Date.now() ? '（已过期）' : ''
          }`
        )
      }
      lines.push('', '签名未校验：以上内容仅解码，不代表令牌有效。')
      return ok(lines.join('\n'), { meta: { header, payload } })
    } catch (error) {
      return fail(`JWT 解码失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

// ---------------------------------------------------------------------------
// JSON / CSV
// ---------------------------------------------------------------------------

const readJson = (input: Record<string, unknown>, key = 'data') => {
  const text = str(input, key).trim()
  if (!text) {
    throw new Error(`${key} 不能为空`)
  }
  return JSON.parse(text) as unknown
}

const jsonFormatTool = defineTool(
  {
    name: 'json_format',
    label: '格式化 JSON',
    description: '校验并美化 / 压缩 JSON。默认 2 空格缩进；compact=true 时输出单行。',
    inputSchema: objectSchema(
      {
        data: { type: 'string', description: 'JSON 文本' },
        indent: { type: 'number', description: '缩进空格数 0-8，默认 2' },
        compact: { type: 'boolean', description: '压缩成一行，默认 false' },
      },
      ['data']
    ),
  },
  async (input) => {
    try {
      const data = readJson(input)
      const compact = bool(input, 'compact')
      const indent = clampInt(num(input, 'indent'), 0, 8, 2)
      const output = compact ? JSON.stringify(data) : JSON.stringify(data, null, indent || 2)
      return ok(clip(output, 40000), { meta: { compact, indent } })
    } catch (error) {
      return fail(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

/** 支持 a.b[0].c 与 a[*].b 的简化路径查询 */
const queryPath = (root: unknown, path: string): unknown => {
  if (!path.trim()) {
    return root
  }
  const tokens: ({ kind: 'key'; value: string } | { kind: 'index'; value: string })[] = []
  for (const part of path.split('.')) {
    if (!part) {
      continue
    }
    const match = /^([^[\]]*)((?:\[(?:\d+|\*)\])*)$/.exec(part)
    if (!match) {
      tokens.push({ kind: 'key', value: part })
      continue
    }
    if (match[1]) {
      tokens.push({ kind: 'key', value: match[1] })
    }
    for (const index of match[2].matchAll(/\[(\d+|\*)\]/g)) {
      tokens.push({ kind: 'index', value: index[1] })
    }
  }
  let current: unknown[] = [root]
  for (const token of tokens) {
    const next: unknown[] = []
    for (const item of current) {
      if (token.kind === 'key') {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const record = item as Record<string, unknown>
          if (Object.hasOwn(record, token.value)) {
            next.push(record[token.value])
          }
        }
      } else if (Array.isArray(item)) {
        if (token.value === '*') {
          next.push(...item)
        } else {
          const index = Number(token.value)
          if (index >= 0 && index < item.length) {
            next.push(item[index])
          }
        }
      }
    }
    current = next
    if (current.length === 0) {
      return undefined
    }
  }
  return current.length === 1 ? current[0] : current
}

const jsonQueryTool = defineTool(
  {
    name: 'json_query',
    label: '查询 JSON',
    description:
      '按路径读取 JSON 中的值，支持 a.b.c、数组下标 a[0] 与通配 a[*].name。空路径返回整个文档。',
    inputSchema: objectSchema(
      {
        data: { type: 'string', description: 'JSON 文本' },
        path: { type: 'string', description: '路径，例如 items[0].title' },
      },
      ['data']
    ),
  },
  async (input) => {
    try {
      const data = readJson(input)
      const value = queryPath(data, str(input, 'path'))
      if (value === undefined) {
        return fail('路径没有匹配到任何值')
      }
      return ok(clip(JSON.stringify(value, null, 2), 20000), { meta: { path: str(input, 'path') } })
    } catch (error) {
      return fail(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

const collectJsonDiff = (a: unknown, b: unknown, path: string, out: string[], limit: number) => {
  if (out.length >= limit) {
    return
  }
  if (Object.is(a, b)) {
    return
  }
  const type = (value: unknown) =>
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (type(a) !== type(b)) {
    out.push(`${path || '$'}：${type(a)} → ${type(b)}`)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length)
    for (let index = 0; index < max; index += 1) {
      if (index >= a.length) {
        out.push(`${path}[${index}]：新增 ${JSON.stringify(b[index])}`)
      } else if (index >= b.length) {
        out.push(`${path}[${index}]：删除 ${JSON.stringify(a[index])}`)
      } else {
        collectJsonDiff(a[index], b[index], `${path}[${index}]`, out, limit)
      }
    }
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!Object.hasOwn(left, key)) {
        out.push(`${path}.${key}：新增 ${JSON.stringify(right[key])}`)
      } else if (!Object.hasOwn(right, key)) {
        out.push(`${path}.${key}：删除`)
      } else {
        collectJsonDiff(left[key], right[key], `${path}.${key}`, out, limit)
      }
    }
    return
  }
  out.push(`${path || '$'}：${JSON.stringify(a)} → ${JSON.stringify(b)}`)
}

const jsonDiffTool = defineTool(
  {
    name: 'json_diff',
    label: '对比 JSON',
    description: '逐层对比两段 JSON，列出新增、删除与改动的路径。最多返回 200 条。',
    inputSchema: objectSchema({ a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
  },
  async (input) => {
    try {
      const left = readJson(input, 'a')
      const right = readJson(input, 'b')
      const out: string[] = []
      collectJsonDiff(left, right, '', out, 200)
      return ok(out.length ? out.join('\n') : '两段 JSON 完全一致', {
        meta: { changes: out.length },
      })
    } catch (error) {
      return fail(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

/** RFC 4180 风格解析：支持引号、转义引号、CRLF */
const parseCsv = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

const csvToJsonTool = defineTool(
  {
    name: 'csv_to_json',
    label: 'CSV 转 JSON',
    description:
      '把 CSV 文本转成 JSON 数组。自动识别逗号、制表符或分号；默认首行为表头，返回对象数组。',
    inputSchema: objectSchema(
      {
        data: { type: 'string', description: 'CSV 文本' },
        delimiter: { type: 'string', description: '分隔符，auto 时自动识别' },
        header: { type: 'boolean', description: '首行是否为表头，默认 true' },
      },
      ['data']
    ),
  },
  async (input) => {
    const text = str(input, 'data')
    if (!text.trim()) {
      return fail('data 不能为空')
    }
    const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
    const requested = str(input, 'delimiter')
    const delimiter =
      requested && requested !== 'auto'
        ? requested === '\\t'
          ? '\t'
          : requested
        : firstLine.includes('\t')
          ? '\t'
          : firstLine.includes(';')
            ? ';'
            : ','
    const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''))
    if (rows.length === 0) {
      return fail('没有解析到任何数据行')
    }
    if (rows.length > 5001) {
      return fail('行数超过 5000，请先拆分文件')
    }
    const hasHeader = input.header === undefined ? true : bool(input, 'header')
    const header = hasHeader ? rows[0] : rows[0].map((_, index) => `col${index + 1}`)
    const body = hasHeader ? rows.slice(1) : rows
    const records = body.map((row) =>
      Object.fromEntries(header.map((key, index) => [key.trim() || `col${index + 1}`, row[index] ?? '']))
    )
    return ok(clip(JSON.stringify(records, null, 2), 40000), {
      meta: { rows: records.length, columns: header.length, delimiter },
    })
  },
  'browser'
)

const csvEscape = (value: unknown, delimiter: string) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /["\n\r]/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

const jsonToCsvTool = defineTool(
  {
    name: 'json_to_csv',
    label: 'JSON 转 CSV',
    description: '把对象数组转成 CSV。列顺序按首次出现合并，字段中的引号与换行会正确转义。',
    inputSchema: objectSchema(
      {
        data: { type: 'string', description: 'JSON 数组文本' },
        delimiter: { type: 'string', description: '分隔符，默认逗号' },
      },
      ['data']
    ),
  },
  async (input) => {
    try {
      const data = readJson(input)
      if (!Array.isArray(data) || data.length === 0) {
        return fail('需要一个非空 JSON 数组')
      }
      if (data.length > 5000) {
        return fail('行数超过 5000，请先拆分数据')
      }
      const delimiter = str(input, 'delimiter') || ','
      const keys: string[] = []
      for (const item of data) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const key of Object.keys(item as Record<string, unknown>)) {
            if (!keys.includes(key)) {
              keys.push(key)
            }
          }
        }
      }
      if (keys.length === 0) {
        return fail('数组元素不是对象，无法确定列名')
      }
      const lines = [keys.map((key) => csvEscape(key, delimiter)).join(delimiter)]
      for (const item of data) {
        const record = (item ?? {}) as Record<string, unknown>
        lines.push(keys.map((key) => csvEscape(record[key], delimiter)).join(delimiter))
      }
      return ok(clip(lines.join('\n'), 40000), { meta: { rows: data.length, columns: keys.length } })
    } catch (error) {
      return fail(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g
const LATIN_WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g

const textStatsTool = defineTool(
  {
    name: 'text_stats',
    label: '文本统计',
    description:
      '统计字符数、去空白字符数、词数、中文字数、行数、段落数、UTF-8 字节数与预计阅读时长。',
    inputSchema: objectSchema({ text: { type: 'string' } }, ['text']),
  },
  async (input) => {
    const text = str(input, 'text')
    const chars = [...text].length
    const charsNoSpace = [...text.replace(/\s/g, '')].length
    const cjk = (text.match(CJK) ?? []).length
    const latinWords = (text.match(LATIN_WORD) ?? []).length
    const words = cjk + latinWords
    const lines = text ? text.split(/\r?\n/).length : 0
    const paragraphs = text.trim() ? text.trim().split(/\n\s*\n/).length : 0
    const bytes = utf8(text).length
    const minutes = words / 260
    const readTime = minutes < 1 ? '不到 1 分钟' : `约 ${Math.ceil(minutes)} 分钟`
    return ok(
      [
        `字符：${chars}（不含空白 ${charsNoSpace}）`,
        `词数：${words}（中文 ${cjk}，拉丁 ${latinWords}）`,
        `行数：${lines}，段落：${paragraphs}`,
        `UTF-8 大小：${bytes} 字节`,
        `阅读时长：${readTime}`,
      ].join('\n'),
      { meta: { chars, charsNoSpace, words, cjk, latinWords, lines, paragraphs, bytes } }
    )
  },
  'browser'
)

const wordFrequencyTool = defineTool(
  {
    name: 'word_frequency',
    label: '词频',
    description:
      '统计中英文词频：英文按单词切分，中文按固定长度 n-gram（默认 2 字）切分，返回出现最多的词。',
    inputSchema: objectSchema({
      text: { type: 'string' },
      top: { type: 'number', description: '返回前 N 个，默认 30' },
      min_len: { type: 'number', description: '中文片段长度 2-4，默认 2' },
      stopwords: { type: 'string', description: '逗号分隔的停用词' },
    }, ['text']),
  },
  async (input) => {
    const text = str(input, 'text')
    if (!text.trim()) {
      return fail('text 不能为空')
    }
    const top = clampInt(num(input, 'top'), 1, 200, 30)
    const n = clampInt(num(input, 'min_len'), 2, 4, 2)
    const stop = new Set(
      str(input, 'stopwords')
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
    )
    const counts = new Map<string, number>()
    const bump = (word: string) => {
      if (!word || stop.has(word.toLowerCase())) {
        return
      }
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    for (const word of text.toLowerCase().match(LATIN_WORD) ?? []) {
      bump(word)
    }
    for (const run of text.match(/[\u3400-\u9fff]+/g) ?? []) {
      for (let index = 0; index <= run.length - n; index += 1) {
        bump(run.slice(index, index + n))
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
    const lines = [`总词数：${total}，唯一词：${counts.size}`, '']
    const max = sorted[0]?.[1] ?? 1
    for (const [word, count] of sorted) {
      const bar = '█'.repeat(Math.max(1, Math.round((count / max) * 20)))
      lines.push(`${word.padEnd(18, ' ')} ${String(count).padStart(5, ' ')}  ${bar}`)
    }
    return ok(lines.join('\n'), { meta: { total, unique: counts.size, top } })
  },
  'browser'
)

const dedupeTool = defineTool(
  {
    name: 'dedupe_lines',
    label: '行去重',
    description: '文本按行去重，可选忽略大小写、先 trim、保持原顺序或排序输出。',
    inputSchema: objectSchema(
      {
        text: { type: 'string' },
        case_insensitive: { type: 'boolean' },
        strip_whitespace: { type: 'boolean', description: '比较前去掉首尾空白，默认 true' },
        keep_order: { type: 'boolean', description: '保持首次出现顺序，默认 true' },
        drop_empty: { type: 'boolean', description: '丢弃空行，默认 true' },
      },
      ['text']
    ),
  },
  async (input) => {
    const lines = str(input, 'text').split(/\r?\n/)
    const trim = input.strip_whitespace === undefined ? true : bool(input, 'strip_whitespace')
    const dropEmpty = input.drop_empty === undefined ? true : bool(input, 'drop_empty')
    const insensitive = bool(input, 'case_insensitive')
    const keepOrder = input.keep_order === undefined ? true : bool(input, 'keep_order')
    const seen = new Set<string>()
    const result: string[] = []
    let removed = 0
    for (const raw of lines) {
      const line = trim ? raw.trim() : raw
      if (dropEmpty && line === '') {
        continue
      }
      const key = insensitive ? line.toLowerCase() : line
      if (seen.has(key)) {
        removed += 1
        continue
      }
      seen.add(key)
      result.push(line)
    }
    const output = keepOrder ? result : result.sort((a, b) => a.localeCompare(b))
    return ok(clip(output.join('\n'), 40000), {
      meta: { input: lines.length, output: output.length, removed },
    })
  },
  'browser'
)

const stripInvisibleTool = defineTool(
  {
    name: 'strip_invisible',
    label: '清除不可见字符',
    description:
      '清除零宽字符、方向控制符、BOM 与 C0/C1 控制字符；可顺带把连续空格和空行压缩。',
    inputSchema: objectSchema({
      text: { type: 'string' },
      collapse_spaces: { type: 'boolean', description: '合并连续空格与多余空行，默认 false' },
    }, ['text']),
  },
  async (input) => {
    const original = str(input, 'text')
    let text = original
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
      // eslint-disable-next-line no-control-regex -- 这里就是要清掉 C0/C1 控制字符
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    if (bool(input, 'collapse_spaces')) {
      text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
    }
    return ok(clip(text, 40000), {
      meta: { removed: [...original].length - [...text].length },
    })
  },
  'browser'
)

const regexExtractTool = defineTool(
  {
    name: 'regex_extract',
    label: '正则提取',
    description:
      '用 JavaScript 正则从文本中提取匹配。有捕获组时返回捕获内容（多组用制表符连接）；可去重并限制条数。',
    inputSchema: objectSchema(
      {
        text: { type: 'string' },
        pattern: { type: 'string', description: '正则表达式，不要包含首尾斜杠' },
        flags: { type: 'string', description: '修饰符，默认 g；可按需加 i/m/s/u' },
        unique: { type: 'boolean', description: '去重，默认 true' },
        limit: { type: 'number', description: '最多返回条数，默认 100' },
      },
      ['text', 'pattern']
    ),
  },
  async (input) => {
    const text = str(input, 'text')
    if (text.length > 300_000) {
      return fail('文本超过 30 万字符，请先截取需要处理的部分')
    }
    const pattern = str(input, 'pattern')
    if (!pattern) {
      return fail('pattern 不能为空')
    }
    const flags = str(input, 'flags') || 'g'
    try {
      const regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
      const unique = input.unique === undefined ? true : bool(input, 'unique')
      const limit = clampInt(num(input, 'limit'), 1, 1000, 100)
      const seen = new Set<string>()
      const matches: string[] = []
      for (const match of text.matchAll(regex)) {
        const groups = match.length > 1 ? match.slice(1).map((item) => item ?? '') : [match[0]]
        const value = groups.join('\t').trim()
        if (!value || (unique && seen.has(value))) {
          if (!value) {
            continue
          }
          continue
        }
        seen.add(value)
        matches.push(value)
        if (matches.length >= limit) {
          break
        }
      }
      if (matches.length === 0) {
        return ok('没有匹配到内容', { meta: { count: 0 } })
      }
      return ok(`共 ${matches.length} 条匹配：\n${matches.join('\n')}`, {
        meta: { count: matches.length, pattern, flags },
      })
    } catch (error) {
      return fail(`正则无效：${error instanceof Error ? error.message : String(error)}`)
    }
  },
  'browser'
)

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const markdownTocTool = defineTool(
  {
    name: 'markdown_toc',
    label: 'Markdown 目录',
    description: '提取 Markdown 的标题结构，生成缩进目录；可输出带锚点的链接。会跳过代码块里的 #。',
    inputSchema: objectSchema(
      {
        text: { type: 'string' },
        max_level: { type: 'number', description: '最大标题层级 1-6，默认 6' },
        links: { type: 'boolean', description: '输出可点击锚点，默认 true' },
      },
      ['text']
    ),
  },
  async (input) => {
    const lines = str(input, 'text').split(/\r?\n/)
    const maxLevel = clampInt(num(input, 'max_level'), 1, 6, 6)
    const links = input.links === undefined ? true : bool(input, 'links')
    const headings: { level: number; title: string }[] = []
    let fenced = false
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        continue
      }
      if (fenced) {
        continue
      }
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (match && match[1].length <= maxLevel) {
        headings.push({ level: match[1].length, title: match[2] })
      }
    }
    if (headings.length === 0) {
      return ok('没有找到标题')
    }
    const output = headings
      .map((heading) => {
        const indent = '  '.repeat(heading.level - 1)
        return links
          ? `${indent}- [${heading.title}](#${slugify(heading.title)})`
          : `${indent}- ${heading.title}`
      })
      .join('\n')
    return ok(output, { meta: { headings: headings.length } })
  },
  'browser'
)

const similarityTool = defineTool(
  {
    name: 'text_similarity',
    label: '文本相似度',
    description:
      '比较两段文本的相似度，返回 0-1 的分数。算法：jaccard（词集合）、dice（二元组）、cosine（词频向量）、levenshtein（编辑距离归一化）。',
    inputSchema: objectSchema(
      {
        text1: { type: 'string' },
        text2: { type: 'string' },
        algorithm: {
          type: 'string',
          enum: ['jaccard', 'dice', 'cosine', 'levenshtein'],
          description: '默认 jaccard',
        },
      },
      ['text1', 'text2']
    ),
  },
  async (input) => {
    const left = str(input, 'text1')
    const right = str(input, 'text2')
    const algorithm = (str(input, 'algorithm') || 'jaccard').toLowerCase()
    const tokens = (text: string) => {
      const normalized = text.toLowerCase()
      const cjk = normalized.match(/[\u3400-\u9fff]/g) ?? []
      const words = normalized.match(LATIN_WORD) ?? []
      return [...words, ...cjk]
    }
    if (algorithm === 'levenshtein') {
      const a = [...left].slice(0, 5000)
      const b = [...right].slice(0, 5000)
      const previous = new Array<number>(b.length + 1)
      const current = new Array<number>(b.length + 1)
      for (let j = 0; j <= b.length; j += 1) {
        previous[j] = j
      }
      for (let i = 1; i <= a.length; i += 1) {
        current[0] = i
        for (let j = 1; j <= b.length; j += 1) {
          current[j] = Math.min(
            previous[j] + 1,
            current[j - 1] + 1,
            previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          )
        }
        for (let j = 0; j <= b.length; j += 1) {
          previous[j] = current[j]
        }
      }
      const distance = previous[b.length]
      const score = 1 - distance / Math.max(1, Math.max(a.length, b.length))
      return ok(`Levenshtein 距离：${distance}\n相似度：${(score * 100).toFixed(2)}%`, {
        meta: { algorithm, distance, score },
      })
    }
    const a = tokens(left)
    const b = tokens(right)
    if (a.length === 0 || b.length === 0) {
      return fail('两段文本都需要至少一个可比较的词')
    }
    const count = (list: string[]) => {
      const map = new Map<string, number>()
      for (const item of list) {
        map.set(item, (map.get(item) ?? 0) + 1)
      }
      return map
    }
    const mapA = count(a)
    const mapB = count(b)
    let score = 0
    if (algorithm === 'cosine') {
      const keys = new Set([...mapA.keys(), ...mapB.keys()])
      let dot = 0
      let normA = 0
      let normB = 0
      for (const key of keys) {
        const x = mapA.get(key) ?? 0
        const y = mapB.get(key) ?? 0
        dot += x * y
        normA += x * x
        normB += y * y
      }
      score = normA && normB ? dot / Math.sqrt(normA * normB) : 0
    } else if (algorithm === 'dice') {
      const bigrams = (list: string[]) => {
        const set = new Set<string>()
        for (let index = 0; index < list.length - 1; index += 1) {
          set.add(`${list[index]}\u0000${list[index + 1]}`)
        }
        return set
      }
      const setA = bigrams(a)
      const setB = bigrams(b)
      let overlap = 0
      for (const item of setA) {
        if (setB.has(item)) {
          overlap += 1
        }
      }
      score = setA.size + setB.size ? (2 * overlap) / (setA.size + setB.size) : 0
    } else {
      const setA = new Set(a)
      const setB = new Set(b)
      let overlap = 0
      for (const item of setA) {
        if (setB.has(item)) {
          overlap += 1
        }
      }
      score = setA.size + setB.size ? overlap / (setA.size + setB.size - overlap) : 0
    }
    return ok(`算法：${algorithm}\n相似度：${(score * 100).toFixed(2)}%`, {
      meta: { algorithm, score },
    })
  },
  'browser'
)

const templateTool = defineTool(
  {
    name: 'template_render',
    label: '模板渲染',
    description:
      '把模板里的 {{变量}} 替换成给定值，变量支持 a.b 形式的嵌套路径。未知变量保持原样，便于检查遗漏。',
    inputSchema: objectSchema(
      {
        template: { type: 'string' },
        variables: { type: 'object', description: '变量字典，值可以是任意 JSON 类型' },
      },
      ['template']
    ),
  },
  async (input) => {
    const template = str(input, 'template')
    const variables = input.variables
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      return fail('variables 需要一个对象')
    }
    let missing = 0
    const output = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (placeholder, path: string) => {
      let value: unknown = variables
      for (const key of path.split('.')) {
        if (value && typeof value === 'object' && Object.hasOwn(value, key)) {
          value = (value as Record<string, unknown>)[key]
        } else {
          value = undefined
          break
        }
      }
      if (value === undefined || value === null) {
        missing += 1
        return placeholder
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    })
    return ok(clip(output, 40000), { meta: { missing } })
  },
  'browser'
)

const diffTextTool = defineTool(
  {
    name: 'diff_text',
    label: '文本 diff',
    description: '对比两段文本，按行或按词输出增删（- 删除，+ 新增）。适合版本对比与改动摘要。',
    inputSchema: objectSchema(
      {
        a: { type: 'string', description: '旧文本' },
        b: { type: 'string', description: '新文本' },
        mode: { type: 'string', enum: ['lines', 'words'], description: '默认 lines' },
      },
      ['a', 'b']
    ),
  },
  async (input) => {
    const a = str(input, 'a')
    const b = str(input, 'b')
    if (a.length + b.length > 400_000) {
      return fail('文本过长（合计超过 40 万字符），请先截取需要比较的部分')
    }
    const mode = str(input, 'mode') === 'words' ? 'words' : 'lines'
    const parts = mode === 'words' ? diffWords(a, b) : diffLines(a, b)
    const lines: string[] = []
    let added = 0
    let removed = 0
    for (const part of parts) {
      const prefix = part.added ? '+' : part.removed ? '-' : ' '
      if (part.added) {
        added += part.value.length
      }
      if (part.removed) {
        removed += part.value.length
      }
      if (prefix === ' ') {
        continue
      }
      for (const line of part.value.split(/\r?\n/)) {
        if (line !== '') {
          lines.push(`${prefix} ${line}`)
        }
      }
      if (lines.length > 400) {
        lines.push('…（改动过多，已截断）')
        break
      }
    }
    return ok(lines.length ? lines.join('\n') : '两段文本一致', {
      meta: { added, removed, mode },
    })
  },
  'browser'
)

// ---------------------------------------------------------------------------
// time
// ---------------------------------------------------------------------------

const DATE_OFFSET = /^\s*([+-])\s*(\d+)\s*([smhdwMy])\s*$/

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

const addMonths = (date: Date, months: number) => {
  const year = date.getFullYear()
  const month = date.getMonth() + months
  const targetYear = year + Math.floor(month / 12)
  const targetMonth = ((month % 12) + 12) % 12
  const day = Math.min(date.getDate(), daysInMonth(targetYear, targetMonth + 1))
  const next = new Date(date)
  next.setFullYear(targetYear, targetMonth, day)
  return next
}

const dateCalcTool = defineTool(
  {
    name: 'date_calc',
    label: '日期计算',
    description:
      '在基准时间上加减偏移量。offset 支持 +1d、-3w、+2h、+30M（M 为分钟，m 为月）、+1y。返回 ISO、本地时间与时间戳。',
    inputSchema: objectSchema(
      {
        base: { type: 'string', description: '基准时间（ISO），省略为现在' },
        offset: { type: 'string', description: '如 +1d、-3w、+2h、+30M' },
      },
      ['offset']
    ),
  },
  async (input) => {
    const offset = str(input, 'offset')
    const match = DATE_OFFSET.exec(offset)
    if (!match) {
      return fail('offset 格式错误，示例：+1d、-3w、+2h、+30M')
    }
    const baseText = str(input, 'base').trim()
    const base = baseText ? new Date(baseText) : new Date()
    if (Number.isNaN(base.getTime())) {
      return fail(`base 不是合法时间：${baseText}`)
    }
    const amount = Number(match[2]) * (match[1] === '+' ? 1 : -1)
    let result: Date
    switch (match[3]) {
      case 's':
        result = new Date(base.getTime() + amount * 1000)
        break
      case 'M':
        result = new Date(base.getTime() + amount * 60_000)
        break
      case 'h':
        result = new Date(base.getTime() + amount * 3_600_000)
        break
      case 'd':
        result = new Date(base.getTime() + amount * 86_400_000)
        break
      case 'w':
        result = new Date(base.getTime() + amount * 7 * 86_400_000)
        break
      case 'm':
        result = addMonths(base, amount)
        break
      case 'y':
        result = addMonths(base, amount * 12)
        break
      default:
        return fail(`未知单位：${match[3]}`)
    }
    return ok(
      [
        `基准：${base.toLocaleString()}（${base.toISOString()}）`,
        `偏移：${offset}`,
        `结果：${result.toLocaleString()}（${result.toISOString()}）`,
        `时间戳：${result.getTime()}`,
      ].join('\n'),
      { meta: { iso: result.toISOString(), timestamp: result.getTime() } }
    )
  },
  'browser'
)

const zonedParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** 把某时区的墙上时间换算成 UTC 时间戳（两次迭代足够覆盖 DST） */
const zonedTimeToUtc = (
  values: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string
) => {
  const target = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  )
  let stamp = target
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(new Date(stamp), timeZone)
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
    stamp += target - asUtc
  }
  return stamp
}

const timezoneTool = defineTool(
  {
    name: 'timezone_convert',
    label: '时区转换',
    description:
      '把某个时区的日期时间转换到另一个时区。time_str 支持 2026-11-22 10:30、2026-11-22T10:30:00 或带 Z/偏移的 ISO。',
    inputSchema: objectSchema(
      {
        time_str: { type: 'string' },
        from_tz: { type: 'string', description: 'IANA 时区，如 Asia/Shanghai' },
        to_tz: { type: 'string', description: 'IANA 时区，如 America/New_York' },
      },
      ['time_str', 'from_tz', 'to_tz']
    ),
  },
  async (input) => {
    const timeText = str(input, 'time_str').trim()
    const from = str(input, 'from_tz').trim()
    const to = str(input, 'to_tz').trim()
    try {
      // 先校验时区
      new Intl.DateTimeFormat('en-US', { timeZone: from }).format(new Date())
      new Intl.DateTimeFormat('en-US', { timeZone: to }).format(new Date())
    } catch {
      return fail('无效的 IANA 时区，示例：Asia/Shanghai、America/New_York')
    }
    let stamp: number
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(timeText)) {
      stamp = Date.parse(timeText)
      if (Number.isNaN(stamp)) {
        return fail(`无法解析时间：${timeText}`)
      }
    } else {
      const match =
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(timeText)
      if (!match) {
        return fail('时间格式应为 YYYY-MM-DD HH:mm[:ss]')
      }
      stamp = zonedTimeToUtc(
        {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
          hour: Number(match[4] ?? 0),
          minute: Number(match[5] ?? 0),
          second: Number(match[6] ?? 0),
        },
        from
      )
    }
    const format = (timeZone: string) =>
      new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(new Date(stamp))
    return ok(
      [
        `源：${format(from)}（${from}）`,
        `目标：${format(to)}（${to}）`,
        `UTC：${new Date(stamp).toISOString()}`,
      ].join('\n'),
      { meta: { timestamp: stamp, from, to } }
    )
  },
  'browser'
)

const CRON_FIELD = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)+|\d+-\d+\/\d+)$/

const parseCronField = (field: string, min: number, max: number): Set<number> => {
  if (!CRON_FIELD.test(field)) {
    throw new Error(`cron 字段不合法：${field}`)
  }
  const values = new Set<number>()
  for (const part of field.split(',')) {
    let step = 1
    let range = part
    const stepMatch = /^(.+)\/(\d+)$/.exec(part)
    if (stepMatch) {
      range = stepMatch[1]
      step = Number(stepMatch[2])
      if (step <= 0) {
        throw new Error('cron 步长必须大于 0')
      }
    }
    let start: number
    let end: number
    if (range === '*') {
      start = min
      end = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      start = a
      end = b
    } else {
      start = Number(range)
      end = start
    }
    if (start < min || end > max || start > end) {
      throw new Error(`cron 字段超出范围 ${min}-${max}：${part}`)
    }
    for (let value = start; value <= end; value += step) {
      values.add(value)
    }
  }
  return values
}

const cronTool = defineTool(
  {
    name: 'cron_next',
    label: 'Cron 下次执行',
    description:
      '计算 5 段 cron 表达式（分 时 日 月 周）接下来几次的执行时间，使用浏览器本地时区。支持 *、*/n、a-b、a,b 与 a-b/n。',
    inputSchema: objectSchema(
      {
        expression: { type: 'string', description: '例如 0 9 * * 1-5' },
        count: { type: 'number', description: '返回几条，默认 3' },
      },
      ['expression']
    ),
  },
  async (input) => {
    const expression = str(input, 'expression').trim()
    const fields = expression.split(/\s+/)
    if (fields.length !== 5) {
      return fail('需要 5 段 cron：分 时 日 月 周')
    }
    try {
      const minutes = parseCronField(fields[0], 0, 59)
      const hours = parseCronField(fields[1], 0, 23)
      const days = parseCronField(fields[2], 1, 31)
      const months = parseCronField(fields[3], 1, 12)
      const weekdays = parseCronField(fields[4].replace(/^7$/, '0'), 0, 6)
      const count = clampInt(num(input, 'count'), 1, 10, 3)
      const results: string[] = []
      const cursor = new Date()
      cursor.setSeconds(0, 0)
      cursor.setMinutes(cursor.getMinutes() + 1)
      const limit = 366 * 24 * 60
      let steps = 0
      while (results.length < count && steps < limit) {
        steps += 1
        if (
          minutes.has(cursor.getMinutes()) &&
          hours.has(cursor.getHours()) &&
          days.has(cursor.getDate()) &&
          months.has(cursor.getMonth() + 1) &&
          weekdays.has(cursor.getDay())
        ) {
          results.push(cursor.toLocaleString())
        }
        cursor.setMinutes(cursor.getMinutes() + 1)
      }
      if (results.length === 0) {
        return ok('未来一年内没有匹配的执行时间，请检查表达式', { meta: { count: 0 } })
      }
      return ok(results.map((time, index) => `${index + 1}. ${time}`).join('\n'), {
        meta: { results, expression },
      })
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
  'browser'
)

// ---------------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------------

const qrcodeTool = defineTool(
  {
    name: 'qrcode_generate',
    label: '生成二维码',
    description:
      '把文本或链接生成二维码（SVG 产物，可预览与下载）。适合分享链接、Wi-Fi 配置、联系信息等。',
    inputSchema: objectSchema(
      {
        text: { type: 'string', description: '二维码内容' },
        name: { type: 'string', description: '文件名，默认 qrcode.svg' },
      },
      ['text']
    ),
  },
  async (input, context) => {
    const text = str(input, 'text')
    if (!text.trim()) {
      return fail('text 不能为空')
    }
    if (text.length > 2600) {
      return fail('内容过长，二维码最多约 2600 个字符')
    }
    const graphic = buildQr(text)
    if (!graphic) {
      return fail('二维码生成失败：内容过长或包含不支持的字符')
    }
    const margin = 4
    const total = graphic.count + margin * 2
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="512" height="512" shape-rendering="crispEdges">`,
      `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
      `<path d="${graphic.path}" transform="translate(${margin} ${margin})" fill="#0b0d12"/>`,
      '</svg>',
    ].join('')
    context.progress('生成二维码…')
    const name = str(input, 'name').trim() || 'qrcode.svg'
    const meta = await createArtifact({
      name: name.endsWith('.svg') ? name : `${name}.svg`,
      text: svg,
      mime: 'image/svg+xml',
      source: 'browser',
      tool: 'qrcode_generate',
      sessionId: context.sessionId,
    })
    return ok(`已生成二维码「${meta.name}」（${graphic.count}×${graphic.count} 模块），已展示在对话中。`, {
      artifacts: [meta],
      meta: { text, modules: graphic.count },
    })
  },
  'browser'
)

export const utilityTools: RegisteredTool[] = [
  calculateTool,
  randomNumberTool,
  randomBytesTool,
  passwordTool,
  base64Tool,
  urlCodecTool,
  hashTool,
  jwtTool,
  jsonFormatTool,
  jsonQueryTool,
  jsonDiffTool,
  csvToJsonTool,
  jsonToCsvTool,
  textStatsTool,
  wordFrequencyTool,
  dedupeTool,
  stripInvisibleTool,
  regexExtractTool,
  markdownTocTool,
  similarityTool,
  templateTool,
  diffTextTool,
  dateCalcTool,
  timezoneTool,
  cronTool,
  qrcodeTool,
]
