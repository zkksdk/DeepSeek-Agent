import { useSyncExternalStore } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { LiveStatsBar } from '../chatInput/LiveStatsBar.js'
import { MobileHeader } from './MobileHeader.js'
import { setDraftText } from '../../services/chat/drafts.js'
import { setAgentEnabled, useSettings } from '../../services/settings.js'
import { listTools, subscribeTools } from '../../services/agent/registry.js'
import { isExtensionAvailable, subscribeExtension } from '../../services/agent/extension.js'
import { useDesktop } from '../../services/agent/desktop/store.js'
import { useMcp } from '../../services/agent/mcp/store.js'
import { openAgentPanel } from '../agent/agentPanelState.js'
import { IconDesktop, IconMcp, IconPuzzle, IconSpark } from '../agent/ToolIcons.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 能力概览 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  // 对话 = 纯聊天；工作 = 允许模型调工具（Agent）
  const agentEnabled = useSettings((state) => state.agentEnabled)
  const isMobile = useIsMobile()
  const toolCount = useSyncExternalStore(
    subscribeTools,
    () => listTools().length,
    () => 0
  )
  const extensionReady = useSyncExternalStore(
    subscribeExtension,
    isExtensionAvailable,
    isExtensionAvailable
  )
  const desktopReady = useDesktop((state) => state.status === 'connected')
  const mcpReady = useMcp((state) =>
    Object.values(state.states).some((item) => item.status === 'ready')
  )

  const quick = [
    { key: 'agentQuickWeather', text: t('agentQuickWeather') },
    { key: 'agentQuickPage', text: t('agentQuickPage') },
    { key: 'agentQuickFile', text: t('agentQuickFile') },
    { key: 'agentQuickTime', text: t('agentQuickTime') },
  ]

  const fill = (text: string) => {
    setDraftText(null, text)
    document.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  }

  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Agent Runtime
          <span className={styles.badgeSep} />
          Tools · MCP · Devices
        </div>
        <h1 className={styles.greeting}>
          <span className={styles.greetingText}>{t('welcomeMessageChat250808')}</span>
        </h1>
        <p className={styles.tagline}>{t('agentWelcomeTagline')}</p>

        <div className={styles.modeTabs} role="tablist">
          <button
            type="button"
            role="tab"
            className={styles.modeTab}
            aria-selected={!agentEnabled}
            data-active={!agentEnabled || undefined}
            onClick={() => setAgentEnabled(false)}
          >
            {t('modeChat')}
          </button>
          <button
            type="button"
            role="tab"
            className={styles.modeTab}
            aria-selected={agentEnabled}
            data-active={agentEnabled || undefined}
            onClick={() => setAgentEnabled(true)}
          >
            {t('modeWork')}
          </button>
        </div>

        <div className={styles.caps}>
          <button
            type="button"
            className={styles.cap}
            data-live={toolCount > 0}
            onClick={() => openAgentPanel('tools')}
          >
            <IconSpark />
            {toolCount} {t('agentWelcomeTools')}
            <span className={styles.capDot} />
          </button>
          <button
            type="button"
            className={styles.cap}
            data-live={desktopReady}
            onClick={() => openAgentPanel('connect')}
          >
            <IconDesktop />
            {t('agentWelcomeDesktop')}
            <span className={styles.capDot} />
          </button>
          <button
            type="button"
            className={styles.cap}
            data-live={extensionReady}
            onClick={() => openAgentPanel('connect')}
          >
            <IconPuzzle />
            {t('agentWelcomeExtension')}
            <span className={styles.capDot} />
          </button>
          <button
            type="button"
            className={styles.cap}
            data-live={mcpReady}
            onClick={() => openAgentPanel('mcp')}
          >
            <IconMcp />
            MCP
            <span className={styles.capDot} />
          </button>
        </div>

        <div className={styles.inputWrap}>
          <ChatInput sessionId={null} />
          <LiveStatsBar sessionId={null} />
        </div>

          <div className={styles.quick} data-mobile={isMobile || undefined}>
            {quick.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={styles.quickCard}
                style={{ animationDelay: `${180 + index * 45}ms` }}
                onClick={() => fill(item.text)}
              >
                <span className={styles.quickText}>{item.text}</span>
                <span className={styles.quickArrow}>↗</span>
              </button>
            ))}
          </div>
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
