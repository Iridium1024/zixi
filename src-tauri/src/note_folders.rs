use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(super) const MIGRATION: &str = r#"
    CREATE TABLE note_folders (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
    CREATE TABLE note_folder_entries (
        note_id TEXT PRIMARY KEY NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        folder_id TEXT NOT NULL REFERENCES note_folders(id) ON DELETE CASCADE
    );
    CREATE INDEX note_folder_entries_folder_idx ON note_folder_entries(folder_id);
"#;

pub(super) const ORDER_MIGRATION: &str = "CREATE TABLE directory_order (kind TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(kind,id));";

#[derive(Serialize)]
pub(super) struct Folder {
    id: String,
    name: String,
}
#[derive(Serialize)]
pub(super) struct FolderState {
    folders: Vec<Folder>,
    entries: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    orders: BTreeMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub(super) enum Mutation {
    Create {
        id: String,
        name: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Delete {
        id: String,
    },
    MoveMany {
        #[serde(rename = "noteIds")]
        note_ids: Vec<String>,
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    },
    Reorder {
        kind: String,
        ids: Vec<String>,
    },
    Move {
        #[serde(rename = "noteId")]
        note_id: String,
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    },
}

fn read(connection: &Connection) -> Result<FolderState, String> {
    let mut folders = connection
        .prepare("SELECT id, name FROM note_folders ORDER BY name, id")
        .map_err(|e| e.to_string())?;
    let folders = folders
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut entries = connection.prepare("SELECT e.note_id, e.folder_id FROM note_folder_entries e JOIN notes n ON n.id = e.note_id").map_err(|e| e.to_string())?;
    let entries = entries
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(|e| e.to_string())?;
    let mut orders: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut statement = connection
        .prepare("SELECT kind,id FROM directory_order ORDER BY kind,position")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (kind, id) = row.map_err(|e| e.to_string())?;
        orders.entry(kind).or_default().push(id);
    }
    Ok(FolderState {
        folders,
        entries,
        orders,
    })
}

fn move_notes(
    transaction: &Connection,
    ids: Vec<String>,
    folder_id: Option<String>,
) -> Result<(), String> {
    for note_id in ids {
        let exists = transaction
            .query_row(
                "SELECT 1 FROM notes WHERE id = ?1 AND deleted_at IS NULL",
                [&note_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !exists {
            return Err("便签不存在或已移至回收站".into());
        }
        if let Some(ref folder_id) = folder_id {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM note_folders WHERE id = ?1",
                    [&folder_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if !exists {
                return Err("文件夹已被删除，请重新选择".into());
            }
            transaction.execute("INSERT INTO note_folder_entries (note_id, folder_id) VALUES (?1, ?2) ON CONFLICT(note_id) DO UPDATE SET folder_id = excluded.folder_id", params![note_id, folder_id]).map_err(|e| e.to_string())?;
        } else {
            transaction
                .execute(
                    "DELETE FROM note_folder_entries WHERE note_id = ?1",
                    [&note_id],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn mutate(connection: &mut Connection, input: Mutation) -> Result<FolderState, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let creating = matches!(&input, Mutation::Create { .. });
    match input {
        Mutation::Create { id, name } | Mutation::Rename { id, name } => {
            // Presence is checked below; callers cannot supply a parent folder.
            let name = name.trim();
            if name.is_empty() || name.encode_utf16().count() > 80 {
                return Err("文件夹名称应为 1–80 个字符".into());
            }
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM note_folders WHERE id = ?1",
                    [&id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if creating && exists {
                return Err("文件夹已存在".into());
            }
            if !creating && !exists {
                return Err("文件夹已被删除".into());
            }
            if exists {
                transaction.execute(
                    "UPDATE note_folders SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )
            } else {
                transaction.execute(
                    "INSERT INTO note_folders (id, name) VALUES (?1, ?2)",
                    params![id, name],
                )
            }
            .map_err(|e| format!("文件夹保存失败（名称可能重复）：{e}"))?;
        }
        Mutation::Delete { id } => {
            transaction
                .execute(
                    "DELETE FROM note_folder_entries WHERE folder_id = ?1",
                    [&id],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute("DELETE FROM note_folders WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
        }
        Mutation::Reorder { kind, ids } => {
            let table = match kind.as_str() {
                "note" | "trash" => "notes",
                "folder" => "note_folders",
                "mindmap" => "mind_maps",
                "book" => "reader_books",
                _ => return Err("未知目录类型".into()),
            };
            let mut unique = std::collections::HashSet::new();
            transaction
                .execute("DELETE FROM directory_order WHERE kind=?1", [&kind])
                .map_err(|e| e.to_string())?;
            for (position, id) in ids
                .iter()
                .filter(|id| unique.insert((*id).clone()))
                .enumerate()
            {
                let exists = transaction
                    .query_row(&format!("SELECT 1 FROM {table} WHERE id=?1"), [id], |_| {
                        Ok(())
                    })
                    .optional()
                    .map_err(|e| e.to_string())?
                    .is_some();
                if !exists {
                    continue;
                }
                transaction
                    .execute(
                        "INSERT INTO directory_order(kind,id,position) VALUES(?1,?2,?3)",
                        params![kind, id, position as i64],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        Mutation::Move { note_id, folder_id } => {
            move_notes(&transaction, vec![note_id], folder_id)?
        }
        Mutation::MoveMany {
            note_ids,
            folder_id,
        } => move_notes(&transaction, note_ids, folder_id)?,
    }
    let state = read(&transaction)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(state)
}

#[tauri::command]
pub(super) async fn note_folders_state(app: tauri::AppHandle) -> Result<FolderState, String> {
    let path = super::note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || read(&super::open_note_database(&path)?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) async fn mutate_note_folder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: Mutation,
) -> Result<FolderState, String> {
    if window.label() != "main" {
        return Err("仅主窗口可调整便签文件夹".into());
    }
    let path = super::note_database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        mutate(&mut super::open_note_database(&path)?, input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batch_movement_rolls_back_and_order_survives_content_changes() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE notes(id TEXT PRIMARY KEY, deleted_at TEXT); INSERT INTO notes VALUES ('a',NULL),('b',NULL);").unwrap();
        db.execute_batch(MIGRATION).unwrap();
        db.execute_batch(ORDER_MIGRATION).unwrap();
        mutate(
            &mut db,
            Mutation::Create {
                id: "f".into(),
                name: "Folder".into(),
            },
        )
        .unwrap();
        assert!(mutate(
            &mut db,
            Mutation::MoveMany {
                note_ids: vec!["a".into(), "missing".into()],
                folder_id: Some("f".into())
            }
        )
        .is_err());
        assert!(read(&db).unwrap().entries.is_empty());
        mutate(
            &mut db,
            Mutation::MoveMany {
                note_ids: vec!["a".into(), "b".into()],
                folder_id: Some("f".into()),
            },
        )
        .unwrap();
        mutate(
            &mut db,
            Mutation::Reorder {
                kind: "note".into(),
                ids: vec!["b".into(), "a".into(), "b".into()],
            },
        )
        .unwrap();
        assert_eq!(read(&db).unwrap().orders["note"], vec!["b", "a"]);
        assert_eq!(read(&db).unwrap().entries.len(), 2);
        mutate(&mut db, Mutation::Delete { id: "f".into() }).unwrap();
        assert!(read(&db).unwrap().entries.is_empty());
        assert_eq!(read(&db).unwrap().orders["note"], vec!["b", "a"]);
    }
    #[test]
    fn folder_mutations_preserve_notes_and_content_versions() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT, updated_at TEXT, deleted_at TEXT); INSERT INTO notes VALUES ('n', 'keep', 'v1', NULL);").unwrap();
        db.execute_batch(MIGRATION).unwrap();
        db.execute_batch(ORDER_MIGRATION).unwrap();
        mutate(
            &mut db,
            Mutation::Create {
                id: "f".into(),
                name: "项目".into(),
            },
        )
        .unwrap();
        mutate(
            &mut db,
            Mutation::Move {
                note_id: "n".into(),
                folder_id: Some("f".into()),
            },
        )
        .unwrap();
        assert_eq!(read(&db).unwrap().entries["n"], "f");
        let state = mutate(&mut db, Mutation::Delete { id: "f".into() }).unwrap();
        assert!(state.entries.is_empty());
        assert_eq!(
            db.query_row(
                "SELECT content || updated_at FROM notes WHERE id='n'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "keepv1"
        );
        assert!(mutate(
            &mut db,
            Mutation::Move {
                note_id: "n".into(),
                folder_id: Some("f".into())
            }
        )
        .is_err());
        mutate(
            &mut db,
            Mutation::Create {
                id: "f2".into(),
                name: "另一个项目".into(),
            },
        )
        .unwrap();
        mutate(
            &mut db,
            Mutation::Move {
                note_id: "n".into(),
                folder_id: Some("f2".into()),
            },
        )
        .unwrap();
        db.execute("DELETE FROM notes WHERE id='n'", []).unwrap();
        assert!(read(&db).unwrap().entries.is_empty());
    }
}
