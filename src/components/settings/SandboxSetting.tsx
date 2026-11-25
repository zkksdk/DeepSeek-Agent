import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  clearSandboxTree,
  getSandboxInfo,
  type SandboxInfo,
} from '../../services/workspace/local.js'
import { exportWorkspace, importWorkspace, useWorkspace } from '../../services/workspace/store.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/** 字节数转人话 */
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 沙箱设置。
 *
 * 工作区文件住在应用沙箱（filesDir/workspace），不进系统文件管理器，
 * 所以这里得把路径和占用老老实实报出来，用户才知道东西在哪、占了多少。
 */
export const SandboxSetting = () => {
  const t = useTranslate()
  const loading = useWorkspace((state) => state.loading)
  const files = useWorkspace((state) => state.files)

  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = async () => {
    setInfo(await getSandboxInfo())
  }

  useEffect(() => {
    void refresh()
  }, [files])

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
    setMessage(result.ok ? t('workspaceImportDone', { count: result.count ?? 0 }) : t('workspaceImportFailed'))
    void refresh()
  }

  const onClear = async () => {
    setBusy(true)
    const ok = await clearSandboxTree()
    setBusy(false)
    setMessage(ok ? t('sandboxCleared') : t('sandboxClearFailed'))
    void refresh()
  }

  const unsupported = info !== null && !info.ok

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.promptHead}>
          <div className={styles.text}>
            <div className={styles.label}>{t('sandboxTitle')}</div>
            <div className={styles.description}>{t('sandboxHint')}</div>
          </div>
          <Button variant="outlined" size="s" disabled={busy} onClick={() => void refresh()}>
            {t('workspaceRefresh')}
          </Button>
        </div>

        <div className={styles.promptList}>
          <div className={styles.promptRow}>
            <span className={styles.promptRowText}>
              <span className={styles.promptRowName}>
                {unsupported ? t('sandboxUnavailable') : t('sandboxLocation')}
              </span>
              <span className={styles.promptRowContent} style={{ wordBreak: 'break-all' }}>
                {unsupported ? t('sandboxOnlyOnDevice') : (info?.path ?? '…')}
              </span>
            </span>
          </div>
          {!unsupported ? (
            <div className={styles.promptRow}>
              <span className={styles.promptRowText}>
                <span className={styles.promptRowName}>{t('sandboxUsage')}</span>
                <span className={styles.promptRowContent}>
                  {t('sandboxUsageDetail', {
                    count: info?.count ?? 0,
                    size: formatSize(info?.bytes ?? 0),
                  })}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.promptHead}>
          <div className={styles.text}>
            <div className={styles.label}>{t('sandboxTransfer')}</div>
            <div className={styles.description}>{t('sandboxTransferHint')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outlined" size="s" disabled={loading || busy} onClick={() => void onExport()}>
            {t('workspaceExport')}
          </Button>
          <Button variant="outlined" size="s" disabled={loading || busy} onClick={() => void onImport()}>
            {t('workspaceImport')}
          </Button>
          <Button variant="dangerOutlined" size="s" disabled={loading || busy} onClick={() => void onClear()}>
            {t('sandboxClear')}
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
