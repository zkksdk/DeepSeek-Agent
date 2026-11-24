import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'
import type {
  ArtifactMeta,
  ToolCallStatus,
  ToolSource,
} from '../agent/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  /** 当前 serverId 对应的上传图片已确认符合长边限制。旧记录缺少此字段。 */
  imageSizeChecked?: boolean
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock =
  | ThinkingPart
  | TextPart
  | ServerToolBlock
  | ToolCallPart
  | ToolResultPart

/** 客户端工具调用：参数以流式 JSON 分片累积，执行状态就地更新 */
export type ToolCallPart = {
  type: 'tool_use'
  id: string
  name: string
  /** 流式参数原文；流结束后解析为 input */
  inputJson: string
  input: unknown
  status: ToolCallStatus
  source: ToolSource
  startedAt: number
  endedAt?: number
  /** 用户审批结果 */
  decision?: 'allow' | 'deny'
  /** 执行阶段反馈（如桌面端命令输出片段） */
  progress?: string
  /** 工具展示名与风险，历史回放时不依赖注册表 */
  label?: string
  risk?: 'safe' | 'write' | 'exec' | 'network'
  /** 已转入后台：前台不再等它，结果在任务面板里 */
  detached?: boolean
  /** 对应的后台任务 id，界面据此提供「后台运行」与状态跳转 */
  taskId?: string
}

/** 工具结果：同时用于回传模型与界面展示 */
export type ToolResultPart = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  isError?: boolean
  artifacts?: ArtifactMeta[]
  durationMs?: number
  /** 工具自带的展示用元数据（改动行数、预览文件、任务 id 等），不进入模型上下文 */
  meta?: Record<string, unknown>
  /** 工具产出的图片附件，回传给模型时转成 image 内容块 */
  images?: ToolImage[]
}

/** 工具产生的内联图片：base64 回传，界面可直接渲染 */
export type ToolImage = {
  mediaType: string
  /** 不带 data: 前缀的 base64 */
  data: string
  name?: string
}

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  /** 远端模型 id 以字符串保存，历史记录同样兼容 */
  model: ChatModel | string | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  /**
   * 会话模式。缺省（旧会话）按 'work' 处理——那时候还没有这个字段，
   * Agent 能力是全局开着的，保持原行为。
   */
  mode?: SessionMode
  rootMessageId?: string | null
}

/** 会话模式：对话（纯聊天）/ 工作（允许模型调工具） */
export type SessionMode = 'chat' | 'work'

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'mode'>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  mode: session.mode,
})
