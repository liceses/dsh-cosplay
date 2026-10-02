/**
 * dsh-cosplay — 浏览器侧的图片处理（纯浏览器 API）。
 *
 * 立绘上传前先压一遍，理由有三：磁盘（一张 4K PNG 就是 8 MB）、
 * 传输（走 base64 JSON，体积 ×1.37）、渲染（网格里几十张图）。
 *
 * 两条细节：
 * - **带透明通道就保持 PNG**：把 PNG 硬转 JPEG 会在立绘边缘糊出黑边。
 * - **只缩不放**：本来就比上限小的图不放大（放大只会变糊还变重）。
 */

/** 压好的结果。 */
export interface PreparedImage {
  /** 不带 data URL 前缀的 base64。 */
  base64: string
  mime: string
  width: number
  height: number
  /** 原始字节数（回执里用来说明省了多少）。 */
  sourceBytes: number
}

/** data URL → base64（去掉前缀）。 */
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
}

/** 读文件为 data URL。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 解开一张图。 */
function decode(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = dataUrl
  })
}

/**
 * 把用户选的文件压成立绘。
 * @param file - 用户选的文件。
 * @param maxEdge - 最长边上限（px）。
 * @param quality - JPEG/WebP 质量（0..1）。
 */
export async function prepareArt(file: File, maxEdge: number, quality: number): Promise<PreparedImage> {
  const source = await readAsDataUrl(file)
  const image = await decode(source)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width === 0 || height === 0) throw new Error('图片尺寸为 0，换一张试试')

  const limit = Math.max(64, Math.floor(maxEdge))
  const scale = Math.min(1, limit / Math.max(width, height))
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const context = canvas.getContext('2d')
  if (context === null) {
    // 拿不到 2D 上下文（极罕见）：退回原图，让宿主的字节签名校验兜底。
    return { base64: stripDataUrl(source), mime: file.type === '' ? 'image/png' : file.type, width, height, sourceBytes: file.size }
  }

  // 带透明通道的图保持 PNG（避免黑边）。
  const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
  if (!png) {
    // 给 JPEG 一个白底，否则透明区域会变黑。
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, targetW, targetH)
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, targetW, targetH)

  const mime = png ? 'image/png' : 'image/jpeg'
  const dataUrl = canvas.toDataURL(mime, png ? undefined : Math.min(1, Math.max(0.1, quality)))
  return { base64: stripDataUrl(dataUrl), mime, width: targetW, height: targetH, sourceBytes: file.size }
}
