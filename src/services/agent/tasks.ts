import { create } from 'zustand'
import { createId } from '../../utils/id.js'

/**
 * 后台任务表：工具调用与子 Agent 都登记成任务，界面在任务面板里统一查看进度与结果。
 * 任务只是「观测与控制」的入口，真正的执行仍在 runtime / subagent 里，
 * 因此即使面板关掉，任务也会继续跑。
 */
export type TaskKind = 'tool' | 'subagent'

export type TaskStatus = 'running' | 'done' | 'error' | 'cancelled' | 'detached'

export type AgentTask = {
  id: string
  sessionId: string
  kind: TaskKind
  /** 工具名或子 Agent 的任务类型 */
  toolName: string
  /** 短标签，例如「写入工作区文件」 */
  label: string
  /** Agent 给出的一句话目的 */
  purpose: string
  status: TaskStatus
  startedAt: number
  endedAt?: number
  progress?: string
  /** 结果预览（截断后的文本） */
  output?: string
  isError?: boolean
  /** 是否已转入后台：前台不再等它，完成后结果留在面板里 */
  detached: boolean
}

type TaskStore = { tasks: AgentTask[] }

/** 只保留最近的任务，避免长会话把内存吃满 */
const MAX_TASKS = 60

export const useTasks = create<TaskStore>(() => ({ tasks: [] }))

/** 每个任务的取消句柄；不放进 store，避免被序列化或误订阅 */
const controllers = new Map<string, AbortController>()
/** 转入后台时用来解除前台的等待 */
const detachers = new Map<string, () => void>()

const patch = (id: string, update: (task: AgentTask) => AgentTask) =>
  useTasks.setState((state) => ({
    tasks: state.tasks.map((task) => (task.id === id ? update(task) : task)),
  }))

export type StartTaskInput = Omit<AgentTask, 'id' | 'status' | 'startedAt' | 'detached'> & {
  /** 已在运行的取消信号，任务取消时一并中止 */
  parentSignal?: AbortSignal
}

export type TaskHandle = {
  id: string
  signal: AbortSignal
  /** 前台是否还在等这个任务 */
  detached: boolean
  /** 结束时写回结果；后台任务的结果留给面板查看 */
  finish: (result: { output: string; isError?: boolean }) => void
  /** 请求转入后台：前台立即返回，任务继续执行 */
  detach: () => void
  /** 等待「转入后台」信号，用来和工具执行竞速 */
  waitDetach: () => Promise<void>
  /** 任务被用户取消时触发 */
  onCancel: (listener: () => void) => void
}

export const startTask = (input: StartTaskInput): TaskHandle => {
  const id = createId()
  const controller = new AbortController()
  controllers.set(id, controller)
  const onParentAbort = () => controller.abort()
  input.parentSignal?.addEventListener('abort', onParentAbort, { once: true })

  let detached = false
  let resolveDetach: (() => void) | undefined
  const detachPromise = new Promise<void>((resolve) => {
    resolveDetach = resolve
  })
  const cancelListeners: (() => void)[] = []

  const task: AgentTask = {
    id,
    sessionId: input.sessionId,
    kind: input.kind,
    toolName: input.toolName,
    label: input.label,
    purpose: input.purpose,
    status: 'running',
    startedAt: Date.now(),
    progress: input.progress,
    detached: false,
  }
  useTasks.setState((state) => ({ tasks: [task, ...state.tasks].slice(0, MAX_TASKS) }))

  const cleanup = () => {
    controllers.delete(id)
    detachers.delete(id)
    input.parentSignal?.removeEventListener('abort', onParentAbort)
  }

  const handle: TaskHandle = {
    id,
    signal: controller.signal,
    get detached() {
      return detached
    },
    finish: ({ output, isError }) => {
      patch(id, (item) =>
        item.status === 'cancelled'
          ? item
          : {
              ...item,
              status: isError ? 'error' : 'done',
              endedAt: Date.now(),
              output: output.slice(0, 4000),
              isError,
              progress: undefined,
            }
      )
      cleanup()
    },
    detach: () => {
      if (detached) {
        return
      }
      detached = true
      patch(id, (item) => ({ ...item, detached: true, status: 'detached' }))
      resolveDetach?.()
    },
    onCancel: (listener) => {
      cancelListeners.push(listener)
    },
    waitDetach: () => detachPromise,
  }

  detachers.set(id, handle.detach)
  // 取消：中止执行并把状态落定，由 runtime 的 catch 收尾
  controller.signal.addEventListener(
    'abort',
    () => {
      patch(id, (item) =>
        item.status === 'running' || item.status === 'detached'
          ? { ...item, status: 'cancelled', endedAt: Date.now(), progress: undefined }
          : item
      )
      for (const listener of cancelListeners) {
        listener()
      }
    },
    { once: true }
  )
  return handle
}

/** 界面按钮：把这个任务转入后台 */
export const detachTask = (id: string) => detachers.get(id)?.()

/** 任务面板：取消任务 */
export const cancelTask = (id: string) => controllers.get(id)?.abort()

/** 清除已完成/失败/取消的任务记录 */
export const clearFinishedTasks = (sessionId?: string) =>
  useTasks.setState((state) => ({
    tasks: state.tasks.filter(
      (task) =>
        task.status === 'running' ||
        task.status === 'detached' ||
        (sessionId !== undefined && task.sessionId !== sessionId)
    ),
  }))

export const removeTask = (id: string) =>
  useTasks.setState((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))

export const runningTaskCount = () =>
  useTasks.getState().tasks.filter((task) => task.status === 'running' || task.status === 'detached')
    .length
