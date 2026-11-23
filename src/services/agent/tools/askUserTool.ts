import { defineTool, fail, objectSchema, ok, str } from '../toolKit.js'
import { askUser, type UserPromptOption } from '../userPrompt.js'
import type { RegisteredTool } from '../types.js'

/** 选项太多会把输入框撑爆，也超出用户一眼能比较的范围 */
const MAX_OPTIONS = 6

/** 模型偶尔把选项写成字符串数组，两种形态都接受 */
const readOptions = (input: Record<string, unknown>): UserPromptOption[] => {
  const raw = input.options
  if (!Array.isArray(raw)) {
    return []
  }
  const options: UserPromptOption[] = []
  for (const item of raw) {
    const record =
      typeof item === 'string'
        ? { label: item }
        : typeof item === 'object' && item !== null
          ? (item as Record<string, unknown>)
          : null
    if (!record) {
      continue
    }
    const label = str(record, 'label').trim()
    if (!label || options.some((option) => option.label === label)) {
      continue
    }
    const description = str(record, 'description').trim()
    options.push({ label, description: description || undefined })
    if (options.length >= MAX_OPTIONS) {
      break
    }
  }
  return options
}

/** 回答整理成模型易读的几条，避免它把整段 JSON 当结论 */
const describeAnswer = (question: string, selected: string[], custom: string) => {
  const lines = [`用户回答了你刚才的提问「${question}」。`]
  if (selected.length === 1) {
    lines.push(`- 选择：${selected[0]}`)
  } else if (selected.length > 1) {
    lines.push(`- 选择：${selected.join('、')}`)
  }
  if (custom) {
    lines.push(`- 补充说明：${custom}`)
  }
  lines.push('请按这个回答继续，不要重复询问同一件事。')
  return lines.join('\n')
}

export const askUserTools: RegisteredTool[] = [
  defineTool(
    {
      name: 'ask_user',
      label: '向你提问',
      description: [
        '向用户提出一个问题并等待回答。回答会作为工具结果返回给你。',
        '适合：需要用户做选择、缺少关键信息（路径、账号、目标平台）、指令有歧义、即将执行不可逆操作需要确认。',
        '一次只问一个问题；能列出候选方案时给出 2-4 个选项，用户也可以自己输入。',
        '不要用它询问可以自己查证或本该自己判断的琐事（例如「我可以开始了吗」），也不要连续提问。',
      ].join(''),
      inputSchema: objectSchema(
        {
          question: { type: 'string', description: '要问用户的问题，一句话说清楚' },
          header: {
            type: 'string',
            description: '短标题（不超过 12 字），例如「部署目标」「文件格式」',
          },
          options: {
            type: 'array',
            description: `可选项，最多 ${MAX_OPTIONS} 个；留空时用户只能自由输入`,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项文案，简短' },
                description: { type: 'string', description: '一句话说明这个选项的后果' },
              },
              required: ['label'],
            },
          },
          multi: { type: 'boolean', description: '是否允许多选，默认单选' },
          placeholder: { type: 'string', description: '输入框占位文案' },
        },
        ['question']
      ),
      risk: 'safe',
      icon: 'question',
      // 用户可能过很久才回答，不设超时
      timeoutMs: Number.POSITIVE_INFINITY,
    },
    async (input, context) => {
      const question = str(input, 'question').trim()
      if (!question) {
        return fail('question 不能为空')
      }
      const options = readOptions(input)
      const prompt = {
        id: `ask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId: context.sessionId,
        question: question.slice(0, 400),
        header: str(input, 'header').trim().slice(0, 24) || undefined,
        options,
        multi: input.multi === true && options.length > 1,
        placeholder: str(input, 'placeholder').trim().slice(0, 80) || undefined,
        createdAt: Date.now(),
      }

      const answer = await askUser(prompt, context.signal)

      if (!answer) {
        // 中止由运行时的 signal 判断收尾，这里只处理用户主动跳过
        if (context.signal.aborted) {
          return fail('用户停止了生成，提问已撤回。')
        }
        return ok(
          [
            `用户跳过了你的提问「${question}」，没有给出回答。`,
            '请按最合理的默认方案继续，并在回复里说明你采用的假设；不要再次追问同一件事。',
          ].join('\n')
        )
      }

      return ok(describeAnswer(question, answer.selected, answer.custom), {
        meta: {
          askUser: {
            question,
            selected: answer.selected,
            custom: answer.custom,
          },
        },
      })
    }
  ),
]
