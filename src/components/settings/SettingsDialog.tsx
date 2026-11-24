import clsx from 'clsx'
import { useRef, useState, type CSSProperties, type ReactNode, useEffect } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
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
import { detectLocation } from '../../services/geo.js'
import {
  isChineseBrowser,
  MAX_TEMPERATURE,
  MAX_TOP_P,
  setAgentEnabled,
  setLocale,
  setLocation,
  setMaxStepsEnabled,
  setMaxToolRounds,
  setMockAgent,
  setMotion,
  setTemperature,
  setThemePreference,
  setToolApproval,
  setTopP,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { IconFolder, IconSpark } from '../agent/ToolIcons.js'
import { PromptsSetting } from './PromptEditor.js'
import {
  BackgroundSetting,
  ParallelSetting,
  SystemPromptSetting,
  TokenCounterSetting,
} from './AgentSettings.js'
import {
  AnimSpeedSetting,
  AnimTogglesSetting,
  GlassSetting,
  LookSetting,
} from './AppearanceSettings.js'
import { GithubSetting } from './GithubSetting.js'
import { SettingCell, ToggleCell } from './SettingCell.js'
import { UsageSetting } from './UsageSetting.js'
import { WorkspaceSetting } from './WorkspaceSetting.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { AccountField, ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { AccountSetting } from './AccountSetting.js'
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
  { value: 'account', label: 'settingsGroupAccount', icon: <IconDataOutline16 /> },
  {
    value: 'general',
    label: 'settingsGroupGeneral',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'agent', label: 'settingsGroupAgent', icon: <IconSpark /> },
  { value: 'workspace', label: 'settingsGroupWorkspace', icon: <IconFolder /> },
  { value: 'data', label: 'settingsGroupData', icon: <IconDataOutline16 /> },
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
          {section === 'account' ? (
            <>
              <AccountField />
              <ApiKeyField editor={apiKeyEditor} />
              <AccountSetting />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          ) : section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
              <UsageSetting />
              <GithubSetting />
              <LookSetting />
              <GlassSetting />
              <MotionSetting />
              <AnimSpeedSetting />
              <AnimTogglesSetting />
            </>
          ) : section === 'agent' ? (
            <>
              <AgentEnabledSetting />
              <ToolApprovalSetting />
              <MaxStepsSetting />
              <ParallelSetting />
              <BackgroundSetting />
              <TokenCounterSetting />
              <SystemPromptSetting />
              <PromptsSetting />
              <SamplingSetting />
              <MockAgentSetting />
            </>
          ) : section === 'workspace' ? (
            <WorkspaceSetting />
          ) : (
            <>
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

  // 没设过就按 IP 猜一次，省得让用户自己翻省市列表；设过了就不动，尊重用户的选择。
  useEffect(() => {
    if (location !== null) {
      return
    }
    let cancelled = false
    void detectLocation().then((result) => {
      if (!cancelled && result) {
        setLocation(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [location])
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

/** 工具调用总开关：关掉后退化为纯聊天 */
const AgentEnabledSetting = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.agentEnabled)
  return (
    <ToggleCell
      label={t('settingsAgentEnabled')}
      description={t('settingsAgentEnabledHint')}
      checked={enabled}
      onChange={setAgentEnabled}
    />
  )
}

/** 工具执行权限：完全访问后写文件、执行命令不再逐个弹窗 */
const ToolApprovalSetting = () => {
  const t = useTranslate()
  const approval = useSettings((state) => state.toolApproval)
  return (
    <SettingCell
      label={t('settingsAgentApproval')}
      description={t('settingsAgentApprovalHint')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsAgentApproval')}
          value={approval}
          options={[
            { value: 'auto', label: t('settingsAgentApprovalAuto') },
            { value: 'ask', label: t('settingsAgentApprovalAsk') },
          ]}
          onChange={(value) => setToolApproval(value === 'ask' ? 'ask' : 'auto')}
        />
      }
    />
  )
}

/** 最大步数：开关决定是否收口，输入框改具体轮次 */
const MaxStepsSetting = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.maxStepsEnabled)
  const rounds = useSettings((state) => state.maxToolRounds)
  return (
    <SettingCell
      label={t('settingsAgentMaxRounds')}
      description={t('settingsAgentMaxRoundsHint')}
      status={null}
      action={
        <>
          <label className={styles.stepper} data-disabled={!enabled || undefined}>
            <input
              type="number"
              min={1}
              max={24}
              value={rounds}
              disabled={!enabled}
              aria-label={t('settingsAgentMaxRounds')}
              onChange={(event) => setMaxToolRounds(Number(event.target.value))}
            />
            <span>{t('settingsAgentMaxRoundsUnit')}</span>
          </label>
          <Switch
            checked={enabled}
            label={t('settingsAgentMaxRounds')}
            onChange={setMaxStepsEnabled}
          />
        </>
      }
    />
  )
}

/** 采样参数滑杆：值留空表示不下发，由服务端默认 */
const SamplingSlider = ({
  label,
  value,
  max,
  step,
  fallback,
  onChange,
}: {
  label: string
  value: number | null
  max: number
  step: number
  /** 未设置时滑块停在服务端默认值的位置，位置不撒谎 */
  fallback: number
  onChange: (value: number) => void
}) => {
  const t = useTranslate()
  const inherit = value === null
  const current = value ?? fallback
  const fill = max > 0 ? `${Math.min(100, Math.max(0, (current / max) * 100))}%` : '0%'
  return (
    <label className={styles.slider}>
      <span className={styles.sliderHead}>
        <span>{label}</span>
        <b data-inherit={inherit || undefined}>
          {inherit ? t('settingsAgentSamplingDefault') : current.toFixed(2)}
        </b>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={current}
        data-inherit={inherit || undefined}
        aria-label={label}
        style={{ '--fill': fill } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

const SamplingSetting = () => {
  const t = useTranslate()
  const temperature = useSettings((state) => state.temperature)
  const topP = useSettings((state) => state.topP)
  return (
    <div className={clsx(styles.cell, styles.sampling)}>
      <div className={styles.samplingHead}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsAgentSampling')}</div>
          <div className={styles.description}>{t('settingsAgentSamplingHint')}</div>
        </div>
        <Button
          variant="outlined"
          size="s"
          className={styles.cellButton}
          disabled={temperature === null && topP === null}
          onClick={() => {
            setTemperature(null)
            setTopP(null)
          }}
        >
          {t('settingsAgentSamplingReset')}
        </Button>
      </div>
      <div className={styles.sliders}>
        <SamplingSlider
          label={t('settingsAgentTemperature')}
          value={temperature}
          max={MAX_TEMPERATURE}
          step={0.05}
          fallback={1}
          onChange={setTemperature}
        />
        <SamplingSlider
          label={t('settingsAgentTopP')}
          value={topP}
          max={MAX_TOP_P}
          step={0.01}
          fallback={1}
          onChange={setTopP}
        />
      </div>
    </div>
  )
}

/** 演示模式：用本地脚本化模型，方便没有 Key 时体验工具链路 */
const MockAgentSetting = () => {
  const t = useTranslate()
  const mock = useSettings((state) => state.mockAgent)
  return (
    <ToggleCell
      label={t('settingsAgentMock')}
      description={t('settingsAgentMockHint')}
      checked={mock}
      onChange={setMockAgent}
    />
  )
}

/** 界面动效强度：精简模式关掉背景光斑与弹入动画 */
const MotionSetting = () => {
  const t = useTranslate()
  const motion = useSettings((state) => state.motion)
  return (
    <SettingCell
      label={t('settingsMotion')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsMotion')}
          value={motion}
          options={[
            { value: 'full', label: t('settingsMotionFull') },
            { value: 'reduced', label: t('settingsMotionReduced') },
          ]}
          onChange={(value) => setMotion(value === 'reduced' ? 'reduced' : 'full')}
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
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
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
