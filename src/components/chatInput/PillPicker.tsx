import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckedOutline14, IconChevronDownOutline14 } from '../base/icons.js'
import styles from './PillPicker.module.css'

export type PillOption = {
  value: string
  label: string
  description?: string
  icon?: ReactNode
  /** 右侧的补充说明，例如快捷键或路径 */
  hint?: string
}

/**
 * 输入框里的小圆角选择器：触发器 + 浮层列表。
 * 权限、工作区、提示词三处共用同一套交互，避免每个都写一遍定位与关闭逻辑。
 */
export const PillPicker = ({
  icon,
  caption,
  value,
  options,
  onChange,
  onOpen,
  accent,
  footer,
  disabled,
}: {
  icon: ReactNode
  /** 触发器前缀说明，例如「权限」 */
  caption?: string
  value: string | null
  options: PillOption[]
  onChange: (value: string) => void
  /** 展开前触发，用于刷新远端列表（例如桌面端的工作区） */
  onOpen?: () => void
  /** 选中项高亮色，默认主题色 */
  accent?: 'brand' | 'warn'
  /** 浮层底部的附加操作，例如「打开文件夹…」 */
  footer?: ReactNode
  disabled?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { side: 'top', align: 'start', offset: 8, maxHeight: 340, minSpace: 200 })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open, accent === 'warn' && styles.warn)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            onOpen?.()
          }
          setOpen((value) => !value)
        }}
      >
        <span className={styles.icon}>{icon}</span>
        {caption ? <span className={styles.caption}>{caption}</span> : null}
        <span className={styles.value}>{current?.label ?? ''}</span>
        <IconChevronDownOutline14 />
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              role="listbox"
              style={position ?? undefined}
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={clsx(styles.option, option.value === value && styles.active)}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.icon ? <span className={styles.optionIcon}>{option.icon}</span> : null}
                  <span className={styles.optionBody}>
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.description ? (
                      <span className={styles.optionDesc}>{option.description}</span>
                    ) : null}
                  </span>
                  {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
                  {option.value === value ? (
                    <span className={styles.check}>
                      <IconCheckedOutline14 />
                    </span>
                  ) : null}
                </button>
              ))}
              {footer ? <div className={styles.footer}>{footer}</div> : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
