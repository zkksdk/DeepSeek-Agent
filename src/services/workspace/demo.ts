/** 内置演示仓库：三套分支快照，带未提交改动，用于展示工作区与 diff */

const README = `# deepseek-agent

一个跑在终端里的编码 Agent：读文件、改代码、跑测试，都走同一套工具协议。

## 能力

- 工具调用：文件读写、搜索、命令执行
- 多轮循环：一次提问内自动连续调用
- 上下文压缩：长对话只保留最近的关键片段

## 开发

    pnpm install
    pnpm dev

## 协议

模型通过 tool_use 声明调用，运行时执行后以 tool_result 回填。
`

const PACKAGE = `{
  "name": "deepseek-agent",
  "version": "0.6.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "diff": "^5.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
`

const LOOP = `import { runTool } from './runtime.js'
import type { Message, ToolCall } from './types.js'

export type LoopOptions = {
  maxTurns?: number
  onText?: (text: string) => void
  signal?: AbortSignal
}

/** 一轮对话的 agent 循环：模型输出 → 工具执行 → 结果回填 */
export async function runLoop(messages: Message[], options: LoopOptions = {}) {
  const maxTurns = options.maxTurns ?? 8
  const history = [...messages]
  let turn = 0

  while (turn < maxTurns) {
    turn += 1
    const reply = await requestModel(history, options.signal)
    history.push(reply.message)
    options.onText?.(reply.text)

    if (reply.toolCalls.length === 0) {
      return { messages: history, turns: turn }
    }

    for (const call of reply.toolCalls) {
      const result = await runTool(call)
      history.push({
        role: 'tool',
        toolCallId: call.id,
        content: result.content,
      })
    }
  }

  throw new Error('agent loop exceeded ' + maxTurns + ' turns')
}
`

const RUNTIME = `import { TOOLS } from './tools/index.js'
import type { ToolCall, ToolResult } from './types.js'

const TIMEOUT_MS = 90_000

/** 执行单个工具调用；未知工具立即返回错误而不是抛异常 */
export async function runTool(call: ToolCall): Promise<ToolResult> {
  const tool = TOOLS[call.name]
  if (!tool) {
    return { content: 'unknown tool: ' + call.name, isError: true }
  }

  const startedAt = Date.now()
  try {
    const content = await tool.execute(call.input)
    return { content, meta: { durationMs: Date.now() - startedAt } }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    }
  }
}

export { TIMEOUT_MS }
`

const FS_TOOL = `import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = process.cwd()

const safePath = (input: string) => {
  const target = resolve(ROOT, input)
  if (!target.startsWith(ROOT)) {
    throw new Error('path escapes workspace: ' + input)
  }
  return target
}

export const readFileTool = {
  description: '读取工作区内的文本文件',
  inputSchema: { path: 'string' },
  async execute(input: { path: string }) {
    return readFile(safePath(input.path), 'utf8')
  },
}

export const writeFileTool = {
  description: '覆盖写入工作区内的文件',
  inputSchema: { path: 'string', content: 'string' },
  async execute(input: { path: string; content: string }) {
    await writeFile(safePath(input.path), input.content, 'utf8')
    return 'wrote ' + input.content.length + ' chars'
  },
}
`

const SEARCH_TOOL = `import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP = new Set(['.git', 'node_modules', 'dist'])

/** 递归列出文件，供模型挑选要读的路径 */
export async function listFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 6) {
    return []
  }
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (SKIP.has(entry.name)) {
      continue
    }
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, depth + 1)))
    } else {
      files.push(path)
    }
  }
  return files
}

export const listFilesTool = {
  description: '列出工作区文件，便于定位要修改的位置',
  inputSchema: {},
  async execute() {
    return (await listFiles(process.cwd())).join('\\n')
  },
}
`

const TIMELINE = `import { ToolCard } from './ToolCard.js'
import type { Step } from '../agent/types.js'

/** 把一轮回复拆成文字与工具卡片交替的时间线 */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <div className="timeline">
      {steps.map((step) =>
        step.kind === 'text' ? (
          <p key={step.id} className="timeline-text">
            {step.text}
          </p>
        ) : (
          <ToolCard key={step.id} call={step.call} result={step.result} />
        )
      )}
    </div>
  )
}
`

const COMPOSER = `import { useState } from 'react'

type Props = {
  disabled: boolean
  onSend: (text: string) => void
}

/** 底部输入框：Enter 发送，Shift+Enter 换行 */
export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) {
      return
    }
    setText('')
    onSend(value)
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        disabled={disabled}
        placeholder="描述你想做的修改"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <button type="button" onClick={submit} disabled={disabled || !text.trim()}>
        {disabled ? '生成中' : '发送'}
      </button>
    </div>
  )
}
`

const THEME = `:root {
  --bg: #ffffff;
  --panel: #f7f7f8;
  --text: #1a1a1e;
  --muted: #7a7a85;
  --accent: #4d6bfe;
  --border: rgba(0, 0, 0, 0.08);
}

[data-theme='dark'] {
  --bg: #101014;
  --panel: #17171c;
  --text: #f2f2f5;
  --muted: #8b8b96;
  --border: rgba(255, 255, 255, 0.1);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
}

.composer {
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding: 12px;
}
`

const TEST = `import { describe, expect, it } from 'vitest'
import { runLoop } from '../src/agent/loop.js'

describe('runLoop', () => {
  it('stops when the model returns no tool calls', async () => {
    const result = await runLoop([{ role: 'user', content: 'hi' }], {
      request: async () => ({ message: { role: 'assistant', content: 'hello' }, toolCalls: [] }),
    })
    expect(result.turns).toBe(1)
  })

  it('feeds tool results back into the next turn', async () => {
    const result = await runLoop([{ role: 'user', content: 'read a.ts' }], {
      maxTurns: 3,
    })
    expect(result.messages.at(-1)?.role).toBe('assistant')
  })
})
`

const BASE: Record<string, string> = {
  'README.md': README,
  'package.json': PACKAGE,
  'src/agent/loop.ts': LOOP,
  'src/agent/runtime.ts': RUNTIME,
  'src/agent/tools/fs.ts': FS_TOOL,
  'src/agent/tools/search.ts': SEARCH_TOOL,
  'src/ui/Timeline.tsx': TIMELINE,
  'src/ui/Composer.tsx': COMPOSER,
  'src/styles/theme.css': THEME,
  'tests/loop.test.ts': TEST,
}

const LOOP_NEXT = `import { runTool } from './runtime.js'
import type { Message, ToolCall } from './types.js'

export type LoopOptions = {
  maxTurns?: number
  onText?: (text: string) => void
  signal?: AbortSignal
}

/** 一轮对话的 agent 循环：模型输出 → 工具执行 → 结果回填 */
export async function runLoop(messages: Message[], options: LoopOptions = {}) {
  const maxTurns = options.maxTurns ?? 8
  const history = [...messages]
  let turn = 0

  while (turn < maxTurns) {
    turn += 1
    const reply = await requestModel(history, options.signal)
    history.push(reply.message)
    options.onText?.(reply.text)

    if (reply.toolCalls.length === 0) {
      return { messages: history, turns: turn }
    }

    // 同一轮里的工具互不依赖，全部并发执行；顺序只由模型声明决定
    const results = await Promise.all(
      reply.toolCalls.map((call) => runTool(call, options.signal))
    )

    reply.toolCalls.forEach((call, index) => {
      const result = results[index]
      history.push({
        role: 'tool',
        toolCallId: call.id,
        content: result.isError ? 'ERROR: ' + result.content : result.content,
      })
    })
  }

  throw new Error('agent loop exceeded ' + maxTurns + ' turns')
}
`

const DIFF_TOOL = `import { createTwoFilesPatch } from 'diff'
import { readFile } from 'node:fs/promises'

/** 对比文件当前内容与给定基线，返回统一 diff */
export async function diffFile(path: string, baseline: string) {
  const current = await readFile(path, 'utf8')
  if (current === baseline) {
    return 'no changes: ' + path
  }
  return createTwoFilesPatch('a/' + path, 'b/' + path, baseline, current, 'baseline', 'current')
}

export const diffTool = {
  description: '查看文件相对基线的改动，返回 unified diff',
  inputSchema: { path: 'string', baseline: 'string' },
  async execute(input: { path: string; baseline: string }) {
    return diffFile(input.path, input.baseline)
  },
}
`

const README_NEXT = README.replace(
  `## 开发`,
  `## 并行工具执行

同一轮回复里的多个工具调用会并发执行，结果按声明顺序回填，
既缩短等待时间，也保证消息顺序稳定。

## 开发`
)

const WORKSPACE_FILE = `import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SKIP = new Set(['.git', 'node_modules', 'dist'])

export type WorkspaceFile = {
  path: string
  size: number
  content: string
}

/** 读取工作区快照：只保留文本文件，单文件上限 160KB */
export async function readWorkspace(root: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = []

  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) {
        continue
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const info = await stat(full)
      if (info.size > 160 * 1024) {
        continue
      }
      const content = await readFile(full, 'utf8').catch(() => null)
      if (content === null) {
        continue
      }
      files.push({ path: relative(root, full), size: info.size, content })
    }
  }

  await walk(root)
  return files
}
`

const TIMELINE_FEAT = `import { ToolCard } from './ToolCard.js'
import { DiffBadge } from './DiffBadge.js'
import type { Step } from '../agent/types.js'

/** 时间线：文字、工具卡片与代码改动并排展示 */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <div className="timeline">
      {steps.map((step) => {
        if (step.kind === 'text') {
          return (
            <p key={step.id} className="timeline-text">
              {step.text}
            </p>
          )
        }
        if (step.kind === 'diff') {
          return <DiffBadge key={step.id} file={step.file} stats={step.stats} />
        }
        return <ToolCard key={step.id} call={step.call} result={step.result} />
      })}
    </div>
  )
}
`

const WORKSPACE_PANEL = `import { useEffect, useState } from 'react'
import { DiffViewer } from './DiffViewer.js'
import { FileTree } from './FileTree.js'
import { useWorkspace } from '../services/workspace.js'

/** 工作区面板：左侧文件树，右侧 Monaco diff */
export function WorkspacePanel() {
  const files = useWorkspace((state) => state.files)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!selected && files.length > 0) {
      setSelected(files[0].path)
    }
  }, [files, selected])

  return (
    <div className="workspace">
      <FileTree files={files} selected={selected} onSelect={setSelected} />
      <div className="workspace-main">
        {selected ? <DiffViewer path={selected} /> : <p className="empty">选择一个文件查看改动</p>}
      </div>
    </div>
  )
}
`

const THEME_FEAT = THEME.replace(
  `[data-theme='dark'] {`,
  `.workspace {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
}

[data-theme='dark'] {`
)

const RUNTIME_FIXED = RUNTIME.replace(
  `  const startedAt = Date.now()
  try {
    const content = await tool.execute(call.input)`,
  `  const startedAt = Date.now()
  try {
    const content = await tool.execute(call.input, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })`
)

const TEST_FIX = TEST.replace(
  `  it('feeds tool results back into the next turn', async () => {`,
  `  it('aborts a tool that exceeds the timeout', async () => {
    const slow = async () => new Promise((resolve) => setTimeout(resolve, 200))
    await expect(Promise.race([slow(), Promise.reject(new Error('timeout'))])).rejects.toThrow(
      'timeout'
    )
  })

  it('feeds tool results back into the next turn', async () => {`
)

/** 演示仓库的分支快照：head 为基线，worktree 带未提交改动 */
export const demoBranches = (): Record<
  string,
  { head: Record<string, string>; worktree: Record<string, string> }
> => {
  // main：并行工具执行、diff 工具、README 说明
  const mainWorktree = {
    ...BASE,
    'src/agent/loop.ts': LOOP_NEXT,
    'src/agent/tools/diff.ts': DIFF_TOOL,
    'README.md': README_NEXT,
  }

  // feat/workspace：新增工作区读取、时间线 diff 徽标，并补上组件与主题
  const featHead = {
    ...BASE,
    'src/agent/workspace.ts': WORKSPACE_FILE,
    'src/ui/DiffBadge.tsx': `export const DiffBadge = ({ file, stats }: { file: string; stats: { additions: number; deletions: number } }) => (
  <span className="diff-badge">
    {file} +{stats.additions} -{stats.deletions}
  </span>
)
`,
    'src/ui/Timeline.tsx': TIMELINE_FEAT,
  }
  const featWorktree = {
    ...featHead,
    'src/components/WorkspacePanel.tsx': WORKSPACE_PANEL,
    'src/ui/Timeline.tsx': TIMELINE_FEAT.replace(
      '<DiffBadge key={step.id} file={step.file} stats={step.stats} />',
      '<DiffBadge key={step.id} file={step.file} stats={step.stats} showPath />'
    ),
    'src/styles/theme.css': THEME_FEAT,
  }

  // fix/tool-timeout：超时中断与回归测试
  const fixWorktree = {
    ...BASE,
    'src/agent/runtime.ts': RUNTIME_FIXED,
    'tests/loop.test.ts': TEST_FIX,
  }

  return {
    main: { head: { ...BASE }, worktree: mainWorktree },
    'feat/workspace': { head: featHead, worktree: featWorktree },
    'fix/tool-timeout': { head: { ...BASE }, worktree: fixWorktree },
  }
}

/** 演示仓库的默认工作区 */
export const demoWorkspace = () => {
  const all = demoBranches()
  return {
    name: 'deepseek-agent',
    root: 'demo/deepseek-agent',
    branch: 'main',
    branches: Object.keys(all),
    head: all.main.head,
    files: all.main.worktree,
    branchData: all,
  }
}
