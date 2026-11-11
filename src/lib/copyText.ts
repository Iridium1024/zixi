import { isTauriRuntime } from './platform'

export async function copyText(text: string): Promise<void> {
  try {
    if (isTauriRuntime()) {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(text)
    } else {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
    }
  } catch {
    throw new Error('写入剪贴板失败，请重试')
  }
}
