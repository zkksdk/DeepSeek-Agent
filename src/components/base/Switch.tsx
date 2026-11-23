import clsx from 'clsx'
import styles from './Switch.module.css'

/** 开关：设置项里用来表示「开 / 关」，比下拉更直达 */
export const Switch = ({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean
  /** 无可见文字时供读屏使用 */
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={clsx(styles.switch, checked && styles.on)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.thumb} />
  </button>
)
