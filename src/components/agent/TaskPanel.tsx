import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import {
  cancelTask,
  clearFinishedTasks,
  detachTask,
  removeTask,
  useTasks,
  type AgentTask,
} from '../../services/agent/tasks.js'
import { sendInjectedMessage } from '../../services/chat/store.js'
import { showToast } from '../base/toastState.js'
import { closeTaskPanel, useTaskPanel } from './taskPanelState.js'
import { toolIcon } from './ToolIcons.js'
import styles from './TaskPanel.module.css'

const formatClock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${seconds % 60}s`
}

const statusKey = (task: AgentTask) => {
  switch (task.status) {
    case 'running':
      return 'taskPanelRunning'
    case 'detached':
      return 'taskPanelRunning'
    case 'done':
      return 'taskPanelDone'
    case 'error':
      return 'taskPanelFailed'
    default:
      return 'taskPanelCancelled'
  }
}

/**
 * 后台任务面板：工具执行与子 Agent 的实时状态。
 * 前台转入后台的任务会留在这里，跑完后可以直接把结果发回对话继续推理。
 */
export const TaskPanel = () => {
  const t = useTranslate()
  const open = useTaskPanel((state) => state.open)
  const tasks = useTasks((state) => state.tasks)
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!open) {
    return null
  }
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'detached')

  return (
    <Modal
      title={
        <span className={styles.title}>
          {t('taskPanelTitle')}
          {active.length > 0 ? (
            <span className={styles.running}>{t('taskRunningCount', { count: active.length })}</span>
          ) : null}
        </span>
      }
      onClose={closeTaskPanel}
      closable
      className={styles.panel}
      mainClassName={styles.main}
      footer={null}
    >
      <p className={styles.subtitle}>{t('taskPanelSubtitle')}</p>
      {tasks.length === 0 ? (
        <div className={styles.empty}>{t('taskPanelEmpty')}</div>
      ) : (
        <>
          <div className={styles.list}>
            {tasks.map((task) => (
              <div key={task.id} className={styles.task} data-status={task.status}>
                <div className={styles.head}>
                  <span className={styles.icon}>{toolIcon(task.toolName)}</span>
                  <span className={styles.intro}>
                    <span className={styles.purpose}>{task.purpose}</span>
                    <span className={styles.meta}>
                      {task.label}
                      <span className={styles.dot} />
                      {task.endedAt
                        ? formatClock(task.endedAt - task.startedAt)
                        : formatClock(Date.now() - task.startedAt)}
                    </span>
                  </span>
                  <span className={styles.status}>{t(statusKey(task))}</span>
                  {task.status === 'running' || task.status === 'detached' ? (
                    <>
                      {task.status === 'running' ? (
                        <button
                          type="button"
                          className={styles.action}
                          onClick={() => detachTask(task.id)}
                        >
                          {t('toolSendToBackground')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => cancelTask(task.id)}
                      >
                        {t('taskCancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      {task.output ? (
                        <button
                          type="button"
                          className={styles.action}
                          onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                        >
                          {t('taskResult')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => removeTask(task.id)}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
                {task.progress ? <div className={styles.progress}>{task.progress}</div> : null}
                {expanded === task.id && task.output ? (
                  <div className={styles.outputWrap}>
                    <pre className={styles.output}>{task.output}</pre>
                    <Button
                      variant="outlined"
                      size="s"
                      onClick={() => {
                        const sent = sendInjectedMessage(
                          task.sessionId,
                          `后台任务「${task.purpose}」已完成，结果如下：\n\n${task.output}\n\n请基于这个结果继续。`
                        )
                        if (sent) {
                          closeTaskPanel()
                        } else {
                          showToast({ key: 'liveWaiting', type: 'error' })
                        }
                      }}
                    >
                      {t('taskSendToAgent')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className={styles.foot}>
            <Button variant="outlined" size="s" onClick={() => clearFinishedTasks()}>
              {t('taskClear')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
