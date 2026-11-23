import { runSubagent } from '../subagent.js'
import {
  addGoal,
  completeGoal,
  dropGoal,
  removeGoal,
  reopenGoal,
  updateGoal,
  useGoals,
} from '../../goals.js'
import { cancelTask, useTasks, type AgentTask } from '../tasks.js'
import { defineTool, fail, num, objectSchema, ok, str } from '../toolKit.js'
import type { RegisteredTool } from '../types.js'

const TASK_STATUS: Record<AgentTask['status'], string> = {
  running: '运行中',
  detached: '后台运行',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
}

const elapsed = (task: AgentTask) => {
  const end = task.endedAt ?? Date.now()
  return Math.max(0, Math.round((end - task.startedAt) / 1000))
}

const taskLine = (task: AgentTask) => {
  const parts = [
    `[${TASK_STATUS[task.status]}] ${task.label || task.toolName}`,
    `id: ${task.id}`,
    `用时 ${elapsed(task)}s`,
  ]
  if (task.purpose) {
    parts.push(`目的：${task.purpose}`)
  }
  if (task.progress && (task.status === 'running' || task.status === 'detached')) {
    parts.push(`进度：${task.progress}`)
  }
  if (task.output && task.status !== 'running') {
    parts.push(`结果：${task.output.replace(/\s+/g, ' ').slice(0, 240)}`)
  }
  return parts.join('｜')
}

/** 后台任务：模型可以查看自己转后台的工具/子 Agent 进度，也可以取回完整输出 */
const taskStatusTool = defineTool(
  {
    name: 'task_status',
    label: '后台任务状态',
    description: [
      '查看后台任务（转后台的工具调用与子 Agent）的状态。',
      'action=list 列出任务：状态、工具、目的、进度、耗时与结果预览；action=get 用 id 读取某个任务的完整输出。',
      '当工具提示「已转入后台」或用户问「刚才那个任务怎么样了」时使用。',
    ].join(''),
    inputSchema: objectSchema({
      action: { type: 'string', enum: ['list', 'get'], description: '默认 list' },
      id: { type: 'string', description: 'action=get 时的任务 id' },
      scope: {
        type: 'string',
        enum: ['session', 'all'],
        description: 'session 只看当前会话（默认），all 看全部',
      },
    }),
    risk: 'safe',
    icon: 'layers',
  },
  async (input, context) => {
    const action = str(input, 'action') || 'list'
    const all = str(input, 'scope') === 'all'
    const tasks = useTasks
      .getState()
      .tasks.filter((task) => all || task.sessionId === context.sessionId)

    if (action === 'get') {
      const id = str(input, 'id').trim()
      if (!id) {
        return fail('get 需要 id，可以先 action=list 查')
      }
      const task = tasks.find((item) => item.id === id)
      if (!task) {
        return fail(`没有这个任务：${id}`)
      }
      return ok(
        [
          `任务：${task.label || task.toolName}`,
          `状态：${TASK_STATUS[task.status]}`,
          `目的：${task.purpose || '—'}`,
          `开始：${new Date(task.startedAt).toLocaleString()}`,
          `用时：${elapsed(task)}s`,
          task.progress ? `进度：${task.progress}` : '',
          '',
          '输出：',
          task.output || '（还没有输出）',
        ]
          .filter((line) => line !== '')
          .join('\n'),
        { meta: { id: task.id, status: task.status } }
      )
    }

    if (tasks.length === 0) {
      return ok('当前没有后台任务。')
    }
    return ok(
      [
        `共 ${tasks.length} 个后台任务：`,
        ...tasks.map((task) => `- ${taskLine(task)}`),
      ].join('\n'),
      { meta: { count: tasks.length } }
    )
  },
  'browser'
)

/** 取消后台任务：只中止任务自身的 AbortSignal，不影响当前对话 */
const taskCancelTool = defineTool(
  {
    name: 'task_cancel',
    label: '取消后台任务',
    description: '按 id 取消一个仍在运行或已转后台的任务。已完成/失败/取消的任务无需取消。',
    inputSchema: objectSchema({ id: { type: 'string', description: '任务 id' } }, ['id']),
    risk: 'write',
    requiresApproval: false,
    icon: 'bolt',
  },
  async (input) => {
    const id = str(input, 'id').trim()
    if (!id) {
      return fail('需要任务 id，可以先用 task_status 查')
    }
    const task = useTasks.getState().tasks.find((item) => item.id === id)
    if (!task) {
      return fail(`没有这个任务：${id}`)
    }
    if (task.status !== 'running' && task.status !== 'detached') {
      return ok(`任务「${task.label}」已经是${TASK_STATUS[task.status]}，无需取消。`)
    }
    cancelTask(id)
    return ok(`已取消任务「${task.label || task.toolName}」（id: ${id}）。`)
  },
  'browser'
)


/**
 * 目标管理：目标会一直出现在系统提示里，直到被标记完成。
 * 写的是本机目标清单，风险很低，不额外要求确认，避免打断连续推进。
 */
const manageGoalsTool = defineTool(
  {
    name: 'manage_goals',
    label: '管理目标',
    description: [
      '维护跨轮次的目标清单。目标会出现在每一轮的系统提示里，用来对齐「最终要达成什么」。',
      'action=list 查看；create 新建；update 改标题/细节；complete 标记达成并写结论；drop 放弃；reopen 重新激活；remove 删除。',
      '用法建议：接到多步任务先 create 一条目标并写清验收标准，推进过程中用 update 补充进展，交付后用 complete 写结论。',
    ].join(''),
    inputSchema: objectSchema(
      {
        action: {
          type: 'string',
          enum: ['list', 'create', 'update', 'complete', 'drop', 'reopen', 'remove'],
          description: '要执行的动作',
        },
        id: { type: 'string', description: '目标 id，除 create/list 外都需要' },
        title: { type: 'string', description: '目标标题（create/update）' },
        detail: { type: 'string', description: '验收标准、约束、拆解步骤（create/update）' },
        result: { type: 'string', description: '达成结论或产出说明（complete/update）' },
      },
      ['action']
    ),
    risk: 'write',
    requiresApproval: false,
    icon: 'target',
  },
  async (input) => {
    const action = str(input, 'action')
    const id = str(input, 'id').trim()
    const title = str(input, 'title').trim()
    const detail = input.detail === undefined ? undefined : str(input, 'detail')
    const result = input.result === undefined ? undefined : str(input, 'result')

    if (action === 'list') {
      const list = useGoals.getState().list
      if (list.length === 0) {
        return ok('还没有目标。可以用 action=create 建一条。')
      }
      const mark = (status: string) =>
        status === 'active' ? '[ ]' : status === 'done' ? '[x]' : '[-]'
      return ok(
        list
          .map(
            (goal) =>
              `${mark(goal.status)} ${goal.title}（id: ${goal.id}）${goal.result ? `｜结论：${goal.result}` : ''}`
          )
          .join('\n')
      )
    }

    if (action === 'create') {
      if (!title) {
        return fail('create 需要 title')
      }
      const goal = addGoal(title, detail ?? '')
      return ok(`已创建目标「${goal.title}」（id: ${goal.id}），会持续出现在系统提示里。`, {
        meta: { goalId: goal.id },
      })
    }

    if (!id) {
      return fail(`${action} 需要 id，可以先用 action=list 查`)
    }
    const exists = useGoals.getState().list.some((goal) => goal.id === id)
    if (!exists) {
      return fail(`没有这个目标：${id}`)
    }

    switch (action) {
      case 'update':
        updateGoal(id, { ...(title ? { title } : {}), ...(detail !== undefined ? { detail } : {}), ...(result !== undefined ? { result } : {}) })
        return ok('目标已更新。')
      case 'complete':
        completeGoal(id, result)
        return ok(
          `目标已标记达成${result ? `，结论：${result}` : ''}。如果还有下一步，可以再 create 一条新目标。`
        )
      case 'drop':
        dropGoal(id)
        return ok('目标已标记为放弃。')
      case 'reopen':
        reopenGoal(id)
        return ok('目标已重新激活。')
      case 'remove':
        removeGoal(id)
        return ok('目标已删除。')
      default:
        return fail(`不支持的动作：${action}`)
    }
  },
  'browser'
)

export const agentTools: RegisteredTool[] = [
  defineTool(
    {
      name: 'spawn_subagent',
      label: '派生子 Agent',
      description: [
        '把一个相对独立、可并行或需要多步查证的任务交给子 Agent 处理。',
        '子 Agent 有独立上下文和独立工具循环，只把最终结论返回给你，中间过程不占用当前对话。',
        '默认只授予只读工具（时间、天气、网页抓取、扩展读取、MCP 只读工具），不会执行写文件或命令。',
        '适合：分别调研几个对象再对比、先查证再汇总、把长链路检索拆出去。',
        '不适合：一步就能完成的事、需要用户确认的写操作、需要保留中间截图的任务。',
      ].join(''),
      inputSchema: objectSchema(
        {
          task: {
            type: 'string',
            description: '交给子 Agent 的具体任务，写清楚目标、范围与期望输出',
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: '限定子 Agent 可用的工具名；省略时自动挑选只读工具',
          },
          max_rounds: {
            type: 'number',
            description: '最多推理轮次，1-6，默认 3',
          },
        },
        ['task']
      ),
      risk: 'safe',
      icon: 'spark',
    },
    async (input, context) => {
      const task = str(input, 'task').trim()
      if (!task) {
        return fail('task 不能为空')
      }
      const names = Array.isArray(input.tools)
        ? input.tools.filter((item): item is string => typeof item === 'string')
        : undefined
      const maxRounds = Math.min(6, Math.max(1, num(input, 'max_rounds') ?? 3))
      const run = await runSubagent({
        task,
        tools: names,
        maxRounds,
        sessionId: context.sessionId,
        signal: context.signal,
        onProgress: context.progress,
      })
      if (!run.text.trim()) {
        return fail('子 Agent 没有返回内容，可以让它重试或改用主对话工具')
      }
      const summary = run.used.length > 0 ? `调用 ${run.used.join('、')}` : '未调用工具'
      return ok(`子 Agent 完成（${run.rounds} 轮，${summary}）：\n\n${run.text}`)
    }
  ),
  manageGoalsTool,
  taskStatusTool,
  taskCancelTool,
]
