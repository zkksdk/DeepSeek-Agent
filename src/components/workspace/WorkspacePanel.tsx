import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
} from '../base/icons.js'
import { IconFile, IconFolder } from '../agent/ToolIcons.js'
import { diffFile, totalChanges } from '../../services/workspace/diff.js'
import { workspaceStats } from '../../services/workspace/diff.js'
import {
  backToDemo,
  discardFile,
  initWorkspace,
  exportWorkspace,
  importWorkspace,
  refreshLocalWorkspace,
  useWorkspace,
} from '../../services/workspace/store.js'
import { DiffViewer } from './DiffViewer.js'
import { buildFullFileTree, type FileNode } from './fileTree.js'
import {
  closeWorkspacePanel,
  consumeWorkspaceFocus,
  useWorkspacePanel,
} from './workspacePanelState.js'
import styles from './WorkspacePanel.module.css'

const statusLabel = (status?: string) => {
  if (status === 'added') {
    return 'A'
  }
  if (status === 'deleted') {
    return 'D'
  }
  return 'M'
}

const TreeRow = ({
  node,
  depth,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: {
  node: FileNode
  depth: number
  selected: string | null
  collapsed: Set<string>
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}) => {
  const isDir = node.kind === 'dir'
  const open = isDir && !collapsed.has(node.path)
  return (
    <>
      <button
        type="button"
        className={clsx(
          styles.row,
          isDir ? styles.dir : styles.file,
          !isDir && selected === node.path && styles.rowActive
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
        title={node.path}
      >
        {isDir ? (
          <span className={styles.chevron}>
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        ) : (
          <span className={styles.chevron} />
        )}
        <span className={styles.fileIcon} data-dir={isDir}>
          {isDir ? <IconFolder /> : <IconFile />}
        </span>
        <span className={styles.name}>{node.name}</span>
        {!isDir ? (
          <>
            <span className={styles.fileStatus} data-status={node.status}>
              {statusLabel(node.status)}
            </span>
            <span className={styles.fileCount}>
              <span className={styles.add}>+{node.additions}</span>
              <span className={styles.del}>−{node.deletions}</span>
            </span>
          </>
        ) : null}
      </button>
      {isDir && open
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  )
}

/** 工作区：文件树 + 分支切换 + Monaco diff */
/** 临时探针：常驻显示桥接状态，方便在没有日志的情况下定位问题 */

export const WorkspacePanel = () => {
  const t = useTranslate()
  const open = useWorkspacePanel((state) => state.open)
  const focusPath = useWorkspacePanel((state) => state.focusPath)
  const source = useWorkspace((state) => state.source)
  const name = useWorkspace((state) => state.name)
  const files = useWorkspace((state) => state.files)
  const base = useWorkspace((state) => state.base)
  const loading = useWorkspace((state) => state.loading)
  const error = useWorkspace((state) => state.error)
  const truncated = useWorkspace((state) => state.truncated)
  const [selected, setSelected] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferMessage, setTransferMessage] = useState('')

  useEffect(() => {
    if (open) {
      initWorkspace()
    }
  }, [open])

  const stats = useMemo(() => workspaceStats(base, files), [base, files])
  const changes = useMemo(
    () =>
      [...stats.values()].sort((a, b) => a.path.localeCompare(b.path)),
    [stats]
  )
  const totals = useMemo(() => totalChanges(changes), [changes])
  const tree = useMemo(() => buildFullFileTree(files, stats), [files, stats])
  const diff = useMemo(
    () => (selected ? diffFile(selected, base, files) : null),
    [selected, base, files]
  )

  // 工具卡片点了某个文件的改动行数：直接定位，随后清掉一次性请求
  useEffect(() => {
    if (!open || !focusPath) {
      return
    }
    setSelected(focusPath)
    consumeWorkspaceFocus()
  }, [open, focusPath])

  // 当前选中文件不在变更里时，自动落到第一个变更
  useEffect(() => {
    if (!open || focusPath) {
      return
    }
    if (selected && stats.has(selected)) {
      return
    }
    const balanced = changes.find((item) => item.additions > 0 && item.deletions > 0)
    setSelected(balanced?.path ?? changes[0]?.path ?? null)
  }, [open, selected, stats, changes, focusPath])

  if (!open) {
    return null
  }

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }


  const currentDiffIndex = diff && diff.status !== 'unchanged' ? diff : null

  return (
    <Modal
      title={
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <IconFolder />
          </span>
          <span className={styles.titleText}>
            {t('workspaceTitle')}
            <span className={styles.subtitle}>{name}</span>
          </span>
        </span>
      }
      onClose={closeWorkspacePanel}
      closable
      className={styles.panel}
      mainClassName={styles.main}
      footer={null}
    >
      <div className={styles.toolbar}>

        <span className={styles.spacer} />
        <span className={styles.totals}>
          <span className={styles.add}>+{totals.additions}</span>
          <span className={styles.del}>−{totals.deletions}</span>
        </span>
        <span className={styles.count}>{t('workspaceChangeCount', { count: changes.length })}</span>
        {source === 'local' ? (
          <IconButton
            size="xs"
            icon={<IconRefreshOutline16 />}
            tooltip={t('workspaceRefresh')}
            disabled={loading}
            onClick={() => void refreshLocalWorkspace()}
          />
        ) : null}
        <button
          type="button"
          className={styles.openFolder}
          disabled={loading || transferBusy}
          title={t('workspaceExportHint')}
          onClick={async () => {
            setTransferBusy(true)
            const result = await exportWorkspace()
            setTransferBusy(false)
            setTransferMessage(
              result.ok ? t('workspaceExportDone') : t('workspaceExportFailed') + ' ' + (result.error ?? '')
            )
          }}
        >
          {t('workspaceExport')}
        </button>
        <button
          type="button"
          className={styles.openFolder}
          disabled={loading || transferBusy}
          title={t('workspaceImportHint')}
          onClick={async () => {
            setTransferBusy(true)
            const result = await importWorkspace()
            setTransferBusy(false)
            setTransferMessage(
              result.ok ? t('workspaceImportDone', { count: result.count ?? 0 }) : t('workspaceImportFailed')
            )
          }}
        >
          {t('workspaceImport')}
        </button>
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <span>{t('workspaceFiles')}</span>
            <span className={styles.sidebarCount}>{Object.keys(files).length}</span>
          </div>
          <div className={styles.tree}>
            {tree.length === 0 ? (
              <div className={styles.clean}>
                <span className={styles.cleanMark}>✓</span>
                <span>{t('workspaceClean')}</span>
                <span className={styles.cleanHint}>{t('workspaceCleanHint')}</span>
              </div>
            ) : (
              tree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selected}
                  collapsed={collapsed}
                  onSelect={setSelected}
                  onToggle={toggle}
                />
              ))
            )}
          </div>
          {error ? (
            <div className={styles.notice} role="alert">
              {error === 'empty'
                ? t('workspaceEmpty')
                : error === 'reselect'
                  ? t('workspaceReselect')
                  : t('workspaceOpenFailed')}
            </div>
          ) : null}
          {transferMessage ? (
            <div className={styles.notice} role="status">
              {transferMessage}
            </div>
          ) : null}
          {truncated ? <div className={styles.notice}>{t('workspaceTruncated')}</div> : null}
          <div className={styles.sidebarFoot}>
            <span>{t('workspaceChangeCount', { count: changes.length })}</span>
            <span className={styles.sourceTag} data-source={source}>
              {t('workspaceSandboxTag')}
            </span>
          </div>
        </aside>

        <div className={styles.mainArea}>
          {currentDiffIndex ? (
            <DiffViewer
              diff={currentDiffIndex}
              sideBySide={sideBySide}
              onSetSideBySide={setSideBySide}
              onDiscard={() => {
                void discardFile(currentDiffIndex.path).then(() =>
                  showToast({ key: 'workspaceDiscarded' })
                )
              }}
            />
          ) : selected && files[selected] !== undefined ? (
            <div className={styles.plainView}>
              <div className={styles.plainHead}>
                <span>{selected}</span>
                <span className={styles.plainBadge}>{t('workspaceUnchanged')}</span>
              </div>
              <pre className={styles.plainPre}>{files[selected]}</pre>
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyArt} aria-hidden="true">
                <span className={styles.artifactLine} data-kind="del" />
                <span className={styles.artifactLine} data-kind="add" />
                <span className={styles.artifactLine} />
                <span className={styles.artifactLine} data-kind="add" />
              </div>
              <p>{t('workspaceNoSelection')}</p>
              <p className={styles.emptyHint}>{t('workspaceEmptyHint')}</p>
            </div>
          )}
        </div>
      </div>

      <div className={styles.status}>
        <span>
          {t('workspaceStatusHint')}
        </span>
        <span className={styles.spacer} />
        <span className={styles.statusStat}>
          <span className={styles.add}>+{totals.additions}</span>
          <span className={styles.del}>−{totals.deletions}</span>
        </span>
        {source === 'demo' ? (
          <button type="button" className={styles.linkButton} onClick={backToDemo}>
            {t('workspaceResetDemo')}
          </button>
        ) : null}
      </div>
    </Modal>
  )
}
