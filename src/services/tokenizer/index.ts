/**
 * DeepSeek 词表的精确 token 计数。
 *
 * 词表来自 tokenizer.json（LlamaTokenizerFast / BPE），这里只实现计数需要的最小链路：
 * 特殊符号整体计 1 → 三段 Split 预切分 → ByteLevel 字节映射 → 按 merge 优先级贪心合并。
 * 词表本体约 1.5MB，放在懒加载 chunk 里，选择「精确」模式后才下载。
 */

import mergesUrl from './dsv4-merges.txt'

const PRETOKENIZERS = [
  /\p{N}{1,3}/gu,
  /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]+/gu,
  /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~][A-Za-z]+|[^\r\n\p{L}\p{P}\p{S}]?[\p{L}\p{M}]+| ?[\p{P}\p{S}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
]

/** 单个预切片的长度上限。中文长句会被切成多个片，边界处最多差 1-2 个 token */
const MAX_PIECE_CHARS = 192

/** GPT-2 的字节到可见字符映射，ByteLevel 预分词依赖它 */
const buildByteEncoder = () => {
  const direct: number[] = []
  for (let code = 33; code <= 126; code += 1) {
    direct.push(code)
  }
  for (let code = 161; code <= 172; code += 1) {
    direct.push(code)
  }
  for (let code = 174; code <= 255; code += 1) {
    direct.push(code)
  }
  const chars = [...direct]
  let offset = 0
  for (let byte = 0; byte < 256; byte += 1) {
    if (!direct.includes(byte)) {
      direct.push(byte)
      chars.push(256 + offset)
      offset += 1
    }
  }
  const table: string[] = new Array(256)
  for (let index = 0; index < direct.length; index += 1) {
    table[direct[index]] = String.fromCodePoint(chars[index])
  }
  return table
}

const BYTE_ENCODER = buildByteEncoder()
const encoder = new TextEncoder()

/** 用 Isolated 行为切分：命中的片段独立成片，间隙继续交给后面的规则 */
const splitIsolated = (text: string, pattern: RegExp): string[] => {
  const pieces: string[] = []
  let last = 0
  pattern.lastIndex = 0
  for (;;) {
    const match = pattern.exec(text)
    if (!match) {
      break
    }
    if (match[0] === '') {
      pattern.lastIndex += 1
      continue
    }
    if (match.index > last) {
      pieces.push(text.slice(last, match.index))
    }
    pieces.push(match[0])
    last = match.index + match[0].length
  }
  if (last < text.length) {
    pieces.push(text.slice(last))
  }
  return pieces
}

export type Tokenizer = {
  /** 精确 token 数 */
  count: (text: string) => number
  /** 词表里登记的特殊符号，用于自检 */
  addedCount: number
}

const build = (raw: string): Tokenizer => {
  const newline = raw.indexOf('\n')
  const added = raw
    .slice(0, newline > 0 ? newline : 0)
    .split('\u0001')
    .filter(Boolean)
  const merges = raw.slice(newline + 1).split('\n')
  const ranks = new Map<string, number>()
  for (let index = 0; index < merges.length; index += 1) {
    ranks.set(merges[index], index)
  }

  // 特殊符号一次性匹配：按长度倒序，避免短符号吃掉长符号的前缀
  const addedPattern =
    added.length > 0
      ? new RegExp(
          `(${[...added]
            .sort((a, b) => b.length - a.length)
            .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')})`,
          'g'
        )
      : null

  /** 一个预切片内部的合并：每轮找出优先级最高的相邻对，只合并最靠左的一次 */
  const mergeSymbols = (symbols: string[]): number => {
    const parts = symbols
    while (parts.length > 1) {
      let bestRank = Number.POSITIVE_INFINITY
      let bestAt = -1
      for (let index = 0; index < parts.length - 1; index += 1) {
        const rank = ranks.get(`${parts[index]} ${parts[index + 1]}`)
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank
          bestAt = index
        }
      }
      if (bestAt < 0) {
        break
      }
      parts.splice(bestAt, 2, parts[bestAt] + parts[bestAt + 1])
    }
    return parts.length
  }

  const countPiece = (piece: string): number => {
    if (!piece) {
      return 0
    }
    const bytes = encoder.encode(piece)
    if (bytes.length === 1) {
      return 1
    }
    const symbols: string[] = new Array(bytes.length)
    for (let index = 0; index < bytes.length; index += 1) {
      symbols[index] = BYTE_ENCODER[bytes[index]]
    }
    return mergeSymbols(symbols)
  }

  const countPlain = (text: string): number => {
    if (!text) {
      return 0
    }
    let pieces = [text]
    for (const pattern of PRETOKENIZERS) {
      const next: string[] = []
      for (const piece of pieces) {
        if (piece.length <= MAX_PIECE_CHARS) {
          next.push(piece)
          continue
        }
        // 超长片段按固定长度切开，避免单片的合并开销失控
        for (let start = 0; start < piece.length; start += MAX_PIECE_CHARS) {
          next.push(piece.slice(start, start + MAX_PIECE_CHARS))
        }
      }
      pieces = next.flatMap((piece) => splitIsolated(piece, pattern))
    }
    let total = 0
    for (const piece of pieces) {
      total += countPiece(piece)
    }
    return total
  }

  const count = (text: string): number => {
    if (!text) {
      return 0
    }
    if (!addedPattern) {
      return countPlain(text)
    }
    let total = 0
    let last = 0
    addedPattern.lastIndex = 0
    for (;;) {
      const match = addedPattern.exec(text)
      if (!match) {
        break
      }
      if (match.index > last) {
        total += countPlain(text.slice(last, match.index))
      }
      total += 1
      last = match.index + match[0].length
    }
    if (last < text.length) {
      total += countPlain(text.slice(last))
    }
    return total
  }

  return { count, addedCount: added.length }
}

let cached: Tokenizer | null = null
let loading: Promise<Tokenizer | null> | null = null
let unavailable = false

/** 懒加载词表；失败（比如离线或资源缺失）时返回 null，调用方退回估算 */
export const loadTokenizer = (): Promise<Tokenizer | null> => {
  if (cached) {
    return Promise.resolve(cached)
  }
  if (unavailable) {
    return Promise.resolve(null)
  }
  loading ??= fetch(mergesUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`词表加载失败：HTTP ${response.status}`)
      }
      return response.text()
    })
    .then((raw) => {
      cached = build(raw)
      return cached
    })
    .catch(() => {
      // file:// 打开或资源缺失时退回估算，不影响其他功能
      unavailable = true
      loading = null
      return null
    })
  return loading
}

/** 已经加载好时同步取用，省掉一次 microtask */
export const tokenizerReady = () => cached !== null

/**
 * 快速估算：中文 1 字 1 token，拉丁按 0.3 token/字符。
 * 没有词表时用它，够看速度与上下文占用。
 */
export const estimateTokens = (text: string): number => {
  let weight = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    weight += code >= 0x2e80 && code <= 0x9fff ? 1 : 0.3
  }
  return Math.round(weight)
}

/** 优先精确计数，词表不可用时退回估算 */
export const countTokens = async (text: string): Promise<number> => {
  const tokenizer = await loadTokenizer()
  return tokenizer ? tokenizer.count(text) : estimateTokens(text)
}
