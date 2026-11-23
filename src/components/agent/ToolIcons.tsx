import type { SVGProps } from 'react'
import type { ToolSource } from '../../services/agent/types.js'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const base = ({ size = 16, ...props }: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const IconClock = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </svg>
)

export const IconPin = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 14s4.4-3.9 4.4-7A4.4 4.4 0 0 0 3.6 7c0 3.1 4.4 7 4.4 7Z" />
    <circle cx="8" cy="6.9" r="1.6" />
  </svg>
)

export const IconCloud = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.7 12h6.6a2.4 2.4 0 0 0 .3-4.8A3.6 3.6 0 0 0 4.9 6.4 2.8 2.8 0 0 0 4.7 12Z" />
    <path d="M6.2 9.2h3.6" />
  </svg>
)

export const IconBell = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 6.6a4 4 0 0 1 8 0c0 2.6.8 3.4 1.2 3.8H2.8C3.2 10 4 9.2 4 6.6Z" />
    <path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" />
  </svg>
)

export const IconClipboard = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3.4" y="3.2" width="9.2" height="10" rx="1.4" />
    <path d="M6 3.2V2.4h4v.8" />
    <path d="M5.8 7h4.4M5.8 9.4h3" />
  </svg>
)

export const IconGlobe = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M2.6 8h10.8M8 2.4c1.6 1.7 2.4 3.6 2.4 5.6S9.6 12.3 8 13.6c-1.6-1.3-2.4-3.6-2.4-5.6S6.4 4.1 8 2.4Z" />
  </svg>
)

export const IconFile = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 1.8H4.6a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2V5.2L9 1.8Z" />
    <path d="M9 1.8v3.4h3.6M6 8.6h4M6 11h2.8" />
  </svg>
)

export const IconTerminal = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="2" y="3" width="12" height="10" rx="1.4" />
    <path d="m4.8 6.4 1.8 1.7-1.8 1.7M8.6 10.2h2.6" />
  </svg>
)

export const IconCode = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m5.6 5-3 3 3 3M10.4 5l3 3-3 3M9 3 7 13" />
  </svg>
)

export const IconFolder = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2 4.6c0-.7.6-1.2 1.2-1.2h2.6l1.2 1.4h4.8c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.6V4.6Z" />
  </svg>
)

export const IconDesktop = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="1.8" y="2.8" width="12.4" height="8.2" rx="1.2" />
    <path d="M5.6 13.2h4.8M8 11v2.2" />
  </svg>
)

export const IconPuzzle = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6.2 2.4h3.4v1.4a1.3 1.3 0 1 0 2.6 0V2.4H14v3.4h-1.4a1.3 1.3 0 1 0 0 2.6H14v3.4h-3.4v-1.4a1.3 1.3 0 1 0-2.6 0v1.4H4.6V8.4H6a1.3 1.3 0 1 0 0-2.6H4.6V2.4h1.6Z" />
  </svg>
)

export const IconMcp = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="3.4" r="1.6" />
    <circle cx="3.4" cy="11.6" r="1.6" />
    <circle cx="12.6" cy="11.6" r="1.6" />
    <path d="M6.8 4.7 4.4 10.2M9.2 4.7l2.4 5.5M5 11.6h6" />
  </svg>
)

export const IconTrash = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3.2 4.4h9.6M6.4 4.4V3h3.2v1.4M4.4 4.4l.6 8.2c0 .5.4.8.9.8h4.2c.5 0 .9-.3.9-.8l.6-8.2" />
  </svg>
)

export const IconMove = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 2v12M2 8h12M8 2 6.4 3.8M8 2l1.6 1.8M8 14l-1.6-1.8M8 14l1.6-1.8M2 8l1.8-1.6M2 8l1.8 1.6M14 8l-1.8-1.6M14 8l-1.8 1.6" />
  </svg>
)

export const IconInfo = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 7.2v3.4M8 5.2v.2" />
  </svg>
)

export const IconSpark = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 1.8 9.3 6 13.4 7.3 9.3 8.6 8 12.8 6.7 8.6 2.6 7.3 6.7 6 8 1.8Z" />
  </svg>
)

export const IconPlug = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 2v3.4M10 2v3.4M4.6 5.4h6.8v2.2a3.4 3.4 0 0 1-3.4 3.4 3.4 3.4 0 0 1-3.4-3.4V5.4ZM8 11v3" />
  </svg>
)

export const IconAsk = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2.6 7.6c0-2.6 2.4-4.6 5.4-4.6s5.4 2 5.4 4.6-2.4 4.6-5.4 4.6c-.7 0-1.3-.1-1.9-.3L3.4 13.2l.5-2.4A4.5 4.5 0 0 1 2.6 7.6Z" />
    <path d="M6.6 6.5a1.5 1.5 0 1 1 2.2 1.4c-.5.3-.8.6-.8 1.1M8 10.6v.2" />
  </svg>
)


export const IconSearch = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="7.2" cy="7.2" r="4.4" />
    <path d="m10.6 10.6 3 3" />
  </svg>
)

export const IconDatabase = (props: IconProps) => (
  <svg {...base(props)}>
    <ellipse cx="8" cy="4.2" rx="4.8" ry="1.9" />
    <path d="M3.2 4.2v7.6c0 1 2.1 1.9 4.8 1.9s4.8-.9 4.8-1.9V4.2M3.2 8c0 1 2.1 1.9 4.8 1.9s4.8-.9 4.8-1.9" />
  </svg>
)

export const IconDownload = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 2.2v7.2M5.4 7.4 8 10l2.6-2.6M3 12.6h10" />
  </svg>
)

export const IconImage = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" />
    <circle cx="5.8" cy="6.4" r="1.1" />
    <path d="m3.4 11.4 3.2-3 2.4 2.2 1.8-1.6 2.8 2.4" />
  </svg>
)

/** 按来源或工具名映射图标 */
export const toolIcon = (name: string, source?: ToolSource) => {
  switch (name) {
    case 'ask_user':
      return <IconAsk />
    case 'get_datetime':
      return <IconClock />
    case 'get_location':
      return <IconPin />
    case 'get_weather':
      return <IconCloud />
    case 'send_notification':
      return <IconBell />
    case 'read_clipboard':
    case 'write_clipboard':
      return <IconClipboard />
    case 'fetch_webpage':
      return <IconGlobe />
    case 'create_file':
      return <IconFile />
    case 'open_url':
      return <IconGlobe />
    case 'show_widget':
      return <IconSpark />
    case 'preview_file':
      return <IconLayers />
    case 'task_status':
      return <IconLayers />
    case 'task_cancel':
      return <IconBolt />
    case 'view_image':
      return <IconEye />
    case 'workspace_write_file':
      return <IconPen />
    case 'calculate':
    case 'random_number':
    case 'random_bytes':
    case 'password_gen':
      return <IconBolt />
    case 'hash_text':
    case 'jwt_decode':
    case 'base64_codec':
    case 'url_codec':
    case 'json_format':
    case 'json_query':
    case 'json_diff':
    case 'diff_text':
    case 'template_render':
      return <IconCode />
    case 'text_stats':
    case 'word_frequency':
    case 'dedupe_lines':
    case 'strip_invisible':
    case 'regex_extract':
    case 'text_similarity':
      return <IconSearch />
    case 'markdown_toc':
      return <IconLayers />
    case 'date_calc':
    case 'timezone_convert':
    case 'cron_next':
      return <IconClock />
    case 'csv_to_json':
    case 'json_to_csv':
      return <IconDatabase />
    case 'qrcode_generate':
      return <IconImage />
    case 'create_tool':
    case 'run_tool_chain':
      return <IconBolt />
    case 'manage_goals':
      return <IconTarget />
    case 'desk_glob':
    case 'desk_tree':
      return <IconFolder />
    case 'desk_diff':
    case 'desk_calculate':
    case 'desk_codec':
    case 'desk_password':
    case 'desk_markdown':
      return <IconCode />
    case 'desk_time':
      return <IconClock />
    case 'desk_regex':
    case 'desk_dupes':
    case 'desk_similarity':
      return <IconSearch />
    case 'desk_csv':
    case 'desk_pdf':
    case 'desk_office':
      return <IconFile />
    case 'desk_sqlite':
      return <IconDatabase />
    case 'desk_net':
      return <IconGlobe />
    case 'desk_download':
      return <IconDownload />
    case 'desk_image':
    case 'desk_qr':
      return <IconImage />
    case 'browser_screenshot':
    case 'desk_screenshot':
      return <IconCamera />
    case 'spawn_subagent':
      return <IconSpark />
    default:
      break
  }
  if (name.startsWith('desk_shell')) {
    return <IconTerminal />
  }
  if (name.startsWith('desk_python')) {
    return <IconCode />
  }
  if (name.startsWith('desk_fs_list') || name.startsWith('desk_fs_stat')) {
    return <IconFolder />
  }
  if (name.startsWith('desk_fs')) {
    return <IconFile />
  }
  if (name.startsWith('browser_')) {
    return <IconPuzzle />
  }
  switch (source) {
    case 'desktop':
      return <IconDesktop />
    case 'extension':
      return <IconPuzzle />
    case 'mcp':
      return <IconMcp />
    default:
      return <IconSpark />
  }
}

export const IconPen = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2.8 13.2h2.6L12.8 5.8a1.6 1.6 0 0 0 0-2.2l-.4-.4a1.6 1.6 0 0 0-2.2 0L2.8 10.6v2.6Z" />
    <path d="M9.4 4.6l2 2" />
  </svg>
)

export const IconEye = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M1.6 8S3.9 4 8 4s6.4 4 6.4 4-2.3 4-6.4 4S1.6 8 1.6 8Z" />
    <circle cx="8" cy="8" r="1.7" />
  </svg>
)

export const IconLayers = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 2 14 5.2 8 8.4 2 5.2 8 2Z" />
    <path d="M2 8.4 8 11.6l6-3.2M2 11.4 8 14.6l6-3.2" />
  </svg>
)

export const IconBolt = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 1.8 3.6 9h3.6l-.6 5.2L12.4 7H8.8l.2-5.2Z" />
  </svg>
)

export const IconCamera = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2 5.6c0-.7.5-1.2 1.2-1.2h1.6l.8-1.2h4.8l.8 1.2h1.6c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.2V5.6Z" />
    <circle cx="8" cy="8.2" r="2.2" />
  </svg>
)

export const IconTarget = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="2.6" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)
