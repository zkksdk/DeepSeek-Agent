import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import {
  addGoal,
  completeGoal,
  dropGoal,
  GOAL_TEMPLATES,
  removeGoal,
  reopenGoal,
  updateGoal,
  useGoals,
  type Goal,
} from '../../services/goals.js'
import { closeGoalPanel, useGoalPanel } from './goalPanelState.js'
import { IconTarget } from './ToolIcons.js'
import styles from './GoalPanel.module.css'

const statusKey = (goal: Goal) =>
  goal.status === 'active'
    ? 'goalActive'
    : goal.status === 'done'
      ? 'goalDone'
      : 'goalDropped'

/** 一条目标的编辑态：标题与细节都是就地编辑，失焦或点保存写回 */
const GoalRow = ({ goal }: { goal: Goal }) => {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(goal.title)
  const [detail, setDetail] = useState(goal.detail)
  const [result, setResult] = useState(goal.result ?? '')

  const save = () => {
    updateGoal(goal.id, { title, detail, result })
    setEditing(false)
  }

  return (
    <div className={styles.goal} data-status={goal.status}>
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden />
        {editing ? (
          <input
            className={styles.titleInput}
            value={title}
            aria-label={t('goalTitle')}
            onChange={(event) => setTitle(event.target.value)}
          />
        ) : (
          <span className={styles.title}>{goal.title}</span>
        )}
        <span className={styles.status}>{t(statusKey(goal))}</span>
        <span className={styles.actions}>
          {goal.status === 'active' ? (
            <>
              <button type="button" className={styles.action} onClick={() => setEditing((v) => !v)}>
                {editing ? t('cancel') : t('edit')}
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={() => completeGoal(goal.id, result || undefined)}
              >
                {t('goalComplete')}
              </button>
              <button type="button" className={styles.ghost} onClick={() => dropGoal(goal.id)}>
                {t('goalDrop')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.action} onClick={() => reopenGoal(goal.id)}>
                {t('goalReopen')}
              </button>
              <button type="button" className={styles.ghost} onClick={() => removeGoal(goal.id)}>
                {t('delete')}
              </button>
            </>
          )}
        </span>
      </div>

      {editing ? (
        <div className={styles.editor}>
          <textarea
            className={styles.detailInput}
            rows={5}
            value={detail}
            aria-label={t('goalDetail')}
            placeholder={t('goalDetailPlaceholder')}
            onChange={(event) => setDetail(event.target.value)}
          />
          <input
            className={styles.resultInput}
            value={result}
            aria-label={t('goalResult')}
            placeholder={t('goalResultPlaceholder')}
            onChange={(event) => setResult(event.target.value)}
          />
          <div className={styles.editorActions}>
            <Button variant="outlined" size="s" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" size="s" onClick={save}>
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {goal.detail ? <pre className={styles.detail}>{goal.detail}</pre> : null}
          {goal.result ? (
            <div className={styles.result}>
              {t('goalResult')}：{goal.result}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * 目标面板：新建 / 编辑 / 达成 / 放弃。
 * 目标会一直带在系统提示里，所以这里也是「让 Agent 知道要做什么」的唯一入口。
 */
export const GoalPanel = () => {
  const t = useTranslate()
  const open = useGoalPanel((state) => state.open)
  const list = useGoals((state) => state.list)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')

  if (!open) {
    return null
  }

  const active = list.filter((goal) => goal.status === 'active')
  const finished = list.filter((goal) => goal.status !== 'active')

  const create = () => {
    if (!title.trim()) {
      return
    }
    addGoal(title, detail)
    setTitle('')
    setDetail('')
  }

  return (
    <Modal
      title={
        <span className={styles.titleBar}>
          <span className={styles.titleIcon}>
            <IconTarget />
          </span>
          <span>
            {t('goalPanelTitle')}
            <span className={styles.subtitle}>{t('goalPanelSubtitle')}</span>
          </span>
        </span>
      }
      onClose={closeGoalPanel}
      closable
      className={styles.panel}
      mainClassName={styles.main}
      footer={null}
    >
      <div className={styles.create}>
        <input
          className={styles.titleInput}
          value={title}
          placeholder={t('goalTitlePlaceholder')}
          aria-label={t('goalTitle')}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              create()
            }
          }}
        />
        <textarea
          className={styles.detailInput}
          rows={4}
          value={detail}
          placeholder={t('goalDetailPlaceholder')}
          aria-label={t('goalDetail')}
          onChange={(event) => setDetail(event.target.value)}
        />
        <div className={styles.templates}>
          <span className={styles.templatesLabel}>{t('goalTemplates')}</span>
          {GOAL_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={styles.template}
              onClick={() => {
                setTitle(template.title)
                setDetail(template.detail)
              }}
            >
              {template.name}
            </button>
          ))}
        </div>
        <div className={styles.createActions}>
          <Button variant="primary" size="s" disabled={!title.trim()} onClick={create}>
            {t('goalAdd')}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>{t('goalEmpty')}</div>
      ) : (
        <div className={styles.list}>
          {active.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
          {finished.length > 0 ? (
            <div className={clsx(styles.sectionLabel)}>{t('goalFinished')}</div>
          ) : null}
          {finished.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </div>
      )}
    </Modal>
  )
}
