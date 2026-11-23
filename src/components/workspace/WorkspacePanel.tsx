import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
} from '../base/icons.js'
import { IconFile, IconFolder, IconMove } from '../agent/ToolIcons.js'
import { showToast } from '../base/toastState.js'
import { diffFile, totalChanges } from '../../services/workspace/diff.js'
import { workspaceStats } from '../../services/workspace/diff.js'
import {
  backToDemo,
  createBranch,
  discardFile,
  initWorkspace,
  openLocalWorkspace,
  refreshLocalWorkspace,
  setBranch,
  useWorkspace,
} from '../../services/workspace/store.js'
import { canPickDirectory } from '../../services/workspace/local.js'
import { DiffViewer } from './DiffViewer.js'
import { buildFileTree, type FileNode } from './fileTree.js'
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
export const WorkspacePanel = () => {
  const t = useTranslate()
  const open = useWorkspacePanel((state) => state.open)
  const focusPath = useWorkspacePanel((state) => state.focusPath)
  const source = useWorkspace((state) => state.source)
  const name = useWorkspace((state) => state.name)
  const root = useWorkspace((state) => state.root)
  const branch = useWorkspace((state) => state.branch)
  const branches = useWorkspace((state) => state.branches)
  const files = useWorkspace((state) => state.files)
  const base = useWorkspace((state) => state.base)
  const loading = useWorkspace((state) => state.loading)
  const error = useWorkspace((state) => state.error)
  const truncated = useWorkspace((state) => state.truncated)
  const [selected, setSelected] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [branchOpen, setBranchOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [branchName, setBranchName] = useState('')
  const branchRef = useRef<HTMLDivElement>(null)

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
  const tree = useMemo(() => buildFileTree(changes), [changes])
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

  useEffect(() => {
    if (!branchOpen) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!branchRef.current?.contains(event.target as Node)) {
        setBranchOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [branchOpen])

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

  const submitBranch = () => {
    const result = createBranch(branchName)
    if (result.ok) {
      setCreating(false)
      setBranchName('')
      setBranchOpen(false)
      return
    }
    showToast({
      key:
        result.error === 'exists'
          ? 'workspaceBranchExists'
          : result.error === 'local'
            ? 'workspaceLocalBranch'
            : 'workspaceBranchInvalid',
      type: 'error',
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
        <div className={styles.branchWrap} ref={branchRef}>
          <button
            type="button"
            className={styles.branchButton}
            aria-expanded={branchOpen}
            aria-haspopup="listbox"
            onClick={() => setBranchOpen((value) => !value)}
            disabled={loading}
          >
            <IconMove />
            <span className={styles.branchName}>{branch}</span>
            <IconChevronDownOutline14 />
          </button>
          {branchOpen ? (
            <div className={styles.branchMenu} role="listbox">
              <div className={styles.branchMenuHead}>
                {source === 'demo' ? t('workspaceDemoHint') : t('workspaceLocalHint')}
              </div>
              {branches.length === 0 ? (
                <div className={styles.branchEmpty}>{t('workspaceNoBranches')}</div>
              ) : (
                branches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={item === branch}
                    className={clsx(styles.branchItem, item === branch && styles.branchActive)}
                    onClick={() => {
                      if (source === 'demo' && setBranch(item)) {
                        setBranchOpen(false)
                      }
                    }}
                  >
                    <span className={styles.branchDot} data-active={item === branch} />
                    <span className={styles.branchItemName}>{item}</span>
                    {item === branch ? (
                      <span className={styles.branchTag}>{t('workspaceCurrent')}</span>
                    ) : null}
                  </button>
                ))
              )}
              {source === 'demo' ? (
                <div className={styles.branchCreate}>
                  {creating ? (
                    <>
                      <input
                        className={styles.branchInput}
                        value={branchName}
                        autoFocus
                        placeholder={t('workspaceNewBranchPlaceholder')}
                        onChange={(event) => setBranchName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            submitBranch()
                          }
                          if (event.key === 'Escape') {
                            setCreating(false)
                          }
                        }}
                      />
                      <Button variant="primary" size="s" onClick={submitBranch}>
                        {t('workspaceCreate')}
                      </Button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.newBranch}
                      onClick={() => setCreating(true)}
                    >
                      + {t('workspaceNewBranch')}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <span className={styles.root} title={root}>
          {root}
        </span>
        <span className={styles.spacer} />
        <span className={styles.totals}>
          <span className={styles.add}>+{totals.additions}</span>
          <span className={styles.del}>−{totals.deletions}</span>
        </span>
        <span className={styles.count}>{t('workspaceChangedFiles', { count: changes.length })}</span>
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
          disabled={loading || !canPickDirectory()}
          title={canPickDirectory() ? t('workspaceOpenFolderHint') : t('workspaceUnsupported')}
          onClick={() => void openLocalWorkspace()}
        >
          {t('workspaceOpenFolder')}
        </button>
        {source === 'local' ? (
          <button type="button" className={styles.openFolder} onClick={backToDemo}>
            {t('workspaceBackDemo')}
          </button>
        ) : null}
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <span>{t('workspaceChanges')}</span>
            <span className={styles.sidebarCount}>{changes.length}</span>
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
              {error === 'empty' ? t('workspaceEmpty') : t('workspaceOpenFailed')}
            </div>
          ) : null}
          {truncated ? <div className={styles.notice}>{t('workspaceTruncated')}</div> : null}
          <div className={styles.sidebarFoot}>
            <span>{t('workspaceFileCount', { count: Object.keys(files).length })}</span>
            <span className={styles.sourceTag} data-source={source}>
              {source === 'demo' ? t('workspaceDemo') : t('workspaceLocal')}
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
        <span className={styles.statusDot} data-source={source} />
        <span>
          {branch} · {t('workspaceStatusHint')}
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
