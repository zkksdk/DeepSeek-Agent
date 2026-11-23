import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ToolCallPart, ToolResultPart } from '../../services/chat/types.js'
import { describeToolInput, readPurpose } from '../../services/agent/runtime.js'
import { detachTask } from '../../services/agent/tasks.js'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '../base/icons.js'
import { openWorkspaceFile } from '../workspace/workspacePanelState.js'
import { toolIcon } from './ToolIcons.js'
import { describeToolStatus } from './toolStatus.js'
import styles from './ToolCallCard.module.css'

const formatDuration = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

const MAX_PREVIEW = 900

/** ask_user 的参数改投影到卡片上：问题 + 选项，比原始 JSON 好读 */const readAsk = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  const options = Array.isArray(record.options)
    ? record.options
        .map((item) => {
          if (typeof item === 'string') {
            return item
          }
          const label = (item as Record<string, unknown> | null)?.label
          return typeof label === 'string' ? label : ''
        })
        .filter(Boolean)
    : []
  return {
    question: typeof record.question === 'string' ? record.question : '',
    options,
  }
}

/**
 * 工具调用行：和搜索步骤一样的一条横向行，没有卡片外壳与底色。
 * 结构是「图标 + Agent 给的目的 + 一句话结果 + 改动统计 + 耗时」，点整行展开参数与结果。
 * 文件改动会显示 +N −M，点它直接打开工作区的 diff。
 */
export const ToolCallCard = memo(function ToolCallCard({
  call,
  result,
  isLast,
}: {
  call: ToolCallPart
  result?: ToolResultPart
  isLast: boolean
}) {
  const t = useTranslate()
  const isAskUser = call.name === 'ask_user'
  const ask = isAskUser ? readAsk(call.input) : null
  // 提问本身已经在输入框上方展开，卡片保持收起，避免同一段内容出现两次
  const [open, setOpen] = useState(
    !isAskUser && (call.status === 'running' || call.status === 'awaiting')
  )
  const [expanded, setExpanded] = useState(false)
  const touched = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)

  // 执行中自动展开，完成后稍等片刻收起，保持时间线干净；
  // 子 Agent 的结论是主要输出，完成后保持展开
  useEffect(() => {
    if (touched.current) {
      return
    }
    if (!isAskUser && (call.status === 'running' || call.status === 'awaiting')) {
      setOpen(true)
      return
    }
    if (call.name === 'spawn_subagent' && call.status === 'done') {
      setOpen(true)
      return
    }
    if (call.status === 'done' || call.status === 'error' || call.status === 'denied') {
      // 用户点开过就不再自动收起；touched 在定时器触发时再判断一次，
      // 否则「刚点开就被几秒前排好的定时器关掉」会让人以为点击没生效
      timerRef.current = window.setTimeout(() => {
        if (!touched.current) {
          setOpen(false)
        }
      }, 1400)
      return () => window.clearTimeout(timerRef.current)
    }
    return undefined
  }, [call.status, call.name, isAskUser])

  const toggle = () => {
    touched.current = true
    window.clearTimeout(timerRef.current)
    setOpen((value) => !value)
  }

  const label = call.label ?? call.name
  const purpose = readPurpose(call.input)
  const arg = describeToolInput(call.input)
  const duration = result?.durationMs ?? (call.endedAt ? call.endedAt - call.startedAt : undefined)
  const raw = result?.content ?? ''
  // ask_user 的结果是给模型的完整句子，界面上只留「选择 / 补充说明」两行
  const answerLines = raw
    .split('\n')
    .filter((line) => line.trimStart().startsWith('- '))
    .join('\n')
  const content = ask && answerLines ? answerLines : raw
  const long = content.length > MAX_PREVIEW
  const input = call.input as Record<string, unknown> | undefined
  const hasInput = input && Object.keys(input).some((key) => key !== 'purpose')
  const status = describeToolStatus(call, result)
  const change = status.change
  const taskId =
    call.taskId ?? (typeof result?.meta?.taskId === 'string' ? result.meta.taskId : '')
  const running = call.status === 'running' || call.status === 'awaiting'
  // 运行中、等待确认、准备中这几态用右侧的动词 + 呼吸点表示；完成后改用行内「已编辑 xxx」
  const transient = isAskUser
    ? call.status === 'running' || call.status === 'done'
      ? call.status === 'running'
        ? t('askUserWaiting')
        : t('askUserAnswered')
      : ''
    : call.status === 'running'
      ? t('toolStatusRunning')
      : call.status === 'awaiting'
        ? t('toolStatusAwaiting')
        : call.status === 'pending'
          ? t('toolStatusPending')
          : ''

  return (
    <div className={clsx(styles.wrap, !isLast && styles.withLine)} data-status={call.status}>
      <div className={styles.head} onClick={toggle} role="button" tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }}
        aria-expanded={open}
      >
        <span className={styles.icon}>{toolIcon(call.name, call.source)}</span>
        <span className={styles.purpose}>{purpose || label}</span>
        {status.verb || status.target ? (
          <span className={styles.result}>
            {status.verb ? <span className={styles.verb}>{t(status.verb)}</span> : null}
            {status.target ? <span className={styles.target} title={status.target}>{status.target}</span> : null}
          </span>
        ) : arg && purpose ? (
          <span className={styles.arg}>{arg}</span>
        ) : null}
        {change ? (
          <button
            type="button"
            className={styles.change}
            title={`${change.path} — ${t('toolOpenDiff')}`}
            onClick={(event) => {
              event.stopPropagation()
              openWorkspaceFile(change.path)
            }}
          >
            <span className={styles.add}>+{change.additions}</span>
            <span className={styles.del}>−{change.deletions}</span>
          </button>
        ) : null}
        {call.detached ? (
          <span className={styles.badge}>{t('toolDetached')}</span>
        ) : null}
        {transient ? (
          <span className={styles.status}>
            <span className={styles.pulse} aria-hidden />
            {transient}
          </span>
        ) : null}
        {duration !== undefined ? (
          <span className={styles.duration}>{formatDuration(duration)}</span>
        ) : null}
        {running && taskId ? (
          <button
            type="button"
            className={styles.detach}
            title={t('toolSendToBackground')}
            onClick={(event) => {
              event.stopPropagation()
              detachTask(taskId)
            }}
          >
            {t('toolSendToBackground')}
          </button>
        ) : null}
        <span className={styles.chevron}>
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </span>
      </div>

      {open ? (
        <div className={styles.body}>
          {ask ? (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{t('agentToolQuestion')}</span>
              <p className={styles.askQuestion}>{ask.question}</p>
              {ask.options.length > 0 ? (
                <div className={styles.chips}>
                  {ask.options.map((option) => (
                    <span key={option} className={styles.chip}>
                      {option}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : hasInput ? (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{t('agentToolArgs')}</span>
              <pre className={styles.code}>
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(call.input as Record<string, unknown>).filter(
                      ([key]) => key !== 'purpose'
                    )
                  ),
                  null,
                  2
                )}
              </pre>
            </div>
          ) : null}
          {call.progress && call.status === 'running' ? (
            <div className={styles.progress}>{call.progress}</div>
          ) : null}
          {content ? (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{t('agentToolResult')}</span>
              <pre className={styles.code}>
                {expanded || !long ? content : `${content.slice(0, MAX_PREVIEW)}…`}
              </pre>
              {long ? (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t('agentToolCollapse') : t('agentToolExpand')}
                </button>
              ) : null}
            </div>
          ) : null}
          {result?.images?.length ? (
            <div className={styles.images}>
              {result.images.map((image, index) => (
                <img
                  key={`${image.name ?? 'image'}-${index}`}
                  className={styles.image}
                  src={`data:${image.mediaType};base64,${image.data}`}
                  alt={image.name ?? 'tool image'}
                />
              ))}
            </div>
          ) : null}
          {result?.artifacts?.length ? (
            // 卡片内只提示产物，完整卡片统一在消息尾部展示，避免重复
            <div className={styles.artifacts}>
              <span className={styles.sectionTitle}>{t('agentToolArtifacts')}</span>
              <span className={styles.artifactNames}>
                {result.artifacts.map((artifact) => artifact.name).join('、')}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
