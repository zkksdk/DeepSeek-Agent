import type { CreateMessageRequest, MessageStreamEvent, ToolUseBlock } from '../api/types.js'
import { DEMO_WIDGET_HTML } from './mockWidgets.js'

/**
 * 本地演示模型：不请求网络，按剧本产生与真实服务一致的事件流。
 * 用于在没有 API Key、或服务端暂不支持自定义 tools 时验证工具调用链路与界面。
 */

const CITY_PATTERN = /(北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|重庆|苏州|天津|长沙|青岛|厦门| Tokyo| Beijing| Shanghai)/i

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 当前轮的工具结果：只看最后一条用户提问之后的部分。
 * 历史轮次的结果不能参与判断，否则多轮对话会把上一轮当成这一轮。
 */
const currentToolResults = (body: CreateMessageRequest): string[] => {
  let start = 0
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const message = body.messages[i]
    if (message.role === 'user' && typeof message.content === 'string') {
      start = i + 1
      break
    }
  }
  const out: string[] = []
  for (let i = start; i < body.messages.length; i += 1) {
    const message = body.messages[i]
    if (message.role !== 'user' || typeof message.content === 'string') {
      continue
    }
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push(
          typeof block.content === 'string'
            ? block.content
            : block.content
                .map((item) => (item.type === 'text' ? item.text : `[图片 ${item.source.media_type}]`))
                .join('\n')
        )
      }
    }
  }
  return out
}

const countToolResults = (body: CreateMessageRequest) => currentToolResults(body).length

const lastUserText = (body: CreateMessageRequest): string => {
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const message = body.messages[i]
    if (message.role !== 'user') {
      continue
    }
    if (typeof message.content === 'string') {
      return message.content
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    if (text) {
      return text
    }
  }
  return ''
}

const pickCity = (text: string) => CITY_PATTERN.exec(text)?.[1] ?? '杭州'

const wantsTools = (text: string) =>
  /(天气|气温|时间|日期|几点|工具|演示|报告|文件|笔记|notes|图表|可视化|组件|widget|屏幕|截屏|截图|研究|调研|对比|子 ?agent|提问|问我|确认|选项|选择|工作区|分支|diff|改动|workspace|branch|demo|weather|time)/i.test(
    text
  )

/** 把一段文本切片输出，模拟逐字生成 */
async function* emitText(
  index: number,
  text: string,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  const size = 7
  for (let offset = 0; offset < text.length; offset += size) {
    await sleep(16, signal)
    yield {
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text: text.slice(offset, offset + size) },
    }
  }
  yield { type: 'content_block_stop', index }
}

async function* emitThinking(
  index: number,
  text: string,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  yield {
    type: 'content_block_start',
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  }
  for (let offset = 0; offset < text.length; offset += 6) {
    await sleep(14, signal)
    yield {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: text.slice(offset, offset + 6) },
    }
  }
  yield { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'mock' } }
  yield { type: 'content_block_stop', index }
}

async function* emitTool(
  index: number,
  block: ToolUseBlock,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  yield {
    type: 'content_block_start',
    index,
    content_block: { ...block, input: {} },
  }
  const json = JSON.stringify(block.input ?? {})
  for (let offset = 0; offset < json.length; offset += 12) {
    await sleep(10, signal)
    yield {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: json.slice(offset, offset + 12) },
    }
  }
  yield { type: 'content_block_stop', index }
}

const usage = {
  input_tokens: 1200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 800,
  output_tokens: 320,
}

/** 桌面端剧本：验证「本机工具声明 → 模型调用 → 审批 → 执行 → 结果回传」全链路 */
const DESK_PATTERN = /本机|桌面端|本地|写入|创建.{0,4}文件/
const DESK_FILE = 'agent-notes/hello.md'

const hasTool = (body: CreateMessageRequest, name: string) =>
  (body.tools ?? []).some((tool) => 'name' in tool && tool.name === name)

/** MCP 工具会加上服务器前缀，这里按后缀匹配，拿到实际注册名 */
const findToolName = (body: CreateMessageRequest, name: string) =>
  (body.tools ?? [])
    .flatMap((tool) => ('name' in tool ? [tool.name] : []))
    .find((item) => item === name || item.endsWith(`_${name}`))

/** 工作区剧本：先列变更，再把结果读回来总结 */
const WORKSPACE_PATTERN = /工作区|分支|diff|改动|变更|workspace|branch/i

async function* workspaceScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '用户想看工作区状态。先调用 workspace_list_files 拿到分支与变更清单，比凭印象描述准确。',
      signal
    )
    yield* emitText(1, '我先看一下工作区里改了哪些文件。', signal)
    yield* emitTool(
      2,
      { type: 'tool_use', id: `toolu_mock_ws_${Date.now()}`, name: 'workspace_list_files', input: {} },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const list = currentToolResults(body).at(-1) ?? ''
  yield* emitText(
    1,
    [
      '工作区当前状态：',
      '',
      list,
      '',
      '侧栏「工作区」或 `Ctrl/Cmd + Shift + E` 可以打开面板，点文件看逐行 diff：删除行红底、新增行绿底。',
      '也可以让我直接改文件，写入前会先让你确认。',
    ].join('\n'),
    signal
  )
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage }
  yield { type: 'message_stop' }
}

/** 远程 MCP 剧本：验证「工具发现 → 声明 → 调用 → 结果回传」全链路 */
const MCP_PATTERN = /笔记|notes|知识库/i

/** 从自然语言里取一个检索词，取不到时退回默认关键词 */
const noteQuery = (text: string) =>
  /关于\s*([^\s，。？?!]{1,16})/.exec(text)?.[1] ??
  /(?:笔记|notes)[^，。？?!]{0,4}?(?:里的|中的|的)\s*([^\s，。？?!]{1,16})/.exec(text)?.[1] ??
  'MCP'

async function* mcpScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number,
  toolName: string,
  query: string
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '用户要查笔记。这不是浏览器内置工具，而是远程 MCP 服务器提供的 notes_search，先按它的 schema 传入检索词。',
      signal
    )
    yield* emitText(1, '我用 MCP 服务器上的笔记检索工具查一下。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_mcp_${Date.now()}`,
        name: toolName,
        input: { query },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const output = currentToolResults(body).at(-1)?.trim() || '服务器没有返回内容。'
  yield* emitText(
    0,
    `笔记服务返回了结果：\n\n${output}\n\n这条调用走的是 Streamable HTTP：浏览器 → MCP 服务器 → 工具执行 → 结果回传，全程不经过桌面端。`,
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

async function* desktopScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '用户要在这台机器上创建文件。桌面端已连接，desk_fs_write 可以写入沙箱目录，我先写一份说明文档，再把路径告诉用户。',
      signal
    )
    yield* emitText(1, '桌面端已连接，我直接在沙箱里创建一个说明文件。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_desk_${Date.now()}`,
        name: 'desk_fs_write',
        input: {
          path: DESK_FILE,
          content: [
            '# 本机 Agent 演示',
            '',
            '这个文件由网页里的 Agent 通过桌面端写入本机。',
            '',
            '- 写入位置：桌面端沙箱目录',
            '- 触发工具：`desk_fs_write`',
            '- 审批：写操作默认需要确认',
          ].join('\n'),
        },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const output = currentToolResults(body).at(-1) ?? ''
  const failed = /失败|错误|拒绝|超出沙箱/.test(output)
  yield* emitText(
    0,
    failed
      ? `本机写入没有成功：\n\n> ${output.split('\n')[0]}\n\n可以在「Agent 能力 → 桌面端」确认连接与沙箱目录。`
      : `已在本机写入 \`${DESK_FILE}\`。\n\n| 项目 | 结果 |\n| --- | --- |\n| 位置 | 桌面端沙箱目录 |\n| 工具 | desk_fs_write |\n| 状态 | 成功 |\n\n文件内容可以直接用编辑器打开查看。`,
    signal
  )
}

/** Widget 剧本：验证「模型主动生成可视化组件」的链路 */
const WIDGET_PATTERN = /widget|组件|图表|可视化|画个|趋势|仪表盘|dashboard/i

async function* widgetScenario(
  signal: AbortSignal,
  results: number
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '这种数据做成可交互组件比表格更直观。show_widget 能把 HTML 直接渲染进对话，用一个指标卡加柱状图的面板。',
      signal
    )
    yield* emitText(1, '我把调用趋势做成一个可交互面板。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_widget_${Date.now()}`,
        name: 'show_widget',
        input: {
          title: '近七日调用趋势',
          html: DEMO_WIDGET_HTML,
          note: '三张指标卡与七日柱状图，带入场动画',
        },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  yield* emitText(
    0,
    [
      '组件已经生成在消息里，可以直接看，也可以展开到全屏。',
      '',
      '| 指标 | 数值 |',
      '| --- | --- |',
      '| 今日调用 | ==blue:1,284== |',
      '| 成功率 | ==green:99.2%== |',
      '| 平均耗时 | 312 ms |',
      '',
      '> [!TIP]',
      '> 想看别的维度，比如按工具类型拆分，说一声就行。',
      '',
      '顺便演示一下行内语法：==purple:紫色高亮==、~手写波浪线~、==green:绿色高亮==。',
    ].join('\n'),
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

/** 子 Agent 剧本：验证派生、独立执行与结果回传 */
const RESEARCH_PATTERN = /研究|调研|分别|对比|子任务|子 ?agent|并行/i

async function* researchScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number,
  question: string
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '这个请求可以拆成独立的调研任务。派一个子 Agent 去跑，它有自己的上下文和只读工具，主对话只保留结论。',
      signal
    )
    yield* emitText(1, '我派一个子 Agent 去查，拿到结论后再汇总。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_sub_${Date.now()}`,
        name: 'spawn_subagent',
        input: {
          task: `调研并回答：${question}`,
          max_rounds: 3,
        },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const output = currentToolResults(body).at(-1)?.trim() || '子 Agent 没有返回内容。'
  yield* emitText(
    0,
    [
      '子 Agent 已经返回结论：',
      '',
      output,
      '',
      '> [!NOTE]',
      '> 子 Agent 的中间工具调用不会进入主对话，只回传最终结论，上下文更干净。',
    ].join('\n'),
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

/** 电脑操作剧本：验证截屏 → 图片产物链路 */
const COMPUTER_PATTERN = /屏幕|截屏|截图|电脑操作|桌面操作|鼠标|键盘/i

async function* computerScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number
): AsyncGenerator<MessageStreamEvent> {
  if (results === 0) {
    yield* emitThinking(
      0,
      '用户要看屏幕。桌面端已连接，desk_screen_capture 会返回 PNG，运行时把它存成图片产物，消息里能直接看到。',
      signal
    )
    yield* emitText(1, '我截一张当前屏幕。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_screen_${Date.now()}`,
        name: 'desk_screen_capture',
        input: {},
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const output = currentToolResults(body).at(-1) ?? ''
  const failed = /失败|缺少|未找到|Error|error/.test(output)
  yield* emitText(
    0,
    failed
      ? `截屏没有成功：\n\n> ${output.split('\n')[0]}\n\n确认桌面端运行在有图形界面的会话里，Linux 需要 xdotool 与 ImageMagick。`
      : [
          '已截取当前屏幕，图片在上方产物里，可以预览或下载。',
          '',
          '继续操作时，我会先用截图确认坐标，再调用鼠标或键盘工具：',
          '',
          '| 工具 | 作用 |',
          '| --- | --- |',
          '| `desk_mouse` | 移动或点击指定坐标 |',
          '| `desk_keyboard` | 输入文本、发送组合键 |',
          '| `desk_window` | 列出或聚焦窗口 |',
          '',
          '> [!WARNING]',
          '> 电脑操作会直接控制你的鼠标和键盘，执行前请确认目标窗口；敏感操作建议先切到独立桌面。',
        ].join('\n'),
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

/** 反问剧本：验证「模型提问 → 阻塞等待 → 回答作为工具结果回传」 */
const ASK_PATTERN = /提问|问我|反问我|确认一下|选项|选择|ask_user/i

async function* askScenario(
  body: CreateMessageRequest,
  signal: AbortSignal,
  results: number
): AsyncGenerator<MessageStreamEvent> {
  const multi = /多选/.test(lastUserText(body))
  if (results === 0) {
    yield* emitThinking(
      0,
      '用户要我先确认再做。ask_user 会把问题挂在输入框上方并阻塞本轮，拿到回答后作为工具结果继续，比猜一个默认值稳。',
      signal
    )
    yield* emitText(1, multi ? '有几个开关想一起确认，可以多选。' : '这一步有几种做法，先跟你确认一下。', signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: `toolu_mock_ask_${Date.now()}`,
        name: 'ask_user',
        input: multi
          ? {
              header: '构建选项',
              question: '这次构建要一起开启哪些能力？勾选后我一并打包。',
              options: [
                { label: 'MCP 客户端', description: '保留远程工具连接能力' },
                { label: '桌面端桥接', description: '本机文件、命令与截屏' },
                { label: '浏览器扩展', description: '读取并操作当前网页' },
                { label: '演示模式', description: '没有 API Key 时也能跑通链路' },
              ],
              multi: true,
              placeholder: '还想加别的，直接写',
            }
          : {
              header: '部署目标',
              question: '站点要发布到哪个地址？我会按你的选择配置 base 路径和构建产物。',
              options: [
                { label: 'aoan2011.github.io', description: '根路径部署，base 设为 /' },
                {
                  label: '仓库子路径 /chat-agent/',
                  description: 'base 设为 /chat-agent/，适合项目页',
                },
                { label: '先只构建，不上传', description: '打包好 dist，并给出上传命令' },
              ],
              multi: false,
              placeholder: '也可以直接填自定义域名',
            },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const answer = currentToolResults(body).at(-1)?.trim() || ''
  const picked = answer.split('\n').find((line) => line.startsWith('- 选择：')) ?? ''
  yield* emitText(
    0,
    [
      '收到你的回答，按这个方案继续：',
      '',
      `> ${picked.replace(/^- 选择：/, '目标：') || answer.split('\n')[0]}`,
      '',
      '| 项目 | 处理方式 |',
      '| --- | --- |',
      '| base 路径 | 由目标地址推导 |',
      '| 构建产物 | `dist`，相对资源路径 |',
      '| 上传 | 构建完成后给出命令 |',
      '',
      '> [!NOTE]',
      '> 这是演示模式下的固定回复。接入 API Key 后，模型会把真实回答当作工具结果继续推理。',
    ].join('\n'),
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

export async function* mockStreamMessage(
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  yield {
    type: 'message_start',
    message: { id: `msg_mock_${Date.now()}`, model: body.model, usage },
  }

  // 子 Agent 有独立系统提示，给一段只说明链路的结论即可
  if (body.system.includes('子 Agent')) {
    const task = lastUserText(body)
    yield* emitText(
      0,
      [
        `子任务结论（演示模式）：已处理「${task.slice(0, 40)}」。`,
        '',
        '- 关键发现：演示模式没有真实检索能力，这里只验证子 Agent 的派生、独立上下文与结果回传。',
        '- 建议：接入 API Key 后，子 Agent 会按任务实际调用只读工具，并把依据一并返回。',
      ].join('\n'),
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const question = lastUserText(body)
  const results = countToolResults(body)
  const city = pickCity(question)

  if (!wantsTools(question)) {
    yield* emitText(
      0,
      '这是本地演示模式的回答。\n\n当前没有配置可用的 API Key，所以由浏览器内置的脚本化模型生成内容。你可以在**设置 → Agent** 中关闭演示模式并填入 API Key，即可使用真实模型。\n\n试试问我：「查一下杭州天气，并整理成一份报告」。',
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  if (ASK_PATTERN.test(question) && hasTool(body, 'ask_user')) {
    yield* askScenario(body, signal, results)
    return
  }

  if (WORKSPACE_PATTERN.test(question) && hasTool(body, 'workspace_list_files')) {
    yield* workspaceScenario(body, signal, results)
    return
  }

  if (COMPUTER_PATTERN.test(question) && hasTool(body, 'desk_screen_capture')) {
    yield* computerScenario(body, signal, results)
    return
  }

  if (DESK_PATTERN.test(question) && hasTool(body, 'desk_fs_write')) {
    yield* desktopScenario(body, signal, results)
    return
  }

  if (MCP_PATTERN.test(question)) {
    const toolName = findToolName(body, 'notes_search')
    if (toolName) {
      yield* mcpScenario(body, signal, results, toolName, noteQuery(question))
      return
    }
    if (results === 0) {
      yield* emitText(
        0,
        '看起来你想查笔记，但当前没有可用的笔记工具。\n\n打开「Agent 能力 → MCP」添加服务器，填入支持 Streamable HTTP 的端点并连接，我就能调用它的 `notes_search`。',
        signal
      )
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage,
      }
      yield { type: 'message_stop' }
      return
    }
  }

  if (WIDGET_PATTERN.test(question) && hasTool(body, 'show_widget')) {
    yield* widgetScenario(signal, results)
    return
  }

  if (RESEARCH_PATTERN.test(question) && hasTool(body, 'spawn_subagent')) {
    yield* researchScenario(body, signal, results, question)
    return
  }

  if (results === 0) {
    yield* emitThinking(
      0,
      `用户想了解${city}的天气并生成报告。我需要先获取实时天气，再调用时间工具确认日期，最后把结果整理成 Markdown 文件。`,
      signal
    )
    yield* emitText(1, `我先查一下${city}的实时天气。`, signal)
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: 'toolu_mock_weather',
        name: 'get_weather',
        input: { location: city, days: 3 },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  const weatherResult = currentToolResults(body).find((item) => item.includes('当前：')) ?? ''
  const weatherLine = /当前：(.+)/.exec(weatherResult)?.[1] ?? '天气数据已获取'
  const report = [
    `# ${city}天气简报`,
    '',
    '> 由 DeepSeek Agent 自动生成',
    '',
    '## 实况',
    '',
    `- ${weatherLine}`,
    '',
    '## 三日预报',
    '',
    '| 日期 | 天气 | 温度 | 降水概率 |',
    '| --- | --- | --- | --- |',
    '| 今天 | 多云 | 18~26°C | 20% |',
    '| 明天 | 晴 | 17~27°C | 10% |',
    '| 后天 | 小雨 | 16~23°C | 65% |',
    '',
    '## 建议',
    '',
    '- 早晚温差较大，外出建议带一件薄外套。',
    '- 后天有降水，出门记得带伞。',
  ].join('\n')

  if (results === 1) {
    const temperature = /当前：[^\n]*?(-?\d+(?:\.\d+)?)°C/.exec(weatherResult)?.[1]
    yield* emitText(
      0,
      `拿到了${city}的天气数据${temperature ? `，当前约 ${temperature}°C` : ''}。我再确认一下日期，并把结果写成报告文件。`,
      signal
    )
    yield* emitTool(
      1,
      { type: 'tool_use', id: 'toolu_mock_time', name: 'get_datetime', input: {} },
      signal
    )
    yield* emitTool(
      2,
      {
        type: 'tool_use',
        id: 'toolu_mock_file',
        name: 'create_file',
        input: {
          name: 'weather-report.md',
          mime: 'text/markdown',
          description: `${city}三日天气简报`,
          content: report,
        },
      },
      signal
    )
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  yield* emitText(
    0,
    `已完成 ${city} 的天气查询与整理：\n\n| 项目 | 结果 |\n| --- | --- |\n| 实况 | ${weatherLine.replace(/\|/g, '\\|')} |\n| 工具调用 | 3 次（天气 / 时间 / 生成文件） |\n| 产物 | weather-report.md |\n\n报告已经生成，可在上方工具卡片或下方文件卡片中预览、下载。`,
    signal
  )
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}
