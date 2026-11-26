/**
 * DSML 工具调用解析。
 *
 * DeepSeek 在部分通道下不返回结构化 tool_use 事件，而是把调用写成文本：
 *
 *   <||DSML||> invoke name="get_datetime">
 *   <||DSML||> parameter name="timezone" string="true">Asia/Shanghai</||DSML||> parameter>
 *   </||DSML||> invoke>
 *
 * 不解析的话，整段标签会被当成正文显示给用户，工具一次都不执行。
 *
 * 两个坑都在正则上，一起记下来：
 * 1. 竖线有半角 | 和全角 U+FF5C 两种写法。全角不能直接写字符——文件编码一错就变成
 *    残缺的字符类，改用 \\uFF5C 转义。
 * 2. 必须用字面量正则。用 new RegExp 拼字符串时，\\s 到运行时是 \\s（两个字面反斜杠），
 *    正则引擎当字面量处理，永远匹配不到空白——这正是它一开始全部失败的原因。
 */

export type DsmlCall = {
  name: string
  input: Record<string, unknown>
}

const INVOKE_OPEN = /<[|\uFF5C]{1,2}\s*DSML\s*[|\uFF5C]{1,2}>\s*invoke\s+name\s*=\s*"([^"]+)"\s*>/gi
const INVOKE_CLOSE = /<\/?[|\uFF5C]{1,2}\s*DSML\s*[|\uFF5C]{1,2}>\s*invoke\s*>/gi
const PARAM =
  /<[|\uFF5C]{1,2}\s*DSML\s*[|\uFF5C]{1,2}>\s*parameter\s+name\s*=\s*"([^"]+)"(?:\s+string\s*=\s*"true")?\s*>([\s\S]*?)<\/?[|\uFF5C]{1,2}\s*DSML\s*[|\uFF5C]{1,2}>\s*parameter\s*>/gi
const TAG = /<\/?[|\uFF5C]{1,2}\s*DSML\s*[|\uFF5C]{1,2}>/gi

/** 文本里有没有像调用的东西 */
export const hasDsml = (text: string) =>
  /<[|\uFF5C]{1,2}\s*DSML/i.test(text) && /invoke\s+name\s*=/i.test(text)

/** 把一段含 DSML 的文本拆成「正文」与「调用」两部分 */
export const parseDsml = (text: string): { text: string; calls: DsmlCall[] } => {
  if (!hasDsml(text)) {
    return { text, calls: [] }
  }

  const calls: DsmlCall[] = []
  let plain = text

  INVOKE_OPEN.lastIndex = 0
  let match = INVOKE_OPEN.exec(text)
  while (match !== null) {
    const name = match[1]
    const bodyStart = match.index + match[0].length

    INVOKE_CLOSE.lastIndex = bodyStart
    const close = INVOKE_CLOSE.exec(text)
    const bodyEnd = close ? close.index : text.length
    const body = text.slice(bodyStart, bodyEnd)

    const input: Record<string, unknown> = {}
    PARAM.lastIndex = 0
    let param = PARAM.exec(body)
    while (param !== null) {
      input[param[1]] = coerce(param[2])
      param = PARAM.exec(body)
    }

    if (Object.keys(input).length === 0) {
      const trimmed = body.trim()
      if (trimmed.startsWith('{')) {
        try {
          Object.assign(input, JSON.parse(trimmed) as Record<string, unknown>)
        } catch {
          // 留给工具自己报参数错
        }
      }
    }

    calls.push({ name, input })
    plain = plain.slice(0, match.index) + plain.slice(bodyEnd + (close?.[0].length ?? 0))
    match = INVOKE_OPEN.exec(text)
  }

  return { text: plain.replace(TAG, '').trim(), calls }
}

const coerce = (raw: string) => {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && Number.isFinite(Number(value))) return Number(value)
  return raw
}