import { useTranslate } from '../../i18n/index.js'
import { useGoals } from '../../services/goals.js'
import { IconButton } from '../base/IconButton.js'
import { toggleGoalPanel } from '../agent/goalPanelState.js'
import { IconTarget } from '../agent/ToolIcons.js'
import styles from './TaskButton.module.css'

/** 输入框右侧的目标入口：有进行中的目标时显示数量，点开管理目标 */
export const GoalButton = () => {
  const t = useTranslate()
  const active = useGoals((state) => state.list.filter((goal) => goal.status === 'active').length)
  return (
    <span className={styles.wrap} data-active={active > 0 || undefined}>
      <IconButton
        size="m"
        icon={<IconTarget />}
        tooltip={t('goalButton')}
        onClick={toggleGoalPanel}
      />
      {active > 0 ? <span className={styles.badge}>{active}</span> : null}
    </span>
  )
}
