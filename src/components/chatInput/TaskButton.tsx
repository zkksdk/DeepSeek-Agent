import { useTranslate } from '../../i18n/index.js'
import { useTasks } from '../../services/agent/tasks.js'
import { IconButton } from '../base/IconButton.js'
import { toggleTaskPanel } from '../agent/taskPanelState.js'
import { IconBolt } from '../agent/ToolIcons.js'
import styles from './TaskButton.module.css'

/** 输入框右侧的任务入口：有任务在跑时显示数量，点开看进度与结果 */
export const TaskButton = () => {
  const t = useTranslate()
  const running = useTasks(
    (state) => state.tasks.filter((task) => task.status === 'running' || task.status === 'detached').length
  )
  return (
    <span className={styles.wrap} data-active={running > 0 || undefined}>
      <IconButton
        size="m"
        icon={<IconBolt />}
        tooltip={t('taskPanelTitle')}
        onClick={toggleTaskPanel}
      />
      {running > 0 ? <span className={styles.badge}>{running}</span> : null}
    </span>
  )
}
