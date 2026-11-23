/**
 * 注入 SVG 前的最小净化。
 *
 * Mermaid 已经用 securityLevel: strict 渲染，但它的输出最终会走
 * dangerouslySetInnerHTML，所以在最后一公里再做一次白名单式清理：
 * - 移除 script / iframe / object / embed / meta / link；
 * - 移除所有 on* 事件属性；
 * - 去掉 javascript: 与 data:text/html 的链接；
 * - 去掉带表达式或 javascript: 的内联样式。
 *
 * 保留 foreignObject（strict 模式下图表文字可能在这里），
 * 但清掉它内部的可执行元素与事件属性。
 */
const DANGEROUS_TAGS = 'script, iframe, object, embed, meta, link, base'

export const sanitizeSvg = (svg: string): string => {
  if (!svg.trim()) {
    return ''
  }
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    if (doc.querySelector('parsererror')) {
      return ''
    }
    for (const node of doc.querySelectorAll(DANGEROUS_TAGS)) {
      node.remove()
    }
    for (const element of doc.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (name.startsWith('on')) {
          element.removeAttribute(attribute.name)
          continue
        }
        if (
          (name === 'href' || name === 'xlink:href' || name === 'src') &&
          /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value)
        ) {
          element.removeAttribute(attribute.name)
          continue
        }
        if (name === 'style' && /expression\s*\(|javascript:/i.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement)
  } catch {
    return ''
  }
}
