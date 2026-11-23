const isWeb = (tab) => typeof tab.url === 'string' && /^https?:/i.test(tab.url)

const shorten = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 46)
  } catch {
    return url.slice(0, 46)
  }
}

const render = async () => {
  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`
  const tabs = (await chrome.tabs.query({})).filter(isWeb).sort((a, b) => Number(b.active) - Number(a.active))
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })

  document.getElementById('current').textContent = active ? active.title || shorten(active.url) : '—'
  document.getElementById('count').textContent = `${tabs.length} 个网页标签页`

  const list = document.getElementById('tabs')
  for (const tab of tabs.slice(0, 8)) {
    const item = document.createElement('li')
    const title = document.createElement('b')
    title.textContent = tab.active ? '●' : '○'
    const text = document.createElement('span')
    text.textContent = `${tab.title || '无标题'} — ${shorten(tab.url)}`
    item.append(title, text)
    list.append(item)
  }
}

void render()
