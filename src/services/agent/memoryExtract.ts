/**
 * 自动记忆整理：每轮对话结束后，让模型判断本轮是否包含值得长期记住的用户信息，
 * 有则写入本地记忆。失败静默，不影响主流程；可通过设置关闭。
 */
import { streamMessage } from '../api/client.js'
import { useSettings } from '../settings.js'
import { addMemory, mergeSimilarMemories, readMemories } from './memory.js'
import { useWorkspaces } from '../chat/workspaces.js'

const EXTRACT_SYSTEM_PROMPT = `你是记忆整理器。判断这段对话是否包含关于用户的、值得长期记住的稳定信息。

记录：偏好、习惯、身份、长期目标、明确约束、重要事实。
不记录：临时请求、一次性任务细节、闲聊、助手自己说的话、可从对话上下文推断的临时信息。

只输出严格 JSON，不要任何解释或代码块标记：
{"memories":["一句话记忆"]}

没有值得记的就输出 {"memories":[]}。每条不超过 60 字，最多 3 条。`

const collectText = (replyText: string): string => replyText.slice(0, 2000)

export const extractMemories = async (
  userText: string,
  assistantText: string,
  signal?: AbortSignal
): Promise<number> => {
  const trimmed = userText.trim()
  if (!trimmed) {
    return 0
  }
  const { apiKey, model, autoMemory } = useSettings.getState()
  if (!apiKey || !autoMemory) {
    return 0
  }
  try {
    const events = streamMessage(
      apiKey,
      {
        model,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `用户：${trimmed}\n\n助手：${collectText(assistantText)}`,
          },
        ],
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
        tools: [],
      },
      signal ?? new AbortController().signal
    )
    let text = ''
    for await (const event of events) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        text += event.content_block.text
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      return 0
    }
    const parsed = JSON.parse(match[0]) as { memories?: unknown }
    const list = Array.isArray(parsed.memories)
      ? parsed.memories.filter((item): item is string => typeof item === 'string' && !!item.trim())
      : []
    const existing = new Set(readMemories().map((item) => item.content))
    let added = 0
    for (const item of list.slice(0, 3)) {
      const content = item.trim()
      if (content && !existing.has(content)) {
        addMemory(content, useWorkspaces.getState().activeId)
        added += 1
      }
    }
    if (added > 0) {
      // 新增后顺手归并相似记忆，避免越积越多
      mergeSimilarMemories()
    }
    return added
  } catch {
    // 记忆整理失败不影响对话
    return 0
  }
}
