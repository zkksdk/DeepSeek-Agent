import { createArtifact } from '../artifacts.js'
import { defineTool, fail, objectSchema, ok, str } from '../toolKit.js'
import type { RegisteredTool } from '../types.js'

/** 单个 widget 的上限，避免把整个页面塞进消息 */
const MAX_HTML = 160_000

/** 标题转成安全的文件名 */
const fileName = (title: string) => {
  const slug = title
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'widget'}.widget.html`
}

export const widgetTools: RegisteredTool[] = [
  defineTool(
    {
      name: 'show_widget',
      label: '生成可视化组件',
      description: [
        '在对话里直接渲染一个可交互的 HTML 组件，用户看到的是组件本身，不是代码。',
        '适合：图表、流程与架构示意、对比卡片、可调参数的演示、小型交互应用。',
        'HTML 需要自包含：样式写在 <style> 里，脚本写在 <script> 里，不引用本地文件；',
        '不要使用 alert/confirm/prompt，不要在顶层写死 body 高度（内容会自动撑开）。',
        '组件运行在沙箱 iframe 中，无法访问聊天页面数据。',
        '当一张图或一个可操作组件比大段文字更清楚时，主动调用本工具。',
      ].join(''),
      inputSchema: objectSchema(
        {
          title: { type: 'string', description: '组件标题，显示在卡片顶部' },
          html: { type: 'string', description: '完整的 HTML 片段或文档，含内联样式与脚本' },
          note: { type: 'string', description: '一句话说明组件展示了什么' },
        },
        ['title', 'html']
      ),
      risk: 'safe',
      icon: 'sparkle',
    },
    async (input, context) => {
      const title = str(input, 'title').trim() || '可视化组件'
      const html = str(input, 'html')
      if (!html.trim()) {
        return fail('html 不能为空')
      }
      if (html.length > MAX_HTML) {
        return fail(`HTML 过长（${html.length} 字符），请压缩到 ${MAX_HTML} 字符以内`)
      }
      const note = str(input, 'note').trim()
      const artifact = await createArtifact({
        name: fileName(title),
        text: html,
        mime: 'text/html',
        kind: 'widget',
        source: 'browser',
        tool: 'show_widget',
        sessionId: context.sessionId,
      })
      return ok(
        `已生成组件《${title}》，用户可以在对话中直接查看和操作。${note ? `\n组件内容：${note}` : ''}`,
        { artifacts: [artifact] }
      )
    }
  ),
]
