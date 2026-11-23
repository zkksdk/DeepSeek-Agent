import { create } from 'zustand'
import { createId } from '../utils/id.js'

/** 用户保存的常用提示词，插到输入框里再手动补充细节 */
export type CustomPrompt = {
  id: string
  name: string
  content: string
  createdAt: number
}

const STORAGE_KEY = 'chat-agent:custom-prompts'
const MAX_PROMPTS = 40

/**
 * 首次使用时预置的提示词：都是可改的骨架，
 * 用户点「插入」后还能在输入框里补这一轮的具体条件。
 */
const DEFAULT_PROMPTS: Omit<CustomPrompt, 'id' | 'createdAt'>[] = [
  {
    name: '需求拆解',
    content: [
      '把下面这个需求拆成可以直接执行的步骤：',
      '',
      '需求：',
      '',
      '要求：先复述你对需求的理解，再列出步骤（每步说明产出物与验收方式），最后指出风险与需要我确认的点。',
    ].join('\n'),
  },
  {
    name: '代码评审',
    content: [
      '评审我这次的改动，重点只看风险：',
      '',
      '1. 行为变化与边界条件是否被考虑',
      '2. 是否有隐藏的兼容性/性能问题',
      '3. 缺少哪些测试',
      '',
      '按「必须改 / 建议改 / 可以不管」三档给结论，每条给出位置与理由。',
    ].join('\n'),
  },
  {
    name: '目标复盘',
    content: [
      '帮我复盘这个目标：',
      '',
      '目标：',
      '实际结果：',
      '',
      '按「做对了什么 / 差在哪 / 下次怎么改」三段写，结论先行，不要客套。',
    ].join('\n'),
  },
  {
    name: '周报',
    content: [
      '把这周做的事整理成周报：',
      '',
      '（贴要点或让我补充）',
      '',
      '结构：本周产出（按项目分组，写清结果而非过程）／遇到的问题与解法／下周计划。每项不超过两行。',
    ].join('\n'),
  },
]

const load = (): CustomPrompt[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    // 首次使用：写入默认提示词，之后用户可以随意改或删
    if (stored === null) {
      const seeded = DEFAULT_PROMPTS.map((prompt, index) => ({
        ...prompt,
        id: createId(),
        createdAt: Date.now() - index,
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
      return seeded
    }
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item): CustomPrompt[] => {
      if (!item || typeof item !== 'object') {
        return []
      }
      const record = item as Record<string, unknown>
      if (typeof record.name !== 'string' || typeof record.content !== 'string') {
        return []
      }
      return [
        {
          id: typeof record.id === 'string' ? record.id : createId(),
          name: record.name.slice(0, 40),
          content: record.content.slice(0, 8000),
          createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        },
      ]
    })
  } catch {
    return []
  }
}

export const usePrompts = create<{ list: CustomPrompt[] }>(() => ({ list: load() }))

const persist = (list: CustomPrompt[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 存储不可用时只在内存里生效
  }
  usePrompts.setState({ list })
}

export const addPrompt = (name: string, content: string) => {
  const prompt: CustomPrompt = {
    id: createId(),
    name: name.trim().slice(0, 40) || '未命名提示词',
    content: content.slice(0, 8000),
    createdAt: Date.now(),
  }
  const list = [prompt, ...usePrompts.getState().list].slice(0, MAX_PROMPTS)
  persist(list)
  return prompt
}

export const updatePrompt = (id: string, name: string, content: string) => {
  persist(
    usePrompts.getState().list.map((item) =>
      item.id === id
        ? { ...item, name: name.trim().slice(0, 40) || item.name, content: content.slice(0, 8000) }
        : item
    )
  )
}

export const removePrompt = (id: string) => {
  persist(usePrompts.getState().list.filter((item) => item.id !== id))
}
