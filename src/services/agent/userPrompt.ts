import { create } from 'zustand'

/** 选项：一句话说明比标题更有用，可选 */
export type UserPromptOption = {
  label: string
  description?: string
}

/** 模型发起的一次提问，展示在输入框上方，回答后作为工具结果回传 */
export type UserPrompt = {
  id: string
  sessionId: string
  question: string
  /** 模型给的短标题，例如「部署目标」 */
  header?: string
  options: UserPromptOption[]
  /** 允许多选；没有选项时只能是自由输入 */
  multi: boolean
  placeholder?: string
  createdAt: number
}

export type UserPromptAnswer = {
  /** 用户勾选的选项，保持点击顺序 */
  selected: string[]
  /** 用户自己写的回答 */
  custom: string
}

type UserPromptState = {
  /** 先进先出；子 Agent 与主对话可能同时挂起 */
  queue: UserPrompt[]
}

export const useUserPrompts = create<UserPromptState>(() => ({ queue: [] }))

const resolvers = new Map<string, (answer: UserPromptAnswer | null) => void>()

const drop = (id: string) =>
  useUserPrompts.setState((state) => ({ queue: state.queue.filter((item) => item.id !== id) }))

/**
 * 挂起等待用户回答。signal 触发（停止生成、切换会话）时按「没回答」收尾，
 * 避免提问卡片留在界面上却已经没有等待者。
 */
export const askUser = (
  prompt: UserPrompt,
  signal?: AbortSignal
): Promise<UserPromptAnswer | null> => {
  if (signal?.aborted) {
    return Promise.resolve(null)
  }
  return new Promise<UserPromptAnswer | null>((resolve) => {
    const finish = (answer: UserPromptAnswer | null) => {
      resolvers.delete(prompt.id)
      signal?.removeEventListener('abort', onAbort)
      drop(prompt.id)
      resolve(answer)
    }
    const onAbort = () => finish(null)
    resolvers.set(prompt.id, finish)
    useUserPrompts.setState((state) => ({ queue: [...state.queue, prompt] }))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 提交回答；resolver 内部会把卡片从队列里移除 */
export const answerUserPrompt = (id: string, answer: UserPromptAnswer) => {
  resolvers.get(id)?.(answer)
}

/** 用户主动跳过：模型拿到 null，据此自行决定默认方案 */
export const skipUserPrompt = (id: string) => {
  resolvers.get(id)?.(null)
}

/** 停止生成、删除会话时清空，未回答的统一按跳过收尾 */
export const clearUserPrompts = (predicate: (prompt: UserPrompt) => boolean = () => true) => {
  for (const prompt of useUserPrompts.getState().queue.filter(predicate)) {
    resolvers.get(prompt.id)?.(null)
  }
}
