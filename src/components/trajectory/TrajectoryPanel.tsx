import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session, TraceStep } from '../../services/chat/types.js'
import { closeTrajectoryPanel, useTrajectoryPanel } from './trajectoryState.js'
import styles from './TrajectoryPanel.module.css'

type Step = TraceStep & { messageId: string }

type TurnGroup = {
  id: string
  /** 该轮用户提问（截断） */
  title: string
  steps: Step[]
}

/**
 * 智能体轨迹（对标 dsh 的 Trajectory）：
 * - 按轮次（Turn）分组的记录表，粗分割线标轮次边界
 * - 主表只保留 序号 / 事件 / 耗时，点行展开检查器（输入、输出、时刻）
 * - 顶部 Overview 汇总调用数、成功失败、总耗时
 */
export const TrajectoryPanel = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const open = useTrajectoryPanel((state) => state.open)
  const [expanded, setExpanded] = useState<string | null>(null)

  const groups = useMemo(() => {
    const result: TurnGroup[] = []
    let current: TurnGroup | null = null
    for (const message of session.messages) {
      if (message.role === 'user') {
        current = {
          id: message.id,
          title: (message.content || '').trim().slice(0, 48),
          steps: [],
        }
        result.push(current)
        continue
      }
      if (!message.trace?.length) {
        continue
      }
      if (!current) {
        current = { id: `pre-${message.id}`, title: '', steps: [] }
        result.push(current)
      }
      for (const step of message.trace) {
        current.steps.push({ ...step, messageId: message.id })
      }
    }
    return result.filter((group) => group.steps.length > 0)
  }, [session.messages])

  const stats = useMemo(() => {
    let total = 0
    let failed = 0
    let ms = 0
    for (const group of groups) {
      for (const step of group.steps) {
        total += 1
        ms += step.ms
        if (step.isError) {
          failed += 1
        }
      }
    }
    return { total, failed, ok: total - failed, ms, turns: groups.length }
  }, [groups])

  if (!open) {
    return null
  }

  let index = 0
  return (
    <aside className={clsx(styles.panel, isMobile && styles.mobile)}>
      <div className={styles.header}>
        <span className={styles.title}>{t('trajectoryTitle')}</span>
        <button
          type="button"
          className={styles.close}
          onClick={closeTrajectoryPanel}
          aria-label={t('trajectoryClose')}
        >
          ×
        </button>
      </div>

      <div className={styles.overview}>
        {t('trajectoryOverview', {
          turns: stats.turns,
          total: stats.total,
          ok: stats.ok,
          failed: stats.failed,
          seconds: (stats.ms / 1000).toFixed(1),
        })}
      </div>

      <div className={styles.ledger}>
        {groups.length === 0 ? (
          <div className={styles.empty}>{t('trajectoryEmpty')}</div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className={styles.turn}>
              <div className={styles.turnHeader}>{group.title || t('trajectoryUntitledTurn')}</div>
              {group.steps.map((step) => {
                index += 1
                const key = `${step.messageId}-${step.id}`
                const isOpen = expanded === key
                return (
                  <div key={key} className={styles.rowWrap}>
                    <button
                      type="button"
                      className={clsx(styles.row, isOpen && styles.rowOpen)}
                      onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                    >
                      <span className={styles.index}>{index}</span>
                      <span className={clsx(styles.dot, step.isError && styles.errorDot)} />
                      <span className={styles.name}>{step.name}</span>
                      <span className={styles.duration}>{(step.ms / 1000).toFixed(1)}s</span>
                    </button>
                    {isOpen ? (
                      <div className={styles.inspector}>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>{t('trajectoryInput')}</span>
                          <code className={styles.code}>{step.input}</code>
                        </div>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>{t('trajectoryOutput')}</span>
                          <code className={clsx(styles.code, step.isError && styles.codeError)}>
                            {step.output}
                          </code>
                        </div>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>{t('trajectoryTime')}</span>
                          <span className={styles.code}>
                            {new Date(step.at).toLocaleString()} · {step.ms}ms
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
