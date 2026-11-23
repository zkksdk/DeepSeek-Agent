import qrcode from 'qrcode-generator'

/**
 * 生成二维码的 SVG 路径。
 *
 * 不用库自带的 createSvgTag：它把 fill 写死成 #000，也没法跟着主题走。
 * 这里只取模块矩阵，自己拼 path——一次发送大概几百个方块，字符串几 KB，够用。
 */
export type QrGraphic = {
  /** 边长（模块数） */
  count: number
  /** 深色模块的 path，坐标系是 0..count */
  path: string
}

/** 二维码是黑白高对比的，放不下就返回 null，由调用方提示 */
export const buildQr = (text: string): QrGraphic | null => {
  if (!text) {
    return null
  }
  try {
    // 0 = 自动选版本，L = 最低纠错（容量最大），配合压缩后的对话内容
    const qr = qrcode(0, 'L')
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    const parts: string[] = []
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          parts.push(`M${col} ${row}h1v1h-1z`)
        }
      }
    }
    return { count, path: parts.join('') }
  } catch {
    return null
  }
}

/** 把同一张码画到 canvas 上，用于「保存图片」 */
export const drawQrToCanvas = (
  canvas: HTMLCanvasElement,
  graphic: QrGraphic,
  options: { size?: number; margin?: number; dark?: string; light?: string } = {}
) => {
  const size = options.size ?? 1024
  const margin = options.margin ?? 4
  const total = graphic.count + margin * 2
  const cell = Math.floor(size / total)
  const offset = Math.floor((size - cell * graphic.count) / 2)
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  context.fillStyle = options.light ?? '#ffffff'
  context.fillRect(0, 0, size, size)
  context.fillStyle = options.dark ?? '#0b0d12'
  const pattern = new Path2D(graphic.path)
  context.save()
  context.translate(offset, offset)
  context.scale(cell, cell)
  context.fill(pattern)
  context.restore()
}
