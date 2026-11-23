/** 来自服务端或归档的链接会渲染成 href 或交给 window.open，只接受 HTTP / HTTPS。 */
export const isWebUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * 本机与内网地址判定。
 *
 * 智能体可以替用户抓网页，如果不拦这些地址，一段被注入的网页内容就能诱导它
 * 去访问 http://127.0.0.1:xxxx 的管理接口或云元数据服务（SSRF）。
 * 这里只做主机名层面的粗筛，真正的边界仍应由网络策略保证。
 */
export const isPrivateHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return true
  }
  // IPv6 链路本地 / 唯一本地地址
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) {
    return true
  }
  // IPv4 私有段、回环、链路本地、保留段
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) {
    return false
  }
  const a = Number(match[1])
  const b = Number(match[2])
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

/** 可以安全交给网络工具或新标签页的地址：http(s) 且不是本机/内网 */
export const isPublicWebUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !isPrivateHost(url.hostname) &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}
