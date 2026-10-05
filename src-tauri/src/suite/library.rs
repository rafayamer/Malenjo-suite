use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const INDEX_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub kind: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub added_ms: u64,
    pub last_opened_ms: Option<u64>,
    pub available: bool,
    pub location_label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LibraryEntry {
    id: String,
    path: String,
    added_ms: u64,
    last_opened_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LibraryIndex {
    version: u32,
    documents: Vec<LibraryEntry>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            documents: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub documents: Vec<LibraryDocument>,
    pub errors: Vec<ImportError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedDocument {
    pub token: String,
    pub document_id: String,
    pub name: String,
    pub extension: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve MALENJO data directory: {error}"))?
        .join("library");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create MALENJO library directory: {error}"))?;
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(library_dir(app)?.join("index.json"))
}

fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = library_dir(app)?.join("staging");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create MALENJO staging directory: {error}"))?;
    Ok(dir)
}

fn validate_staging_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 128 {
        return Err("Invalid MALENJO staging token.".into());
    }
    if !token.chars().all(|value| value.is_ascii_alphanumeric() || value == '-') {
        return Err("Invalid MALENJO staging token.".into());
    }
    Ok(())
}

fn staging_path(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    validate_staging_token(token)?;
    Ok(staging_dir(app)?.join(token))
}

fn load_index(app: &AppHandle) -> Result<LibraryIndex, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(LibraryIndex::default());
    }

    let bytes = fs::read(&path)
        .map_err(|error| format!("Unable to read MALENJO library index: {error}"))?;
    let index: LibraryIndex = serde_json::from_slice(&bytes)
        .map_err(|error| format!("MALENJO library index is invalid: {error}"))?;

    if index.version != INDEX_VERSION {
        return Err(format!(
            "Unsupported MALENJO library index version {}",
            index.version
        ));
    }

    Ok(index)
}

fn save_index(app: &AppHandle, index: &LibraryIndex) -> Result<(), String> {
    let path = index_path(app)?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Unable to serialize MALENJO library index: {error}"))?;

    fs::write(&temp, bytes)
        .map_err(|error| format!("Unable to write MALENJO library index: {error}"))?;

    if fs::rename(&temp, &path).is_err() {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Unable to replace MALENJO library index: {error}"))?;
        }
        fs::rename(&temp, &path)
            .map_err(|error| format!("Unable to finalize MALENJO library index: {error}"))?;
    }

    Ok(())
}

fn validate_requested_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("File path is empty.".into());
    }
    if path.contains('\0') {
        return Err("File path contains an invalid NUL character.".into());
    }
    if path.len() > 32_767 {
        return Err("File path exceeds the Windows path safety limit.".into());
    }
    Ok(())
}

fn canonical_user_file(path: &str) -> Result<PathBuf, String> {
    validate_requested_path(path)?;
    let requested = PathBuf::from(path);
    let link_metadata = fs::symlink_metadata(&requested)
        .map_err(|error| format!("File is unavailable: {error}"))?;

    if link_metadata.file_type().is_symlink() {
        return Err("Symbolic-link files are not imported into the MALENJO library.".into());
    }
    if !link_metadata.is_file() {
        return Err("The selected path is not a regular file.".into());
    }

    fs::canonicalize(requested).map_err(|error| format!("Unable to resolve file path: {error}"))
}

fn fnv1a64(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn make_document_id(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    format!("doc-{:016x}", fnv1a64(&normalized))
}

fn classify_extension(extension: &str) -> &'static str {
    match extension {
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" => "docx",
        "xls" | "xlsx" | "xlsm" | "csv" | "ods" => "xlsx",
        "ppt" | "pptx" | "odp" => "pptx",
        "png" | "jpg" | "jpeg" | "tif" | "tiff" | "bmp" | "gif" | "webp" | "heic" => "image",
        "dxf" | "dwg" => "cad",
        "dcm" | "dicom" => "dicom",
        _ => "other",
    }
}

fn public_document(entry: &LibraryEntry) -> LibraryDocument {
    let path = PathBuf::from(&entry.path);
    let metadata = fs::metadata(&path).ok();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown file")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let location_label = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("Local computer")
        .to_string();

    LibraryDocument {
        id: entry.id.clone(),
        name,
        kind: classify_extension(&extension).to_string(),
        extension,
        size_bytes: metadata.as_ref().map(|value| value.len()).unwrap_or_default(),
        modified_ms: metadata.as_ref().map(modified_ms).unwrap_or_default(),
        added_ms: entry.added_ms,
        last_opened_ms: entry.last_opened_ms,
        available: metadata.as_ref().is_some_and(|value| value.is_file()),
        location_label,
    }
}

fn find_entry_mut<'a>(index: &'a mut LibraryIndex, document_id: &str) -> Result<&'a mut LibraryEntry, String> {
    index
        .documents
        .iter_mut()
        .find(|entry| entry.id == document_id)
        .ok_or_else(|| "Document is not in the MALENJO library.".to_string())
}

fn find_entry<'a>(index: &'a LibraryIndex, document_id: &str) -> Result<&'a LibraryEntry, String> {
    index
        .documents
        .iter()
        .find(|entry| entry.id == document_id)
        .ok_or_else(|| "Document is not in the MALENJO library.".to_string())
}

#[tauri::command]
pub fn list_library_documents(app: AppHandle) -> Result<Vec<LibraryDocument>, String> {
    let index = load_index(&app)?;
    let mut documents = index
        .documents
        .iter()
        .map(public_document)
        .collect::<Vec<_>>();

    documents.sort_by(|left, right| {
        right
            .last_opened_ms
            .unwrap_or(right.added_ms)
            .cmp(&left.last_opened_ms.unwrap_or(left.added_ms))
    });
    Ok(documents)
}

#[tauri::command]
pub fn add_library_documents(app: AppHandle, paths: Vec<String>) -> Result<ImportResult, String> {
    let mut index = load_index(&app)?;
    let mut documents = Vec::new();
    let mut errors = Vec::new();

    for requested in paths {
        match canonical_user_file(&requested) {
            Ok(path) => {
                let id = make_document_id(&path);
                if let Some(existing) = index.documents.iter().find(|entry| entry.id == id) {
                    documents.push(public_document(existing));
                    continue;
                }

                let entry = LibraryEntry {
                    id,
                    path: path.to_string_lossy().to_string(),
                    added_ms: now_ms(),
                    last_opened_ms: None,
                };
                documents.push(public_document(&entry));
                index.documents.push(entry);
            }
            Err(message) => errors.push(ImportError {
                path: requested,
                message,
            }),
        }
    }

    save_index(&app, &index)?;
    Ok(ImportResult { documents, errors })
}

#[tauri::command]
pub fn open_library_document(app: AppHandle, document_id: String) -> Result<LibraryDocument, String> {
    let mut index = load_index(&app)?;
    let document = {
        let entry = find_entry_mut(&mut index, &document_id)?;
        let path = canonical_user_file(&entry.path)?;
        entry.path = path.to_string_lossy().to_string();
        entry.last_opened_ms = Some(now_ms());
        public_document(entry)
    };
    save_index(&app, &index)?;
    Ok(document)
}

#[tauri::command]
pub fn refresh_library_document(app: AppHandle, document_id: String) -> Result<LibraryDocument, String> {
    let index = load_index(&app)?;
    Ok(public_document(find_entry(&index, &document_id)?))
}

#[tauri::command]
pub fn remove_library_document(app: AppHandle, document_id: String) -> Result<bool, String> {
    let mut index = load_index(&app)?;
    let previous_len = index.documents.len();
    index.documents.retain(|entry| entry.id != document_id);
    let removed = previous_len != index.documents.len();
    if removed {
        save_index(&app, &index)?;
    }
    Ok(removed)
}

fn destination_path(destination: &str) -> Result<PathBuf, String> {
    validate_requested_path(destination)?;
    let path = PathBuf::from(destination);
    if path.exists() && path.is_dir() {
        return Err("Save As destination is a directory, not a file.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Save As destination has no parent directory.".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err("Save As destination folder does not exist.".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn save_as_library_document(
    app: AppHandle,
    document_id: String,
    destination: String,
) -> Result<LibraryDocument, String> {
    let mut index = load_index(&app)?;
    let source_entry = find_entry(&index, &document_id)?.clone();
    let source = canonical_user_file(&source_entry.path)?;
    let destination = destination_path(&destination)?;

    let source_normalized = source.to_string_lossy().to_lowercase();
    let destination_normalized = destination.to_string_lossy().to_lowercase();
    if source_normalized == destination_normalized {
        return Err("Save As destination must be different from the source file.".into());
    }

    fs::copy(&source, &destination)
        .map_err(|error| format!("Unable to save document copy: {error}"))?;

    let canonical_destination = canonical_user_file(&destination)?;
    let id = make_document_id(&canonical_destination);
    let opened = now_ms();

    if let Some(existing) = index.documents.iter_mut().find(|entry| entry.id == id) {
        existing.last_opened_ms = Some(opened);
        let result = public_document(existing);
        save_index(&app, &index)?;
        return Ok(result);
    }

    let entry = LibraryEntry {
        id,
        path: canonical_destination.to_string_lossy().to_string(),
        added_ms: opened,
        last_opened_ms: Some(opened),
    };
    let result = public_document(&entry);
    index.documents.push(entry);
    save_index(&app, &index)?;
    Ok(result)
}


#[tauri::command]
pub fn stage_library_document(app: AppHandle, document_id: String) -> Result<StagedDocument, String> {
    let index = load_index(&app)?;
    let entry = find_entry(&index, &document_id)?;
    let source = canonical_user_file(&entry.path)?;
    let public = public_document(entry);
    let token = format!("{}-{:x}", document_id, now_ms());
    let stage = staging_path(&app, &token)?;

    fs::copy(&source, &stage)
        .map_err(|error| format!("Unable to create MALENJO edit staging copy: {error}"))?;

    Ok(StagedDocument {
        token,
        document_id,
        name: public.name,
        extension: public.extension,
    })
}

#[tauri::command]
pub fn commit_staged_document(
    app: AppHandle,
    document_id: String,
    staging_token: String,
) -> Result<LibraryDocument, String> {
    validate_staging_token(&staging_token)?;
    if !staging_token.starts_with(&format!("{}-", document_id)) {
        return Err("Staging token does not belong to this document.".into());
    }

    let stage = staging_path(&app, &staging_token)?;
    let stage_metadata = fs::symlink_metadata(&stage)
        .map_err(|error| format!("MALENJO staging copy is unavailable: {error}"))?;
    if stage_metadata.file_type().is_symlink() || !stage_metadata.is_file() {
        return Err("MALENJO staging copy is not a regular file.".into());
    }

    let mut index = load_index(&app)?;
    let entry = find_entry_mut(&mut index, &document_id)?;
    let source = canonical_user_file(&entry.path)?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Source document has an invalid file name.".to_string())?;
    let backup = source.with_file_name(format!("{file_name}.malenjo-save-backup"));

    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Unable to clear stale MALENJO save backup: {error}"))?;
    }

    fs::copy(&source, &backup)
        .map_err(|error| format!("Unable to create MALENJO save backup: {error}"))?;

    let write_result = fs::copy(&stage, &source)
        .map_err(|error| format!("Unable to commit document save: {error}"));

    if let Err(error) = write_result {
        let _ = fs::copy(&backup, &source);
        let _ = fs::remove_file(&backup);
        return Err(error);
    }

    if let Ok(file) = fs::OpenOptions::new().read(true).open(&source) {
        let _ = file.sync_all();
    }

    fs::remove_file(&backup)
        .map_err(|error| format!("Document saved, but cleanup of the temporary backup failed: {error}"))?;
    let _ = fs::remove_file(&stage);

    entry.last_opened_ms = Some(now_ms());
    let document = public_document(entry);
    save_index(&app, &index)?;
    Ok(document)
}

#[tauri::command]
pub fn discard_staged_document(app: AppHandle, staging_token: String) -> Result<bool, String> {
    let stage = staging_path(&app, &staging_token)?;
    if !stage.exists() {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(&stage)
        .map_err(|error| format!("Unable to inspect MALENJO staging copy: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("MALENJO staging copy is not a regular file.".into());
    }
    fs::remove_file(stage)
        .map_err(|error| format!("Unable to discard MALENJO staging copy: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{classify_extension, fnv1a64, validate_requested_path, validate_staging_token};

    #[test]
    fn maps_supported_document_extensions() {
        assert_eq!(classify_extension("pdf"), "pdf");
        assert_eq!(classify_extension("docx"), "docx");
        assert_eq!(classify_extension("xlsx"), "xlsx");
        assert_eq!(classify_extension("pptx"), "pptx");
        assert_eq!(classify_extension("dxf"), "cad");
        assert_eq!(classify_extension("dcm"), "dicom");
        assert_eq!(classify_extension("unknown"), "other");
    }

    #[test]
    fn stable_id_hash_is_deterministic() {
        assert_eq!(fnv1a64("C:/Docs/test.pdf"), fnv1a64("C:/Docs/test.pdf"));
        assert_ne!(fnv1a64("C:/Docs/a.pdf"), fnv1a64("C:/Docs/b.pdf"));
    }

    #[test]
    fn rejects_malformed_requested_paths() {
        assert!(validate_requested_path("").is_err());
        assert!(validate_requested_path("bad\0path.pdf").is_err());
    }

    #[test]
    fn rejects_path_like_staging_tokens() {
        assert!(validate_staging_token("doc-123-abc").is_ok());
        assert!(validate_staging_token("../escape").is_err());
        assert!(validate_staging_token("bad/token").is_err());
    }
}
