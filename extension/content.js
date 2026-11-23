/**
 * 页面侧桥接：接收网页 postMessage，执行 DOM 操作，或转发给 service worker。
 * 同一页面可能被注入多次（扩展更新后手动注入），用标记保证只初始化一次。
 */
(() => {
  if (window.__agentBridgeReady) {
    return
  }
  window.__agentBridgeReady = true

  const CHANNEL = '__agent_chat_extension__'
  const MAX_TEXT = 40000

  const reply = (id, payload) => {
    window.postMessage({ [CHANNEL]: true, id, kind: 'response', ...payload }, '*')
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // ---------- 正文提取 ----------

  /** 候选正文容器，按可读文本长度择优；找不到合适容器时退回 body */
  const pickRoot = () => {
    const candidates = [
      ...document.querySelectorAll(
        'article, main, [role="main"], .markdown-body, .article-content, .post-content, #content, .content'
      ),
    ]
    let best = null
    let bestLength = 0
    for (const node of candidates) {
      const length = (node.innerText || '').trim().length
      if (length > bestLength) {
        best = node
        bestLength = length
      }
    }
    // 正文容器至少要有一点内容，否则整页读 body 更可靠
    return best && bestLength > 400 ? best : document.body
  }

  const clean = (text) =>
    text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  const getPage = ({ max_chars = 12000 } = {}) => {
    pingOverlay()
    const root = pickRoot()
    const full = clean(root?.innerText || document.body?.innerText || '')
    const limit = Math.max(500, Math.min(Number(max_chars) || 12000, MAX_TEXT))
    return {
      title: document.title,
      url: location.href,
      text: full.length > limit ? `${full.slice(0, limit)}\n\n…（已截断，共 ${full.length} 字符）` : full,
      length: full.length,
      selection: (window.getSelection()?.toString() || '').trim().slice(0, 4000),
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .slice(0, 20)
        .map((node) => `${node.tagName.toLowerCase()}: ${node.innerText.trim()}`)
        .filter((line) => line.length > 4),
    }
  }

  // ---------- 元素定位 ----------

  const visible = (node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  /** 按文字匹配时取最深的元素，避免点到包住整块页面的外层容器 */
  const byText = (needle, index) => {
    const nodes = [
      ...document.querySelectorAll(
        'button, a, [role="button"], input[type="submit"], input[type="button"], label, li, summary, [onclick]'
      ),
    ].filter((node) => visible(node) && (node.innerText || node.value || '').includes(needle))
    const deepest = nodes.filter(
      (node) => !nodes.some((other) => other !== node && node.contains(other))
    )
    return deepest[index] || nodes[index] || null
  }

  const locate = ({ selector, text, index = 0 }) => {
    if (selector) {
      const list = [...document.querySelectorAll(selector)]
      return list[index] || list[0] || null
    }
    if (text) {
      return byText(text, index)
    }
    return null
  }

  const describe = (node) =>
    node
      ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${
          node.className && typeof node.className === 'string'
            ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : ''
        } 「${(node.innerText || node.value || node.placeholder || '').trim().slice(0, 40)}」`
      : '未找到'

  // ---------- DOM 操作 ----------

  const click = async ({ selector, text, index = 0 }) => {
    const node = locate({ selector, text, index })
    if (!node) {
      throw new Error('没有找到要点击的元素，请换一个选择器或文字')
    }
    pingOverlay()
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    await delay(120)
    const rect = node.getBoundingClientRect()
    moveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2, true)
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }
    node.dispatchEvent(new PointerEvent('pointerdown', options))
    node.dispatchEvent(new MouseEvent('mousedown', options))
    node.dispatchEvent(new PointerEvent('pointerup', options))
    node.dispatchEvent(new MouseEvent('mouseup', options))
    node.dispatchEvent(new MouseEvent('click', options))
    if (typeof node.click === 'function') {
      // 原生 click 兜底：处理只监听 click 的框架组件
      node.click()
    }
    await delay(400)
    return { clicked: describe(node), url: location.href, title: document.title }
  }

  const setValue = (node, value) => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
    setter ? setter.call(node, value) : (node.value = value)
  }

  const type = async ({ selector, text, submit = false, clear = true }) => {
    const node =
      locate({ selector }) ||
      document.activeElement ||
      document.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]')
    if (!node) {
      throw new Error('没有找到可输入的输入框')
    }
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node.isContentEditable)) {
      throw new Error(`目标元素不可输入：${describe(node)}`)
    }
    pingOverlay()
    node.focus()
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    const box = node.getBoundingClientRect()
    moveCursor(box.left + Math.min(box.width / 2, 120), box.top + box.height / 2)
    if (node.isContentEditable) {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(node)
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand(clear ? 'delete' : 'insertText', false, clear ? '' : text)
      if (clear) {
        document.execCommand('insertText', false, text)
      }
    } else {
      setValue(node, clear ? text : `${node.value}${text}`)
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
    await delay(120)
    if (submit) {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      node.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      const form = node.closest('form')
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit()
        } catch {
          form.submit()
        }
      }
      await delay(500)
    }
    return { typed: describe(node), submitted: Boolean(submit), value: (node.value ?? node.innerText ?? '').slice(0, 80) }
  }

  const scroll = async ({ direction = 'down', amount }) => {
    pingOverlay()
    const step = Number(amount) || Math.round(window.innerHeight * 0.85)
    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    } else {
      window.scrollBy({ top: direction === 'up' ? -step : step, behavior: 'smooth' })
    }
    await delay(500)
    return {
      scrollY: Math.round(window.scrollY),
      height: document.body.scrollHeight,
      viewport: window.innerHeight,
      atBottom: Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 4,
    }
  }

  const extract = ({ selector, attribute, limit = 50 }) => {
    pingOverlay()
    const nodes = [...document.querySelectorAll(selector)].slice(0, Math.max(1, Number(limit) || 50))
    if (!nodes.length) {
      throw new Error(`选择器没有匹配到元素：${selector}`)
    }
    const items = nodes.map((node) =>
      attribute ? node.getAttribute(attribute) || '' : (node.innerText || node.textContent || '').trim()
    )
    return { count: nodes.length, total: document.querySelectorAll(selector).length, items }
  }

  // ---------- 整页截图拼接 ----------
  // 页面侧负责把逐屏截图拼到 canvas，service worker 只有 captureVisibleTab 能力。

  let fullShot = null

  const shotStart = ({ width, height, dpr }) => {
    const scale = Math.min(dpr || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(Math.min(height, 16000) * scale)
    fullShot = { canvas, ctx: canvas.getContext('2d'), scale, drawn: 0 }
    return { canvas: { width: canvas.width, height: canvas.height }, scale }
  }

  const shotDraw = async ({ dataUrl, y, viewport }) => {
    if (!fullShot) {
      throw new Error('截图会话不存在，请重新发起截图')
    }
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('截图解码失败'))
      image.src = dataUrl
    })
    const top = Math.round(y * fullShot.scale)
    // 最后一屏可能超出画面高度，按剩余空间裁剪，避免绘制越界
    const remaining = fullShot.canvas.height - top
    const sourceHeight = Math.max(1, Math.min(image.height, Math.round(remaining)))
    fullShot.ctx.drawImage(image, 0, 0, image.width, sourceHeight, 0, top, image.width, sourceHeight)
    fullShot.drawn += 1
    return { drawn: fullShot.drawn, viewport }
  }

  const shotEnd = () => {
    if (!fullShot) {
      throw new Error('截图会话不存在')
    }
    const url = fullShot.canvas.toDataURL('image/png')
    const size = { width: fullShot.canvas.width, height: fullShot.canvas.height }
    fullShot = null
    return { dataUrl: url, ...size }
  }


  // ---------- 操作指示层 ----------
  // 扩展在页面上操作时给出可见反馈：四周跑马灯 + 跟随的大号光标。
  // 全部用 CSSOM（element.style）设置，避免被站点 CSP 拦掉内联样式。

  const OVERLAY_Z = 2147483646
  let overlay = null
  let overlayTimer = 0
  let marqueeFrame = 0

  const styleOf = (el, rules) => {
    Object.assign(el.style, rules)
    return el
  }

  const createCursor = () => {
    const wrap = styleOf(document.createElement('div'), {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      zIndex: String(OVERLAY_Z),
      pointerEvents: 'none',
      transform: 'translate3d(-9999px, -9999px, 0)',
      transition: 'transform .32s cubic-bezier(.22,1,.36,1)',
      willChange: 'transform',
      filter: 'drop-shadow(0 4px 10px rgba(20,40,90,.35))',
    })
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '34')
    svg.setAttribute('height', '34')
    styleOf(svg, { display: 'block', marginLeft: '-4px', marginTop: '-2px' })
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute(
      'd',
      'M4 2.2 4 19.4 8.6 15.1 11.4 21.4 14.5 20 11.7 13.8 18 13.4 4 2.2Z'
    )
    path.setAttribute('fill', '#3964fe')
    path.setAttribute('stroke', '#fff')
    path.setAttribute('strokeWidth', '1.4')
    path.setAttribute('strokeLinejoin', 'round')
    svg.append(path)
    wrap.append(svg)
    return wrap
  }

  const createMarquee = () => {
    const ring = styleOf(document.createElement('div'), {
      position: 'fixed',
      inset: '0',
      zIndex: String(OVERLAY_Z),
      pointerEvents: 'none',
      border: '2px solid rgba(57,100,254,.45)',
      boxShadow: 'inset 0 0 26px rgba(57,100,254,.22)',
      borderRadius: '2px',
    })
    const comets = []
    for (let index = 0; index < 4; index += 1) {
      const comet = styleOf(document.createElement('div'), {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: String(OVERLAY_Z + 1),
        background: 'linear-gradient(90deg, rgba(57,100,254,0) 0%, #3964fe 55%, #8fd3ff 100%)',
        borderRadius: '2px',
        willChange: 'transform',
      })
      if (index % 2 === 0) {
        comet.style.width = '160px'
        comet.style.height = '3px'
        comet.style.top = index === 0 ? '0' : 'calc(100% - 3px)'
        comet.style.left = '0'
      } else {
        comet.style.width = '3px'
        comet.style.height = '160px'
        comet.style.left = index === 1 ? 'calc(100% - 3px)' : '0'
        comet.style.top = '0'
        comet.style.background =
          'linear-gradient(180deg, rgba(57,100,254,0) 0%, #3964fe 55%, #8fd3ff 100%)'
      }
      ring.append(comet)
      comets.push(comet)
    }
    return { ring, comets }
  }

  /** 四条光带沿边框循环，用 rAF 驱动，不依赖站点样式表 */
  const startMarquee = (comets) => {
    if (marqueeFrame) {
      return
    }
    const started = performance.now()
    const tick = (now) => {
      if (!overlay) {
        return
      }
      const width = window.innerWidth
      const height = window.innerHeight
      const period = 2600
      const t = ((now - started) % period) / period
      const x = t * (width + 160) - 160
      const y = t * (height + 160) - 160
      comets[0].style.transform = `translate3d(${x}px, 0, 0)`
      comets[1].style.transform = `translate3d(0, ${y}px, 0)`
      comets[2].style.transform = `translate3d(${-x}px, 0, 0)`
      comets[3].style.transform = `translate3d(0, ${-y}px, 0)`
      marqueeFrame = requestAnimationFrame(tick)
    }
    marqueeFrame = requestAnimationFrame(tick)
  }

  const ensureOverlay = () => {
    if (overlay) {
      return overlay
    }
    const root = styleOf(document.createElement('div'), {
      position: 'fixed',
      inset: '0',
      zIndex: String(OVERLAY_Z),
      pointerEvents: 'none',
      contain: 'layout style',
    })
    const { ring, comets } = createMarquee()
    const cursor = createCursor()
    root.append(ring, cursor)
    document.documentElement.append(root)
    overlay = { root, cursor }
    startMarquee(comets)
    return overlay
  }

  const hideOverlay = () => {
    if (marqueeFrame) {
      cancelAnimationFrame(marqueeFrame)
      marqueeFrame = 0
    }
    overlay?.root.remove()
    overlay = null
  }

  /** 每次页面操作刷新一次存活时间；一串操作结束后自动收起 */
  const pingOverlay = () => {
    ensureOverlay()
    clearTimeout(overlayTimer)
    overlayTimer = window.setTimeout(() => {
      // 光标淡出后再整层移除，避免突然消失
      if (overlay) {
        overlay.cursor.style.opacity = '0'
      }
      overlayTimer = window.setTimeout(hideOverlay, 260)
    }, 2200)
  }

  /** 把大号光标移到页面坐标上，附带一次点击涟漪 */
  const moveCursor = (x, y, ripple = false) => {
    const current = ensureOverlay()
    current.cursor.style.opacity = '1'
    current.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
    if (!ripple) {
      return
    }
    const dot = styleOf(document.createElement('div'), {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '46px',
      height: '46px',
      marginLeft: '-23px',
      marginTop: '-23px',
      borderRadius: '50%',
      border: '2px solid rgba(57,100,254,.85)',
      background: 'rgba(57,100,254,.16)',
      zIndex: String(OVERLAY_Z),
      pointerEvents: 'none',
      transform: `translate3d(${x}px, ${y}px, 0) scale(.35)`,
      opacity: '1',
      transition: 'transform .42s ease-out, opacity .42s ease-out',
    })
    document.documentElement.append(dot)
    requestAnimationFrame(() => {
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`
      dot.style.opacity = '0'
    })
    window.setTimeout(() => dot.remove(), 460)
  }

  // ---------- 消息分发 ----------

  const run = async (tool, args) => {
    switch (tool) {
      case 'get_page':
        return getPage(args)
      case 'click':
        return click(args)
      case 'type':
        return type(args)
      case 'scroll':
        return scroll(args)
      case 'extract':
        return extract(args)
      case 'shot_start':
        return shotStart(args)
      case 'shot_draw':
        return shotDraw(args)
      case 'shot_end':
        return shotEnd()
      default:
        throw new Error(`页面不支持的操作：${tool}`)
    }
  }

  // 网页 → content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return
    }
    const data = event.data
    if (!data || data[CHANNEL] !== true || data.kind !== 'request') {
      return
    }
    const id = data.id
    if (data.tool === 'ping') {
      reply(id, { ok: true, data: { version: '1.0.0', url: location.href } })
      return
    }
    // 只有截图拼接在页面内完成；读取与操作一律交给后台选目标标签页，
    // 否则「总结当前网页」会在 Agent 页面自己身上执行。
    const local = new Set(['shot_start', 'shot_draw', 'shot_end'])
    if (!local.has(data.tool)) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'relay',
          tool: data.tool,
          args: data.args || {},
        })
        reply(id, response?.ok ? { ok: true, data: response.data } : { ok: false, error: response?.error || '扩展调用失败' })
      } catch (error) {
        reply(id, { ok: false, error: `扩展后台未响应：${error?.message || error}` })
      }
      return
    }
    try {
      reply(id, { ok: true, data: await run(data.tool, data.args || {}) })
    } catch (error) {
      reply(id, { ok: false, error: error?.message || String(error) })
    }
  })

  // 后台 → content script
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'page') {
      return
    }
    run(message.tool, message.args || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
    return true
  })

  // 告诉页面扩展已就绪；页面加载早期发的 ping 可能丢失，这里主动广播一次
  window.postMessage({ [CHANNEL]: true, kind: 'ready' }, '*')
})()
