import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  answerUserPrompt,
  skipUserPrompt,
  useUserPrompts,
  type UserPrompt,
} from '../../services/agent/userPrompt.js'
import { IconCheckedOutline14 } from '../base/icons.js'
import { IconAsk } from './ToolIcons.js'
import styles from './AskUserPanel.module.css'

/**
 * 模型反问面板：挂在输入框顶部，阻塞等待用户回答。
 * 单选点一下即提交，多选与自由输入走下方的提交按钮。
 */
export const AskUserPanel = ({ sessionId }: { sessionId: string | null }) => {
  const prompt = useUserPrompts(
    (state) => state.queue.find((item) => item.sessionId === sessionId) ?? null
  )
  if (!prompt) {
    return null
  }
  // key 变化即换了一道题，本地选中态跟着重置
  return <PromptCard key={prompt.id} prompt={prompt} />
}

const PromptCard = ({ prompt }: { prompt: UserPrompt }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const locked = useRef(false)

  // 桌面端直接把光标放进输入框，移动端不抢焦点，避免一上来就弹键盘
  useEffect(() => {
    if (!isMobile) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [isMobile])

  const canSubmit = custom.trim().length > 0 || selected.length > 0

  const submit = () => {
    if (locked.current) {
      return
    }
    const text = custom.trim()
    if (!text && selected.length === 0) {
      return
    }
    locked.current = true
    answerUserPrompt(prompt.id, { selected, custom: text })
  }

  const choose = (label: string) => {
    if (locked.current) {
      return
    }
    if (prompt.multi) {
      setSelected((prev) =>
        prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
      )
      return
    }
    // 单选先给出勾选反馈，再提交，避免卡片一闪而过
    setSelected([label])
    setFlash(label)
    window.setTimeout(() => {
      if (locked.current) {
        return
      }
      locked.current = true
      answerUserPrompt(prompt.id, { selected: [label], custom: '' })
    }, 220)
  }

  // 键盘监听只挂一次，处理函数从 ref 取最新状态
  const actions = useRef({ submit, choose })
  actions.current = { submit, choose }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        skipUserPrompt(prompt.id)
        return
      }
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        actions.current.submit()
        return
      }
      if (!typing && /^[1-9]$/.test(event.key)) {
        const option = prompt.options[Number(event.key) - 1]
        if (option) {
          event.preventDefault()
          actions.current.choose(option.label)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [prompt])

  return (
    <div className={styles.card} role="group" aria-label={t('askUserTitle')}>
      <span className={styles.sweep} aria-hidden />
      <div className={styles.head}>
        <span className={styles.badge}>
          <IconAsk size={12} />
          {t('askUserTitle')}
        </span>
        {prompt.header ? <span className={styles.header}>{prompt.header}</span> : null}
        {prompt.multi ? <span className={styles.tag}>{t('askUserMultiHint')}</span> : null}
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.skip}
          onClick={() => skipUserPrompt(prompt.id)}
          aria-label={t('askUserSkip')}
        >
          {t('askUserSkip')}
        </button>
      </div>

      <p className={styles.question}>{prompt.question}</p>

      {prompt.options.length > 0 ? (
        <div className={styles.options}>
          {prompt.options.map((option, index) => {
            const active = selected.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={clsx(
                  styles.option,
                  active && styles.optionActive,
                  flash === option.label && styles.optionFlash
                )}
                style={{ '--i': index } as CSSProperties}
                aria-pressed={active}
                onClick={() => choose(option.label)}
              >
                <span className={styles.key} aria-hidden>
                  {index + 1}
                </span>
                <span className={styles.optionBody}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.description ? (
                    <span className={styles.optionDesc}>{option.description}</span>
                  ) : null}
                </span>
                <span className={styles.check} aria-hidden>
                  <IconCheckedOutline14 />
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={styles.custom}>
        <input
          ref={inputRef}
          className={styles.input}
          value={custom}
          placeholder={prompt.placeholder ?? t('askUserPlaceholder')}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className={styles.send}
          disabled={!canSubmit}
          onClick={submit}
        >
          {prompt.multi && selected.length > 0
            ? t('askUserMultiSubmit', { count: selected.length })
            : t('askUserSubmit')}
        </button>
      </div>

      {isMobile ? null : <div className={styles.hint}>{t('askUserHint')}</div>}
    </div>
  )
}
