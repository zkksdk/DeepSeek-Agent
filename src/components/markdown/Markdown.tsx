import { memo, useMemo } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useSettings } from '../../services/settings.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/** 流式动画窗口：末尾这么多字符内保留动画节点 */
const STREAM_WINDOW = 160

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  /*
   * 只给末尾一小段文字挂动画节点：既能让新到的字逐个入场，又不会在父组件
   * 每次重渲染时把上一帧的节点重建掉（动画会随之中断）。节点按绝对偏移做 key，
   * 已存在字符的 DOM 保持不变，动画只播一次。
   */
  // 关闭动效时直接渲染纯文本，不再逐字入场
  const motion = useSettings((state) => state.motion)
  const streamFrom =
    loading && motion === 'full' ? Math.max(0, throttledMarkdown.length - STREAM_WINDOW) : -1
  const ast = useMemo(
    () => (throttledMarkdown ? toMdAst(throttledMarkdown, { sources, disableLink }) : null),
    [throttledMarkdown, sources, disableLink]
  )
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      streamFrom={streamFrom}
      onUpdate={scrollToBottom}
    />
  ) : null
})
