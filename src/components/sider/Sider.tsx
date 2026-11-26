import clsx from 'clsx'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { IconFolder, IconSpark } from '../agent/ToolIcons.js'
import { openAgentPanel } from '../agent/agentPanelState.js'
import { isExtensionAvailable, subscribeExtension } from '../../services/agent/extension.js'
import { useDesktop } from '../../services/agent/desktop/store.js'
import { useMcp } from '../../services/agent/mcp/store.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions, groupSessionsByWorkspace } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import { archiveWorkspace, createWorkspace, removeWorkspace, renameWorkspace, setActiveWorkspace, useWorkspace } from '../../services/workspace/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { UsageCard } from './UsageCard.js'
import { useLiquidGlass } from '../glass/useLiquidGlass.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  // 聊天会话 = mode 为 chat 的那些；工作会话在另一个 tab
  const chatOnly = useMemo(() => sessions.filter((item) => item.mode === 'chat'), [sessions])
  const groups = useMemo(() => groupSessions(chatOnly, now, t), [chatOnly, now, t])
  const allEntries = useWorkspace((state) => state.entries)
  // 归档的不在侧栏占位置，去「设置 → 沙箱 → 归档」里管
  // 演示仓库是保底工作区，永远出现在列表里
  const entries = allEntries.filter((item) => !item.archived || item.id === 'demo')
  // 工作区 tab 收 mode 为 work 的会话；对话类留给聊天会话 tab
  const assigned = useMemo(() => sessions.filter((item) => item.mode === 'work'), [sessions])
  const workspaceGroups = useMemo(
    () => groupSessionsByWorkspace(assigned, entries, t('workspaceUngrouped')),
    [assigned, entries, t]
  )
  // 侧栏顶部两个 tab：工作区（按目录归类）/ 聊天会话（按时间）
  const [tab, setTab] = useState<'workspace' | 'chats'>('workspace')
  // 工作区管理：新建输入 + 管理面板
  const [wsCreating, setWsCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const [wsManaging, setWsManaging] = useState(false)
  // 每个工作区默认只显示 5 条，点「展开其余」临时看全部（离开侧栏就复位）
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set())
  // 每个工作区分组行右侧的 ⋯ 菜单开关
  const [menuFor, setMenuFor] = useState<Map<string, boolean>>(new Map())
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const desktopReady = useDesktop((state) => state.status === 'connected')
  const mcpReady = useMcp((state) =>
    Object.values(state.states).some((item) => item.status === 'ready')
  )
  const extensionReady = useSyncExternalStore(
    subscribeExtension,
    isExtensionAvailable,
    isExtensionAvailable
  )
  const liveCount = Number(desktopReady) + Number(mcpReady) + Number(extensionReady)
  // 侧边栏是液态玻璃：整块半透明，靠折射贴图把背后的极光折出厚度
  const glassRef = useLiquidGlass<HTMLDivElement>()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div ref={glassRef} className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.siderTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workspace'}
          className={clsx(styles.siderTab, tab === 'workspace' && styles.siderTabActive)}
          onClick={() => setTab('workspace')}
        >
          {t('workspaceSectionTitle')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chats'}
          className={clsx(styles.siderTab, tab === 'chats' && styles.siderTabActive)}
          onClick={() => setTab('chats')}
        >
          {t('workspaceChatSectionTitle')}
        </button>
      </div>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {tab === 'workspace' ? (
            <div className={styles.section}>
              <div className={styles.workspaceTools}>
                <span className={styles.workspaceToolsTitle}>{t('workspaceSectionTitle')}</span>
                <button
                  type="button"
                  className={styles.workspaceTool}
                  aria-label={t('workspaceCreate')}
                  onClick={() => setWsCreating((v) => !v)}
                >
                  +
                </button>
                <button
                  type="button"
                  className={styles.workspaceTool}
                  aria-label={t('workspaceManage')}
                  onClick={() => setWsManaging((v) => !v)}
                >
                  ⋯
                </button>
              </div>
              {wsCreating ? (
                <div className={styles.workspaceCreateRow}>
                  <input
                    className={styles.workspaceCreateInput}
                    value={wsName}
                    autoFocus
                    placeholder={t('workspaceNewName')}
                    onChange={(event) => setWsName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        const result = createWorkspace(wsName)
                        if (result.ok) {
                          setWsName('')
                          setWsCreating(false)
                        } else {
                          showToast({ key: 'workspaceExists', type: 'error' })
                        }
                      }
                      if (event.key === 'Escape') setWsCreating(false)
                    }}
                  />
                  <button
                    type="button"
                    className={styles.workspaceCreateOk}
                    onClick={() => {
                      const result = createWorkspace(wsName)
                      if (result.ok) {
                        setWsName('')
                        setWsCreating(false)
                      } else {
                        showToast({ key: 'workspaceExists', type: 'error' })
                      }
                    }}
                  >
                    {t('workspaceCreate')}
                  </button>
                </div>
              ) : null}
              {wsManaging ? (
                <div className={styles.workspaceManage}>
                  {entries.map((item) => (
                    <div key={item.id} className={styles.workspaceManageRow}>
                      <input
                        className={styles.workspaceManageInput}
                        defaultValue={item.name}
                        onBlur={(event) => {
                          if (event.target.value.trim() && event.target.value !== item.name) {
                            renameWorkspace(item.id, event.target.value)
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                        }}
                      />
                      <button
                        type="button"
                        className={styles.workspaceManageDelete}
                        onClick={() => {
                          void removeWorkspace(item.id).then((result) => {
                            if (!result.ok) {
                              showToast({
                                key: result.reason === 'protected' ? 'workspaceProtected' : 'workspaceRemoveFailed',
                                type: 'error',
                              })
                            }
                          })
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {workspaceGroups.length === 0 ? (
                <div className={styles.sectionHeader}>{t('workspaceNoGroups')}</div>
              ) : (
                workspaceGroups.map((group) => (
                  <div key={group.key} className={styles.workspaceGroup}>
                    <div className={styles.workspaceGroupHead}>
                      <button
                        type="button"
                        className={styles.workspaceGroupMain}
                        onClick={() => void setActiveWorkspace(group.key)}
                      >
                        <span className={styles.workspaceGroupIcon}>
                          <IconFolder />
                        </span>
                        <span className={styles.workspaceGroupName}>{group.name}</span>
                        <span className={styles.workspaceGroupCount}>{group.sessions.length}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.workspaceGroupMenu}
                        aria-label={t('workspaceManage')}
                        onClick={() => {
                          const next = new Map(menuFor)
                          next.set(group.key, !menuFor.get(group.key))
                          setMenuFor(next)
                        }}
                      >
                        ⋯
                      </button>
                      {menuFor.get(group.key) ? (
                        <div className={styles.workspaceMenu}>
                          <button
                            type="button"
                            className={styles.workspaceMenuItem}
                            onClick={() => {
                              newChat()
                              void setActiveWorkspace(group.key)
                              setMenuFor(new Map())
                            }}
                          >
                            {t('workspaceNewSession')}
                          </button>
                          <button
                            type="button"
                            className={styles.workspaceMenuItem}
                            onClick={() => {
                              const name = window.prompt(t('workspaceRenamePrompt'), group.name)
                              if (name) renameWorkspace(group.key, name)
                              setMenuFor(new Map())
                            }}
                          >
                            {t('workspaceRename')}
                          </button>
                          <button
                            type="button"
                            className={styles.workspaceMenuItem}
                            onClick={() => {
                              const ok = archiveWorkspace(group.key)
                              showToast(
                                ok
                                  ? { key: 'workspaceArchivedDone' }
                                  : { key: 'workspaceProtected', type: 'error' }
                              )
                              setMenuFor(new Map())
                            }}
                          >
                            {t('workspaceArchive')}
                          </button>
                          <button
                            type="button"
                            className={styles.workspaceMenuItemDanger}
                            onClick={() => {
                              void removeWorkspace(group.key).then((result) => {
                                if (!result.ok) {
                                  showToast({
                                    key: result.reason === 'protected' ? 'workspaceProtected' : 'workspaceRemoveFailed',
                                    type: 'error',
                                  })
                                }
                              })
                              setMenuFor(new Map())
                            }}
                          >
                            {t('workspaceDeleteGroup')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  {(expandedWorkspaces.has(group.key) ? group.sessions : group.sessions.slice(0, 5)).map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeId}
                        onDelete={() => setDeleting(session)}
                      />
                    ))}
                  {group.sessions.length > 5 && !expandedWorkspaces.has(group.key) ? (
                    <button
                      type="button"
                      className={styles.workspaceMore}
                      onClick={() => {
                        setExpandedWorkspaces((prev) => {
                          const next = new Set(prev)
                          next.add(group.key)
                          return next
                        })
                      }}
                    >
                      {t('workspaceShowMore', { count: group.sessions.length - 5 })}
                    </button>
                  ) : null}
                  </div>
                ))
              )}
            </div>
          ) : groups.length === 0 ? (
            <div className={styles.sectionHeader}>{t('workspaceNoUngroupedChats')}</div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={`chat-${session.id}`}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openAgentPanel()}>
          <span className={styles.settingsIcon}>
            <IconSpark />
          </span>
          <span className={styles.settingsLabel}>{t('agentPanelTitle')}</span>
          <span
            className={styles.liveDot}
            data-live={liveCount > 0}
            title={liveCount > 0 ? t('agentConnected') : t('agentDisconnected')}
          />
        </button>
        <button type="button" className={styles.settings} onClick={() => openSettings('account')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
        <UsageCard />
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
