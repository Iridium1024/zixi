import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ beforeClose: vi.fn(), close: vi.fn(), onClose: vi.fn(), unlisten: vi.fn() }))
vi.mock('../../lib/platform', () => ({ isTauriRuntime: () => true }))
vi.mock('../settings/settingsRepository', () => ({ loadSetting: async () => null }))
vi.mock('../settings/useAppearanceRuntime', () => ({ useAppearanceRuntime: () => ({ resolvedTheme: 'light', issues: [] }) }))
vi.mock('../../components/WindowResizeEdges', () => ({ WindowResizeEdges: () => null }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => undefined }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: mocked.close, onCloseRequested: mocked.onClose }) }))
vi.mock('./MindMapWorkspace', async () => {
  const React = await import('react')
  return { MindMapWorkspace: ({ onBeforeLeaveReady }: { onBeforeLeaveReady(handler: (() => Promise<boolean>) | null): void }) => {
    React.useEffect(() => { onBeforeLeaveReady(mocked.beforeClose); return () => onBeforeLeaveReady(null) }, [onBeforeLeaveReady])
    return <div>测试导图</div>
  } }
})
import { MindMapWindow } from './MindMapWindow'

beforeEach(() => {
  mocked.beforeClose.mockReset().mockResolvedValue(false)
  mocked.close.mockReset().mockResolvedValue(undefined)
  mocked.onClose.mockReset().mockResolvedValue(mocked.unlisten)
  mocked.unlisten.mockReset()
})
afterEach(cleanup)

it('keeps the independent window open when its draft cannot be saved', async () => {
  render(<MindMapWindow mapId="map-1" />)
  await waitFor(() => expect(mocked.onClose).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '关闭导图窗口' }))
  expect(await screen.findByText('关闭已取消：请先保存或处理导图冲突')).toBeInTheDocument()
  expect(mocked.close).not.toHaveBeenCalled()
  mocked.beforeClose.mockResolvedValueOnce(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭导图窗口' })) })
  await waitFor(() => expect(mocked.close).toHaveBeenCalledTimes(1))
})
