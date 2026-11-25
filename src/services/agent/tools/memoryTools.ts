import { defineTool, fail, num, objectSchema, ok, str } from '../toolKit.js'
import type { RegisteredTool } from '../types.js'
import { add, loadAll, useMemory } from '../../memory/store.js'
import { touchMemory } from '../../chat/db.js'
import type { StoredMemory } from '../../chat/db.js'
import { useWorkspace } from '../../workspace/store.js'

/**
 * 记忆工具。
 *
 * 只在工作模式（agentEnabled）下声明——对话模式是纯聊天，不该往外写东西。
 *
 * 写入的判断权交给模型：什么值得记，代码判断不了。但工具描述里给了硬约束，
 * 明确写着「能从代码推出来的不要记」，否则记忆库很快会被脚手架信息灌满。
 */

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const

const saveMemoryTool = defineTool(
  {
    name: 'save_memory',
    label: '记住这件事',
    description:
      '把一条值得跨会话记住的事存进长期记忆。适合记：用户的偏好和习惯（user）、用户纠正过你的做法（feedback）、代码里看不出来的项目决策（project）、外部信息的来源（reference）。不要记：能从代码或文件里直接看出来的东西（架构、路径、依赖名）、一次性的临时状态、还没确认的猜测。同一件事只记一条，重复记会污染索引。',
    inputSchema: objectSchema(
      {
        type: {
          type: 'string',
          description: 'user=用户偏好 / feedback=被纠正的做法 / project=项目决策 / reference=外部来源',
        },
        title: {
          type: 'string',
          description: '一行摘要，不超过 40 字，这句话会直接进系统提示词',
        },
        body: {
          type: 'string',
          description: '详情：具体是什么、为什么、怎么用。200 字以内说清楚',
        },
        scope: {
          type: 'string',
          description:
            'workspace=只在这个项目生效（默认）/ global=所有项目通用。项目约定用 workspace，用户偏好用 global',
        },
      },
      ['type', 'title', 'body']
    ),
  },
  async (input) => {
    const type = str(input, 'type') as StoredMemory['type']
    if (!MEMORY_TYPES.includes(type)) {
      return fail('type 只能是 user / feedback / project / reference')
    }
    const title = str(input, 'title').trim()
    const body = str(input, 'body').trim()
    if (!title) {
      return fail('title 不能为空')
    }
    if (!body) {
      return fail('body 不能为空')
    }
    // 同一件事别记两遍：标题撞了就更新正文，不新增
    const existing = useMemory
      .getState()
      .list.find((item) => item.type === type && item.title === title)
    // 默认只挂到当前工作区：别的项目不该看到「这个仓库用 pnpm」
    const scope = str(input, 'scope').trim() || 'workspace'
    const activeWorkspace = useWorkspace.getState().activeId
    const memory = await add({
      type,
      title,
      body,
      ...(scope === 'workspace' && activeWorkspace ? { workspaceId: activeWorkspace } : {}),
    })
    return ok(
      existing
        ? '已有同标题的记忆，这次作为新的补充：' + title
        : '已记住：' + title + '（当前共 ' + useMemory.getState().list.length + ' 条）',
      { meta: { memoryId: memory.id } }
    )
  }
)

const recallMemoryTool = defineTool(
  {
    name: 'recall_memory',
    label: '翻记忆',
    description:
      '系统提示词里只列了记忆的标题。需要具体细节时用它按关键词搜正文，返回匹配的完整内容。搜不到就说搜不到，不要根据标题自己编。',
    inputSchema: objectSchema(
      {
        query: {
          type: 'string',
          description: '关键词；可以空格分隔多个，命中任意一个就算',
        },
        limit: { type: 'number', description: '最多返回几条，默认 5' },
      },
      ['query']
    ),
  },
  async (input) => {
    const query = str(input, 'query').trim().toLowerCase()
    if (!query) {
      return fail('query 不能为空')
    }
    const limit = Math.min(20, Math.max(1, Math.round(num(input, 'limit') ?? 5)))
    const terms = query.split(/\s+/).filter(Boolean)

    // 内存里没有就先从库里拉一次，避免冷启动时搜空
    if (useMemory.getState().list.length === 0) {
      await loadAll()
    }

    const activeWorkspace = useWorkspace.getState().activeId
    const matched = useMemory
      .getState()
      // 和 memoryPrompt 同样的作用域规则：别的项目的约定搜不出来
      .filter((item) => !item.workspaceId || item.workspaceId === activeWorkspace)
      .filter((item) => {
        const haystack = (item.title + ' ' + item.body).toLowerCase()
        return terms.some((term) => haystack.includes(term))
      })
      .slice(0, limit)

    if (matched.length === 0) {
      return ok('没有匹配的记忆。如果这件事确实该记住，可以用 save_memory 存下来。')
    }

    for (const item of matched) {
      void touchMemory(item.id).catch(() => {})
    }

    const text = matched
      .map(
        (item, index) =>
          index +
          1 +
          '. [' +
          item.type +
          '] ' +
          item.title +
          '\n   ' +
          item.body.split('\n').join('\n   ')
      )
      .join('\n\n')
    return ok(text + '\n\n（共命中 ' + matched.length + ' 条）', { meta: { count: matched.length } })
  }
)

export const memoryTools: RegisteredTool[] = [saveMemoryTool, recallMemoryTool]
