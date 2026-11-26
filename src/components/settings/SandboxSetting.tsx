import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  clearSandboxTree,
  getSandboxInfo,
  listSandboxDir,
  readSandboxFile,
  type SandboxEntry,
  type SandboxInfo,
} from '../../services/workspace/local.js'
import { exportWorkspace, importWorkspace, unarchiveWorkspace, useWorkspace } from '../../services/workspace/store.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 沙箱文件管理器。
 *
 * 沙箱躺在 filesDir/workspace/files 下，系统文件管理器看不到，
 * 所以这里做一份自己的浏览界面：面包屑 + 目录列表 + 文件预览。
 */
export const SandboxSetting = () => {
  const t = useTranslate()
  const loading = useWorkspace((state) => state.loading)
  const files = useWorkspace((state) => state.files)
  const workspaces = useWorkspace((state) => state.entries)
  const archivedWorkspaces = workspaces.filter((item) => item.archived)

  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<SandboxEntry[]>([])
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadDir = async (dir: string) => {
    const listing = await listSandboxDir(dir)
    if (listing.ok) {
      setEntries(listing.items ?? [])
      setCwd(dir)
      setPreview(null)
    } else {
      setEntries([])
    }
  }

  const refresh = async () => {
    setInfo(await getSandboxInfo())
    await loadDir(cwd)
  }

  useEffect(() => {
    void (async () => {
      setInfo(await getSandboxInfo())
      await loadDir('')
    })()
    // files 变化说明工作树被改过，重列一次
  }, [files])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  const crumbs = useMemo(() => {
    if (!cwd) return [] as { name: string; path: string }[]
    const parts = cwd.split('/')
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
  }, [cwd])

  const onOpen = async (entry: SandboxEntry) => {
    const next = cwd ? `${cwd}/${entry.name}` : entry.name
    if (entry.dir) {
      await loadDir(next)
      return
    }
    const result = await readSandboxFile(next)
    if (result.ok) {
      setPreview({ path: next, content: result.content })
    } else {
      setMessage(
        result.error === 'too-large'
          ? t('sandboxFileTooLarge')
          : result.error === 'is-directory'
            ? t('sandboxIsDirectory')
            : t('sandboxReadFailed')
      )
    }
  }

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
            <div className={styles.description}>
              {unsupported
                ? t('sandboxOnlyOnDevice')
                : t('sandboxUsageDetail', {
                    count: info?.count ?? 0,
                    size: formatSize(info?.bytes ?? 0),
                  })}
            </div>
          </div>
          <Button variant="outlined" size="s" disabled={busy} onClick={() => void refresh()}>
            {t('workspaceRefresh')}
          </Button>
        </div>

        {!unsupported ? (
          <>
            <div className={styles.sandboxCrumbs}>
              <button
                type="button"
                className={styles.sandboxCrumb}
                onClick={() => void loadDir('')}
              >
                {t('sandboxRoot')}
              </button>
              {crumbs.map((crumb) => (
                <span key={crumb.path} className={styles.sandboxCrumbWrap}>
                  <span className={styles.sandboxSep}>/</span>
                  <button
                    type="button"
                    className={styles.sandboxCrumb}
                    onClick={() => void loadDir(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div className={styles.sandboxList}>
              {entries.length === 0 ? (
                <div className={styles.description} style={{ padding: '12px 4px' }}>
                  {t('sandboxEmptyDir')}
                </div>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    className={styles.sandboxRow}
                    onClick={() => void onOpen(entry)}
                  >
                    <span className={styles.sandboxIcon} data-dir={entry.dir} />
                    <span className={styles.sandboxName}>{entry.name}</span>
                    <span className={styles.sandboxMeta}>
                      {entry.dir ? t('sandboxFolder') : formatSize(entry.size)}
                    </span>
                    <span className={styles.sandboxTime}>{formatTime(entry.mtime)}</span>
                  </button>
                ))
              )}
            </div>

            {preview ? (
              <div className={styles.sandboxPreview}>
                <div className={styles.sandboxPreviewHead}>
                  <span>{preview.path}</span>
                  <button type="button" className={styles.sandboxClose} onClick={() => setPreview(null)}>
                    ×
                  </button>
                </div>
                <pre className={styles.sandboxPre}>{preview.content}</pre>
              </div>
            ) : null}

            <div className={styles.description} style={{ marginTop: 10, wordBreak: 'break-all' }}>
              {info?.path ?? ''}
            </div>
          </>
        ) : null}
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

      <div className={styles.cell}>
        <div className={styles.promptHead}>
          <div className={styles.text}>
            <div className={styles.label}>{t('workspaceArchived')}</div>
            <div className={styles.description}>{t('workspaceArchiveHint')}</div>
          </div>
        </div>
        {archivedWorkspaces.length === 0 ? (
          <div className={styles.description}>{t('workspaceArchiveEmpty')}</div>
        ) : (
          <div className={styles.promptList}>
            {archivedWorkspaces.map((item) => (
              <div key={item.id} className={styles.promptRow}>
                <span className={styles.promptRowText}>
                  <span className={styles.promptRowName}>{item.name}</span>
                  <span className={styles.promptRowContent}>{item.root}</span>
                </span>
                <Button variant="outlined" size="s" onClick={() => unarchiveWorkspace(item.id)}>
                  {t('workspaceUnarchive')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
