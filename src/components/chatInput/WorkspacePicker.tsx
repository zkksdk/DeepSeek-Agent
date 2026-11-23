import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  useWorkspace,
  setActiveWorkspace,
  openLocalWorkspace,
} from '../../services/workspace/store.js'
import { setDesktopPlane, setWebPlane, useWorkspacePlane } from '../../services/workspace/plane.js'
import {
  refreshDesktopInfo,
  switchDesktopWorkspace,
  useDesktop,
} from '../../services/agent/desktop/store.js'
import { showToast } from '../base/toastState.js'
import { PillPicker } from './PillPicker.js'
import { IconDesktop, IconFolder } from '../agent/ToolIcons.js'
import styles from './PillPicker.module.css'

/** 本机工作区在选择器里的值前缀，与网页工作区的 id 区分开 */
const DESKTOP_PREFIX = 'desktop:'

/**
 * 工作区选择器：一次只用一个工作区，具体用哪个由用户在聊天框处决定。
 * 同时列出网页工作区（演示仓库、本地文件夹）与本机工作区（桌面端的沙箱根）。
 *
 * 选中的「平面」会持久化：连着桌面端时不再强行显示本机目录，
 * 用户选网页工作区就是网页工作区。
 */
export const WorkspacePicker = () => {
  const t = useTranslate()
  const entries = useWorkspace((state) => state.entries)
  const activeId = useWorkspace((state) => state.activeId)
  const loading = useWorkspace((state) => state.loading)
  const plane = useWorkspacePlane()
  const desktop = useDesktop()
  const connected = desktop.status === 'connected'
  // 直接使用桌面端上报的列表；是否排除配置目录由桌面端决定
  const desktopWorkspaces = connected ? (desktop.info?.workspaces ?? []) : []
  // 当前工作区以桌面端的 current 标记为准，其次退回 sandbox
  const currentPath =
    desktopWorkspaces.find((item) => item.current)?.path ?? desktop.info?.sandbox ?? null
  const planePath = plane.kind === 'desktop' ? plane.path : null

  /*
   * 断开时保留「桌面端」这个选择：value 在断线期间会显示网页工作区，
   * 重连后自动回到桌面端的当前目录，不用用户再选一次。
   */

  // 桌面端换了工作区（重启、改配置、别处切换）时，选择器跟着走，不停在旧路径
  useEffect(() => {
    if (connected && planePath && currentPath && planePath !== currentPath) {
      setDesktopPlane(currentPath)
    }
  }, [connected, planePath, currentPath])

  const value =
    plane.kind === 'desktop' && connected
      ? `${DESKTOP_PREFIX}${currentPath ?? planePath ?? ''}`
      : activeId

  const desktopOptions = desktopWorkspaces.map((item) => ({
    value: `${DESKTOP_PREFIX}${item.path}`,
    label: item.name || item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path,
    description: `${t('agentPanelDesktop')} · ${item.path}`,
    icon: <IconDesktop />,
  }))
  // 当前沙箱不在列表里（旧版桌面端只报配置里的目录）时补一项，避免显示空白
  if (currentPath && !desktopWorkspaces.some((item) => item.path === currentPath)) {
    desktopOptions.unshift({
      value: `${DESKTOP_PREFIX}${currentPath}`,
      label: currentPath.split(/[\\/]/).filter(Boolean).at(-1) || currentPath,
      description: `${t('agentPanelDesktop')} · ${currentPath}`,
      icon: <IconDesktop />,
    })
  }

  return (
    <PillPicker
      icon={plane.kind === 'desktop' && connected ? <IconDesktop /> : <IconFolder />}
      value={value}
      disabled={loading}
      onOpen={() => void refreshDesktopInfo()}
      options={[
        ...entries.map((entry) => ({
          value: entry.id,
          label: entry.name,
          description:
            entry.source === 'demo'
              ? `${t('workspacePickerDemo')} · ${entry.branch}`
              : `${entry.branch} · ${entry.root}`,
        })),
        ...desktopOptions,
      ]}
      onChange={(next) => {
        if (!next.startsWith(DESKTOP_PREFIX)) {
          setWebPlane()
          setActiveWorkspace(next)
          return
        }
        const path = next.slice(DESKTOP_PREFIX.length)
        void switchDesktopWorkspace(path).then((ok) => {
          if (!ok) {
            showToast({ key: 'agentConnectFailed', type: 'error' })
            return
          }
          setDesktopPlane(path)
        })
      }}
      footer={
        <button
          type="button"
          className={styles.option}
          onClick={() => {
            setWebPlane()
            void openLocalWorkspace()
          }}
        >
          <span className={styles.optionIcon}>
            <IconFolder />
          </span>
          <span className={styles.optionBody}>
            <span className={styles.optionLabel}>{t('workspacePickerAdd')}</span>
          </span>
        </button>
      }
    />
  )
}
