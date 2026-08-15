mod asset_validation;

use asset_validation::{detect_background, detect_font, extension_matches};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Theme, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

const BACKGROUND_BYTE_LIMIT: u64 = 24 * 1024 * 1024;
const FONT_BYTE_LIMIT: u64 = 12 * 1024 * 1024;

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    DWMWA_USE_IMMERSIVE_DARK_MODE,
};

#[derive(Default)]
struct PendingTrayRequests {
    next_id: AtomicU64,
    pending: Mutex<Vec<u64>>,
}

impl PendingTrayRequests {
    fn enqueue(&self) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.pending.lock().expect("tray queue poisoned").push(id);
        id
    }

    fn list(&self) -> Vec<u64> {
        self.pending.lock().expect("tray queue poisoned").clone()
    }

    fn acknowledge(&self, id: u64) {
        self.pending
            .lock()
            .expect("tray queue poisoned")
            .retain(|candidate| *candidate != id);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenNoteWindowResult {
    created: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtomicNoteSaveInput {
    id: String,
    title: String,
    content: String,
    style_json: String,
    always_on_top: bool,
    expected_updated_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    revision_id: String,
    revision_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AtomicNoteSaveResult {
    status: &'static str,
    updated_at: Option<String>,
    previous_deleted_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmptyTrashResult {
    note_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchTrashMutationResult {
    note_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtomicComparisonSaveInput {
    id: String,
    left_text: String,
    right_text: String,
    preset: String,
    stats_json: String,
    expected_revision: Option<i64>,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComparisonState {
    id: String,
    left_text: String,
    right_text: String,
    preset: String,
    stats_json: String,
    updated_at: String,
    revision: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AtomicComparisonSaveResult {
    status: &'static str,
    comparison: Option<ComparisonState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCompareWindowResult {
    created: bool,
}

struct StoredNoteState {
    title: String,
    content: String,
    style_json: String,
    always_on_top: bool,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundAssetRecord {
    id: String,
    source_file_name: String,
    stored_path: String,
    format: String,
    byte_size: u64,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFontRecord {
    id: String,
    internal_family: String,
    display_name: String,
    source_file_name: String,
    stored_path: String,
    format: String,
    style: String,
}

fn require_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("只有主窗口可以导入或删除本地外观资源".into())
    }
}

fn chrome_theme(value: &str) -> Result<Theme, String> {
    match value {
        "light" => Ok(Theme::Light),
        "dark" => Ok(Theme::Dark),
        _ => Err("标题栏主题必须是 light 或 dark".into()),
    }
}

#[cfg(target_os = "windows")]
fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16)
}

#[cfg(target_os = "windows")]
fn apply_windows_chrome_colors(window: &tauri::WebviewWindow, theme: Theme) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let is_dark = matches!(theme, Theme::Dark);
    let (caption, text, border) = if is_dark {
        (
            colorref(41, 39, 36),
            colorref(238, 234, 227),
            colorref(69, 65, 60),
        )
    } else {
        (
            colorref(236, 233, 226),
            colorref(41, 39, 36),
            colorref(222, 217, 207),
        )
    };
    let dark_mode: i32 = i32::from(is_dark);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const i32 as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        )
        .map_err(|error| error.to_string())?;
        for (attribute, value) in [
            (DWMWA_CAPTION_COLOR, caption),
            (DWMWA_TEXT_COLOR, text),
            (DWMWA_BORDER_COLOR, border),
        ] {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &value as *const u32 as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn apply_main_window_chrome(window: &tauri::WebviewWindow, theme: Theme) {
    if let Err(error) = window.set_theme(Some(theme)) {
        log::warn!("unable to synchronize main window titlebar theme: {error}");
        return;
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = apply_windows_chrome_colors(window, theme) {
        // Some older Windows builds reject the DWM color attributes. Tauri's native
        // theme remains active, so this is a safe, visible fallback rather than a startup failure.
        log::warn!("unable to apply Windows DWM titlebar colors: {error}");
    }
}

#[tauri::command]
fn sync_main_window_chrome(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    require_main_window(&window)?;
    apply_main_window_chrome(&window, chrome_theme(&theme)?);
    Ok(())
}

fn managed_asset_dir(app: &tauri::AppHandle, kind: &str) -> Result<PathBuf, String> {
    let leaf = match kind {
        "background" => "backgrounds",
        "font" => "fonts",
        _ => return Err("未知的外观资源类型".into()),
    };
    app.path()
        .app_config_dir()
        .map(|root| root.join("appearance").join(leaf))
        .map_err(|error| error.to_string())
}

fn source_parts(path: &Path) -> Result<(String, String), String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "所选路径不是有效文件".to_string())?
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    Ok((file_name, extension))
}

fn read_limited(path: &Path, limit: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| format!("无法读取所选{label}文件"))?;
    if !metadata.is_file() {
        return Err(format!("所选{label}路径不是文件"));
    }
    if metadata.len() == 0 {
        return Err(format!("所选{label}文件为空"));
    }
    if metadata.len() > limit {
        return Err(format!("{label}文件超过 {} MB 限制", limit / 1024 / 1024));
    }
    fs::read(path).map_err(|_| format!("无法读取所选{label}文件"))
}

fn asset_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn persist_managed_asset(
    app: &tauri::AppHandle,
    kind: &str,
    id: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let directory = managed_asset_dir(app, kind)?;
    fs::create_dir_all(&directory).map_err(|_| "无法创建应用外观资源目录".to_string())?;
    let destination = directory.join(format!("{id}.{extension}"));
    if !destination.exists() {
        fs::write(&destination, bytes).map_err(|_| "无法写入应用外观资源目录".to_string())?;
    }
    Ok(destination)
}

fn note_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|root| root.join("zixi.db"))
        .map_err(|error| error.to_string())
}

fn open_note_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn save_note_atomic_connection(
    connection: &mut Connection,
    input: AtomicNoteSaveInput,
) -> Result<AtomicNoteSaveResult, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let stored = transaction
        .query_row(
            "SELECT title, content, style_json, always_on_top, updated_at, deleted_at
             FROM notes WHERE id = ?1 LIMIT 1",
            params![input.id],
            |row| {
                Ok(StoredNoteState {
                    title: row.get(0)?,
                    content: row.get(1)?,
                    style_json: row.get(2)?,
                    always_on_top: row.get::<_, i64>(3)? != 0,
                    updated_at: row.get(4)?,
                    deleted_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicNoteSaveResult {
            status: "missing",
            updated_at: None,
            previous_deleted_at: None,
        });
    };
    let unchanged = stored.title == input.title
        && stored.content == input.content
        && stored.style_json == input.style_json
        && stored.always_on_top == input.always_on_top
        && stored.deleted_at == input.deleted_at;
    if stored.updated_at != input.expected_updated_at {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicNoteSaveResult {
            status: if unchanged { "unchanged" } else { "conflict" },
            updated_at: Some(stored.updated_at),
            previous_deleted_at: stored.deleted_at,
        });
    }
    if unchanged {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicNoteSaveResult {
            status: "unchanged",
            updated_at: Some(stored.updated_at),
            previous_deleted_at: stored.deleted_at,
        });
    }

    let content_changed = stored.title != input.title || stored.content != input.content;
    let create_revision = match input.revision_mode.as_str() {
        "none" => false,
        "protection" => content_changed,
        "auto" if content_changed => {
            transaction
                .query_row(
                    "SELECT CASE
                    WHEN COUNT(*) = 0 THEN 1
                    ELSE COALESCE(
                        (julianday(?1) - julianday(MAX(created_at))) * 86400000 >= 300000,
                        1
                    )
                 END
                 FROM note_revisions WHERE note_id = ?2",
                    params![input.updated_at, input.id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?
                != 0
        }
        _ => false,
    };
    if create_revision {
        let kind = if input.revision_mode == "protection" {
            "protection"
        } else {
            "auto"
        };
        transaction
            .execute(
                "INSERT INTO note_revisions (id, note_id, title, content, kind, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    input.revision_id,
                    input.id,
                    stored.title,
                    stored.content,
                    kind,
                    input.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    let rows_affected = transaction
        .execute(
            "UPDATE notes SET title = ?1, content = ?2, style_json = ?3,
             always_on_top = ?4, updated_at = ?5, deleted_at = ?6
             WHERE id = ?7 AND updated_at = ?8",
            params![
                input.title,
                input.content,
                input.style_json,
                i64::from(input.always_on_top),
                input.updated_at,
                input.deleted_at,
                input.id,
                input.expected_updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    if rows_affected != 1 {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicNoteSaveResult {
            status: "conflict",
            updated_at: None,
            previous_deleted_at: stored.deleted_at,
        });
    }
    transaction
        .execute(
            "DELETE FROM note_revisions WHERE note_id = ?1 AND id NOT IN (
                SELECT id FROM note_revisions WHERE note_id = ?1
                ORDER BY created_at DESC, id DESC LIMIT 10
             )",
            params![input.id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AtomicNoteSaveResult {
        status: "updated",
        updated_at: Some(input.updated_at),
        previous_deleted_at: stored.deleted_at,
    })
}

fn read_comparison_state(
    connection: &Connection,
    id: &str,
) -> Result<Option<ComparisonState>, String> {
    connection
        .query_row(
            "SELECT id, left_text, right_text, preset, stats_json, updated_at, revision
             FROM comparisons WHERE id = ?1 LIMIT 1",
            params![id],
            |row| {
                Ok(ComparisonState {
                    id: row.get(0)?,
                    left_text: row.get(1)?,
                    right_text: row.get(2)?,
                    preset: row.get(3)?,
                    stats_json: row.get(4)?,
                    updated_at: row.get(5)?,
                    revision: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn save_comparison_atomic_connection(
    connection: &mut Connection,
    input: AtomicComparisonSaveInput,
) -> Result<AtomicComparisonSaveResult, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let stored = transaction
        .query_row(
            "SELECT id, left_text, right_text, preset, stats_json, updated_at, revision
             FROM comparisons WHERE id = ?1 LIMIT 1",
            params![input.id],
            |row| {
                Ok(ComparisonState {
                    id: row.get(0)?,
                    left_text: row.get(1)?,
                    right_text: row.get(2)?,
                    preset: row.get(3)?,
                    stats_json: row.get(4)?,
                    updated_at: row.get(5)?,
                    revision: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        if input.expected_revision.is_some() {
            transaction.rollback().map_err(|error| error.to_string())?;
            return Ok(AtomicComparisonSaveResult {
                status: "conflict",
                comparison: None,
            });
        }
        let created = ComparisonState {
            id: input.id,
            left_text: input.left_text,
            right_text: input.right_text,
            preset: input.preset,
            stats_json: input.stats_json,
            updated_at: input.updated_at,
            revision: 1,
        };
        transaction.execute(
            "INSERT INTO comparisons (id, left_text, right_text, preset, stats_json, updated_at, revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![created.id, created.left_text, created.right_text, created.preset, created.stats_json, created.updated_at, created.revision],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(AtomicComparisonSaveResult {
            status: "created",
            comparison: Some(created),
        });
    };
    let unchanged = stored.left_text == input.left_text
        && stored.right_text == input.right_text
        && stored.preset == input.preset
        && stored.stats_json == input.stats_json;
    if input.expected_revision != Some(stored.revision) {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicComparisonSaveResult {
            status: if unchanged { "unchanged" } else { "conflict" },
            comparison: Some(stored),
        });
    }
    if unchanged {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicComparisonSaveResult {
            status: "unchanged",
            comparison: Some(stored),
        });
    }
    let next_revision = stored.revision + 1;
    let updated = ComparisonState {
        id: input.id,
        left_text: input.left_text,
        right_text: input.right_text,
        preset: input.preset,
        stats_json: input.stats_json,
        updated_at: input.updated_at,
        revision: next_revision,
    };
    let changed = transaction
        .execute(
            "UPDATE comparisons SET left_text = ?1, right_text = ?2, preset = ?3, stats_json = ?4,
         updated_at = ?5, revision = ?6 WHERE id = ?7 AND revision = ?8",
            params![
                updated.left_text,
                updated.right_text,
                updated.preset,
                updated.stats_json,
                updated.updated_at,
                updated.revision,
                updated.id,
                stored.revision
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        transaction.rollback().map_err(|error| error.to_string())?;
        return Ok(AtomicComparisonSaveResult {
            status: "conflict",
            comparison: Some(stored),
        });
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AtomicComparisonSaveResult {
        status: "updated",
        comparison: Some(updated),
    })
}

#[tauri::command]
async fn load_comparison_atomic(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<ComparisonState>, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_note_database(&path)?;
        read_comparison_state(&connection, &id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_comparison_atomic(
    app: tauri::AppHandle,
    input: AtomicComparisonSaveInput,
) -> Result<AtomicComparisonSaveResult, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("ZIXI_TEST_FAIL_COMPARISON_SAVE").is_some() {
        return Err("测试模式：模拟比较会话保存失败".to_string());
    }
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        save_comparison_atomic_connection(&mut connection, input)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_note_atomic(
    app: tauri::AppHandle,
    input: AtomicNoteSaveInput,
) -> Result<AtomicNoteSaveResult, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        save_note_atomic_connection(&mut connection, input)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn permanently_delete_note_atomic(
    app: tauri::AppHandle,
    note_id: String,
) -> Result<bool, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let deleted = transaction
            .execute(
                "DELETE FROM notes WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![note_id],
            )
            .map_err(|error| error.to_string())?
            == 1;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(deleted)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn normalized_batch_note_ids(note_ids: Vec<String>) -> Vec<String> {
    let mut normalized = note_ids
        .into_iter()
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn placeholders(count: usize) -> String {
    std::iter::repeat("?")
        .take(count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn select_trashed_note_ids(
    transaction: &rusqlite::Transaction<'_>,
    note_ids: &[String],
) -> Result<Vec<String>, String> {
    if note_ids.is_empty() {
        return Ok(Vec::new());
    }
    let query = format!(
        "SELECT id FROM notes WHERE deleted_at IS NOT NULL AND id IN ({}) ORDER BY id",
        placeholders(note_ids.len())
    );
    let mut statement = transaction
        .prepare(&query)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(note_ids.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn restore_notes_atomic_connection(
    connection: &mut Connection,
    note_ids: Vec<String>,
    updated_at: String,
) -> Result<BatchTrashMutationResult, String> {
    let note_ids = normalized_batch_note_ids(note_ids);
    if note_ids.is_empty() {
        return Ok(BatchTrashMutationResult { note_ids });
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let restored_ids = select_trashed_note_ids(&transaction, &note_ids)?;
    if !restored_ids.is_empty() {
        let query = format!(
            "UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE deleted_at IS NOT NULL AND id IN ({})",
            placeholders(restored_ids.len())
        );
        let mut values = Vec::with_capacity(restored_ids.len() + 1);
        values.push(updated_at);
        values.extend(restored_ids.iter().cloned());
        transaction
            .execute(&query, params_from_iter(values.iter()))
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(BatchTrashMutationResult {
        note_ids: restored_ids,
    })
}

fn permanently_delete_notes_atomic_connection(
    connection: &mut Connection,
    note_ids: Vec<String>,
) -> Result<BatchTrashMutationResult, String> {
    let note_ids = normalized_batch_note_ids(note_ids);
    if note_ids.is_empty() {
        return Ok(BatchTrashMutationResult { note_ids });
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let deleted_ids = select_trashed_note_ids(&transaction, &note_ids)?;
    if !deleted_ids.is_empty() {
        let query = format!(
            "DELETE FROM notes WHERE deleted_at IS NOT NULL AND id IN ({})",
            placeholders(deleted_ids.len())
        );
        transaction
            .execute(&query, params_from_iter(deleted_ids.iter()))
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(BatchTrashMutationResult {
        note_ids: deleted_ids,
    })
}

#[tauri::command]
async fn restore_notes_atomic(
    app: tauri::AppHandle,
    note_ids: Vec<String>,
    updated_at: String,
) -> Result<BatchTrashMutationResult, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        restore_notes_atomic_connection(&mut connection, note_ids, updated_at)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn permanently_delete_notes_atomic(
    app: tauri::AppHandle,
    note_ids: Vec<String>,
) -> Result<BatchTrashMutationResult, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        permanently_delete_notes_atomic_connection(&mut connection, note_ids)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn empty_trash_atomic(app: tauri::AppHandle) -> Result<EmptyTrashResult, String> {
    let path = note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_note_database(&path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let note_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM notes WHERE deleted_at IS NOT NULL ORDER BY id")
                .map_err(|error| error.to_string())?;
            let collected = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            collected
        };
        transaction
            .execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", [])
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(EmptyTrashResult { note_ids })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn import_background_file(
    app: &tauri::AppHandle,
    source: &Path,
) -> Result<BackgroundAssetRecord, String> {
    let (source_file_name, extension) = source_parts(source)?;
    let bytes = read_limited(source, BACKGROUND_BYTE_LIMIT, "背景图")?;
    let (format, width, height) = detect_background(&bytes)?;
    if !extension_matches(format, &extension) {
        return Err("文件扩展名与实际图片内容不一致".into());
    }
    let id = format!("bg-{}", asset_hash(&bytes));
    let stored_path = persist_managed_asset(app, "background", &id, format, &bytes)?;
    Ok(BackgroundAssetRecord {
        id,
        source_file_name,
        stored_path: stored_path.to_string_lossy().into_owned(),
        format: format.into(),
        byte_size: bytes.len() as u64,
        width,
        height,
    })
}

fn import_font_file(app: &tauri::AppHandle, source: &Path) -> Result<ImportedFontRecord, String> {
    let (source_file_name, extension) = source_parts(source)?;
    let bytes = read_limited(source, FONT_BYTE_LIMIT, "字体")?;
    let format = detect_font(&bytes)?;
    if !extension_matches(format, &extension) {
        return Err("文件扩展名与实际字体内容不一致".into());
    }
    let digest = asset_hash(&bytes);
    let id = format!("font-{digest}");
    let stored_path = persist_managed_asset(app, "font", &id, format, &bytes)?;
    let display_name: String = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("导入字体")
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    Ok(ImportedFontRecord {
        id,
        internal_family: format!("ZixiImported_{digest}"),
        display_name,
        source_file_name,
        stored_path: stored_path.to_string_lossy().into_owned(),
        format: format.into(),
        style: "normal".into(),
    })
}

#[tauri::command]
async fn pick_background_asset(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<BackgroundAssetRecord>, String> {
    require_main_window(&window)?;
    let selected = app
        .dialog()
        .file()
        .set_title("选择本地背景图")
        .add_filter("背景图片", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "无法读取文件选择器返回的路径".to_string())?;
    import_background_file(&app, &path).map(Some)
}

#[tauri::command]
async fn pick_font_asset(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<ImportedFontRecord>, String> {
    require_main_window(&window)?;
    let selected = app
        .dialog()
        .file()
        .set_title("导入应用字体")
        .add_filter("字体文件", &["woff2", "woff", "ttf", "otf"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "无法读取文件选择器返回的路径".to_string())?;
    import_font_file(&app, &path).map(Some)
}

#[tauri::command]
fn delete_managed_asset(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
    stored_path: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let target = PathBuf::from(stored_path);
    if !target.exists() {
        return Ok(());
    }
    let root = managed_asset_dir(&app, &kind)?;
    fs::create_dir_all(&root).map_err(|_| "无法访问应用外观资源目录".to_string())?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "无法验证应用资源目录".to_string())?;
    let canonical_target = target
        .canonicalize()
        .map_err(|_| "无法验证待删除资源".to_string())?;
    if !canonical_target.starts_with(&canonical_root) || !canonical_target.is_file() {
        return Err("拒绝删除应用管理目录之外的文件".into());
    }
    fs::remove_file(canonical_target).map_err(|_| "无法删除应用管理的资源副本".to_string())
}

#[tauri::command]
async fn open_note_window(
    app: tauri::AppHandle,
    note_id: String,
    title: String,
) -> Result<OpenNoteWindowResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_for_window = app.clone();
        let (sender, receiver) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = create_or_show_note_window(app_for_window, note_id, title);
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "独立便签窗口创建超时".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn take_pending_tray_note_requests(state: tauri::State<'_, PendingTrayRequests>) -> Vec<u64> {
    state.list()
}

#[tauri::command]
fn acknowledge_tray_note_request(state: tauri::State<'_, PendingTrayRequests>, request_id: u64) {
    state.acknowledge(request_id);
}

fn create_or_show_note_window(
    app: tauri::AppHandle,
    note_id: String,
    title: String,
) -> Result<OpenNoteWindowResult, String> {
    let safe_id: String = note_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let label = format!("note-{safe_id}");

    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(OpenNoteWindowResult { created: false });
    }

    let route = format!("?window=note&id={note_id}");
    let url = if cfg!(debug_assertions) {
        WebviewUrl::External(
            tauri::Url::parse(&format!("http://localhost:5173/{route}"))
                .map_err(|error| error.to_string())?,
        )
    } else {
        WebviewUrl::App(format!("index.html{route}").into())
    };
    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title(title)
        .inner_size(380.0, 420.0)
        .min_inner_size(260.0, 220.0)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .center()
        .visible(true)
        .transparent(true)
        .build()
        .map_err(|error| error.to_string())?;

    let restorable = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
    let _ = window.restore_state(restorable);
    let window_for_state = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Moved(_) | WindowEvent::Resized(_)
        ) {
            let _ = window_for_state.app_handle().save_window_state(restorable);
        }
    });
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(OpenNoteWindowResult { created: true })
}

#[tauri::command]
async fn open_compare_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<OpenCompareWindowResult, String> {
    require_main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let app_for_window = app.clone();
        let (sender, receiver) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = create_or_show_compare_window(app_for_window);
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "独立文字比较窗口创建超时".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

fn create_or_show_compare_window(app: tauri::AppHandle) -> Result<OpenCompareWindowResult, String> {
    const LABEL: &str = "compare";
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        schedule_acceptance_exit_if_requested(&app);
        return Ok(OpenCompareWindowResult { created: false });
    }
    let route = "?window=compare";
    let url = if cfg!(debug_assertions) {
        WebviewUrl::External(
            tauri::Url::parse(&format!("http://localhost:5173/{route}"))
                .map_err(|error| error.to_string())?,
        )
    } else {
        WebviewUrl::App(format!("index.html{route}").into())
    };
    let window = WebviewWindowBuilder::new(&app, LABEL, url)
        .title("字隙 · 独立文字比较")
        .inner_size(760.0, 720.0)
        .min_inner_size(480.0, 420.0)
        .resizable(true)
        .center()
        .visible(true)
        .build()
        .map_err(|error| error.to_string())?;
    let restorable = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
    let _ = window.restore_state(restorable);
    let window_for_state = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Moved(_) | WindowEvent::Resized(_)
        ) {
            let _ = window_for_state.app_handle().save_window_state(restorable);
        }
    });
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    schedule_acceptance_exit_if_requested(&app);
    Ok(OpenCompareWindowResult { created: true })
}

fn schedule_app_exit(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Allow pending 650–800 ms frontend autosaves to finish first.
        std::thread::sleep(Duration::from_millis(1000));
        app.exit(0);
    });
}

fn schedule_acceptance_exit_if_requested(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) && std::env::var_os("ZIXI_TEST_EXIT_ON_COMPARE_WINDOW_OPEN").is_some()
    {
        schedule_app_exit(app.clone());
    }
}

const REVISION_POLICY_MIGRATION_SQL: &str = r#"
    DROP TRIGGER IF EXISTS notes_snapshot_before_content_update;
    DROP TRIGGER IF EXISTS note_revisions_keep_latest_30;

    ALTER TABLE note_revisions ADD COLUMN kind TEXT NOT NULL DEFAULT 'auto';

    DELETE FROM note_revisions
    WHERE id IN (
        SELECT id FROM (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY note_id
                    ORDER BY created_at DESC, id DESC
                ) AS revision_number
            FROM note_revisions
        )
        WHERE revision_number > 10
    );
"#;

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create notes and revisions",
            sql: r#"
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                style_json TEXT NOT NULL,
                always_on_top INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);
            CREATE INDEX IF NOT EXISTS notes_deleted_at_idx ON notes(deleted_at);

            CREATE TABLE IF NOT EXISTS note_revisions (
                id TEXT PRIMARY KEY NOT NULL,
                note_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS revisions_note_created_idx
                ON note_revisions(note_id, created_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create comparison sessions and settings",
            sql: r#"
                CREATE TABLE IF NOT EXISTS comparisons (
                    id TEXT PRIMARY KEY NOT NULL,
                    left_text TEXT NOT NULL DEFAULT '',
                    right_text TEXT NOT NULL DEFAULT '',
                    preset TEXT NOT NULL DEFAULT 'review',
                    stats_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS comparisons_updated_idx
                    ON comparisons(updated_at DESC);

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "make note revision snapshots atomic and bounded",
            sql: r#"
                CREATE TRIGGER IF NOT EXISTS notes_snapshot_before_content_update
                BEFORE UPDATE OF title, content ON notes
                WHEN OLD.title <> NEW.title OR OLD.content <> NEW.content
                BEGIN
                    INSERT INTO note_revisions (id, note_id, title, content, created_at)
                    VALUES (
                        'revision-' || lower(hex(randomblob(16))),
                        OLD.id,
                        OLD.title,
                        OLD.content,
                        NEW.updated_at
                    );
                END;

                CREATE TRIGGER IF NOT EXISTS note_revisions_keep_latest_30
                AFTER INSERT ON note_revisions
                BEGIN
                    DELETE FROM note_revisions
                    WHERE note_id = NEW.note_id
                      AND id NOT IN (
                        SELECT id FROM note_revisions
                        WHERE note_id = NEW.note_id
                        ORDER BY created_at DESC, id DESC
                        LIMIT 30
                      );
                END;

                DELETE FROM note_revisions
                WHERE id IN (
                    SELECT id FROM (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                PARTITION BY note_id
                                ORDER BY created_at DESC, id DESC
                            ) AS revision_number
                        FROM note_revisions
                    )
                    WHERE revision_number > 30
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "move note snapshots to coordinated five minute checkpoints",
            sql: REVISION_POLICY_MIGRATION_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "coordinate comparison saves with a revision token",
            sql: "ALTER TABLE comparisons ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingTrayRequests::default())
        // Must be registered first so a second launch can only focus the primary window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:zixi.db", database_migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            save_note_atomic,
            permanently_delete_note_atomic,
            restore_notes_atomic,
            permanently_delete_notes_atomic,
            empty_trash_atomic,
            load_comparison_atomic,
            save_comparison_atomic,
            sync_main_window_chrome,
            open_compare_window,
            open_note_window,
            hide_main_window,
            take_pending_tray_note_requests,
            acknowledge_tray_note_request,
            pick_background_asset,
            pick_font_asset,
            delete_managed_asset
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let show_item = MenuItem::with_id(app, "show", "显示字隙", true, None::<&str>)?;
            let note_item = MenuItem::with_id(app, "new-note", "新建浮动便签", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &note_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("application icon missing")
                        .clone(),
                )
                .tooltip("字隙 · 本地文字比较与便签")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "new-note" => {
                        let request_id = app.state::<PendingTrayRequests>().enqueue();
                        let _ = app.emit("tray-new-note", request_id);
                    }
                    "quit" => schedule_app_exit(app.clone()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                apply_main_window_chrome(&window, Theme::Light);
                let window_to_hide = window.clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let restorable =
                            StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
                        let _ = window_to_hide.app_handle().save_window_state(restorable);
                        api.prevent_close();
                        let _ = window_to_hide.hide();
                    }
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                        let restorable =
                            StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
                        let _ = window_to_hide.app_handle().save_window_state(restorable);
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run 字隙");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod revision_policy_tests {
    use super::{
        permanently_delete_notes_atomic_connection, restore_notes_atomic_connection,
        save_comparison_atomic_connection, save_note_atomic_connection, AtomicComparisonSaveInput,
        AtomicNoteSaveInput, REVISION_POLICY_MIGRATION_SQL,
    };
    use rusqlite::{params, Connection};

    fn legacy_database() -> Connection {
        let database = Connection::open_in_memory().expect("in-memory sqlite");
        database
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE notes (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    style_json TEXT NOT NULL,
                    always_on_top INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE note_revisions (
                    id TEXT PRIMARY KEY NOT NULL,
                    note_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
                );
                CREATE TRIGGER notes_snapshot_before_content_update
                BEFORE UPDATE OF title, content ON notes BEGIN SELECT 1; END;
                CREATE TRIGGER note_revisions_keep_latest_30
                AFTER INSERT ON note_revisions BEGIN SELECT 1; END;
                INSERT INTO notes VALUES (
                    'note-1', '迁移前标题', '迁移前正文', '{}', 1,
                    '2026-08-13T00:00:00Z', '2026-08-13T00:00:00Z', NULL
                );
                "#,
            )
            .expect("legacy schema");
        for index in 0..14 {
            database
                .execute(
                    "INSERT INTO note_revisions VALUES (?1, 'note-1', '标题', ?2, ?3)",
                    params![
                        format!("revision-{index:02}"),
                        format!("正文-{index:02}"),
                        format!("2026-08-13T00:{index:02}:00Z")
                    ],
                )
                .expect("legacy revision");
        }
        database
    }

    fn comparison_database() -> Connection {
        let database = Connection::open_in_memory().expect("in-memory comparison sqlite");
        database
            .execute_batch(
                "CREATE TABLE comparisons (
                    id TEXT PRIMARY KEY NOT NULL,
                    left_text TEXT NOT NULL,
                    right_text TEXT NOT NULL,
                    preset TEXT NOT NULL,
                    stats_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0
                );",
            )
            .expect("comparison schema");
        database
    }

    #[test]
    fn comparison_revision_rejects_a_stale_writer_without_losing_saved_text() {
        let mut database = comparison_database();
        let created = save_comparison_atomic_connection(
            &mut database,
            AtomicComparisonSaveInput {
                id: "comparison-current".into(),
                left_text: "窗口 A".into(),
                right_text: "版本 A".into(),
                preset: "review".into(),
                stats_json: "{}".into(),
                expected_revision: None,
                updated_at: "2026-08-15T00:00:00Z".into(),
            },
        )
        .expect("create comparison");
        assert_eq!(created.status, "created");
        let stale = save_comparison_atomic_connection(
            &mut database,
            AtomicComparisonSaveInput {
                id: "comparison-current".into(),
                left_text: "窗口 B".into(),
                right_text: "版本 B".into(),
                preset: "review".into(),
                stats_json: "{}".into(),
                expected_revision: Some(0),
                updated_at: "2026-08-15T00:01:00Z".into(),
            },
        )
        .expect("stale save response");
        assert_eq!(stale.status, "conflict");
        assert_eq!(stale.comparison.expect("persisted").left_text, "窗口 A");
    }

    #[test]
    fn migration_preserves_notes_drops_triggers_and_trims_to_ten() {
        let database = legacy_database();
        database
            .execute_batch(REVISION_POLICY_MIGRATION_SQL)
            .expect("revision policy migration");

        let body: String = database
            .query_row("SELECT content FROM notes WHERE id = 'note-1'", [], |row| {
                row.get(0)
            })
            .expect("note body");
        let revisions: i64 = database
            .query_row("SELECT COUNT(*) FROM note_revisions", [], |row| row.get(0))
            .expect("revision count");
        let triggers: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'note_%'",
                [],
                |row| row.get(0),
            )
            .expect("trigger count");
        let kind: String = database
            .query_row(
                "SELECT kind FROM note_revisions ORDER BY created_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("revision kind");

        assert_eq!(body, "迁移前正文");
        assert_eq!(revisions, 10);
        assert_eq!(triggers, 0);
        assert_eq!(kind, "auto");
    }

    #[test]
    fn sqlite_cascade_removes_revisions_on_permanent_delete() {
        let database = legacy_database();
        database
            .execute_batch(REVISION_POLICY_MIGRATION_SQL)
            .expect("revision policy migration");
        database
            .execute("DELETE FROM notes WHERE id = 'note-1'", [])
            .expect("delete note");
        let revisions: i64 = database
            .query_row("SELECT COUNT(*) FROM note_revisions", [], |row| row.get(0))
            .expect("revision count");
        assert_eq!(revisions, 0);
    }

    #[test]
    fn sqlite_expected_timestamp_prevents_stale_writes() {
        let database = legacy_database();
        let first = database
            .execute(
                "UPDATE notes SET content = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4",
                params![
                    "窗口 A",
                    "2026-08-13T00:01:00Z",
                    "note-1",
                    "2026-08-13T00:00:00Z"
                ],
            )
            .expect("first conditional update");
        let stale = database
            .execute(
                "UPDATE notes SET content = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4",
                params![
                    "窗口 B",
                    "2026-08-13T00:02:00Z",
                    "note-1",
                    "2026-08-13T00:00:00Z"
                ],
            )
            .expect("stale conditional update");
        assert_eq!(first, 1);
        assert_eq!(stale, 0);
    }

    #[test]
    fn atomic_save_updates_and_snapshots_on_one_connection() {
        let mut database = legacy_database();
        database
            .execute_batch(REVISION_POLICY_MIGRATION_SQL)
            .expect("revision policy migration");
        let result = save_note_atomic_connection(
            &mut database,
            AtomicNoteSaveInput {
                id: "note-1".into(),
                title: "事务后标题".into(),
                content: "事务后正文".into(),
                style_json: "{}".into(),
                always_on_top: true,
                expected_updated_at: "2026-08-13T00:00:00Z".into(),
                updated_at: "2026-08-13T01:00:00Z".into(),
                deleted_at: None,
                revision_id: "revision-atomic".into(),
                revision_mode: "auto".into(),
            },
        )
        .expect("atomic save");
        let content: String = database
            .query_row("SELECT content FROM notes WHERE id = 'note-1'", [], |row| {
                row.get(0)
            })
            .expect("saved content");
        let snapshot: String = database
            .query_row(
                "SELECT content FROM note_revisions WHERE id = 'revision-atomic'",
                [],
                |row| row.get(0),
            )
            .expect("snapshot");
        assert_eq!(result.status, "updated");
        assert_eq!(content, "事务后正文");
        assert_eq!(snapshot, "迁移前正文");
    }

    #[test]
    fn batch_trash_mutations_are_atomic_and_ignore_duplicate_missing_or_active_ids() {
        let mut database = legacy_database();
        database
            .execute_batch(REVISION_POLICY_MIGRATION_SQL)
            .expect("revision policy migration");
        database
            .execute(
                "UPDATE notes SET deleted_at = '2026-08-13T01:00:00Z' WHERE id = 'note-1'",
                [],
            )
            .expect("trash first note");
        database
            .execute(
                "INSERT INTO notes VALUES (
                    'note-2', '第二张', '第二张正文', '{}', 1,
                    '2026-08-13T00:00:00Z', '2026-08-13T00:00:00Z', '2026-08-13T01:00:00Z'
                )",
                [],
            )
            .expect("insert second trashed note");

        let restored = restore_notes_atomic_connection(
            &mut database,
            vec!["missing".into(), "note-1".into(), "note-1".into()],
            "2026-08-13T02:00:00Z".into(),
        )
        .expect("batch restore");
        assert_eq!(restored.note_ids, vec!["note-1"]);
        let first_deleted_at: Option<String> = database
            .query_row(
                "SELECT deleted_at FROM notes WHERE id = 'note-1'",
                [],
                |row| row.get(0),
            )
            .expect("restored note");
        assert_eq!(first_deleted_at, None);

        let deleted = permanently_delete_notes_atomic_connection(
            &mut database,
            vec![
                "note-1".into(),
                "note-2".into(),
                "note-2".into(),
                "missing".into(),
            ],
        )
        .expect("batch permanent delete");
        assert_eq!(deleted.note_ids, vec!["note-2"]);
        let remaining: i64 = database
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .expect("remaining notes");
        assert_eq!(remaining, 1);
        assert!(
            permanently_delete_notes_atomic_connection(&mut database, Vec::new())
                .expect("empty batch")
                .note_ids
                .is_empty()
        );
    }
}
