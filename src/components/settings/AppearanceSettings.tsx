import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setAnimSpeed,
  setGlass,
  setLook,
  toggleAnim,
  useSettings,
  type AnimSettings,
  type GlassPreference,
  type LookPreference,
} from '../../services/settings.js'
import { ToggleCell } from './SettingCell.js'
import styles from './Settings.module.css'

/** 动画速度：缩放所有过渡与关键帧时长 */
export const AnimSpeedSetting = () => {
  const t = useTranslate()
  const speed = useSettings((state) => state.animSpeed)
  const fill = `${((speed - 0.5) / 1.5) * 100}%`
  return (
    <div className={styles.cell}>
      <label className={styles.slider}>
        <span className={styles.sliderHead}>
          <span>{t('settingsAnimSpeed')}</span>
          <b>{speed.toFixed(1)}×</b>
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={speed}
          aria-label={t('settingsAnimSpeed')}
          style={{ '--fill': fill } as CSSProperties}
          onChange={(event) => setAnimSpeed(Number(event.target.value))}
        />
      </label>
      <div className={styles.description}>{t('settingsAnimSpeedHint')}</div>
    </div>
  )
}

const TOGGLES: { key: keyof AnimSettings; label: TranslationKey }[] = [
  { key: 'aurora', label: 'settingsAnimAurora' },
  { key: 'shimmer', label: 'settingsAnimShimmer' },
  { key: 'transitions', label: 'settingsAnimTransitions' },
  { key: 'pulse', label: 'settingsAnimPulse' },
]

/** 逐项开关：低配机器上只留必要的反馈 */
export const AnimTogglesSetting = () => {
  const t = useTranslate()
  const anim = useSettings((state) => state.anim)
  return (
    <>
      {TOGGLES.map((item) => (
        <ToggleCell
          key={item.key}
          label={t(item.label)}
          checked={anim[item.key]}
          onChange={() => toggleAnim(item.key)}
        />
      ))}
    </>
  )
}

const LOOKS: { value: LookPreference; label: TranslationKey }[] = [
  { value: 'calm', label: 'settingsLookCalm' },
  { value: 'aurora', label: 'settingsLookAurora' },
]

/** 视觉风格：默认中性克制；原来的极光与彩色渐变保留为可选项 */
export const LookSetting = () => {
  const t = useTranslate()
  const look = useSettings((state) => state.look)
  return (
    <div className={styles.cell}>
      <div className={styles.theme}>
        {t('settingsLook')}
        <div role="radiogroup" aria-label={t('settingsLook')} className={styles.themeOptions}>
          {LOOKS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={look === option.value}
              className={clsx(
                styles.themeOption,
                look === option.value && styles.themeOptionSelected
              )}
              onClick={() => setLook(option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.description}>{t('settingsLookHint')}</div>
    </div>
  )
}

const GLASS: { value: GlassPreference; label: TranslationKey }[] = [
  { value: 'liquid', label: 'settingsGlassRefract' },
  { value: 'frost', label: 'settingsGlassBlur' },
  { value: 'off', label: 'settingsGlassOff' },
]

/** 玻璃强度：折射最像真玻璃，毛玻璃与关闭用来在低配设备上换流畅度 */
export const GlassSetting = () => {
  const t = useTranslate()
  const glass = useSettings((state) => state.glass)
  return (
    <div className={styles.cell}>
      <div className={styles.theme}>
        {t('settingsGlass')}
        <div role="radiogroup" aria-label={t('settingsGlass')} className={styles.themeOptions}>
          {GLASS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={glass === option.value}
              className={clsx(
                styles.themeOption,
                glass === option.value && styles.themeOptionSelected
              )}
              onClick={() => setGlass(option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.description}>{t('settingsGlassHint')}</div>
    </div>
  )
}
