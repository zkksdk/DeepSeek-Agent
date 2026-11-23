/** 图片数据在「data URL / 纯 base64 / 图片块」之间转换与缩放的公共工具 */

export type ImagePayload = { mediaType: string; data: string }

const IMAGE_MEDIA = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif)$/i

/** 拆开 data URL；不是图片 data URL 时返回 null */
export const splitDataUrl = (value: string): ImagePayload | null => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim())
  if (!match || !IMAGE_MEDIA.test(match[1])) {
    return null
  }
  return { mediaType: match[1].toLowerCase().replace('jpg', 'jpeg'), data: match[2] }
}

/**
 * 纯 base64：按魔数猜类型，猜不出按 png 处理。
 * 模型从工具结果里复制图片时经常只拿到裸 base64。
 */
export const readBase64Payload = (value: string, mediaType?: string): ImagePayload | null => {
  const raw = value.trim()
  if (!raw) {
    return null
  }
  const fromUrl = splitDataUrl(raw)
  if (fromUrl) {
    return fromUrl
  }
  const data = raw.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length < 32) {
    return null
  }
  const type =
    mediaType && IMAGE_MEDIA.test(mediaType)
      ? mediaType.toLowerCase()
      : data.startsWith('/9j/')
        ? 'image/jpeg'
        : data.startsWith('UklGR')
          ? 'image/webp'
          : data.startsWith('R0lGOD')
            ? 'image/gif'
            : 'image/png'
  return { mediaType: type, data }
}

/** 长边超过上限时按比例缩小，返回可直接回传模型的图片块 */
export const downscaleImage = async (
  payload: ImagePayload,
  maxEdge = 1568
): Promise<ImagePayload> => {
  // GIF 缩放只剩一帧，直接原样返回
  if (payload.mediaType === 'image/gif') {
    return payload
  }
  const image = new Image()
  image.src = `data:${payload.mediaType};base64,${payload.data}`
  try {
    await image.decode()
  } catch {
    return payload
  }
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  if (longest <= maxEdge) {
    return payload
  }
  const scale = maxEdge / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    return payload
  }
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    // JPEG 体积更小，截图这类内容用 JPEG 足够
    const mediaType = payload.mediaType === 'image/png' ? 'image/png' : 'image/jpeg'
    const dataUrl = canvas.toDataURL(mediaType, 0.92)
    const scaled = splitDataUrl(dataUrl)
    return scaled ?? payload
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** 估算 base64 解码后的字节数，用于判断要不要压缩 */
export const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4)
