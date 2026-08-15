import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../../lib/platform'
import type {
  BackgroundAssetRecord,
  BackgroundFormat,
  FontFormat,
  ImportedFontRecord,
  ManagedAssetKind,
} from './appearance'

type ImportedBackground = Omit<BackgroundAssetRecord, 'importedAt'>
type ImportedFont = Omit<ImportedFontRecord, 'importedAt'>

const BACKGROUND_LIMIT = 24 * 1024 * 1024
const FONT_LIMIT = 12 * 1024 * 1024

function extensionOf(name: string) {
  return name.split('.').pop()?.toLocaleLowerCase() ?? ''
}

function fileStem(name: string) {
  const safe = [...name.replace(/\.[^.]+$/, '')]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
  return safe.slice(0, 80) || '导入字体'
}

function bytesMatch(bytes: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => bytes[index] === byte)
}

function detectBackground(bytes: Uint8Array): BackgroundFormat | null {
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (bytesMatch(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (
    bytesMatch(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytesMatch(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) return 'webp'
  return null
}

function detectFont(bytes: Uint8Array): FontFormat | null {
  if (bytesMatch(bytes, [0x77, 0x4f, 0x46, 0x32])) return 'woff2'
  if (bytesMatch(bytes, [0x77, 0x4f, 0x46, 0x46])) return 'woff'
  if (bytesMatch(bytes, [0x4f, 0x54, 0x54, 0x4f])) return 'otf'
  if (
    bytesMatch(bytes, [0x00, 0x01, 0x00, 0x00])
    || bytesMatch(bytes, [0x74, 0x72, 0x75, 0x65])
  ) return 'ttf'
  return null
}

function formatMatchesExtension(format: BackgroundFormat | FontFormat, extension: string) {
  if (format === 'jpeg') return extension === 'jpg' || extension === 'jpeg'
  return format === extension
}

async function readSignature(file: File) {
  return new Uint8Array(await file.slice(0, 32).arrayBuffer())
}

function dataUrlFor(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取所选文件'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

async function browserImageSize(file: File) {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

export async function pickAndImportBackground(): Promise<BackgroundAssetRecord | null> {
  const imported = await invoke<ImportedBackground | null>('pick_background_asset')
  return imported ? { ...imported, importedAt: new Date().toISOString() } : null
}

export async function pickAndImportFont(): Promise<ImportedFontRecord | null> {
  const imported = await invoke<ImportedFont | null>('pick_font_asset')
  return imported ? { ...imported, importedAt: new Date().toISOString() } : null
}

export async function importBackgroundFromBrowser(file: File): Promise<BackgroundAssetRecord> {
  if (file.size > BACKGROUND_LIMIT) throw new Error('图片超过 24 MB 限制')
  const format = detectBackground(await readSignature(file))
  if (!format || !formatMatchesExtension(format, extensionOf(file.name))) {
    throw new Error('文件内容与 PNG、JPEG 或 WebP 格式不匹配')
  }
  const size = await browserImageSize(file)
  if (size.width * size.height > 40_000_000 || size.width > 10_000 || size.height > 10_000) {
    throw new Error('图片尺寸过大，请压缩到 10000 像素以内且不超过 4000 万像素')
  }
  return {
    id: `bg-${crypto.randomUUID()}`,
    sourceFileName: file.name,
    storedPath: await dataUrlFor(file),
    format,
    byteSize: file.size,
    width: size.width,
    height: size.height,
    importedAt: new Date().toISOString(),
  }
}

export async function importFontFromBrowser(file: File): Promise<ImportedFontRecord> {
  if (file.size > FONT_LIMIT) throw new Error('字体超过 12 MB 限制')
  const format = detectFont(await readSignature(file))
  if (!format || !formatMatchesExtension(format, extensionOf(file.name))) {
    throw new Error('文件内容与 WOFF2、WOFF、TTF 或 OTF 格式不匹配')
  }
  const id = `font-${crypto.randomUUID()}`
  return {
    id,
    internalFamily: `ZixiImported_${id.replace(/[^A-Za-z0-9_]/g, '_')}`,
    displayName: fileStem(file.name),
    sourceFileName: file.name,
    storedPath: await dataUrlFor(file),
    format,
    style: 'normal',
    importedAt: new Date().toISOString(),
  }
}

export async function deleteManagedAsset(kind: ManagedAssetKind, storedPath: string) {
  if (!isTauriRuntime() || storedPath.startsWith('data:')) return
  await invoke('delete_managed_asset', { kind, storedPath })
}

export function managedAssetUrl(storedPath: string) {
  if (!storedPath || storedPath.startsWith('data:') || storedPath.startsWith('blob:')) return storedPath
  return isTauriRuntime() ? convertFileSrc(storedPath) : ''
}
