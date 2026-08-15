import {
  Check,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  Moon,
  RotateCcw,
  ShieldCheck,
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
import { ruleForPreset, type ComparePreferences } from '../compare/comparePreferences'
import type { ComparePreset, UnicodeMode, WhitespaceMode } from '../compare/types'
import {
  deleteManagedAsset,
  importBackgroundFromBrowser,
  importFontFromBrowser,
  managedAssetUrl,
  pickAndImportBackground,
  pickAndImportFont,
} from './managedAssets'

interface AppearanceSettingsPanelProps {
  appearance: AppearanceSettings
  runtimeIssues: string[]
  onChange(value: AppearanceSettings): void
  onStatusChange(status: string): void
  comparePreferences: ComparePreferences
  onComparePreferencesChange(value: ComparePreferences): void
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
  appearance,
  runtimeIssues,
  onChange,
  onStatusChange,
  comparePreferences,
  onComparePreferencesChange,
}: AppearanceSettingsPanelProps) {
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

  async function revealDatabase() {
    if (!isTauriRuntime()) {
      onStatusChange('浏览器预览中没有桌面数据目录；请在桌面版中使用此入口')
      return
    }
    try {
      const [{ appConfigDir, join }, { revealItemInDir }] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-opener'),
      ])
      await revealItemInDir(await join(await appConfigDir(), 'zixi.db'))
      onStatusChange('已在资源管理器中定位本地数据库')
    } catch {
      onStatusChange('无法打开数据目录，请确认桌面版数据库已经初始化')
    }
  }

  return (
    <section className="settings-view">
      <header className="settings-header">
        <div><p className="eyebrow">外观与阅读</p><h1>让界面安静下来</h1><p>主题、背景和字体只保存在当前设备，并实时同步到已经打开的便签窗口。</p></div>
        <div className="privacy-note"><ShieldCheck size={17} /><span><strong>本地资源</strong>不会上传字体或图片</span></div>
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
          <label className="setting-row"><span><strong>界面字号</strong><small>12–22 px，调整导航、按钮和设置，不改变编辑器与便签正文</small></span><div className="range-row"><input type="range" min="12" max="22" step="1" value={appearance.uiFontSize} onChange={(event) => update({ uiFontSize: Number(event.target.value) })} /><input className="ui-font-size-input" aria-label="界面字号数值" type="number" min="12" max="22" step="1" value={appearance.uiFontSize} onChange={(event) => { const value = Number(event.target.value); if (value >= 12 && value <= 22) update({ uiFontSize: value }) }} /><output>px</output></div></label>
          <label className="setting-row"><span><strong>比较编辑器字号</strong><small>12–28 px，原文与修改稿共用；不改变界面或便签正文</small></span><div className="range-row"><input type="range" min="12" max="28" step="1" value={appearance.compareEditorFontSize} onChange={(event) => update({ compareEditorFontSize: Number(event.target.value) })} /><input className="ui-font-size-input" aria-label="比较编辑器字号数值" type="number" min="12" max="28" step="1" value={appearance.compareEditorFontSize} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 12 && value <= 28) update({ compareEditorFontSize: value }) }} /><output>px</output></div></label>
          <label className="setting-row"><span><strong>强调色</strong><small>用于选中、焦点和主要操作，不改变差异语义色</small></span><div className="color-control"><input type="color" value={appearance.accent} onChange={(event) => update({ accent: event.target.value })} /><button className="text-button" onClick={() => update({ accent: DEFAULT_APPEARANCE.accent })} type="button"><RotateCcw size={14} />恢复</button></div></label>
          <label className="setting-row switch-row"><span><strong>增强对比度</strong><small>独立于主题模式，加粗边界与焦点</small></span><input type="checkbox" checked={appearance.accessibility.increasedContrast} onChange={(event) => update({ accessibility: { ...appearance.accessibility, increasedContrast: event.target.checked } })} /></label>
          <label className="setting-row switch-row"><span><strong>减少透明效果</strong><small>关闭背景模糊并使用完全不透明表面</small></span><input type="checkbox" checked={appearance.accessibility.reduceTransparency} onChange={(event) => update({ accessibility: { ...appearance.accessibility, reduceTransparency: event.target.checked } })} /></label>
          <label className="setting-row switch-row"><span><strong>减少动态效果</strong><small>同时响应系统的“减少动画”偏好</small></span><input type="checkbox" checked={appearance.accessibility.reduceMotion} onChange={(event) => update({ accessibility: { ...appearance.accessibility, reduceMotion: event.target.checked } })} /></label>
        </div>
      </section>

      <details className="settings-section compare-preferences-section">
        <summary><span><h2>高级比较</h2><p>布局、换行和比较规则会保存，并实时同步到独立比较窗口。</p></span></summary>
        <div className="setting-rows">
          <label className="setting-row"><span><strong>主比较布局</strong><small>自动模式依据编辑工作区宽度决定，不受侧栏外的屏幕宽度误导</small></span><select value={comparePreferences.layout} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, layout: event.target.value as ComparePreferences['layout'] })}><option value="auto">自动</option><option value="side-by-side">左右</option><option value="stacked">上下</option></select></label>
          <label className="setting-row"><span><strong>换行模式</strong><small>关闭换行时保留可操作的水平滚动条</small></span><select value={comparePreferences.wordWrap} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, wordWrap: event.target.value as ComparePreferences['wordWrap'] })}><option value="window">跟随窗口</option><option value="column">固定列宽</option><option value="off">关闭换行</option></select></label>
          <label className="setting-row"><span><strong>固定列宽</strong><small>仅在“固定列宽”时生效，范围 40–200 字符</small></span><input aria-label="固定换行列宽" disabled={comparePreferences.wordWrap !== 'column'} type="number" min="40" max="200" value={comparePreferences.wordWrapColumn} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, wordWrapColumn: Math.min(200, Math.max(40, Number(event.target.value) || 80)) })} /></label>
          <label className="setting-row switch-row"><span><strong>显示行号</strong><small>两侧始终一致，便于定位差异</small></span><input type="checkbox" checked={comparePreferences.lineNumbers} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, lineNumbers: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>空白字符</strong><small>控制 Monaco 的可见空白提示</small></span><select value={comparePreferences.whitespace} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, whitespace: event.target.value as ComparePreferences['whitespace'] })}><option value="none">关闭</option><option value="selection">仅选中</option><option value="all">全部</option></select></label>
          <label className="setting-row switch-row"><span><strong>默认同步滚动</strong><small>新开的比较窗口也使用同一偏好</small></span><input type="checkbox" checked={comparePreferences.syncScroll} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, syncScroll: event.target.checked })} /></label>
          <label className="setting-row"><span><strong>比较规则</strong><small>精确、审阅、宽松或按下方选项自定义</small></span><select value={comparePreferences.rule.preset} onChange={(event) => { const value = event.target.value as ComparePreset | 'custom'; onComparePreferencesChange({ ...comparePreferences, rule: value === 'custom' ? { ...comparePreferences.rule, preset: 'custom' } : ruleForPreset(value) }) }}><option value="exact">精确</option><option value="review">审阅</option><option value="relaxed">宽松</option><option value="custom">自定义</option></select></label>
        </div>
        <fieldset className="custom-rule-fieldset" disabled={comparePreferences.rule.preset !== 'custom'}>
          <legend>自定义规则</legend>
          <div className="custom-rule-grid">
            <label className="custom-rule-toggle"><input type="checkbox" checked={comparePreferences.rule.caseSensitive} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', caseSensitive: event.target.checked } })} /><span>区分大小写</span></label>
            <label><span>空白处理</span><select value={comparePreferences.rule.whitespace} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', whitespace: event.target.value as WhitespaceMode } })}><option value="all">全部参与</option><option value="trim-trailing">忽略行尾</option><option value="collapse">合并连续空白</option></select></label>
            <label><span>Unicode 等价</span><select value={comparePreferences.rule.unicode} onChange={(event) => onComparePreferencesChange({ ...comparePreferences, rule: { ...comparePreferences.rule, preset: 'custom', unicode: event.target.value as UnicodeMode } })}><option value="none">不规范化</option><option value="nfc">NFC</option><option value="nfkc">NFKC（含全半角）</option></select></label>
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
            <label>显示方式<select value={appearance.background.fit} onChange={(event) => updateBackground({ fit: event.target.value as AppearanceSettings['background']['fit'] })}><option value="cover">填充窗口</option><option value="contain">完整显示</option><option value="native">原始尺寸</option></select></label>
            <label>主题遮罩<div className="range-row"><input type="range" min="0" max="78" value={appearance.background.dim * 100} onChange={(event) => updateBackground({ dim: Number(event.target.value) / 100 })} /><output>{Math.round(appearance.background.dim * 100)}%</output></div></label>
            <label>背景模糊<div className="range-row"><input disabled={appearance.accessibility.reduceTransparency} type="range" min="0" max="24" value={appearance.background.blur} onChange={(event) => updateBackground({ blur: Number(event.target.value) })} /><output>{appearance.background.blur}px</output></div></label>
            <label>界面表面<div className="range-row"><input disabled={appearance.accessibility.reduceTransparency} type="range" min="82" max="100" value={appearance.background.surfaceOpacity * 100} onChange={(event) => updateBackground({ surfaceOpacity: Number(event.target.value) / 100 })} /><output>{Math.round(appearance.background.surfaceOpacity * 100)}%</output></div></label>
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
            <label key={key}><span><strong>{label}</strong><small>{description}</small></span><select value={appearance.fonts[key] ?? ''} onChange={(event) => update({ fonts: { ...appearance.fonts, [key]: event.target.value || null } })}><option value={BUNDLED_FONT_ID}>思源宋体（内置）</option><option value="">系统后备字体</option>{appearance.importedFonts.map((font) => <option key={font.id} value={font.id}>{font.displayName}</option>)}</select></label>
          ))}
        </div>
        {fontToDelete && <div className="delete-confirmation" role="alertdialog" aria-labelledby="font-delete-title"><div><strong id="font-delete-title">删除“{fontToDelete.displayName}”？</strong><p>{Object.values(appearance.fonts).includes(fontToDelete.id) ? '该字体正在使用。删除后相关区域与使用它的便签会恢复系统默认字体。' : '使用该字体的便签会恢复系统默认字体；不会删除原始字体或系统字体。'}</p></div><div><button className="text-button" onClick={() => setFontToDelete(null)}>取消</button><button className="danger-button" disabled={busy === fontToDelete.id} onClick={() => deleteFont(fontToDelete)}><Trash2 size={15} />确认删除</button></div></div>}
        {appearance.importedFonts.length ? <div className="font-list">{appearance.importedFonts.map((font) => <article key={font.id}><div className="font-sample" style={{ fontFamily: fontPreviewFamily(font) }}>字隙 Aa 123，审阅与记录。</div><div><strong>{font.displayName}</strong><small>{font.sourceFileName} · {font.format.toUpperCase()}</small></div><button className="icon-only-button" disabled={busy === font.id} onClick={() => setFontToDelete(font)} title={`删除 ${font.displayName}`}><Trash2 size={16} /></button></article>)}</div> : <div className="empty-inline"><Type size={20} /><span>尚未导入字体；系统后备字体始终可用。</span></div>}
        <button className="text-button restore-fonts" onClick={() => update({ fonts: { uiFontId: BUNDLED_FONT_ID, editorFontId: BUNDLED_FONT_ID, noteDefaultFontId: BUNDLED_FONT_ID } })}><RotateCcw size={14} />全部恢复思源宋体</button>
      </section>

      <section className="settings-section compact-section">
        <div><h2>数据与备份</h2><p>退出应用后复制整个配置目录，可同时备份 SQLite、WAL、背景图和导入字体。</p></div>
        <button className="secondary-button" onClick={revealDatabase}><FolderOpen size={16} />定位本地数据库</button>
      </section>
    </section>
  )
}
