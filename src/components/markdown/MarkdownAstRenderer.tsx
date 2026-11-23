import {
  createContext,
  createElement,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import type {
  BlockContent,
  DefinitionContent,
  List as ListNode,
  PhrasingContent,
  Root,
  Table as TableNode,
} from 'mdast'
import type { AlertKind, MarkNode, WavyNode } from '../../services/markdown/parse.js'
import { CitationLink } from '../search/CitationLink.js'
import { CodeBlock } from './CodeBlock.js'
import { ImageAsLink, Link } from './Link.js'
import { InlineMath, MathBlock } from './MathFormula.js'

const Html = memo(function Html({ value }: { value: string }) {
  if (/^<br\s*\/?>$/i.test(value)) {
    return <br />
  }
  return <span className="ds-markdown-html">{value}</span>
})

/** 高亮与波浪线都只包裹纯文本，保持原有的换行行为 */
const Mark = memo(function Mark({ node }: { node: MarkNode }) {
  return (
    <mark className="ds-md-mark" data-color={node.color}>
      <MarkdownPhrasingContent nodes={node.children} />
    </mark>
  )
})

const Wavy = memo(function Wavy({ node }: { node: WavyNode }) {
  return (
    <span className="ds-md-wavy">
      <MarkdownPhrasingContent nodes={node.children} />
    </span>
  )
})

const ALERT_META: Record<AlertKind, { label: string; icon: string }> = {
  note: { label: '说明', icon: 'ℹ' },
  tip: { label: '提示', icon: '✦' },
  important: { label: '重要', icon: '❗' },
  warning: { label: '警告', icon: '⚠' },
  caution: { label: '危险', icon: '⛔' },
}

const Alert = memo(function Alert({
  node,
}: {
  node: { kind: AlertKind; children: BlockContent[] }
}) {
  const meta = ALERT_META[node.kind]
  return (
    <div className="ds-md-alert" data-kind={node.kind}>
      <div className="ds-md-alert-head">
        <span className="ds-md-alert-icon" aria-hidden="true">
          {meta.icon}
        </span>
        <span className="ds-md-alert-label">{meta.label}</span>
      </div>
      <div className="ds-md-alert-body">
        <MarkdownBlockContentOrDefinitionContent
          nodes={node.children as Array<BlockContent | DefinitionContent>}
          loading={false}
        />
      </div>
    </div>
  )
})

const List = memo(function List({ node, loading }: { node: ListNode; loading: boolean }) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag start={node.ordered ? node.start || undefined : undefined}>
      {node.children.map((child, index) => {
        // GFM: task item 的 checked 为 boolean；普通 listItem 为 null
        const checked = child.checked
        const isTaskItem = typeof checked === 'boolean'
        return (
          <li key={index} className={isTaskItem ? 'ds-markdown-task-list-item' : undefined}>
            {isTaskItem ? (
              // □ U+25A1 / ☑ U+2611
              <span className="ds-markdown-task-checkbox">{checked ? '☑  ' : '□  '}</span>
            ) : null}
            <MarkdownBlockContentOrDefinitionContent nodes={child.children} loading={loading} />
          </li>
        )
      })}
    </ListTag>
  )
})

const Table = memo(function Table({ node }: { node: TableNode }) {
  const columnCount = node.children[0]?.children.length
  return (
    <div className="markdown-table-wrapper">
      <table>
        {node.children[0] ? (
          <thead>
            <tr>
              {node.children[0].children.map((cell, cellIndex) => {
                return (
                  <th key={cellIndex}>
                    <MarkdownPhrasingContent nodes={cell.children} />
                  </th>
                )
              })}
            </tr>
          </thead>
        ) : null}
        {node.children[1] ? (
          <tbody>
            {node.children.slice(1).map((row, rowIndex) => {
              const curColumnCount = row.children.length || 0
              return (
                <tr key={rowIndex}>
                  {row.children.map((cell, cellIndex) => {
                    return (
                      <td key={cellIndex}>
                        <MarkdownPhrasingContent nodes={cell.children} />
                      </td>
                    )
                  })}
                  {/* 补齐到列数 */}
                  {Array.from({ length: columnCount - curColumnCount }).map((_, idx) => (
                    <td key={`ptd_${idx}`} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        ) : null}
      </table>
    </div>
  )
})

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
}: {
  nodes: PhrasingContent[]
}) {
  return (
    <>
      {nodes.map((node, index) => {
        return <MarkdownPhrasingContentItem key={index} node={node} />
      })}
    </>
  )
})

const MarkdownPhrasingContentItem = memo(function MarkdownPhrasingContentItem({
  node,
}: {
  node: PhrasingContent
}) {
  switch (node.type) {
    case 'inlineMath':
      return <InlineMath value={node.value} />
    case 'break':
      return <br />
    case 'emphasis':
      return (
        <em>
          <MarkdownPhrasingContent nodes={node.children} />
        </em>
      )
    case 'image':
      return <ImageAsLink node={node} />
    case 'html':
      return <Html value={node.value} />
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'link':
      return (
        <Link node={node}>
          <MarkdownPhrasingContent nodes={node.children} />
        </Link>
      )
    case 'strong':
      return (
        <strong>
          <MarkdownPhrasingContent nodes={node.children} />
        </strong>
      )
    case 'text':
      return <TextContent text={node.value} offset={node.position?.start.offset ?? -1} />
    case 'citation':
      return <CitationLink source={node.source} />
    case 'mark':
      return <Mark node={node} />
    case 'wavy':
      return <Wavy node={node} />
    default:
      // 删除线、脚注、引用式链接已在解析时换成文本
      return null
  }
})

/** 从该字符偏移之后的内容做入场动画；-1 表示不启用 */
const StreamFromContext = createContext(-1)

/** 单次渲染最多动画这么多个片段，避免长段落一次性生成过多节点 */
const STREAM_SEGMENT_LIMIT = 180

/**
 * 切分新到的文本：中日韩逐字，拉丁字母与数字按词成组，空白保持普通文本。
 * 逐字用 inline-block 会破坏英文断行，按词分组后既能上浮又不会把单词拆开。
 */
const segmentText = (text: string): Array<{ value: string; start: number }> => {
  const pattern =
    /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+(?:[’'\-_.]*[A-Za-z0-9]+)*|\s+|[\s\S]/gu
  const out: Array<{ value: string; start: number }> = []
  for (const match of text.matchAll(pattern)) {
    out.push({ value: match[0], start: match.index ?? 0 })
  }
  return out
}

const StreamLine = memo(function StreamLine({
  line,
  lineStart,
  streamFrom,
}: {
  line: string
  lineStart: number
  streamFrom: number
}) {
  const cut = Math.max(0, Math.min(line.length, streamFrom - lineStart))
  if (streamFrom < 0 || lineStart < 0 || cut >= line.length) {
    return <span>{line}</span>
  }
  const rest = line.slice(cut)
  const segments = segmentText(rest)
  const visible =
    segments.length > STREAM_SEGMENT_LIMIT ? segments.slice(-STREAM_SEGMENT_LIMIT) : segments
  const skip = visible.length > 0 ? visible[0].start : rest.length
  return (
    <span>
      {line.slice(0, cut + skip)}
      {visible.map((segment, index) =>
        /^\s+$/.test(segment.value) ? (
          segment.value
        ) : (
          <span
            key={lineStart + cut + segment.start}
            className="ds-md-stream-char"
            style={{ animationDelay: `${Math.min(index, 12) * 12}ms` }}
          >
            {segment.value}
          </span>
        )
      )}
    </span>
  )
})

// 按 \n 拆行插 <br>：源文每个换行（含软换行）都渲染为视觉换行
const TextContent = memo(function TextContent({ text, offset }: { text: string; offset: number }) {
  const streamFrom = useContext(StreamFromContext)
  const result: ReactNode[] = []
  let cursor = offset
  text.split(/(\r?\n)/).forEach((part, index) => {
    if (index % 2 === 1) {
      result.push(<br key={`${cursor}b`} />)
      cursor += part.length
      return
    }
    if (part) {
      result.push(
        <StreamLine key={`${cursor}s`} line={part} lineStart={cursor} streamFrom={streamFrom} />
      )
    }
    cursor += part.length
  })
  return result
})

const MarkdownBlockContentOrDefinitionContent = memo(
  function MarkdownBlockContentOrDefinitionContent({
    nodes,
    loading,
  }: {
    nodes: Array<BlockContent | DefinitionContent>
    loading: boolean
  }) {
    return nodes.map((node, index) => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              <MarkdownBlockContentOrDefinitionContent nodes={node.children} loading={loading} />
            </blockquote>
          )
        case 'html':
          return <Html key={index} value={node.value} />
        case 'heading':
          return node.children.length === 0
            ? null
            : createElement(
                `h${node.depth}`,
                { key: index },
                <MarkdownPhrasingContent nodes={node.children} />
              )
        case 'paragraph':
          return (
            <p key={index} className="ds-markdown-paragraph">
              <MarkdownPhrasingContent nodes={node.children} />
            </p>
          )
        case 'code':
          return (
            <CodeBlock
              key={index}
              code={node.value}
              infostring={node.lang || 'text'}
              loading={loading}
            />
          )
        case 'table':
          return <Table node={node} key={index} />
        case 'list':
          return <List key={index} node={node} loading={loading} />
        case 'alert':
          return <Alert key={index} node={node} />
        default:
          // 脚注与定义已在解析时换成段落
          return null
      }
    })
  }
)

export const MarkdownAstRenderer = memo(function MarkdownAstRenderer({
  ast,
  onUpdate,
  className,
  loading = false,
  streamFrom = -1,
}: {
  ast: Root
  className?: string
  loading?: boolean
  /** 该字符偏移之后的文本播放逐字入场动画 */
  streamFrom?: number
  /**
   * layoutEffect 之后触发 -> 进行页面滚动
   */
  onUpdate: () => void
}) {
  const onUpdateRef = useRef<() => void>(() => 0)
  onUpdateRef.current = onUpdate
  useLayoutEffect(() => {
    onUpdateRef.current()
  }, [ast.children])

  return useMemo(
    () => (
      <div className={clsx('ds-markdown', className)}>
        <StreamFromContext.Provider value={streamFrom}>
          {/* 解析器在根节点下产出块级内容。 */}
          <MarkdownBlockContentOrDefinitionContent
            nodes={ast.children as Array<BlockContent | DefinitionContent>}
            loading={loading}
          />
        </StreamFromContext.Provider>
      </div>
    ),
    [className, ast.children, loading, streamFrom]
  )
})
