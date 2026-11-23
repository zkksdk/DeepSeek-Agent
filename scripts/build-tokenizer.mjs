/**
 * 从 DeepSeek 的 tokenizer.json 生成前端的紧凑词表。
 *
 * 只保留「精确计数」需要的东西：
 * - added_tokens（<｜...｜> 这类特殊符号，按整体计 1 个 token）
 * - merges 的先后顺序（BPE 的合并优先级）
 *
 * 输出是纯文本，第一行是特殊符号（用 \u0001 分隔），之后每行是一次合并。
 * 纯文本比 JSON 少一层转义，也能直接按 asset/source 打进懒加载 chunk。
 *
 * 用法：node scripts/build-tokenizer.mjs <tokenizer.json> [输出路径]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const input = process.argv[2]
if (!input) {
  console.error('用法：node scripts/build-tokenizer.mjs <tokenizer.json> [输出路径]')
  process.exit(1)
}
const output = resolve(process.argv[3] ?? 'src/services/tokenizer/dsv4-merges.txt')

const raw = JSON.parse(readFileSync(input, 'utf8'))
const model = raw?.model
if (!model || model.type !== 'BPE' || !Array.isArray(model.merges)) {
  console.error('不是预期的 BPE tokenizer.json')
  process.exit(1)
}

const SEP = '\u0001'
const added = (raw.added_tokens ?? [])
  .map((token) => token?.content)
  .filter(
    (content) =>
      typeof content === 'string' && content.length > 0 && !content.includes('\n') && !content.includes(SEP)
  )

const merges = model.merges.map((item) => (Array.isArray(item) ? item.join(' ') : String(item)))
if (merges.some((line) => line.includes('\n'))) {
  console.error('merge 里出现了换行，无法用行分隔')
  process.exit(1)
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${added.join(SEP)}\n${merges.join('\n')}`)
const size = readFileSync(output).length
console.log(`已写入 ${output}`)
console.log(`merges: ${merges.length}，added: ${added.length}，体积 ${(size / 1024).toFixed(0)} KB`)
