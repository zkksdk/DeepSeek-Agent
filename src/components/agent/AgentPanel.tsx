import clsx from 'clsx'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { IconPlug, IconSpark, toolIcon } from './ToolIcons.js'
import { getToolsRevision, listTools, subscribeTools } from '../../services/agent/registry.js'
import { needsApproval, sourceLabel, type ToolSource } from '../../services/agent/types.js'
import { isExtensionAvailable, subscribeExtension } from '../../services/agent/extension.js'
import {
  connectDesktop,
  disconnectDesktop,
  setDesktopAutoConnect,
  useDesktop,
} from '../../services/agent/desktop/store.js'
import {
  addServer,
  connectServer,
  disconnectServer,
  removeServer,
  useMcp,
} from '../../services/agent/mcp/store.js'
import type { McpServerConfig, McpServerState } from '../../services/agent/mcp/types.js'
import {
  closeAgentPanel,
  setAgentPanelTab,
  useAgentPanel,
  type AgentPanelTab,
} from './agentPanelState.js'
import styles from './AgentPanel.module.css'

const TABS: { key: AgentPanelTab; label: 'agentPanelTools' | 'agentPanelMcp' | 'agentPanelDesktop' }[] = [
  { key: 'tools', label: 'agentPanelTools' },
  { key: 'mcp', label: 'agentPanelMcp' },
  { key: 'connect', label: 'agentPanelDesktop' },
]

/** Agent 控制台：工具清单、MCP 服务器与本地连接 */
export const AgentPanel = () => {
  const t = useTranslate()
  const open = useAgentPanel((state) => state.open)
  const tab = useAgentPanel((state) => state.tab)
  // 注册表不是 zustand，用版本号驱动重渲染
  const revision = useSyncExternalStore(subscribeTools, getToolsRevision, getToolsRevision)
  // revision 变化即注册表变化，用它作为重算依据
  const tools = useMemo(() => (revision >= 0 ? listTools() : []), [revision])

  if (!open) {
    return null
  }

  return (
    <Modal
      title={
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <IconSpark />
          </span>
          <span className={styles.titleText}>
            {t('agentPanelTitle')}
            <span className={styles.subtitle}>{t('agentPanelSubtitle')}</span>
          </span>
        </span>
      }
      onClose={closeAgentPanel}
      closable
      className={styles.panel}
      mainClassName={styles.main}
      footer={null}
    >
      <div className={styles.tabs} role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={clsx(styles.tab, tab === item.key && styles.tabActive)}
            onClick={() => setAgentPanelTab(item.key)}
          >
            {t(item.label)}
            {item.key === 'tools' ? <span className={styles.tabCount}>{tools.length}</span> : null}
          </button>
        ))}
      </div>
      <div className={styles.body}>
        {tab === 'tools' ? <ToolsTab /> : null}
        {tab === 'mcp' ? <McpTab /> : null}
        {tab === 'connect' ? <ConnectTab /> : null}
      </div>
    </Modal>
  )
}

const ToolsTab = () => {
  const t = useTranslate()
  const definitions = listTools()
  if (definitions.length === 0) {
    return <div className={styles.empty}>{t('agentToolsEmpty')}</div>
  }
  const groups = new Map<string, typeof definitions>()
  for (const definition of definitions) {
    const key = `${definition.source}:${definition.serverName ?? ''}`
    const list = groups.get(key) ?? []
    list.push(definition)
    groups.set(key, list)
  }
  return (
    <div className={styles.groups}>
      {[...groups.entries()].map(([key, list]) => {
        const [source, serverName] = key.split(':')
        return (
          <div key={key} className={styles.group}>
            <div className={styles.groupHead}>
              <span className={styles.groupName}>
                {serverName || sourceLabel(source as ToolSource)}
              </span>
              <span className={styles.groupCount}>{list.length}</span>
            </div>
            <div className={styles.toolList}>
              {list.map((definition) => (
                <div key={definition.name} className={styles.tool}>
                  <span className={styles.toolIcon} data-source={definition.source}>
                    {toolIcon(definition.name, definition.source)}
                  </span>
                  <span className={styles.toolInfo}>
                    <span className={styles.toolName}>
                      {definition.label}
                      {needsApproval(definition) ? (
                        <span className={styles.approval}>{t('agentApprovalTitle')}</span>
                      ) : null}
                    </span>
                    <span className={styles.toolDesc}>{definition.description}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const McpTab = () => {
  const t = useTranslate()
  const servers = useMcp((state) => state.servers)
  const states = useMcp((state) => state.states)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [transport, setTransport] = useState<'http' | 'sse'>('http')
  const [headers, setHeaders] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      setError(t('agentMcpInvalid'))
      return
    }
    if (!name.trim()) {
      setError(t('agentMcpInvalid'))
      return
    }
    let extra: Record<string, string> | undefined
    if (headers.trim()) {
      try {
        const value: unknown = JSON.parse(headers)
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('invalid')
        }
        extra = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, String(val)])
        )
      } catch {
        setError(t('agentMcpInvalid'))
        return
      }
    }
    const config = addServer({
      name: name.trim(),
      transport,
      url: parsed.href,
      headers: extra,
    })
    setAdding(false)
    setName('')
    setUrl('')
    setHeaders('')
    await connectServer(config.id)
  }

  return (
    <div className={styles.mcp}>
      <div className={styles.mcpHead}>
        <span className={styles.mcpHint}>{t('agentMcpHint')}</span>
        <Button variant="outlined" size="s" onClick={() => setAdding((value) => !value)}>
          {t('agentMcpAdd')}
        </Button>
      </div>

      {adding ? (
        <div className={styles.form}>
          <label className={styles.field}>
            <span>{t('agentMcpName')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('agentMcpNamePlaceholder')} />
          </label>
          <label className={styles.field}>
            <span>{t('agentMcpTransport')}</span>
            <select
              value={transport}
              onChange={(event) => setTransport(event.target.value as 'http' | 'sse')}
            >
              <option value="http">Streamable HTTP</option>
              <option value="sse">HTTP + SSE</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('agentMcpUrl')}</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t('agentMcpUrlPlaceholder')} />
          </label>
          <label className={styles.field}>
            <span>{t('agentMcpHeaders')}</span>
            <textarea
              rows={2}
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              placeholder='{"Authorization":"Bearer ..."}'
            />
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.formActions}>
            <Button variant="outlined" size="s" onClick={() => setAdding(false)}>
              {t('agentMcpCancel')}
            </Button>
            <Button variant="primary" size="s" onClick={() => void submit()}>
              {t('agentMcpSave')}
            </Button>
          </div>
        </div>
      ) : null}

      {servers.length === 0 && !adding ? <div className={styles.empty}>{t('agentMcpEmpty')}</div> : null}

      <div className={styles.serverList}>
        {servers.map((server) => (
          <ServerRow key={server.id} server={server} state={states[server.id]} />
        ))}
      </div>
    </div>
  )
}

const ServerRow = ({
  server,
  state,
}: {
  server: McpServerConfig
  state: McpServerState | undefined
}) => {
  const t = useTranslate()
  const status = state?.status ?? 'idle'
  return (
    <div className={styles.server} data-status={status}>
      <span className={styles.serverDot} />
      <span className={styles.serverInfo}>
        <span className={styles.serverName}>
          {server.name}
          {status === 'ready' && state?.tools.length ? (
            <span className={styles.serverTools}>
              {t('agentMcpTools', { count: state.tools.length })}
            </span>
          ) : null}
        </span>
        <span className={styles.serverUrl}>
          {server.transport.toUpperCase()} · {server.url}
        </span>
        {state?.error ? <span className={styles.serverError}>{state.error}</span> : null}
      </span>
      <span className={styles.serverActions}>
        {status === 'ready' || status === 'connecting' ? (
          <Button variant="outlined" size="s" onClick={() => disconnectServer(server.id)}>
            {t('agentMcpDisconnect')}
          </Button>
        ) : (
          <Button variant="primary" size="s" onClick={() => void connectServer(server.id)}>
            {t('agentMcpConnect')}
          </Button>
        )}
        <button
          type="button"
          className={styles.remove}
          aria-label={t('agentMcpRemove')}
          onClick={() => removeServer(server.id)}
        >
          ×
        </button>
      </span>
    </div>
  )
}

const ConnectTab = () => {
  const t = useTranslate()
  const desktop = useDesktop()
  const extension = useSyncExternalStore(subscribeExtension, isExtensionAvailable, isExtensionAvailable)
  const [url, setUrl] = useState(desktop.url)
  const [token, setToken] = useState(desktop.token)
  const [showToken, setShowToken] = useState(false)

  return (
    <div className={styles.connect}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>
            {t('agentPanelDesktop')}
            <span className={styles.status} data-status={desktop.status}>
              {desktop.status === 'connected'
                ? t('agentConnected')
                : desktop.status === 'connecting'
                  ? t('agentConnecting')
                  : desktop.status === 'error'
                    ? t('agentConnectFailed')
                    : t('agentDisconnected')}
            </span>
          </span>
          {desktop.info ? (
            <span className={styles.cardMeta}>
              v{desktop.info.version} · {desktop.info.platform}
            </span>
          ) : null}
        </div>
        <p className={styles.cardDesc}>{t('agentDesktopHint')}</p>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>{t('agentDesktopUrl')}</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
          </label>
          <label className={styles.field}>
            <span>{t('agentDesktopToken')}</span>
            <div className={styles.secret}>
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                spellCheck={false}
              />
              <button type="button" onClick={() => setShowToken((value) => !value)}>
                {showToken ? '🙈' : '👁'}
              </button>
            </div>
          </label>
        </div>
        {desktop.info ? (
          <div className={styles.infoRow}>
            <span>
              {t('agentDesktopSandbox')}：<code>{desktop.info.sandbox}</code>
            </span>
            {desktop.info.allowed?.length ? (
              <span>
                {t('agentDesktopAllowed')}：<code>{desktop.info.allowed.join(' · ')}</code>
              </span>
            ) : null}
            <span>{t('agentDesktopTools', { count: desktop.toolCount })}</span>
          </div>
        ) : null}
        {desktop.error ? <div className={styles.error}>{desktop.error}</div> : null}
        <div className={styles.cardActions}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={desktop.autoConnect}
              onChange={(event) => setDesktopAutoConnect(event.target.checked)}
            />
            {t('agentDesktopAuto')}
          </label>
          <span className={styles.grow} />
          {desktop.status === 'connected' ? (
            <Button variant="outlined" size="s" onClick={disconnectDesktop}>
              {t('agentDesktopDisconnect')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="s"
              disabled={desktop.status === 'connecting'}
              onClick={() => void connectDesktop(url.trim(), token.trim())}
            >
              {desktop.status === 'connecting' ? t('agentConnecting') : t('agentDesktopConnect')}
            </Button>
          )}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>
            {t('agentPanelExtension')}
            <span className={styles.status} data-status={extension ? 'ready' : 'idle'}>
              {extension ? t('agentConnected') : t('agentExtensionMissing')}
            </span>
          </span>
          <span className={styles.cardMeta}>Chrome / Edge · MV3</span>
        </div>
        <p className={styles.cardDesc}>
          {extension ? t('agentExtensionFound') : t('agentExtensionHint')}
        </p>
        <div className={styles.chips}>
          {t('agentExtensionActions')
            .split(' · ')
            .map((item) => (
              <span key={item} className={styles.chip}>
                {item}
              </span>
            ))}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>
            <IconPlug />
            MCP
          </span>
        </div>
        <p className={styles.cardDesc}>{t('agentMcpHint')}</p>
        <button type="button" className={styles.linkButton} onClick={() => setAgentPanelTab('mcp')}>
          {t('agentPanelMcp')} →
        </button>
      </section>
    </div>
  )
}
