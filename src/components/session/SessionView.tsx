import clsx from 'clsx'
import { useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { LiveStatsBar } from '../chatInput/LiveStatsBar.js'
import { ProgressiveBlur } from '../base/ProgressiveBlur.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  // 列表还在顶部时不需要顶部模糊，否则第一条消息会被糊掉
  const [atTop, setAtTop] = useState(true)
  return (
    <div className={styles.view}>
      {/* 顶部：消息滚到标题下面时逐级虚化，标题栏不再需要实底色 */}
      <ProgressiveBlur
        direction="top"
        height={104}
        blur={15}
        tint={0.38}
        className={clsx(styles.topBlur, !atTop && styles.topBlurVisible)}
        style={{ zIndex: 5 }}
      />
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        onTopEdgeChange={setAtTop}
        footer={
          <div className={styles.inputContainer}>
            {/* 底部：输入框上方的消息渐隐，输入框作为玻璃层压在上面 */}
            <ProgressiveBlur
              direction="bottom"
              blur={15}
              tint={0.42}
              className={styles.bottomBlur}
              style={{ top: -62, bottom: 0, zIndex: -1 }}
            />
            <ChatInput sessionId={session.id} />
            <LiveStatsBar sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
