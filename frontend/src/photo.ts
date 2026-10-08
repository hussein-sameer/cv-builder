/** Photo handling for the CV: crop to passport proportions and shrink before it goes into the CV JSON. */

const OUT_W = 420 // 7:9 (35 x 45 mm) at ~300 dpi for the printed 28 x 36 mm photo
const OUT_H = 540
const MAX_FILE_MB = 15

/**
 * Read an image file, centre it in a 7:9 frame (biased towards the top so a face in a tall photo stays in
 * frame) and return a ~50 KB JPEG data URL. The server crops the same way, so imported JSON prints alike.
 */
export async function photoFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG or PNG).')
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`That image is over ${MAX_FILE_MB} MB. Choose a smaller one.`)
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error("Couldn't read that image. Use a JPG or PNG photo.")
  }
  const ratio = OUT_W / OUT_H
  let sw = bmp.width
  let sh = sw / ratio
  if (sh > bmp.height) {
    sh = bmp.height
    sw = sh * ratio
  }
  const canvas = document.createElement('canvas')
  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Your browser couldn't process the image.")
  ctx.fillStyle = '#ffffff' // image data, not UI: transparent PNGs print on white paper
  ctx.fillRect(0, 0, OUT_W, OUT_H)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) * 0.2, sw, sh, 0, 0, OUT_W, OUT_H)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.88)
}

/** Data URLs the server accepts for `personal.photo` (see backend models.Personal.photo). */
export const isPhotoDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length <= 1_500_000
