import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { QuestionNav } from './QuestionNav.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 距顶部小于该值时视为在顶部，此时不显示顶部渐变模糊 */
const EDGE_THRESHOLD = 6
/** 当前问题的判定线：视口顶部往下这么多像素内，最后一个越过的提问就是「当前」 */
const ACTIVE_OFFSET = 96
/** 跳转时给标题栏与顶部模糊留出的高度 */
const JUMP_OFFSET = 72
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

/** 导航里的一行文字：压平空白；只有附件时退回附件名 */
const questionText = (content: string, files: { name: string }[]): string => {
  const text = content.replace(/\s+/g, ' ').trim()
  if (text) {
    return text
  }
  return files.map((file) => file.name).join('、') || '—'
}

export const MessageList = ({
  session,
  streaming,
  footer,
  onTopEdgeChange,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
  /** 是否已经滚离顶部：顶部渐变模糊只在有内容滚到标题下面时出现 */
  onTopEdgeChange?: (atTop: boolean) => void
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  // 右侧快速跳转只认用户提问，一条提问对应列表里的一行
  const questionItems = useMemo(
    () =>
      messages.flatMap((message) =>
        message.role === 'user'
          ? [{ id: message.id, text: questionText(message.content, message.files) }]
          : []
      ),
    [messages]
  )
  const questionKey = questionItems.map((item) => item.id).join('|')
  const [activeId, setActiveId] = useState<string | null>(null)

  const jumpToQuestion = useCallback((id: string) => {
    const el = scrollRef.current
    const node = el?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
    if (!el || !node) {
      return
    }
    // 手动跳转后不再跟随底部，否则流式内容会把视线拽回去
    stickyRef.current = false
    const top =
      node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - JUMP_OFFSET
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [])

  // 用 IntersectionObserver 判断「当前读到哪一问」：之前每帧都要 querySelector + 读 rect，
  // 长对话滚动时这些同步布局查询就是掉帧的元凶。现在只在进入/离开判定带时回调一次。
  useEffect(() => {
    const el = scrollRef.current
    const ids = questionKey === '' ? [] : questionKey.split('|')
    if (!el || ids.length === 0) {
      setActiveId(null)
      return
    }
    const nodes = ids
      .map((id) => el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`))
      .filter((node): node is HTMLElement => node !== null)
    if (nodes.length === 0) {
      return
    }
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-message-id')
          if (!id) {
            continue
          }
          if (entry.isIntersecting) {
            visible.add(id)
          } else {
            visible.delete(id)
          }
        }
        // 判定带里最靠下的一条就是当前提问；没有命中时保留上一条，首次回落到第一条
        const current = ids.filter((id) => visible.has(id)).at(-1)
        setActiveId((previous) => current ?? previous ?? ids[0] ?? null)
      },
      // 顶部留出标题栏高度，底部只留一条很窄的带，等价于「跨过这条线」
      { root: el, rootMargin: `-${ACTIVE_OFFSET}px 0px -86% 0px`, threshold: 0 }
    )
    for (const node of nodes) {
      observer.observe(node)
    }
    return () => observer.disconnect()
  }, [questionKey, isMobile])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      onTopEdgeChange?.(el.scrollTop < EDGE_THRESHOLD)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onTopEdgeChange?.(el.scrollTop < EDGE_THRESHOLD)
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom, onTopEdgeChange])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div className={styles.root}>
        <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div ref={contentRef} className={styles.column} data-message-list>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )
              )}
            </div>
          </div>
          {footer}
        </div>
        {!isMobile && questionItems.length > 1 ? (
          <QuestionNav items={questionItems} activeId={activeId} onJump={jumpToQuestion} />
        ) : null}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
