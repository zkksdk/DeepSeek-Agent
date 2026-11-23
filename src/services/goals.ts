import { create } from 'zustand'
import { createId } from '../utils/id.js'

/**
 * Agent 目标：跨轮次保留的「要达成什么」。
 * 与单轮的工具调用不同，目标会一直出现在系统提示里，直到被标记完成或放弃。
 */
export type GoalStatus = 'active' | 'done' | 'dropped'

export type Goal = {
  id: string
  title: string
  /** 验收标准、约束、拆解步骤等自由文本 */
  detail: string
  status: GoalStatus
  createdAt: number
  updatedAt: number
  /** 达成时的结论或产出说明 */
  result?: string
}

const STORAGE_KEY = 'chat-agent:goals'
const MAX_GOALS = 30

const load = (): Goal[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item): Goal[] => {
      if (!item || typeof item !== 'object') {
        return []
      }
      const record = item as Record<string, unknown>
      if (typeof record.title !== 'string') {
        return []
      }
      const status =
        record.status === 'done' || record.status === 'dropped' ? record.status : 'active'
      return [
        {
          id: typeof record.id === 'string' ? record.id : createId(),
          title: record.title.slice(0, 120),
          detail: typeof record.detail === 'string' ? record.detail.slice(0, 4000) : '',
          status,
          createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
          result: typeof record.result === 'string' ? record.result.slice(0, 2000) : undefined,
        },
      ]
    })
  } catch {
    return []
  }
}

export const useGoals = create<{ list: Goal[] }>(() => ({ list: load() }))

const persist = (list: Goal[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 存储不可用时只在内存里生效
  }
  useGoals.setState({ list })
}

export const addGoal = (title: string, detail = ''): Goal => {
  const now = Date.now()
  const goal: Goal = {
    id: createId(),
    title: title.trim().slice(0, 120) || '未命名目标',
    detail: detail.slice(0, 4000),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  persist([goal, ...useGoals.getState().list].slice(0, MAX_GOALS))
  return goal
}

export const updateGoal = (
  id: string,
  patch: Partial<Pick<Goal, 'title' | 'detail' | 'result'>>
) => {
  persist(
    useGoals.getState().list.map((goal) =>
      goal.id === id
        ? {
            ...goal,
            ...(patch.title !== undefined ? { title: patch.title.slice(0, 120) } : {}),
            ...(patch.detail !== undefined ? { detail: patch.detail.slice(0, 4000) } : {}),
            ...(patch.result !== undefined ? { result: patch.result.slice(0, 2000) } : {}),
            updatedAt: Date.now(),
          }
        : goal
    )
  )
}

const setStatus = (id: string, status: GoalStatus, result?: string) => {
  persist(
    useGoals.getState().list.map((goal) =>
      goal.id === id
        ? {
            ...goal,
            status,
            updatedAt: Date.now(),
            ...(result !== undefined ? { result: result.slice(0, 2000) } : {}),
          }
        : goal
    )
  )
}

export const completeGoal = (id: string, result?: string) => setStatus(id, 'done', result)
export const dropGoal = (id: string) => setStatus(id, 'dropped')
export const reopenGoal = (id: string) => setStatus(id, 'active')

export const removeGoal = (id: string) => {
  persist(useGoals.getState().list.filter((goal) => goal.id !== id))
}

export const activeGoals = () => useGoals.getState().list.filter((goal) => goal.status === 'active')

/** 拼进系统提示的目标清单；没有目标时返回空串 */
export const goalsPrompt = () => {
  const list = activeGoals()
  if (list.length === 0) {
    return ''
  }
  const lines = list.map((goal, index) => {
    const detail = goal.detail
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' / ')
    return `${index + 1}. ${goal.title}${detail ? `：${detail}` : ''}（id: ${goal.id}）`
  })
  return [
    '',
    '当前目标（由用户设定，跨轮次保留）：',
    ...lines,
    '推进目标时先用 manage_goals 更新细节，达成后用 manage_goals 标记 complete 并写明结论。不要自行放弃目标。',
  ].join('\n')
}

/**
 * 目标模板：新建时一键套用，用户再按需改写。
 * 文案刻意写成可编辑的骨架，而不是让人照抄的成品。
 */
export const GOAL_TEMPLATES: { id: string; name: string; title: string; detail: string }[] = [
  {
    id: 'deliver',
    name: '功能交付',
    title: '完成某个功能',
    detail: [
      '验收标准：',
      '1. ',
      '2. ',
      '约束：不改动无关模块；保持现有代码风格；涉及破坏性变更先确认。',
      '拆解：',
      '- [ ] 摸清现状（相关文件、调用链、已有测试）',
      '- [ ] 给出方案与影响面',
      '- [ ] 实现并自测',
      '- [ ] 补测试 / 文档',
    ].join('\n'),
  },
  {
    id: 'research',
    name: '调研对比',
    title: '调研并给出选型建议',
    detail: [
      '要回答的问题：',
      '1. ',
      '对比维度：成本、性能、生态、迁移代价、长期维护。',
      '输出：结论先行，再给依据与不确定性；每个结论标注来源。',
    ].join('\n'),
  },
  {
    id: 'debug',
    name: '问题排查',
    title: '定位并修复某个问题',
    detail: [
      '现象：',
      '复现步骤：',
      '怀疑范围：',
      '要求：先给最小复现或证据，再改代码；改完说明验证方式。',
    ].join('\n'),
  },
]
