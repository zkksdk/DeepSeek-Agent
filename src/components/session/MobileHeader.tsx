import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useChatStore, setSessionMode } from '../../services/chat/store.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { openWorkspacePanel } from '../workspace/workspacePanelState.js'
import { IconFolder } from '../agent/ToolIcons.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题与开启新对话 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  // 当前会话的模式；没打开会话时不显示这个胶囊
  const activeId = useChatStore((state) => state.activeId)
  const mode = useChatStore((state) =>
    state.sessions.find((item) => item.id === state.activeId)?.mode
  )
  const sessionMode = activeId ? (mode ?? 'work') : null
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? (
        <>
          <span className={styles.spacer} />
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconFolder />}
            aria-label={t('workspaceOpenPanel')}
            onClick={openWorkspacePanel}
          />
        </>
      ) : null}
      {title === undefined ? null : (
        <>
          <div className={styles.title}>{title}</div>
          {sessionMode === null ? null : (
            <button
              type="button"
              className={styles.modeBadge}
              data-mode={sessionMode}
              aria-label={t('sessionModeToggle')}
              onClick={() =>
                activeId &&
                setSessionMode(activeId, sessionMode === 'work' ? 'chat' : 'work')
              }
            >
              {sessionMode === 'work' ? t('modeWork') : t('modeChat')}
            </button>
          )}
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        </>
      )}
    </div>
  )
}
