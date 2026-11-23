import { useTranslate } from '../../i18n/index.js'
import {
  clampParallel,
  setBackgroundTools,
  setParallelTools,
  setSystemPrompt,
  setTokenCounter,
  useSettings,
} from '../../services/settings.js'
import { defaultSystemPrompt } from '../../services/systemPrompt.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

/** 一轮里同时执行多少个工具 */
export const ParallelSetting = () => {
  const t = useTranslate()
  const value = useSettings((state) => state.parallelTools)
  return (
    <SettingCell
      label={t('settingsParallelTools')}
      description={t('settingsParallelToolsHint')}
      status={null}
      action={
        <label className={styles.stepper}>
          <input
            type="number"
            min={1}
            max={8}
            value={value}
            aria-label={t('settingsParallelTools')}
            onChange={(event) => setParallelTools(clampParallel(Number(event.target.value)))}
          />
          <span>×</span>
        </label>
      }
    />
  )
}

/** 长任务转入后台，对话不被阻塞 */
export const BackgroundSetting = () => {
  const t = useTranslate()
  const value = useSettings((state) => state.backgroundTools)
  return (
    <SettingCell
      label={t('settingsBackgroundTools')}
      description={t('settingsBackgroundToolsHint')}
      status={null}
      action={
        <Switch
          checked={value}
          label={t('settingsBackgroundTools')}
          onChange={setBackgroundTools}
        />
      }
    />
  )
}

/** token 统计方式 */
export const TokenCounterSetting = () => {
  const t = useTranslate()
  const value = useSettings((state) => state.tokenCounter)
  return (
    <SettingCell
      label={t('settingsTokenCounter')}
      description={t('settingsTokenCounterHint')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTokenCounter')}
          value={value}
          options={[
            { value: 'fast', label: t('settingsTokenCounterFast') },
            { value: 'exact', label: t('settingsTokenCounterExact') },
          ]}
          onChange={(next) => setTokenCounter(next === 'exact' ? 'exact' : 'fast')}
        />
      }
    />
  )
}

/** 系统提示词：预填默认文本，用户可逐句修改；失焦即保存 */
export const SystemPromptSetting = () => {
  const t = useTranslate()
  const value = useSettings((state) => state.systemPrompt)
  return (
    <div className={styles.cell}>
      <div className={styles.promptHead}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsSystemPrompt')}</div>
          <div className={styles.description}>{t('settingsSystemPromptHint')}</div>
        </div>
        <Button
          variant="outlined"
          size="s"
          className={styles.cellButton}
          disabled={value.trim() === defaultSystemPrompt()}
          onClick={() => setSystemPrompt(defaultSystemPrompt())}
        >
          {t('settingsSystemPromptReset')}
        </Button>
      </div>
      <textarea
        className={styles.promptInput}
        rows={8}
        value={value}
        spellCheck={false}
        placeholder={t('settingsSystemPromptPlaceholder')}
        onChange={(event) => setSystemPrompt(event.target.value)}
      />
    </div>
  )
}
