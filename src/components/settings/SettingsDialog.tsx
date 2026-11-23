import clsx from 'clsx'
import { useRef, useState, useEffect, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setLocale,
  setLocation,
  setModel,
  setApiOrigin,
  setAgentMode,
  setAutoMemory,
  setMemorySpark,
  setToolEnabled,
  setThemePreference,
  setTtsVoice,
  useSettings,
  DEFAULT_MODEL,
  type ThemePreference,
} from '../../services/settings.js'
import { DEFAULT_API_ORIGIN } from '../../services/api/runtimeConfig.js'
import { listModels } from '../../services/api/client.js'
import { AGENT_TOOLS } from '../../services/agent/tools.js'
import { buildPlugins, type AgentPlugin, type PluginSource } from '../../services/agent/plugin.js'
import {
  addMemory,
  clearMemories,
  mergeSimilarMemories,
  readMemories,
  removeMemory,
  updateMemory,
  type MemoryItem,
} from '../../services/agent/memory.js'
import { saveBlob } from '../../services/platform/download.js'
import {
  addMcpServer,
  connectMcpServer,
  readMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
} from '../../services/agent/mcp.js'
import {
  addHttpSkill,
  parseHttpSkill,
  readHttpSkills,
  removeHttpSkill,
  setHttpSkillEnabled,
} from '../../services/agent/skills.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'tools', label: 'settingDialogAsideToolsOptionLabel', icon: <IconThinkOutline16 /> },
  { value: 'memory', label: 'settingDialogAsideMemoryOptionLabel', icon: <IconBrowseOutline16 /> },
  {
    value: 'integrations',
    label: 'settingDialogAsideIntegrationsOptionLabel',
    icon: <IconLinkOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ModelSetting />
              <AgentModeSetting />
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
            </>
          ) : section === 'tools' ? (
            <ToolsSettings />
          ) : section === 'memory' ? (
            <MemorySettings />
          ) : section === 'integrations' ? (
            <IntegrationsSettings />
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
/** 模型与 API 地址：可自定义任意模型名和 Anthropic 兼容服务地址，留空则用默认 */
const ModelSetting = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const apiOrigin = useSettings((state) => state.apiOrigin)
  const [modelInput, setModelInput] = useState(model)
  const [originInput, setOriginInput] = useState(apiOrigin)
  const [models, setModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    setModelInput(model)
  }, [model])
  useEffect(() => {
    setOriginInput(apiOrigin)
  }, [apiOrigin])

  /** 用已保存的 API Key 拉取服务端模型列表 */
  const fetchModels = async () => {
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      setFetchError(t('modelFetchNeedApiKey'))
      return
    }
    setFetching(true)
    setFetchError(null)
    try {
      const list = await listModels(apiKey)
      setModels(list)
      if (list.length === 0) {
        setFetchError(t('modelFetchEmpty'))
      }
    } catch (error) {
      setFetchError(
        `${t('modelFetchFailed')}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setFetching(false)
    }
  }

  const modelOptions = models.map((item) => ({ value: item, label: item }))

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('modelSettingLabel')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={DEFAULT_MODEL}
            autoComplete="off"
            spellCheck={false}
            value={modelInput}
            onChange={(event) => setModelInput(event.target.value)}
            onBlur={() => setModel(modelInput)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                setModel(modelInput)
              }
            }}
          />
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.confirm}
            disabled={fetching}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void fetchModels()}
          >
            {fetching ? t('modelFetching') : t('modelFetch')}
          </button>
        </div>
        {fetchError ? <div className={styles.error}>{fetchError}</div> : null}
        {modelOptions.length > 0 ? (
          <Select
            value={modelInput}
            options={modelOptions}
            onChange={(value) => {
              setModelInput(value)
              setModel(value)
            }}
            placeholder={t('modelSelectPlaceholder')}
            ariaLabel={t('modelSettingLabel')}
          />
        ) : null}
        <div className={styles.description}>{t('modelSettingDescription')}</div>
        <div className={styles.label}>{t('apiOriginSettingLabel')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={DEFAULT_API_ORIGIN}
            autoComplete="off"
            spellCheck={false}
            value={originInput}
            onChange={(event) => setOriginInput(event.target.value)}
            onBlur={() => {
              setApiOrigin(originInput)
              // 地址变更后之前的模型列表不再可靠
              setModels([])
              setFetchError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                setApiOrigin(originInput)
              }
            }}
          />
        </div>
        <div className={styles.description}>{t('apiOriginSettingDescription')}</div>
      </div>
    </div>
  )
}

/** 智能体模式：开启后模型可自主调用本地工具并多步推理 */
const AgentModeSetting = () => {
  const t = useTranslate()
  const agentMode = useSettings((state) => state.agentMode)
  return (
    <SettingCell
      label={t('agentModeLabel')}
      description={t('agentModeDescription')}
      status={null}
      action={
        <Button
          variant={agentMode ? 'primary' : 'outlined'}
          size="m"
          className={styles.cellButton}
          onClick={() => setAgentMode(!agentMode)}
        >
          {t(agentMode ? 'agentModeOn' : 'agentModeOff')}
        </Button>
      }
    />
  )
}

/** 接入：MCP 服务器与自定义技能（HTTP 工具） */
const IntegrationsSettings = () => {
  const t = useTranslate()
  const [, forceRender] = useState(0)
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [status, setStatus] = useState<Record<string, string>>({})
  const [skillJson, setSkillJson] = useState('')
  const [skillError, setSkillError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const servers = readMcpServers()
  const skills = readHttpSkills()

  const connect = async (serverId: string) => {
    const server = readMcpServers().find((item) => item.id === serverId)
    if (!server) {
      return
    }
    setBusyId(serverId)
    setStatus((prev) => ({ ...prev, [serverId]: t('mcpConnecting') }))
    try {
      const tools = await connectMcpServer(server)
      setStatus((prev) => ({ ...prev, [serverId]: `${tools.length} ${t('mcpToolCount')}` }))
    } catch (error) {
      setStatus((prev) => ({
        ...prev,
        [serverId]: `${t('mcpConnectFailed')}：${error instanceof Error ? error.message : String(error)}`,
      }))
    } finally {
      setBusyId(null)
    }
  }

  const submitMcp = () => {
    if (!addMcpServer(mcpName, mcpUrl)) {
      setStatus((prev) => ({ ...prev, _add: t('mcpAddInvalid') }))
      return
    }
    setMcpName('')
    setMcpUrl('')
    forceRender((value) => value + 1)
  }

  const submitSkill = () => {
    const { skill, error } = parseHttpSkill(skillJson)
    if (!skill) {
      setSkillError(error ?? t('skillInvalid'))
      return
    }
    addHttpSkill(skill)
    setSkillJson('')
    setSkillError(null)
    forceRender((value) => value + 1)
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('mcpServersTitle')}</div>
        <div className={styles.description}>{t('mcpServersDescription')}</div>
      </div>
      {servers.map((server) => (
        <div key={server.id} className={clsx(styles.cell, styles.toolRow)}>
          <div className={styles.text}>
            <div className={styles.toolName}>{server.name}</div>
            <div className={styles.description}>{server.url}</div>
            {status[server.id] ? <div className={styles.description}>{status[server.id]}</div> : null}
          </div>
          <div className={styles.toolActions}>
            <Button
              variant={server.enabled ? 'primary' : 'outlined'}
              size="m"
              onClick={() => {
                setMcpServerEnabled(server.id, !server.enabled)
                forceRender((value) => value + 1)
              }}
            >
              {t(server.enabled ? 'toolEnabled' : 'toolDisabled')}
            </Button>
            <Button
              variant="outlined"
              size="m"
              disabled={busyId === server.id || !server.enabled}
              onClick={() => void connect(server.id)}
            >
              {busyId === server.id ? t('mcpConnecting') : t('mcpConnect')}
            </Button>
            <Button
              variant="dangerOutlined"
              size="m"
              onClick={() => {
                removeMcpServer(server.id)
                forceRender((value) => value + 1)
              }}
            >
              {t('delete')}
            </Button>
          </div>
        </div>
      ))}
      <div className={styles.cell}>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={t('mcpNamePlaceholder')}
            value={mcpName}
            onChange={(event) => setMcpName(event.target.value)}
          />
        </div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={t('mcpUrlPlaceholder')}
            value={mcpUrl}
            onChange={(event) => setMcpUrl(event.target.value)}
          />
        </div>
        {status._add ? <div className={styles.error}>{status._add}</div> : null}
        <Button variant="primary" size="m" className={styles.cellButton} onClick={submitMcp}>
          {t('mcpAdd')}
        </Button>
      </div>

      <div className={styles.cell}>
        <div className={styles.label}>{t('skillsTitle')}</div>
        <div className={styles.description}>{t('skillsDescription')}</div>
      </div>
      {skills.map((skill) => (
        <div key={skill.id} className={clsx(styles.cell, styles.toolRow)}>
          <div className={styles.text}>
            <div className={styles.toolName}>{skill.name}</div>
            <div className={styles.description}>{skill.description}</div>
          </div>
          <Button
            variant={skill.enabled ? 'primary' : 'outlined'}
            size="m"
            onClick={() => {
              setHttpSkillEnabled(skill.id, !skill.enabled)
              forceRender((value) => value + 1)
            }}
          >
            {t(skill.enabled ? 'toolEnabled' : 'toolDisabled')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            onClick={() => {
              removeHttpSkill(skill.id)
              forceRender((value) => value + 1)
            }}
          >
            {t('delete')}
          </Button>
        </div>
      ))}
      <div className={styles.cell}>
        <textarea
          className={styles.skillTextarea}
          placeholder={t('skillJsonPlaceholder')}
          value={skillJson}
          onChange={(event) => setSkillJson(event.target.value)}
        />
        {skillError ? <div className={styles.error}>{skillError}</div> : null}
        <Button variant="primary" size="m" className={styles.cellButton} onClick={submitSkill}>
          {t('skillAdd')}
        </Button>
      </div>
    </>
  )
}

/** 插件总览：把内置工具 / 技能 / MCP 统一展示 */
const PluginOverview = () => {
  const t = useTranslate()
  const [plugins, setPlugins] = useState<AgentPlugin[] | null>(null)

  useEffect(() => {
    let alive = true
    void buildPlugins()
      .then((list) => {
        if (alive) {
          setPlugins(list)
        }
      })
      .catch(() => {
        if (alive) {
          setPlugins([])
        }
      })
    return () => {
      alive = false
    }
  }, [])

  const sourceLabel = (source: PluginSource) =>
    t(
      source === 'builtin'
        ? 'pluginSourceBuiltin'
        : source === 'skill'
          ? 'pluginSourceSkill'
          : source === 'mcp'
            ? 'pluginSourceMcp'
            : 'pluginSourceAgent'
    )

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('pluginOverviewTitle')}</div>
        <div className={styles.description}>{t('pluginOverviewDescription')}</div>
      </div>
      {plugins === null ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('pluginLoading')}</div>
        </div>
      ) : plugins.length === 0 ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('pluginEmpty')}</div>
        </div>
      ) : (
        plugins.map((plugin) => (
          <div key={plugin.id} className={clsx(styles.cell, styles.toolRow)}>
            <div className={styles.text}>
              <div className={styles.toolName}>{plugin.name}</div>
              <div className={styles.description}>
                {sourceLabel(plugin.source)} · {plugin.tools().length} {t('pluginToolCount')}
              </div>
            </div>
            <div className={styles.description}>
              {t(plugin.enabled() ? 'toolEnabled' : 'toolDisabled')}
            </div>
          </div>
        ))
      )}
    </>
  )
}

/** 长期记忆管理：查看 / 删除 / 手动添加 */
/** 记忆管理：统计 / 搜索 / 编辑 / 删除 / 清空 */
/** 工具管理：逐个开关智能体可调用的工具 */
const ToolsSettings = () => {
  const t = useTranslate()
  return (
    <>
      <PluginOverview />
      <div className={styles.cell}>
        <div className={styles.label}>{t('toolsSettingsTitle')}</div>
        <div className={styles.description}>{t('toolsSettingsDescription')}</div>
      </div>
      {AGENT_TOOLS.map((tool) => (
        <ToolRow key={tool.name} name={tool.name} description={tool.description} />
      ))}
    </>
  )
}

const ToolRow = ({ name, description }: { name: string; description: string }) => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.toolOverrides[name] !== false)
  return (
    <div className={clsx(styles.cell, styles.toolRow)}>
      <div className={styles.text}>
        <div className={styles.toolName}>{name}</div>
        <div className={styles.description}>{description}</div>
      </div>
      <Button
        variant={enabled ? 'primary' : 'outlined'}
        size="m"
        className={styles.cellButton}
        onClick={() => setToolEnabled(name, !enabled)}
      >
        {t(enabled ? 'toolEnabled' : 'toolDisabled')}
      </Button>
    </div>
  )
}

const MemorySettings = () => {
  const t = useTranslate()
  const autoMemory = useSettings((state) => state.autoMemory)
  const memorySpark = useSettings((state) => state.memorySpark)
  const [items, setItems] = useState<MemoryItem[]>(() => readMemories())
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = () => setItems(readMemories())
  const globalCount = items.filter((item) => !item.workspaceId).length
  const workspaceCount = items.length - globalCount
  const keyword = query.trim().toLowerCase()
  const filtered = keyword
    ? items.filter((item) => item.content.toLowerCase().includes(keyword))
    : items

  const commitEdit = (id: string) => {
    if (updateMemory(id, editValue)) {
      setEditingId(null)
      setEditValue('')
      refresh()
    }
  }

  const addDraft = () => {
    if (addMemory(draft)) {
      setDraft('')
      refresh()
    }
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.text}>
          <div className={styles.label}>{t('memoryTitle')}</div>
          <div className={styles.description}>
            {t('memoryStats', {
              total: items.length,
              global: globalCount,
              workspace: workspaceCount,
            })}
          </div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => {
            const removed = mergeSimilarMemories()
            refresh()
            setStatus(removed > 0 ? t('memoryMerged', { count: removed }) : t('memoryMergeNone'))
          }}
        >
          {t('memoryMerge')}
        </Button>
      </div>

      <SettingCell
        label={t('memoryAutoLabel')}
        description={t('memoryAutoDescription')}
        status={null}
        action={
          <Button
            variant={autoMemory ? 'primary' : 'outlined'}
            size="m"
            className={styles.cellButton}
            onClick={() => setAutoMemory(!autoMemory)}
          >
            {t(autoMemory ? 'toolEnabled' : 'toolDisabled')}
          </Button>
        }
      />
      <SettingCell
        label={t('memorySparkLabel')}
        description={t('memorySparkDescription')}
        status={null}
        action={
          <Button
            variant={memorySpark ? 'primary' : 'outlined'}
            size="m"
            className={styles.cellButton}
            onClick={() => setMemorySpark(!memorySpark)}
          >
            {t(memorySpark ? 'toolEnabled' : 'toolDisabled')}
          </Button>
        }
      />

      <div className={styles.cell}>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={t('memorySearchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {status ? (
        <div className={styles.cell}>
          <div className={styles.description}>{status}</div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('memoryEmpty')}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('memoryNoMatch')}</div>
        </div>
      ) : (
        filtered.map((item) => (
          <div key={item.id} className={clsx(styles.cell, styles.toolRow)}>
            <div className={styles.text}>
              {editingId === item.id ? (
                <div className={styles.apiKeyInput}>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={editValue}
                    autoFocus
                    onChange={(event) => setEditValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        commitEdit(item.id)
                      }
                    }}
                  />
                </div>
              ) : (
                <div className={styles.description}>{item.content}</div>
              )}
              <div className={styles.description} style={{ opacity: 0.6 }}>
                {item.workspaceId ? t('memoryWorkspaceTag') : t('memoryGlobalTag')}
                {' · '}
                {new Date(item.createdAt).toLocaleString()}
              </div>
            </div>
            <div className={styles.toolActions}>
              {editingId === item.id ? (
                <>
                  <Button variant="primary" size="m" onClick={() => commitEdit(item.id)}>
                    {t('memorySave')}
                  </Button>
                  <Button
                    variant="outlined"
                    size="m"
                    onClick={() => {
                      setEditingId(null)
                      setEditValue('')
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    size="m"
                    onClick={() => {
                      setEditingId(item.id)
                      setEditValue(item.content)
                    }}
                  >
                    {t('memoryEdit')}
                  </Button>
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    onClick={() => {
                      removeMemory(item.id)
                      refresh()
                    }}
                  >
                    {t('delete')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))
      )}

      <div className={styles.cell}>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.fieldInput}
            placeholder={t('memoryPlaceholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && draft.trim()) {
                addDraft()
              }
            }}
          />
        </div>
        <Button variant="primary" size="m" className={styles.cellButton} onClick={addDraft}>
          {t('memoryAdd')}
        </Button>
      </div>

      {items.length > 0 ? (
        <div className={styles.cell}>
          <div className={styles.description}>{t('memoryClearHint')}</div>
          <Button
            variant="dangerOutlined"
            size="m"
            className={styles.cellButton}
            onClick={() => setConfirmClear(true)}
          >
            {t('memoryClearAll')}
          </Button>
        </div>
      ) : null}

      {confirmClear ? (
        <Modal
          title={t('memoryClearConfirmTitle')}
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setConfirmClear(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  clearMemories()
                  setConfirmClear(false)
                  setStatus(t('memoryCleared'))
                  refresh()
                }}
              >
                {t('memoryClearAll')}
              </Button>
            </>
          }
        >
          {t('memoryClearConfirmDescription')}
        </Modal>
      ) : null}
    </>
  )
}

const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      await saveBlob(blob, name)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
