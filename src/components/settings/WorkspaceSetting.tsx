import { useTranslate } from '../../i18n/index.js'
import {
  openLocalWorkspace,
  refreshLocalWorkspace,
  removeWorkspace,
  useWorkspace,
} from '../../services/workspace/store.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/**
 * 工作区管理：列表 + 移除 + 打开新文件夹。
 * 日常切换放在输入框左下角的选择器里，这里只做增删。
 */
export const WorkspaceSetting = () => {
  const t = useTranslate()
  const entries = useWorkspace((state) => state.entries)
  const activeId = useWorkspace((state) => state.activeId)
  const loading = useWorkspace((state) => state.loading)

  return (
    <div className={styles.cell}>
      <div className={styles.promptHead}>
        <div className={styles.text}>
          <div className={styles.label}>{t('workspacePickerLabel')}</div>
          <div className={styles.description}>{t('settingsWorkspaceHint')}</div>
        </div>
        <Button
          variant="outlined"
          size="s"
          disabled={loading}
          onClick={() => void openLocalWorkspace()}
        >
          {t('workspacePickerAdd')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className={styles.description}>{t('settingsWorkspaceEmpty')}</div>
      ) : (
        <div className={styles.promptList}>
          {entries.map((entry) => (
            <div key={entry.id} className={styles.promptRow}>
              <span className={styles.promptRowText}>
                <span className={styles.promptRowName}>
                  {entry.name}
                  {entry.id === activeId ? ' ·' : ''}
                </span>
                <span className={styles.promptRowContent}>
                  {entry.source === 'demo' ? t('workspacePickerDemo') : entry.root} · {entry.branch}
                </span>
              </span>
              {entry.source === 'local' && entry.id === activeId ? (
                <button
                  type="button"
                  className={styles.promptDelete}
                  onClick={() => void refreshLocalWorkspace()}
                >
                  {t('workspaceRefresh')}
                </button>
              ) : null}
              {entry.source === 'local' ? (
                <button
                  type="button"
                  className={styles.promptDelete}
                  onClick={() => void removeWorkspace(entry.id)}
                >
                  {t('settingsWorkspaceRemove')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
