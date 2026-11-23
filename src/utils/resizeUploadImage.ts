// 上传图片的长边上限，单位为像素。超过后服务端会拒绝，因此在客户端先缩小。
const MAX_IMAGE_EDGE = 4096

const readUploadImage = async (blob: Blob) => {
  const image = new Image()
  const url = URL.createObjectURL(blob)
  try {
    // 通过临时 URL 解码本地文件，从 naturalWidth 和 naturalHeight 读取图片本身的尺寸。
    image.src = url
    await image.decode()
    return { image, longestEdge: Math.max(image.naturalWidth, image.naturalHeight) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 复用旧 file_id 前，用本地原件检查当时上传的图片是否超限。 */
export const isUploadImageOversized = async (blob: Blob): Promise<boolean> =>
  (await readUploadImage(blob)).longestEdge > MAX_IMAGE_EDGE

/** 图片在尺寸上限内时返回原文件，超限时生成按比例缩小的上传副本。 */
export const resizeUploadImage = async (file: File, signal?: AbortSignal): Promise<File> => {
  signal?.throwIfAborted()
  // GIF 等动图缩放后只剩一帧，保持原样交给服务端判断
  if (file.type === 'image/gif') {
    return file
  }
  let read: Awaited<ReturnType<typeof readUploadImage>>
  try {
    read = await readUploadImage(file)
  } catch {
    // 解不开的图片（如 HEIC）直接上传，让服务端给出明确的错误
    return file
  }
  const { image, longestEdge } = read
  signal?.throwIfAborted()
  if (longestEdge <= MAX_IMAGE_EDGE) {
    return file
  }

  // 宽和高都乘以「长边上限 ÷ 原图长边」，这样横图和竖图都能按原比例缩到同一上限。
  const scale = MAX_IMAGE_EDGE / longestEdge
  const canvas = document.createElement('canvas')
  // 画布宽高需要整数像素。极细长图的短边可能舍入为 0，因此至少保留 1 像素。
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  try {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法创建画布上下文')
    }
    // drawImage 将整张图重采样到目标尺寸的画布上。
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    // toBlob 把缩放后的像素编码成文件数据。JPEG 和 WebP 优先沿用原格式，其余使用 PNG。
    const type = file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png'
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('无法编码图片'))),
        type,
        // 压缩质量
        1
      )
    })
    signal?.throwIfAborted()
    // 浏览器可能回退到 PNG，上传文件的后缀以实际编码为准。
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice('image/'.length)
    const name = file.name.replace(/\.[^.]*$/, '') + '.' + extension
    return new File([blob], name, { type: blob.type, lastModified: file.lastModified })
  } finally {
    canvas.width = canvas.height = 0
  }
}
