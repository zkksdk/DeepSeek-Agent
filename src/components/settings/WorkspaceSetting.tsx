import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  exportWorkspace,
  importWorkspace,
  useWorkspace,
} from '../../services/workspace/store.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/**
 * 工作区管理。
 *
 * 本地目录模式已下线（HarmonyOS 的 picker 授权是临时的，重启必然失效），
 * 所以这里不再提供「打开文件夹」，只展示工作区现状 + 导入导出。
 * 日常切换分支走输入框左下角的选择器。
 */
export const WorkspaceSetting = () => {
  const t = useTranslate()
  const entries = useWorkspace((state) => state.entries)
  const activeId = useWorkspace((state) => state.activeId)
  const loading = useWorkspace((state) => state.loading)
  const files = useWorkspace((state) => state.files)
  const branch = useWorkspace((state) => state.branch)
  const branches = useWorkspace((state) => state.branches)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const active = entries.find((entry) => entry.id === activeId)
  const fileCount = Object.keys(files).length

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  const onExport = async () => {
    setBusy(true)
    const result = await exportWorkspace()
    setBusy(false)
    setMessage(result.ok ? t('workspaceExportDone') : t('workspaceExportFailed'))
  }

  const onImport = async () => {
    setBusy(true)
    const result = await importWorkspace()
    setBusy(false)
    setMessage(
      result.ok ? t('workspaceImportDone', { count: result.count ?? 0 }) : t('workspaceImportFailed')
    )
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.promptHead}>
          <div className={styles.text}>
            <div className={styles.label}>{t('settingsWorkspaceCurrent')}</div>
            <div className={styles.description}>{t('settingsWorkspaceHint')}</div>
          </div>
        </div>

        <div className={styles.promptList}>
          <div className={styles.promptRow}>
            <span className={styles.promptRowText}>
              <span className={styles.promptRowName}>{active?.name ?? 'deepseek-agent'}</span>
              <span className={styles.promptRowContent}>
                {t('settingsWorkspaceBranch')} {branch}
                {branches.length > 1 ? ` · ${t('settingsWorkspaceBranchCount', { count: branches.length })}` : ''}
              </span>
            </span>
            <span className={styles.promptRowContent}>{t('workspaceFileCount', { count: fileCount })}</span>
          </div>
        </div>

        <div className={styles.description} style={{ marginTop: 8 }}>
          {t('settingsWorkspaceSandbox')}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.promptHead}>
          <div className={styles.text}>
            <div className={styles.label}>{t('settingsWorkspaceTransfer')}</div>
            <div className={styles.description}>{t('settingsWorkspaceTransferHint')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outlined" size="s" disabled={loading || busy} onClick={() => void onExport()}>
            {t('workspaceExport')}
          </Button>
          <Button variant="outlined" size="s" disabled={loading || busy} onClick={() => void onImport()}>
            {t('workspaceImport')}
          </Button>
        </div>
        {message ? (
          <div className={styles.description} style={{ marginTop: 8 }}>
            {message}
          </div>
        ) : null}
      </div>
    </>
  )
}
