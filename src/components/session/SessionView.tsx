import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { TrajectoryPanel } from '../trajectory/TrajectoryPanel.js'
import { toggleTrajectoryPanel, useTrajectoryPanel } from '../trajectory/trajectoryState.js'
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
  const traceOpen = useTrajectoryPanel((state) => state.open)
  return (
    <div className={styles.view}>
      <div className={styles.mainCol}>
        {isMobile ? <MobileHeader title={title} /> : (
          <div className={styles.header}>
            <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
              {title}
            </div>
            <button
              type="button"
              className={clsx(styles.traceButton, traceOpen && styles.traceButtonActive)}
              onClick={toggleTrajectoryPanel}
              aria-pressed={traceOpen}
            >
              {t('trajectoryToggle')}
            </button>
          </div>
        )}
        {isMobile ? (
          <button
            type="button"
            className={clsx(styles.mobileTraceButton, traceOpen && styles.traceButtonActive)}
            onClick={toggleTrajectoryPanel}
          >
            {t('trajectoryToggle')}
          </button>
        ) : null}
        <MessageList
          session={session}
          streaming={streaming}
          footer={
            <div className={styles.inputContainer}>
              <ChatInput sessionId={session.id} />
              <div className={styles.caveat}>{t('contentCaveat')}</div>
            </div>
          }
        />
      </div>
      <TrajectoryPanel session={session} />
    </div>
  )
}
