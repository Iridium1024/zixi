//! The locator stays in AppConfig. Business data moves only at startup, before SQL opens.
use rusqlite::{params, Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const LOCATOR: &str = "storage-location.json";
const DATA_FOLDERS: [&str; 3] = ["appearance", "reader", "collaboration"];

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Locator {
    active: Option<PathBuf>,
    pending: Option<PathBuf>,
    previous: Option<PathBuf>,
    notice: Option<String>,
}

pub struct StorageState {
    pub root: PathBuf,
    default_root: PathBuf,
    locator: Mutex<Locator>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_path: String,
    pub database_url: String,
    default_path: String,
    previous_path: Option<String>,
    pending_path: Option<String>,
    notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    target_path: String,
    file_count: usize,
    byte_size: u64,
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

// Canonical Windows paths contain a verbatim prefix, which must not enter SQLite URLs.
fn canonical(path: &Path) -> Result<PathBuf, String> {
    let full = path.canonicalize().map_err(message)?;
    #[cfg(windows)]
    {
        let text = full.to_str().ok_or("资料路径包含无法识别的字符")?;
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{unc}")));
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(local));
        }
    }
    Ok(full)
}

fn normalized(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let value = value.to_lowercase();
    value.trim_end_matches('/').to_string()
}

fn within(path: &Path, root: &Path) -> bool {
    let (path, root) = (normalized(path), normalized(root));
    path == root || path.starts_with(&(root + "/"))
}

fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(message)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("资料目录不能包含符号链接或目录联接".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err("资料目录不能包含符号链接".into());
    }
    Ok(())
}

fn validate_target(source: &Path, target: &Path) -> Result<PathBuf, String> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err("请选择有效的本地资料目录".into());
    }
    let parent = target.parent().ok_or("目标目录无效")?;
    for ancestor in parent.ancestors() {
        reject_link(ancestor)?;
    }
    let target = canonical(parent)?.join(target.file_name().unwrap());
    if within(&target, source) || within(source, &target) {
        return Err("新目录不能是当前目录、其内部目录或上级目录".into());
    }
    // Never merge into or overwrite an existing directory, including an earlier backup.
    if target.try_exists().map_err(message)? {
        return Err("目标中已存在 ZixiData，请选择其它位置，以免覆盖已有资料".into());
    }
    Ok(target)
}

fn collect_files(root: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    fn visit(base: &Path, relative: &Path, result: &mut Vec<(PathBuf, u64)>) -> Result<(), String> {
        let path = base.join(relative);
        reject_link(&path)?;
        let metadata = fs::metadata(&path).map_err(message)?;
        if metadata.is_dir() {
            for entry in fs::read_dir(path).map_err(message)? {
                let entry = entry.map_err(message)?;
                visit(base, &relative.join(entry.file_name()), result)?;
            }
        } else if metadata.is_file() {
            result.push((relative.to_path_buf(), metadata.len()));
        } else {
            return Err("资料中存在无法迁移的特殊文件".into());
        }
        Ok(())
    }
    let mut result = Vec::new();
    for folder in DATA_FOLDERS {
        if root.join(folder).try_exists().map_err(message)? {
            visit(root, Path::new(folder), &mut result)?;
        }
    }
    for name in ["zixi.db", "zixi.db-wal"] {
        if root.join(name).try_exists().map_err(message)? {
            visit(root, Path::new(name), &mut result)?;
        }
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(result)
}

fn check_space(parent: &Path, needed: u64) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDiskFreeSpaceExW};
        let name: Vec<u16> = parent.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut free = 0;
        unsafe { GetDiskFreeSpaceExW(PCWSTR(name.as_ptr()), Some(&mut free), None, None) }
            .map_err(message)?;
        if free < needed.saturating_add(16 * 1024 * 1024) {
            return Err("目标磁盘空间不足，请至少预留资料大小和 16 MiB 的额外空间".into());
        }
    }
    #[cfg(not(windows))]
    let _ = (parent, needed); // Copy failures still leave the active directory unchanged.
    Ok(())
}

fn write_locator(default_root: &Path, value: &Locator) -> Result<(), String> {
    let temporary = default_root.join(format!(".storage-location-{}.tmp", stamp()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(message)?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(message)?)
            .map_err(message)?;
        file.sync_all().map_err(message)?;
        drop(file);
        fs::rename(&temporary, default_root.join(LOCATOR)).map_err(message)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn file_hash(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(message)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(message)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest.finalize().to_vec())
}

fn remap_path(value: &str, source: &Path, target: &Path) -> Result<String, String> {
    let original = Path::new(value);
    if !original.is_absolute() {
        return Ok(value.into());
    }
    let resolved = canonical(original).unwrap_or_else(|_| original.to_path_buf());
    let old = resolved.as_path();
    // Only application-managed paths are rewritten. User's external paths stay untouched.
    for folder in DATA_FOLDERS {
        let managed = source.join(folder);
        if within(old, &managed) {
            let relative = old
                .strip_prefix(source)
                .map_err(|_| "资料路径的大小写或形式不一致，未切换目录")?;
            return Ok(target.join(relative).to_string_lossy().into_owned());
        }
    }
    Ok(value.into())
}

fn remap_assets(value: &mut serde_json::Value, source: &Path, target: &Path) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                if key == "storedPath" {
                    if let Some(path) = value.as_str() {
                        *value = remap_path(path, source, target)?.into();
                    }
                } else {
                    remap_assets(value, source, target)?;
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remap_assets(item, source, target)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn table_exists(connection: &Connection, name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [name],
            |row| row.get(0),
        )
        .map_err(message)
}

fn update_database_paths(path: &Path, source: &Path, target: &Path) -> Result<(), String> {
    let mut connection = Connection::open(path).map_err(message)?;
    // Leave no live WAL dependency in the staged backup.
    connection
        .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;")
        .map_err(message)?;
    let transaction = connection.transaction().map_err(message)?;
    if table_exists(&transaction, "reader_books")? {
        let rows = transaction
            .prepare("SELECT id, stored_path FROM reader_books")
            .map_err(message)?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(message)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(message)?;
        for (id, old) in rows {
            transaction
                .execute(
                    "UPDATE reader_books SET stored_path=?1 WHERE id=?2",
                    params![remap_path(&old, source, target)?, id],
                )
                .map_err(message)?;
        }
    }
    if table_exists(&transaction, "settings")? {
        let rows = transaction
            .prepare("SELECT key, value_json FROM settings")
            .map_err(message)?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(message)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(message)?;
        for (key, json) in rows {
            let mut value: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| format!("设置 {key} 无法解析：{e}"))?;
            remap_assets(&mut value, source, target)?;
            transaction
                .execute(
                    "UPDATE settings SET value_json=?1 WHERE key=?2",
                    params![value.to_string(), key],
                )
                .map_err(message)?;
        }
    }
    transaction.commit().map_err(message)?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(message)?;
    if integrity != "ok" {
        return Err(format!("迁移副本校验失败：{integrity}"));
    }
    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(message)?;
    if foreign_keys
        .query([])
        .map_err(message)?
        .next()
        .map_err(message)?
        .is_some()
    {
        return Err("迁移副本存在无效的数据关联".into());
    }
    Ok(())
}

fn migrate(source: &Path, requested: &Path) -> Result<PathBuf, String> {
    let target = validate_target(source, requested)?;
    let files = collect_files(source)?;
    check_space(
        target.parent().unwrap(),
        files.iter().map(|(_, bytes)| bytes).sum(),
    )?;
    let staging = target
        .parent()
        .unwrap()
        .join(format!(".zixi-migration-{}", stamp()));
    fs::create_dir(&staging).map_err(message)?;
    let copied = (|| {
        for (relative, _) in files
            .iter()
            .filter(|(path, _)| !path.starts_with("zixi.db") && !path.starts_with("zixi.db-wal"))
        {
            let destination = staging.join(relative);
            fs::create_dir_all(destination.parent().unwrap()).map_err(message)?;
            let mut input = fs::File::open(source.join(relative)).map_err(message)?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(message)?;
            std::io::copy(&mut input, &mut output).map_err(message)?;
            output.sync_all().map_err(message)?;
            drop(output);
            if file_hash(&source.join(relative))? != file_hash(&destination)? {
                return Err(format!("文件校验失败：{}", relative.display()));
            }
        }
        if source.join("zixi.db").is_file() {
            let connection = Connection::open_with_flags(
                source.join("zixi.db"),
                OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(message)?;
            connection
                .busy_timeout(std::time::Duration::from_secs(5))
                .map_err(message)?;
            connection
                .backup(DatabaseName::Main, staging.join("zixi.db"), None)
                .map_err(message)?;
            update_database_paths(&staging.join("zixi.db"), source, &target)?;
        }
        // Re-check after copying: no replacement if another process populated the destination.
        validate_target(source, &target)?;
        fs::rename(&staging, &target).map_err(message)?;
        Ok(target)
    })();
    // A failed partial copy is retained under its unique name, never confused with active data.
    copied.map_err(|error: String| {
        format!("{error}。原资料未切换；临时副本位于 {}", staging.display())
    })
}

impl StorageState {
    pub fn initialize(default_root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&default_root).map_err(message)?;
        let default_root = canonical(&default_root)?;
        let config_file = default_root.join(LOCATOR);
        let mut locator: Locator = if config_file.try_exists().map_err(message)? {
            serde_json::from_slice(&fs::read(config_file).map_err(message)?)
                .map_err(|e| format!("无法读取资料位置配置：{e}"))?
        } else {
            Locator::default()
        };
        let mut root =
            canonical(locator.active.as_deref().unwrap_or(&default_root)).map_err(|e| {
                format!(
                    "资料目录不可用，请恢复原磁盘或检查 {}：{e}",
                    default_root.join(LOCATOR).display()
                )
            })?;
        if locator.active.is_some() && !root.join("zixi.db").is_file() {
            return Err("自定义资料目录中的数据库已丢失，已停止启动以免创建空资料库".into());
        }
        if let Some(target) = locator.pending.take() {
            match migrate(&root, &target) {
                Ok(next) => {
                    locator.previous = Some(root.clone());
                    locator.active = Some(next.clone());
                    locator.notice =
                        Some("资料迁移完成，正在使用新目录；原目录保留为备份。".into());
                    root = next;
                }
                Err(error) => {
                    locator.notice = Some(format!("迁移未完成，继续使用原目录：{error}"));
                }
            }
            // Switching the locator is the last step. Failure never starts SQL on the new root.
            write_locator(&default_root, &locator)?;
        }
        Ok(Self {
            root,
            default_root,
            locator: Mutex::new(locator),
        })
    }

    pub fn database_url(&self) -> String {
        let path = self
            .root
            .join("zixi.db")
            .to_string_lossy()
            .replace('%', "%25")
            .replace('?', "%3F")
            .replace('#', "%23");
        format!("sqlite:{path}")
    }

    fn info(&self) -> Result<StorageInfo, String> {
        let config = self.locator.lock().map_err(message)?;
        Ok(StorageInfo {
            data_path: self.root.to_string_lossy().into_owned(),
            database_url: self.database_url(),
            default_path: self.default_root.to_string_lossy().into_owned(),
            previous_path: config
                .previous
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            pending_path: config
                .pending
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            notice: config.notice.clone(),
        })
    }
}

#[tauri::command]
pub fn get_storage_info(state: State<'_, StorageState>) -> Result<StorageInfo, String> {
    state.info()
}

fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口设置中更改资料位置".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_storage_directory(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<MigrationPlan>, String> {
    require_main(&window)?;
    let selected = app
        .dialog()
        .file()
        .set_title("选择资料存放位置（将在其中创建 ZixiData 文件夹）")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let parent = selected.into_path().map_err(message)?;
    let state = app.state::<StorageState>();
    let target = validate_target(&state.root, &parent.join("ZixiData"))?;
    let files = collect_files(&state.root)?;
    let byte_size = files.iter().map(|(_, bytes)| bytes).sum();
    check_space(target.parent().unwrap(), byte_size)?;
    // Probe only our unique file, never an existing destination file.
    let probe = target
        .parent()
        .unwrap()
        .join(format!(".zixi-write-probe-{}", stamp()));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|e| format!("目标位置不可写：{e}"))?;
    drop(file);
    fs::remove_file(probe).map_err(message)?;
    Ok(Some(MigrationPlan {
        target_path: target.to_string_lossy().into_owned(),
        file_count: files.len(),
        byte_size,
    }))
}

#[tauri::command]
pub fn migrate_storage_and_restart(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    target_path: String,
) -> Result<(), String> {
    require_main(&window)?;
    if app.webview_windows().keys().any(|label| label != "main") {
        return Err("请先保存并关闭所有独立便签、比较、阅读器和导图窗口，再进行迁移".into());
    }
    let state = app.state::<StorageState>();
    let target = validate_target(&state.root, Path::new(&target_path))?;
    let mut locator = state.locator.lock().map_err(message)?;
    let pending = locator.pending.replace(target);
    if let Err(error) = write_locator(&state.default_root, &locator) {
        locator.pending = pending;
        return Err(error);
    }
    drop(locator);
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "zixi-storage-test-{}-{}",
                std::process::id(),
                stamp()
            ));
            fs::create_dir(&path).unwrap();
            Self(canonical(&path).unwrap())
        }
        fn folder(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(&path).unwrap();
            path
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(root: &Path) -> Connection {
        fs::create_dir_all(root.join("reader/books")).unwrap();
        fs::create_dir_all(root.join("appearance/fonts")).unwrap();
        fs::create_dir_all(root.join("collaboration/notes")).unwrap();
        fs::write(root.join("reader/books/一本书.txt"), "第一章\n原始书籍内容").unwrap();
        fs::write(root.join("appearance/fonts/custom.ttf"), b"font fixture").unwrap();
        fs::write(root.join("collaboration/notes/snapshot.txt"), "协作副本").unwrap();
        let db = Connection::open(root.join("zixi.db")).unwrap();
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
            CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT);
            CREATE TABLE note_revisions (note_id TEXT REFERENCES notes(id), content TEXT);
            CREATE TABLE mind_maps (id TEXT, data_json TEXT);
            CREATE TABLE reader_books (id TEXT PRIMARY KEY, stored_path TEXT);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT);
            CREATE TABLE _sqlx_migrations (version INTEGER);
            INSERT INTO _sqlx_migrations VALUES (10);
            INSERT INTO notes VALUES ('n1', '不能丢失的便签');
            INSERT INTO note_revisions VALUES ('n1', '便签历史');
            INSERT INTO mind_maps VALUES ('m1', '{\"nodeData\":{\"id\":\"root\"}}');",
        )
        .unwrap();
        db.execute(
            "INSERT INTO reader_books VALUES ('b1', ?1)",
            [root.join("reader/books/一本书.txt").to_string_lossy()],
        )
        .unwrap();
        let appearance = serde_json::json!({"importedFonts": [{"storedPath": root.join("appearance/fonts/custom.ttf")}], "unrelated": "保留原值"});
        db.execute(
            "INSERT INTO settings VALUES ('appearance', ?1)",
            [appearance.to_string()],
        )
        .unwrap();
        db
    }

    #[test]
    fn migrates_wal_and_all_business_files_and_rewrites_only_the_copy() {
        let sandbox = Sandbox::new();
        let source = sandbox.folder("原资料");
        let db = fixture(&source); // Keep WAL open: copying only zixi.db would miss these rows.
        let target = sandbox.0.join("new data # 100%");
        migrate(&source, &target).unwrap();
        let copy = Connection::open(target.join("zixi.db")).unwrap();
        assert_eq!(
            copy.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "不能丢失的便签"
        );
        assert_eq!(
            copy.query_row("SELECT COUNT(*) FROM note_revisions", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            copy.query_row("SELECT COUNT(*) FROM mind_maps", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            copy.query_row("SELECT version FROM _sqlx_migrations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            10
        );
        assert_eq!(
            PathBuf::from(
                copy.query_row("SELECT stored_path FROM reader_books", [], |r| r
                    .get::<_, String>(0))
                    .unwrap()
            ),
            target.join("reader/books/一本书.txt")
        );
        let json: String = copy
            .query_row("SELECT value_json FROM settings", [], |r| r.get(0))
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            PathBuf::from(value["importedFonts"][0]["storedPath"].as_str().unwrap()),
            target.join("appearance/fonts/custom.ttf")
        );
        assert_eq!(value["unrelated"], "保留原值");
        for file in [
            "reader/books/一本书.txt",
            "appearance/fonts/custom.ttf",
            "collaboration/notes/snapshot.txt",
        ] {
            assert_eq!(
                file_hash(&source.join(file)).unwrap(),
                file_hash(&target.join(file)).unwrap()
            );
        }
        assert_eq!(
            db.query_row("SELECT stored_path FROM reader_books", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            source.join("reader/books/一本书.txt").to_string_lossy()
        );
    }

    #[test]
    fn startup_commits_locator_last_and_supports_a_second_migration() {
        let sandbox = Sandbox::new();
        let original = sandbox.folder("default");
        drop(fixture(&original));
        let first = sandbox.0.join("first");
        write_locator(
            &original,
            &Locator {
                pending: Some(first.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = StorageState::initialize(original.clone()).unwrap();
        assert_eq!(state.root, first);
        assert_eq!(
            state.info().unwrap().previous_path.unwrap(),
            original.to_string_lossy()
        );
        assert!(original.join("zixi.db").is_file());
        let second = sandbox.0.join("second");
        {
            let mut locator = state.locator.lock().unwrap();
            locator.pending = Some(second.clone());
            write_locator(&original, &locator).unwrap();
        }
        let state = StorageState::initialize(original.clone()).unwrap();
        assert_eq!(state.root, second);
        assert!(state.info().unwrap().database_url.contains("second"));
        let db = Connection::open(second.join("zixi.db")).unwrap();
        assert_eq!(
            PathBuf::from(
                db.query_row("SELECT stored_path FROM reader_books", [], |r| r
                    .get::<_, String>(0))
                    .unwrap()
            ),
            second.join("reader/books/一本书.txt")
        );
    }

    #[test]
    fn occupied_destination_rolls_back_and_never_overwrites_user_files() {
        let sandbox = Sandbox::new();
        let original = sandbox.folder("default");
        drop(fixture(&original));
        let target = sandbox.folder("occupied");
        fs::write(target.join("keep.txt"), "原有文件").unwrap();
        write_locator(
            &original,
            &Locator {
                pending: Some(target.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = StorageState::initialize(original.clone()).unwrap();
        assert_eq!(state.root, original);
        assert!(state.info().unwrap().notice.unwrap().contains("迁移未完成"));
        assert!(state.info().unwrap().pending_path.is_none());
        assert_eq!(
            fs::read_to_string(target.join("keep.txt")).unwrap(),
            "原有文件"
        );
        assert_eq!(
            StorageState::initialize(original.clone()).unwrap().root,
            original
        );
    }

    #[test]
    fn corrupted_database_does_not_switch_or_modify_source() {
        let sandbox = Sandbox::new();
        let source = sandbox.folder("default");
        fs::write(source.join("zixi.db"), "这不是 SQLite").unwrap();
        let target = sandbox.0.join("target");
        write_locator(
            &source,
            &Locator {
                pending: Some(target.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = StorageState::initialize(source.clone()).unwrap();
        assert_eq!(state.root, source);
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(source.join("zixi.db")).unwrap(),
            "这不是 SQLite"
        );
    }

    #[test]
    fn rejects_self_and_nested_targets_and_missing_active_data() {
        let sandbox = Sandbox::new();
        let source = sandbox.folder("default");
        assert!(validate_target(&source, &source).is_err());
        assert!(validate_target(&source, &source.join("nested")).is_err());
        write_locator(
            &source,
            &Locator {
                active: Some(sandbox.0.join("missing")),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(StorageState::initialize(source).is_err());
        assert!(!sandbox.0.join("missing").exists());
    }
}
