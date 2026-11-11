import { RangeControl, CheckControl, SelectControl } from '../../components/FormControls'
import { ViewStatus } from '../../components/ViewStatus'
import { StorageSettingsPanel } from './StorageSettingsPanel'
import { saveSetting } from './settingsRepository'
import { WorkspaceNavigation, useUnifiedNavigation } from '../../components/WorkspaceNavigation'
import {
  Check,
  Eye,
  Image as ImageIcon,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { isTauriRuntime } from '../../lib/platform'
import { resetNotesUsingFont } from '../notes/noteRepository'
import type { AppearanceSettings, BackgroundAssetRecord, ImportedFontRecord, ThemeMode } from './appearance'
import { BUNDLED_FONT_ID, DEFAULT_APPEARANCE } from './appearance'
import { COMPARE_PREFERENCES_KEY, ruleForPreset, type ComparePreferences } from '../compare/comparePreferences'
import type { ComparePreset, UnicodeMode, WhitespaceMode } from '../compare/types'
import type { NotePreferences } from '../notes/notePreferences'
import type { WindowBehaviorPreferences } from './windowBehavior'
import type { ReaderPreferences } from '../reader/types'
import {
  deleteManagedAsset,
  importBackgroundFromBrowser,
  importFontFromBrowser,
  managedAssetUrl,
  pickAndImportBackground,
  pickAndImportFont,
} from './managedAssets'

interface AppearanceSettingsPanelProps {
  statusMessage?: string
  appearance: AppearanceSettings
  runtimeIssues: string[]
  onChange(value: AppearanceSettings): void
  onStatusChange(status: string): void
  comparePreferences: ComparePreferences
  onComparePreferencesChange(value: ComparePreferences): void
  notePreferences: NotePreferences
  onNotePreferencesChange(value: NotePreferences): void
  windowBehavior: WindowBehaviorPreferences
  onWindowBehaviorChange(value: WindowBehaviorPreferences): void
  readerPreferences: ReaderPreferences
  onReaderPreferencesChange(value: ReaderPreferences): void
}

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', description: '温暖纸面', icon: Sun },
  { value: 'dark', label: '深色', description: '暖炭低光', icon: Moon },
  { value: 'system', label: '跟随系统', description: '实时切换', icon: Monitor },
]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function fontPreviewFamily(font: ImportedFontRecord) {
  return `'${font.internalFamily}', 'Microsoft YaHei UI', 'Segoe UI', sans-serif`
}

async function validateFont(font: ImportedFontRecord) {
  const url = managedAssetUrl(font.storedPath)
  const family = `ZixiValidation_${crypto.randomUUID().replaceAll('-', '_')}`
  const face = new FontFace(family, `url(${JSON.stringify(url)})`, { display: 'swap' })
  await face.load()
}

export function AppearanceSettingsPanel({
  statusMessage,
  appearance,
  runtimeIssues,
  onChange,
  onStatusChange,
  comparePreferences,
  onComparePreferencesChange,
  notePreferences,
  onNotePreferencesChange,
  windowBehavior,
  onWindowBehaviorChange,
  readerPreferences,
  onReaderPreferencesChange,
}: AppearanceSettingsPanelProps) {
  const unifiedNavigation = useUnifiedNavigation()
  const [pendingBackground, setPendingBackground] = useState<BackgroundAssetRecord | null>(null)
  const [fontToDelete, setFontToDelete] = useState<ImportedFontRecord | null>(null)
  const [busy, setBusy] = useState('')
  const backgroundInput = useRef<HTMLInputElement>(null)
  const fontInput = useRef<HTMLInputElement>(null)
  const previewAsset = pendingBackground ?? appearance.background.asset
  const previewUrl = previewAsset ? managedAssetUrl(previewAsset.storedPath) : ''

  function update(next: Partial<AppearanceSettings>) {
    onChange({ ...appearance, ...next })
  }

  function updateBackground(next: Partial<AppearanceSettings['background']>) {
    update({ background: { ...appearance.background, ...next } })
  }

  async function chooseBackground() {
    if (!isTauriRuntime()) {
      backgroundInput.current?.click()
      return
    }
    setBusy('background')
    try {
      const asset = await pickAndImportBackground()
      if (!asset) return
      if (pendingBackground && pendingBackground.id !== asset.id) {
        await deleteManagedAsset('background', pendingBackground.storedPath).catch(() => undefined)
      }
      setPendingBackground(asset)
      onStatusChange('背景图已复制到应用目录，请检查预览后应用')
    } catch (error) {
      onStatusChange(`背景图导入失败：${errorMessage(error)}`)
    } finally {
      setBusy('')
    }
  }

  async function chooseBrowserBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setBusy('background')
    try {
      const asset = await importBackgroundFromBrowser(file)
      setPendingBackground(asset)
      onStatusChange('背景图已载入浏览器预览；桌面版会保存应用管理副本')
    } catch (error) {
      onStatusChange(`背景图导入失败：${errorMessage(error)}`)
    } finally {
      setBusy('')
    }
  }

  async function discardPendingBackground() {
    if (!pendingBackground) return
    await deleteManagedAsset('background', pendingBackground.storedPath).catch(() => undefined)
    setPendingBackground(null)
    onStatusChange('已放弃尚未应用的背景预览')
  }

  async function applyPendingBackground() {
    if (!pendingBackground) return
    const nextBackground = pendingBackground
    const previousBackground = appearance.background.asset
    updateBackground({ asset: nextBackground })
    setPendingBackground(null)
    if (previousBackground && previousBackground.id !== nextBackground.id) {
      try {
        await deleteManagedAsset('background', previousBackground.storedPath)
      } catch (error) {
        onStatusChange(`背景图已应用，但旧管理副本清理失败：${errorMessage(error)}`)
        return
      }
    }
    onStatusChange('背景图已应用并同步到所有窗口')
  }

  async function removeBackground() {
    const asset = appearance.background.asset
    updateBackground({ asset: null })
    setPendingBackground(null)
    if (asset) {
      try {
        await deleteManagedAsset('background', asset.storedPath)
        onStatusChange('背景图已移除，应用管理副本已删除')
      } catch (error) {
        onStatusChange(`背景已停用，但管理副本删除失败：${errorMessage(error)}`)
      }
    }
  }

  async function addFontFromRecord(font: ImportedFontRecord) {
    const duplicate = appearance.importedFonts.find((item) => item.id === font.id)
    if (duplicate) {
      onStatusChange(`字体“${duplicate.displayName}”已经导入，无需重复复制`)
      return
    }
    try {
      await validateFont(font)
    } catch {
      await deleteManagedAsset('font', font.storedPath).catch(() => undefined)
      throw new Error('字体内容无法被系统字体引擎解析')
    }
    update({ importedFonts: [...appearance.importedFonts, font] })
    onStatusChange(`字体“${font.displayName}”已导入，可分别应用到界面、比较器或便签`)
  }

  async function chooseFont() {
    if (!isTauriRuntime()) {
      fontInput.current?.click()
      return
    }
    setBusy('font')
    try {
      const font = await pickAndImportFont()
      if (!font) return
      await addFontFromRecord(font)
    } catch (error) {
      onStatusChange(`字体导入失败：${errorMessage(error)}`)
    } finally {
      setBusy('')
    }
  }

  async function chooseBrowserFont(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setBusy('font')
    try {
      await addFontFromRecord(await importFontFromBrowser(file))
    } catch (error) {
      onStatusChange(`字体导入失败：${errorMessage(error)}`)
    } finally {
      setBusy('')
    }
  }

  async function deleteFont(font: ImportedFontRecord) {
    setBusy(font.id)
    try {
      const changedNotes = await resetNotesUsingFont(font.internalFamily)
      await deleteManagedAsset('font', font.storedPath)
      const clearIfSelected = (id: string | null) => id === font.id ? null : id
      onChange({
        ...appearance,
        importedFonts: appearance.importedFonts.filter((item) => item.id !== font.id),
        fonts: {
          uiFontId: clearIfSelected(appearance.fonts.uiFontId),
          editorFontId: clearIfSelected(appearance.fonts.editorFontId),
          noteDefaultFontId: clearIfSelected(appearance.fonts.noteDefaultFontId),
        },
      })
      setFontToDelete(null)
      onStatusChange(`字体已删除${changedNotes ? `，${changedNotes} 张便签已恢复默认字体` : ''}`)
    } catch (error) {
      onStatusChange(`字体删除失败，原设置未改变：${errorMessage(error)}`)
    } finally {
      setBusy('')
    }
  }

  async function persistBeforeRestart() {
    await Promise.all([
      saveSetting('appearance', appearance),
      saveSetting('note-preferences', notePreferences),
      saveSetting('window-behavior', windowBehavior),
      saveSetting('reader-preferences', readerPreferences),
      saveSetting(COMPARE_PREFERENCES_KEY, comparePreferences),
    ])
  }

  return (
    <section className="settings-view" id="settings-view">
      {unifiedNavigation && <WorkspaceNavigation><aside className="settings-directory" aria-label="设置目录"><header><strong>设置</strong></header><div className="directory-items">{['主题', 'TXT 阅读器', '独立便签', '独立窗口与主窗口', '高级比较', '本地背景图', '应用字体', '数据与备份'].map((label) => <button key={label} onClick={() => {
        const heading = [...document.querySelectorAll('#settings-view h2')].find((item) => item.textContent === label)
        const section = heading?.closest('.settings-section')
        if (section instanceof HTMLDetailsElement) section.open = true
        section?.scrollIntoView({ block: 'start' })
      }}>{label}</button>)}</div></aside></WorkspaceNavigation>}

      <header className="settings-header">
        <div><h1>设置</h1><p>调整主题、背景与字体，并实时同步到已经打开的便签窗口。</p></div>
        <ViewStatus message={statusMessage} />
      </header>

      {runtimeIssues.length > 0 && <div className="settings-alert" role="status">{runtimeIssues.map((issue) => <p key={issue}>{issue}</p>)}</div>}

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>主题</h2><p>跟随系统会在应用运行期间实时响应浅色与深色切换。</p></div></div>
        <div className="theme-options" role="radiogroup" aria-label="主题模式">
          {THEME_OPTIONS.map(({ value, label, description, icon: Icon }) => (
            <button key={value} role="radio" aria-checked={appearance.themeMode === value} className={appearance.themeMode === value ? 'selected' : ''} onClick={() => update({ themeMode: value })}>
              <Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span>{appearance.themeMode === value && <Check size={16} />}
            </button>
          ))}
        </div>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>界面字号</strong><small>12–22 px，调整导航、按钮和设置，不改变编辑器与便签正文</small></span><div className="range-row"><RangeControl aria-label="界面字号"  min="12" max="22" step="1" value={appearance.uiFontSize} onChange={(event) => update({ uiFontSize: Number(event.target.value) })} /><input className="ui-font-size-input" aria-label="界面字号数值" type="number" min="12" max="22" step="1" value={appearance.uiFontSize} onChange={(event) => { const value = Number(event.target.value); if (value >= 12 && value <= 22) update({ uiFontSize: value }) }} /><output>px</output></div></label>
          <label className="setting-row"><span><strong>比较编辑器字号</strong><small>12–28 px，原文与修改稿共用；不改变界面或便签正文</small></span><div className="range-row"><RangeControl aria-label="比较编辑器字号"  min="12" max="28" step="1" value={appearance.compareEditorFontSize} onChange={(event) => update({ compareEditorFontSize: Number(event.target.value) })} /><input className="ui-font-size-input" aria-label="比较编辑器字号数值" type="number" min="12" max="28" step="1" value={appearance.compareEditorFontSize} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 12 && value <= 28) update({ compareEditorFontSize: value }) }} /><output>px</output></div></label>
          <label className="setting-row"><span><strong>强调色</strong><small>用于选中、焦点和主要操作，不改变差异语义色</small></span><div className="color-control"><input type="color" value={appearance.accent} onChange={(event) => update({ accent: event.target.value })} /><button className="text-button" onClick={() => update({ accent: DEFAULT_APPEARANCE.accent })} type="button"><RotateCcw size={14} />恢复</button></div></label>
          <label className="setting-row switch-row"><span><strong>增强对比度</strong><small>独立于主题模式，加粗边界与焦点</small></span><CheckControl aria-label="增强对比度" switch  checked={appearance.accessibility.increasedContrast} onChange={(event) => update({ accessibility: { ...appearance.accessibility, increasedContrast: event.target.checked } })} /></label>
          <label className="setting-row switch-row"><span><strong>减少透明效果</strong><small>关闭背景模糊并使用完全不透明表面</small></span><CheckControl aria-label="减少透明效果" switch  checked={appearance.accessibility.reduceTransparency} onChange={(event) => update({ accessibility: { ...appearance.accessibility, reduceTransparency: event.target.checked } })} /></label>
          <label className="setting-row switch-row"><span><strong>减少动态效果</strong><small>同时响应系统的“减少动画”偏好</small></span><CheckControl aria-label="减少动态效果" switch  checked={appearance.accessibility.reduceMotion} onChange={(event) => update({ accessibility: { ...appearance.accessibility, reduceMotion: event.target.checked } })} /></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>TXT 阅读器</h2><p>控制书库进入行为、导入后的动作与默认阅读排版。</p></div></div>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>阅读方式</strong><small>章节滚动适合连续阅读；单页模式只对当前内部区块分页</small></span><SelectControl aria-label="阅读方式" value={readerPreferences.readingMode} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, readingMode: event.target.value as ReaderPreferences['readingMode'] })}><option value="chapter-scroll">章节滚动</option><option value="paged">单页分页</option></SelectControl></label>
          <label className="setting-row"><span><strong>正文宽度</strong><small>仅改变正文排版宽度，切换后会尽量保留当前文字位置</small></span><SelectControl aria-label="正文宽度" value={readerPreferences.contentWidth} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, contentWidth: Number(event.target.value) as ReaderPreferences['contentWidth'] })}><option value="640">窄（640 px）</option><option value="760">标准（760 px）</option><option value="880">宽（880 px）</option></SelectControl></label>
          <label className="setting-row"><span><strong>正文字体</strong><small>作为打开 TXT 时的默认排版</small></span><SelectControl aria-label="正文字体" value={readerPreferences.fontFamily} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, fontFamily: event.target.value as ReaderPreferences['fontFamily'] })}><option value="serif">宋体</option><option value="sans">黑体</option></SelectControl></label>
          <label className="setting-row"><span><strong>默认行距</strong><small>可在阅读工具栏中继续即时调整</small></span><SelectControl aria-label="默认行距" value={readerPreferences.lineHeight} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, lineHeight: Number(event.target.value) })}><option value="1.55">紧凑</option><option value="1.9">舒适</option><option value="2.2">宽松</option></SelectControl></label>
          <label className="setting-row switch-row"><span><strong>进入书架时打开最近阅读窗口</strong><small>默认关闭；开启后进入书架会弹出最近一本书的独立阅读窗口</small></span><CheckControl aria-label="进入书架时打开最近阅读窗口" switch  checked={readerPreferences.autoOpenRecent} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, autoOpenRecent: event.target.checked })} /></label>
          <label className="setting-row switch-row"><span><strong>导入后立即阅读</strong><small>开启后，导入完成会直接打开独立阅读窗口</small></span><CheckControl aria-label="导入后立即阅读" switch  checked={readerPreferences.openAfterImport} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, openAfterImport: event.target.checked })} /></label>
          <label className="setting-row switch-row"><span><strong>滚到边界后继续滚轮切换章节</strong><small>正文仅渲染当前区块；到达首尾后再次有意滚动才会切换，并带有防误触冷却</small></span><CheckControl aria-label="滚到边界后继续滚轮切换章节" switch  checked={readerPreferences.autoTurnChapterOnWheel} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, autoTurnChapterOnWheel: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>段落首行缩进</strong><small>0—8 个全角字符；旧设置保持原有的 0 字符效果</small></span><RangeControl aria-label="段落首行缩进"  min="0" max="8" step="1" value={readerPreferences.firstLineIndent} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, firstLineIndent: Number(event.target.value) })} /></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>独立便签</h2><p>控制浮动便签窗口存在未保存修改时的关闭方式。</p></div></div>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>关闭窗口时</strong><small>“退出时询问”是新默认值；Ctrl+S 始终会立即保存当前内容</small></span><SelectControl aria-label="独立便签关闭方式" value={notePreferences.closeBehavior} onChange={(event) => onNotePreferencesChange({ version: 1, closeBehavior: event.target.value as NotePreferences['closeBehavior'] })}><option value="ask">退出时询问是否保存（推荐）</option><option value="save">自动保存并关闭</option><option value="discard">不保存直接关闭</option></SelectControl></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>独立窗口与主窗口</h2><p>“最小化”保留任务栏按钮；“隐藏到托盘”会从任务栏消失，并通过托盘图标恢复。</p></div></div>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>打开独立便签后</strong><small>仅影响浮动便签，不影响主窗口中的“便签”页面</small></span><SelectControl aria-label="打开独立便签后的主窗口行为" value={windowBehavior.note.open} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, note: { ...windowBehavior.note, open: event.target.value as WindowBehaviorPreferences['note']['open'] } })}><option value="keep">保持主窗口现状</option><option value="minimize">最小化到任务栏</option><option value="hide">隐藏到系统托盘</option></SelectControl></label>
          <label className="setting-row"><span><strong>关闭最后一个独立便签后</strong><small>仍有其它独立窗口时不会抢回主窗口焦点</small></span><SelectControl aria-label="关闭独立便签后的主窗口行为" value={windowBehavior.note.close} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, note: { ...windowBehavior.note, close: event.target.value as WindowBehaviorPreferences['note']['close'] } })}><option value="keep">保持主窗口现状</option><option value="show">显示并聚焦主窗口</option></SelectControl></label>
          <label className="setting-row"><span><strong>打开独立比较后</strong><small>控制从主比较页面弹出独立比较窗口后的主窗口状态</small></span><SelectControl aria-label="打开独立比较后的主窗口行为" value={windowBehavior.compare.open} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, compare: { ...windowBehavior.compare, open: event.target.value as WindowBehaviorPreferences['compare']['open'] } })}><option value="keep">保持主窗口现状</option><option value="minimize">最小化到任务栏</option><option value="hide">隐藏到系统托盘</option></SelectControl></label>
          <label className="setting-row"><span><strong>关闭最后一个独立比较后</strong><small>仍有其它独立窗口时不会抢回主窗口焦点</small></span><SelectControl aria-label="关闭独立比较后的主窗口行为" value={windowBehavior.compare.close} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, compare: { ...windowBehavior.compare, close: event.target.value as WindowBehaviorPreferences['compare']['close'] } })}><option value="keep">保持主窗口现状</option><option value="show">显示并聚焦主窗口</option></SelectControl></label>
          <label className="setting-row"><span><strong>打开独立阅读窗口后</strong><small>可让主窗口保持、最小化或隐藏到系统托盘</small></span><SelectControl aria-label="打开独立阅读窗口后的主窗口行为" value={windowBehavior.reader.open} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, reader: { ...windowBehavior.reader, open: event.target.value as WindowBehaviorPreferences['reader']['open'] } })}><option value="keep">保持主窗口现状</option><option value="minimize">最小化到任务栏</option><option value="hide">隐藏到系统托盘</option></SelectControl></label>
          <label className="setting-row"><span><strong>关闭最后一个独立阅读窗口后</strong><small>仍有其它独立窗口时不会抢回主窗口焦点</small></span><SelectControl aria-label="关闭独立阅读窗口后的主窗口行为" value={windowBehavior.reader.close} onChange={(event) => onWindowBehaviorChange({ ...windowBehavior, reader: { ...windowBehavior.reader, close: event.target.value as WindowBehaviorPreferences['reader']['close'] } })}><option value="keep">保持主窗口现状</option><option value="show">显示并聚焦主窗口</option></SelectControl></label>
          <label className="setting-row switch-row"><span><strong>独立阅读窗口始终置顶</strong><small>在侧边面板中修改时会立即作用于当前窗口</small></span><CheckControl aria-label="独立阅读窗口始终置顶" switch  checked={readerPreferences.standaloneAlwaysOnTop} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, standaloneAlwaysOnTop: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>恢复隐藏阅读窗</strong><small>这是系统级组合键；若被其它程序占用，会保留上一个可用组合键并显示提示</small></span><SelectControl aria-label="恢复隐藏阅读窗快捷键" value={readerPreferences.restoreShortcut} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, restoreShortcut: event.target.value as ReaderPreferences['restoreShortcut'] })}><option value="Control+Alt+B">Ctrl+Alt+B</option><option value="Control+Shift+B">Ctrl+Shift+B</option><option value="Alt+Shift+B">Alt+Shift+B</option></SelectControl></label>
          <label className="setting-row"><span><strong>阅读背景不透明度</strong><small>{Math.round(readerPreferences.backgroundOpacity * 100)}%；只影响背景，文字保持不透明</small></span><RangeControl aria-label="阅读背景不透明度"  min="0" max="1" step="0.02" value={readerPreferences.backgroundOpacity} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, backgroundOpacity: Number(event.target.value) })} /></label>
          <label className="setting-row"><span><strong>阅读文字颜色</strong><small>默认跟随主题；选择颜色后改为固定值</small></span><span><input aria-label="阅读文字颜色" type="color" value={readerPreferences.textColor || '#2f2b27'} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, textColor: event.target.value })} /><button type="button" className="secondary-button" onClick={() => onReaderPreferencesChange({ ...readerPreferences, textColor: '' })}>跟随主题</button></span></label>
          <label className="setting-row switch-row"><span><strong>阅读文字阴影</strong><small>在复杂背景上增加轻微轮廓，可随时关闭</small></span><CheckControl aria-label="阅读文字阴影" switch  checked={readerPreferences.textShadow} onChange={(event) => onReaderPreferencesChange({ ...readerPreferences, textShadow: event.target.checked })} /></label>
        </div>
      </section>

      <details className="settings-section compare-preferences-section">
        <summary><span><h2>高级比较</h2><p>布局、换行和比较规则会保存，并实时同步到独立比较窗口。</p></span></summary>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>主比较布局</strong><small>自动模式依据编辑工作区宽度决定，不受侧栏外的屏幕宽度误导</small></span><SelectControl aria-label="主比较布局" value={comparePreferences.layout} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, layout: event.target.value as ComparePreferences['layout'] })}><option value="auto">自动</option><option value="side-by-side">左右</option><option value="stacked">上下</option></SelectControl></label>
          <label className="setting-row"><span><strong>换行模式</strong><small>关闭换行时保留可操作的水平滚动条</small></span><SelectControl aria-label="换行模式" value={comparePreferences.wordWrap} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, wordWrap: event.target.value as ComparePreferences['wordWrap'] })}><option value="window">跟随窗口</option><option value="column">固定列宽</option><option value="off">关闭换行</option></SelectControl></label>
          <label className="setting-row"><span><strong>固定列宽</strong><small>仅在“固定列宽”时生效，范围 40–200 字符</small></span><input aria-label="固定换行列宽" disabled={comparePreferences.wordWrap !== 'column'} type="number" min="40" max="200" value={comparePreferences.wordWrapColumn} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, wordWrapColumn: Math.min(200, Math.max(40, Number(event.target.value) || 80)) })} /></label>
          <label className="setting-row switch-row"><span><strong>显示行号</strong><small>两侧始终一致，便于定位差异</small></span><CheckControl aria-label="显示行号" switch  checked={comparePreferences.lineNumbers} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, lineNumbers: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>空白字符</strong><small>控制 Monaco 的可见空白提示</small></span><SelectControl aria-label="空白字符" value={comparePreferences.whitespace} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, whitespace: event.target.value as ComparePreferences['whitespace'] })}><option value="none">关闭</option><option value="selection">仅选中</option><option value="all">全部</option></SelectControl></label>
          <label className="setting-row switch-row"><span><strong>默认同步滚动</strong><small>新开的比较窗口也使用同一偏好</small></span><CheckControl aria-label="默认同步滚动" switch  checked={comparePreferences.syncScroll} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, syncScroll: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>比较规则</strong><small>精确、审阅、宽松或按下方选项自定义</small></span><SelectControl aria-label="比较规则" value={comparePreferences.rule.preset} onChange={(event) => { const value = event.target.value as ComparePreset | 'custom'; onComparePreferencesChange({ ...comparePreferences, rule: value === 'custom' ? { ...comparePreferences.rule, preset: 'custom' } : ruleForPreset(value) }) }}><option value="exact">精确</option><option value="review">审阅</option><option value="relaxed">宽松</option><option value="custom">自定义</option></SelectControl></label>
        </div>
        <fieldset className="custom-rule-fieldset" disabled={comparePreferences.rule.preset !== 'custom'}>
          <legend>自定义规则</legend>
          <div className="custom-rule-grid">
            <label className="custom-rule-toggle"><CheckControl aria-label="区分大小写"  checked={comparePreferences.rule.caseSensitive} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', caseSensitive: event.target.checked } })} /><span>区分大小写</span></label>
            <label><span>空白处理</span><SelectControl aria-label="空白处理" value={comparePreferences.rule.whitespace} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', whitespace: event.target.value as WhitespaceMode } })}><option value="all">全部参与</option><option value="trim-trailing">忽略行尾</option><option value="collapse">合并连续空白</option></SelectControl></label>
            <label><span>Unicode 等价</span><SelectControl aria-label="Unicode 等价" value={comparePreferences.rule.unicode} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', unicode: event.target.value as UnicodeMode } })}><option value="none">不规范化</option><option value="nfc">NFC</option><option value="nfkc">NFKC（含全半角）</option></SelectControl></label>
          </div>
        </fieldset>
      </details>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>本地背景图</h2><p>支持 PNG、JPEG 和 WebP；桌面版会验证后复制到应用管理目录。</p></div><button className="secondary-button" disabled={busy === 'background'} onClick={chooseBackground}><ImageIcon size={16} />{busy === 'background' ? '正在验证…' : '选择图片'}</button></div>
        <input ref={backgroundInput} hidden type="file" accept=".png,.jpg,.jpeg,.webp" onChange={chooseBrowserBackground} />
        <div className="background-settings">
          <div className="background-preview" style={{ backgroundImage: previewUrl ? `url(${JSON.stringify(previewUrl)})` : undefined, backgroundSize: appearance.background.fit === 'native' ? 'auto' : appearance.background.fit, '--preview-dim': String(appearance.background.dim) } as CSSProperties}>
            <div><Eye size={18} /><strong>{previewAsset ? previewAsset.sourceFileName : '使用主题默认背景'}</strong><small>{previewAsset ? `${previewAsset.width} × ${previewAsset.height} · ${(previewAsset.byteSize / 1024 / 1024).toFixed(1)} MB` : '背景图只作为环境层，正文保持稳定纸面'}</small></div>
          </div>
          <div className="background-controls">
            <label>显示方式<SelectControl aria-label="显示方式" value={appearance.background.fit} onChange={(event) => updateBackground({ fit: event.target.value as AppearanceSettings['background']['fit'] })}><option value="cover">填充窗口</option><option value="contain">完整显示</option><option value="native">原始尺寸</option></SelectControl></label>
            <label>主题遮罩<div className="range-row"><RangeControl aria-label="主题遮罩"  min="0" max="78" value={appearance.background.dim * 100} onChange={(event) => updateBackground({ dim: Number(event.target.value) / 100 })} /><output>{Math.round(appearance.background.dim * 100)}%</output></div></label>
            <label>背景模糊<div className="range-row"><RangeControl aria-label="背景模糊" disabled={appearance.accessibility.reduceTransparency}  min="0" max="24" value={appearance.background.blur} onChange={(event) => updateBackground({ blur: Number(event.target.value) })} /><output>{appearance.background.blur}px</output></div></label>
            <label>界面表面<div className="range-row"><RangeControl aria-label="界面表面" disabled={appearance.accessibility.reduceTransparency}  min="82" max="100" value={appearance.background.surfaceOpacity * 100} onChange={(event) => updateBackground({ surfaceOpacity: Number(event.target.value) / 100 })} /><output>{Math.round(appearance.background.surfaceOpacity * 100)}%</output></div></label>
            <p className="readability-note">表面透明度最低为 82%；比较编辑器和长文本区域会保持更稳定的不透明度。</p>
            <div className="button-row">
              {pendingBackground && <><button className="primary-button" onClick={applyPendingBackground}>应用预览</button><button className="text-button" onClick={discardPendingBackground}>放弃预览</button></>}
              {appearance.background.asset && <button className="danger-button" onClick={removeBackground}><Trash2 size={15} />移除背景</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><div><h2>应用字体</h2><p>支持 WOFF2、WOFF、TTF、OTF；字体仅在字隙内部注册，不会安装到系统。</p></div><button className="secondary-button" disabled={busy === 'font'} onClick={chooseFont}><Upload size={16} />{busy === 'font' ? '正在验证…' : '导入字体'}</button></div>
        <input ref={fontInput} hidden type="file" accept=".woff2,.woff,.ttf,.otf" onChange={chooseBrowserFont} />
        <div className="font-scope-grid">
          {([
            ['uiFontId', '界面字体', '导航、按钮与设置'],
            ['editorFontId', '比较编辑器', '原文与修改稿正文'],
            ['noteDefaultFontId', '默认便签正文', '新建或跟随默认的便签'],
          ] as const).map(([key, label, description]) => (
            <label key={key}><span><strong>{label}</strong><small>{description}</small></span><SelectControl aria-label="思源宋体（内置）" value={appearance.fonts[key] ?? ''} onChange={(event) => update({ fonts: { ...appearance.fonts, [key]: event.target.value || null } })}><option value={BUNDLED_FONT_ID}>思源宋体（内置）</option><option value="">系统后备字体</option>{appearance.importedFonts.map((font) => <option key={font.id} value={font.id}>{font.displayName}</option>)}</SelectControl></label>
          ))}
        </div>
        {fontToDelete && <div className="delete-confirmation" role="alertdialog" aria-labelledby="font-delete-title"><div><strong id="font-delete-title">删除“{fontToDelete.displayName}”？</strong><p>{Object.values(appearance.fonts).includes(fontToDelete.id) ? '该字体正在使用。删除后相关区域与使用它的便签会恢复系统默认字体。' : '使用该字体的便签会恢复系统默认字体；不会删除原始字体或系统字体。'}</p></div><div><button className="text-button" onClick={() => setFontToDelete(null)}>取消</button><button className="danger-button" disabled={busy === fontToDelete.id} onClick={() => deleteFont(fontToDelete)}><Trash2 size={15} />确认删除</button></div></div>}
        {appearance.importedFonts.length ? <div className="font-list">{appearance.importedFonts.map((font) => <article key={font.id}><div className="font-sample" style={{ fontFamily: fontPreviewFamily(font) }}>字隙 Aa 123，审阅与记录。</div><div><strong>{font.displayName}</strong><small>{font.sourceFileName} · {font.format.toUpperCase()}</small></div><button className="icon-only-button" disabled={busy === font.id} onClick={() => setFontToDelete(font)} title={`删除 ${font.displayName}`}><Trash2 size={16} /></button></article>)}</div> : <div className="empty-inline"><Type size={20} /><span>尚未导入字体；系统后备字体始终可用。</span></div>}
        <button className="text-button restore-fonts" onClick={() => update({ fonts: { uiFontId: BUNDLED_FONT_ID, editorFontId: BUNDLED_FONT_ID, noteDefaultFontId: BUNDLED_FONT_ID } })}><RotateCcw size={14} />全部恢复思源宋体</button>
      </section>

      <StorageSettingsPanel beforeRestart={persistBeforeRestart} onStatusChange={onStatusChange} />
    </section>
  )
}
