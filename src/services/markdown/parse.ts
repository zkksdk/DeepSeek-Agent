import type {
  BlockContent,
  Node as MdAstNode,
  Nodes,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

/** 彩色高亮：==文本== 默认黄色，==red:文本== 指定颜色 */
export type MarkColor =
  | 'yellow'
  | 'red'
  | 'green'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'gray'
  | 'cyan'

export interface MarkNode extends MdAstNode {
  type: 'mark'
  color: MarkColor
  children: PhrasingContent[]
}

/** 手写波浪线：~文本~ */
export interface WavyNode extends MdAstNode {
  type: 'wavy'
  children: PhrasingContent[]
}

/** GitHub README 风格的提示块：> [!IMPORTANT] */
export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export interface AlertNode extends MdAstNode {
  type: 'alert'
  kind: AlertKind
  children: BlockContent[]
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
    alert: AlertNode
    // mdast 的 Nodes 联合只由 RootContentMap 组成，行内节点也登记一次，
    // 否则遍历函数拿不到这两个自定义节点的类型
    mark: MarkNode
    wavy: WavyNode
  }

  interface BlockContentMap {
    alert: AlertNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
    mark: MarkNode
    wavy: WavyNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

const MARK_COLORS = 'yellow|red|green|blue|purple|orange|pink|gray|cyan'

/** `> [!NOTE]` 等 GitHub alert 标记，位于引用块首行 */
const ALERT_PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\n|$)/i

/** 把引用块首行的 alert 标记摘掉，并把节点改成 alert */
const convertAlerts = (node: Nodes) => {
  if ('children' in node) {
    for (const child of node.children) {
      convertAlerts(child as Nodes)
    }
  }
  if (node.type !== 'blockquote') {
    return
  }
  const first = node.children[0]
  if (!first || first.type !== 'paragraph') {
    return
  }
  const head = first.children[0]
  if (!head || head.type !== 'text') {
    return
  }
  const match = ALERT_PATTERN.exec(head.value)
  if (!match) {
    return
  }
  head.value = head.value.slice(match[0].length)
  if (head.value === '') {
    first.children.shift()
  }
  if (first.children.length === 0) {
    node.children.shift()
  }
  const alert = node as unknown as AlertNode
  alert.type = 'alert'
  alert.kind = match[1].toLowerCase() as AlertKind
}

/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - ==高亮==、==red:高亮== 与 ~波浪线~ 换成行内节点
 * - > [!NOTE] 等引用块换成 alert 节点
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  const ast = fromMarkdown(input, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染；
      // singleTilde 会把 ~文本~ 当删除线，这里关闭，留给手写波浪线
      { ...gfm({ singleTilde: false }), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  convertAlerts(ast)
  const replacements: Parameters<typeof findAndReplace>[1] = [
    [
      new RegExp(`==(${MARK_COLORS}):([^=\\n]+)==`, 'g'),
      (_: string, color: string, value: string): MarkNode => ({
        type: 'mark',
        color: color as MarkColor,
        children: [text(value)],
      }),
    ],
    [
      /==([^=\n]+)==/g,
      (_: string, value: string): MarkNode => ({
        type: 'mark',
        color: 'yellow',
        children: [text(value)],
      }),
    ],
    [
      // 单个波浪线是手写下划线，双波浪线已由 GFM 解析成删除线
      /(?<!~)~([^~\n]+)~(?!~)/g,
      (_: string, value: string): WavyNode => ({ type: 'wavy', children: [text(value)] }),
    ],
  ]
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    replacements.unshift([
      /\[citation:(\d+)\]/g,
      (_: string, index: string): CitationNode | '' => {
        const source = sourcesByIndex.get(Number(index))
        return source ? { type: 'citation', source } : ''
      },
    ])
  }
  findAndReplace(ast, replacements, { ignore: ['linkReference'] })

  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}
