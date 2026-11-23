/**
 * Service worker：标签页选择、截图、跨域抓取与标签页管理。
 * 页面内的 DOM 操作由 content script 执行，这里只处理需要扩展权限的部分。
 */

const MAX_FULL_PAGE_SHOTS = 8
const rank = new Map()
let counter = 0

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 记录标签页的激活顺序，用于「用户刚才在看的页面」这一默认目标 */
const bump = (tabId) => {
  rank.set(tabId, ++counter)
  void chrome.storage.session.set({ tabRank: [...rank.entries()] })
}

chrome.tabs.onActivated.addListener(({ tabId }) => bump(tabId))
chrome.tabs.onRemoved.addListener((tabId) => {
  rank.delete(tabId)
  void chrome.storage.session.set({ tabRank: [...rank.entries()] })
})

const restoreRank = async () => {
  try {
    const stored = await chrome.storage.session.get('tabRank')
    for (const [id, value] of stored.tabRank || []) {
      rank.set(id, value)
    }
  } catch {
    // 首次运行或权限受限时忽略
  }
}
void restoreRank()

const isWeb = (tab) => typeof tab.url === 'string' && /^https?:/i.test(tab.url)

/**
 * 默认操作对象：优先当前窗口的活动标签页，其次最近激活过的网页标签页。
 * 排除发起请求的 Agent 页面，避免「总结当前网页」变成总结自己。
 */
const resolveTarget = async (senderTabId, requested) => {
  if (requested) {
    const tab = await chrome.tabs.get(Number(requested)).catch(() => null)
    if (!tab) {
      throw new Error(`找不到标签页 ${requested}`)
    }
    return tab.id
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active && active.id !== senderTabId && isWeb(active)) {
    return active.id
  }
  const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id !== senderTabId && isWeb(tab))
  if (!tabs.length) {
    throw new Error('没有可操作的其他网页标签页，请先在浏览器里打开目标网页')
  }
  tabs.sort((a, b) => (rank.get(b.id) || 0) - (rank.get(a.id) || 0))
  return tabs[0].id
}

/** 向标签页发指令；content script 缺失时注入后重试一次 */
const pageMessage = async (tabId, tool, args) => {
  const send = () => chrome.tabs.sendMessage(tabId, { type: 'page', tool, args })
  let response
  try {
    response = await send()
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await delay(150)
    response = await send()
  }
  if (!response) {
    throw new Error('页面没有响应，可能被浏览器限制（如扩展商店页、PDF 预览）')
  }
  if (response.ok === false) {
    throw new Error(response.error || '页面操作失败')
  }
  return response.data
}

const pageMetrics = async (tabId) => {
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: document.documentElement.clientWidth,
      height: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0),
      viewport: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollY: window.scrollY,
    }),
  })
  return entry.result
}

const capture = async (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: 'png' })

const screenshot = async (tabId, { full_page = false } = {}) => {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.active) {
    await chrome.tabs.update(tabId, { active: true })
    await delay(400)
  }
  if (!full_page) {
    const dataUrl = await capture(tab.windowId)
    return { dataUrl, full: false, width: tab.width, height: tab.height }
  }

  const metrics = await pageMetrics(tabId)
  const height = Math.min(metrics.height, 16000)
  await pageMessage(tabId, 'shot_start', { width: metrics.width, height, dpr: metrics.dpr })
  try {
    let y = 0
    let shots = 0
    while (y < height && shots < MAX_FULL_PAGE_SHOTS) {
      await chrome.scripting.executeScript({ target: { tabId }, func: (top) => window.scrollTo(0, top), args: [y] })
      await delay(620)
      const dataUrl = await capture(tab.windowId)
      await pageMessage(tabId, 'shot_draw', { dataUrl, y, viewport: metrics.viewport })
      y += metrics.viewport
      shots += 1
    }
    const result = await pageMessage(tabId, 'shot_end', {})
    return { ...result, full: true, shots, pageHeight: metrics.height }
  } finally {
    await chrome.scripting
      .executeScript({ target: { tabId }, func: (top) => window.scrollTo(0, top), args: [metrics.scrollY] })
      .catch(() => {})
  }
}

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, code) =>
      String.fromCodePoint(parseInt(code, hex ? 16 : 10))
    )

const htmlToText = (html) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const fetchPage = async (url, maxChars = 12000) => {
  if (!/^https?:/i.test(url)) {
    throw new Error('只支持 http/https 地址')
  }
  const response = await fetch(url, { credentials: 'include', redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`抓取失败：HTTP ${response.status}`)
  }
  const html = await response.text()
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || url
  const text = htmlToText(html)
  return {
    title: decodeEntities(title),
    url: response.url || url,
    text: text.length > maxChars ? `${text.slice(0, maxChars)}\n\n…（已截断，共 ${text.length} 字符）` : text,
  }
}

const tabInfo = (tab) => ({
  id: tab.id,
  title: tab.title,
  url: tab.url,
  active: tab.active,
  windowId: tab.windowId,
})

const manageTabs = async ({ action = 'list', url, tabId }) => {
  if (action === 'list') {
    const tabs = (await chrome.tabs.query({})).filter(isWeb)
    return { count: tabs.length, tabs: tabs.map(tabInfo) }
  }
  if (action === 'open') {
    return tabInfo(await chrome.tabs.create({ url: url || 'about:blank' }))
  }
  if (!tabId) {
    throw new Error('需要 tab_id')
  }
  const tab = await chrome.tabs.get(Number(tabId)).catch(() => null)
  if (!tab) {
    throw new Error(`找不到标签页 ${tabId}`)
  }
  if (action === 'activate') {
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    return { activated: tab.id, title: tab.title, url: tab.url }
  }
  if (action === 'close') {
    await chrome.tabs.remove(tab.id)
    return { closed: tab.id, title: tab.title }
  }
  throw new Error(`未知操作：${action}`)
}

const navigate = async (tabId, url) => {
  if (!/^https?:/i.test(url)) {
    throw new Error('只支持 http/https 地址')
  }
  await chrome.tabs.update(tabId, { url })
  await delay(600)
  const tab = await chrome.tabs.get(tabId)
  return { tabId, title: tab.title, url: tab.url, status: tab.status }
}

const handle = async (message, sender) => {
  const senderTabId = sender.tab?.id
  const args = message.args || {}
  switch (message.tool) {
    case 'ping':
      return { version: chrome.runtime.getManifest().version, tab: senderTabId }
    case 'get_page': {
      const tabId = await resolveTarget(senderTabId, args.tab_id)
      return pageMessage(tabId, 'get_page', args)
    }
    case 'click':
    case 'type':
    case 'scroll':
    case 'extract': {
      const tabId = await resolveTarget(senderTabId, args.tab_id)
      return pageMessage(tabId, message.tool, args)
    }
    case 'fetch_page':
      return fetchPage(String(args.url || ''), Number(args.max_chars) || 12000)
    case 'screenshot': {
      const tabId = await resolveTarget(senderTabId, args.tab_id)
      return screenshot(tabId, args)
    }
    case 'tabs':
      return manageTabs(args)
    case 'navigate': {
      const tabId = await resolveTarget(senderTabId, args.tab_id)
      return navigate(tabId, String(args.url || ''))
    }
    default:
      throw new Error(`未知工具：${message.tool}`)
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'relay') {
    return
  }
  handle(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
  return true
})
