import { FolderOpen, FolderInput } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { LightDialog } from '../../components/LightDialog'
import { isTauriRuntime } from '../../lib/platform'

interface StorageInfo {
  dataPath: string
  defaultPath: string
  previousPath: string | null
  pendingPath: string | null
  notice: string | null
}
interface MigrationPlan { targetPath: string; fileCount: number; byteSize: number }

export function StorageSettingsPanel({ beforeRestart, onStatusChange }: { beforeRestart(): Promise<void>; onStatusChange(message: string): void }) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(isTauriRuntime)
  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    void invoke<StorageInfo>('get_storage_info').then((value) => { if (!cancelled) setInfo(value) })
      .catch((error: unknown) => { if (!cancelled) setError(String(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  const closeDialog = useCallback(() => { if (!busy) setPlan(null) }, [busy])
  async function chooseDirectory() {
    setBusy(true); setError('')
    try { setPlan(await invoke<MigrationPlan | null>('pick_storage_directory')) }
    catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  async function migrate() {
    if (!plan) return
    setBusy(true); setError('')
    try {
      await beforeRestart()
      await invoke('migrate_storage_and_restart', { targetPath: plan.targetPath })
      onStatusChange('正在重启；启动时将迁移并校验资料，原目录保留为备份')
    } catch (error) { setError(String(error)); setBusy(false) }
  }
  async function revealDirectory() {
    if (!info) return
    try { await revealItemInDir(info.dataPath) }
    catch (error) { setError(`无法定位资料目录：${String(error)}`) }
  }
  return <section className="settings-section storage-settings">
    <div><h2>数据与备份</h2><p>更改便签、书库、导图及自定义资源的保存位置。选择位置后会在其中创建 ZixiData 文件夹。</p></div>
    {info && <dl className="storage-paths"><div><dt>当前资料目录</dt><dd>{info.dataPath}</dd></div>{info.previousPath && <div><dt>上次迁移备份</dt><dd>{info.previousPath}</dd></div>}</dl>}
    {loading && <p role="status">正在读取资料目录…</p>}
    {info?.notice && <p className="storage-notice" role="status">{info.notice}</p>}
    {info?.pendingPath && <p role="status">已安排迁移至 {info.pendingPath}，下次启动时执行。</p>}
    {!isTauriRuntime() && <p>存储位置与迁移功能请在桌面版中使用。</p>}
    {error && !plan && <p className="storage-notice" role="alert">{error}</p>}
    <div className="button-row"><button className="secondary-button" disabled={!info || busy} onClick={() => void revealDirectory()}><FolderOpen size={16} />定位资料目录</button><button className="secondary-button" disabled={!info || busy} onClick={() => void chooseDirectory()}><FolderInput size={16} />更改存储位置</button></div>
    <p className="storage-help">迁移前请保存并关闭所有独立窗口。应用将重启，完成复制和校验后才启用新目录；失败时继续使用原目录。原资料保留供备份确认，不会自动删除。少量启动配置、窗口布局和 WebView 用户数据仍保留在系统目录；清理旧资料时请保留默认目录中的 storage-location.json，以便下次启动定位新资料。</p>
    {plan && <LightDialog title="迁移资料并重启" onClose={closeDialog}>
      <div className="storage-migration-details"><p>新资料目录</p><p className="storage-target">{plan.targetPath}</p><p>预计约 {plan.fileCount} 个文件 · {(plan.byteSize / 1024 / 1024).toFixed(1)} MiB。迁移包含数据库、书籍副本、协作文件及自定义字体和背景。</p><p>原目录会保留；不会覆盖目标中已有资料。确认后将保存当前设置并重启。</p>{error && <p role="alert">{error}</p>}</div>
      <div className="storage-dialog-actions"><button className="secondary-button" disabled={busy} onClick={closeDialog}>取消</button><button className="primary-button" disabled={busy} onClick={() => void migrate()}>{busy ? '正在准备重启…' : '迁移并重启'}</button></div>
    </LightDialog>}
  </section>
}
