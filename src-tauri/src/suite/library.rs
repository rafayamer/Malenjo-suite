use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const INDEX_VERSION: u32 = 1;
const STAGING_VERSION: u32 = 1;

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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StagingManifest {
    version: u32,
    document_id: String,
    source_size: u64,
    source_modified_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn staging_nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
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

fn staging_manifest_path(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    validate_staging_token(token)?;
    Ok(staging_dir(app)?.join(format!("{token}.json")))
}

fn parse_index(bytes: &[u8]) -> Result<LibraryIndex, String> {
    let index: LibraryIndex = serde_json::from_slice(bytes)
        .map_err(|error| format!("MALENJO library index is invalid: {error}"))?;

    if index.version != INDEX_VERSION {
        return Err(format!(
            "Unsupported MALENJO library index version {}",
            index.version
        ));
    }
    Ok(index)
}

fn load_index(app: &AppHandle) -> Result<LibraryIndex, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(LibraryIndex::default());
    }

    let bytes = fs::read(&path)
        .map_err(|error| format!("Unable to read MALENJO library index: {error}"))?;
    match parse_index(&bytes) {
        Ok(index) => Ok(index),
        Err(primary_error) => {
            let backup = path.with_extension("json.bak");
            if !backup.exists() {
                return Err(primary_error);
            }
            let backup_bytes = fs::read(&backup)
                .map_err(|error| format!("{primary_error}; backup read failed: {error}"))?;
            parse_index(&backup_bytes)
                .map_err(|backup_error| format!("{primary_error}; backup recovery failed: {backup_error}"))
        }
    }
}

fn save_index(app: &AppHandle, index: &LibraryIndex) -> Result<(), String> {
    let path = index_path(app)?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Unable to serialize MALENJO library index: {error}"))?;

    fs::write(&temp, bytes)
        .map_err(|error| format!("Unable to write MALENJO library index: {error}"))?;

    if path.exists() {
        let backup = path.with_extension("json.bak");
        fs::copy(&path, &backup)
            .map_err(|error| format!("Unable to create MALENJO library index backup: {error}"))?;
    }

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

fn classify_signature(bytes: &[u8], extension: &str) -> &'static str {
    if bytes.starts_with(b"%PDF-") {
        return "pdf";
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || bytes.starts_with(b"II*\0")
        || bytes.starts_with(b"MM\0*")
    {
        return "image";
    }
    if bytes.len() >= 132 && &bytes[128..132] == b"DICM" {
        return "dicom";
    }

    classify_extension(extension)
}

fn detect_kind(path: &Path, extension: &str) -> &'static str {
    let mut header = [0u8; 132];
    match fs::File::open(path).and_then(|mut file| file.read(&mut header)) {
        Ok(read) => classify_signature(&header[..read], extension),
        Err(_) => classify_extension(extension),
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
        kind: detect_kind(&path, &extension).to_string(),
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
    if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect Save As destination: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Save As refuses to overwrite a symbolic-link destination.".into());
        }
        if !metadata.is_file() {
            return Err("Save As destination is not a regular file.".into());
        }
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

    let destination_text = destination.to_string_lossy();
    let canonical_destination = canonical_user_file(destination_text.as_ref())?;
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
    let source_metadata = fs::metadata(&source)
        .map_err(|error| format!("Unable to inspect source document: {error}"))?;
    let token = format!("{}-{:x}", document_id, staging_nonce());
    let stage = staging_path(&app, &token)?;
    let manifest_path = staging_manifest_path(&app, &token)?;

    fs::copy(&source, &stage)
        .map_err(|error| format!("Unable to create MALENJO edit staging copy: {error}"))?;

    let manifest = StagingManifest {
        version: STAGING_VERSION,
        document_id: document_id.clone(),
        source_size: source_metadata.len(),
        source_modified_ms: modified_ms(&source_metadata),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to serialize MALENJO staging manifest: {error}"))?;
    if let Err(error) = fs::write(&manifest_path, manifest_bytes) {
        let _ = fs::remove_file(&stage);
        return Err(format!("Unable to create MALENJO staging manifest: {error}"));
    }

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
    let manifest_path = staging_manifest_path(&app, &staging_token)?;
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("MALENJO staging manifest is unavailable: {error}"))?;
    let manifest: StagingManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("MALENJO staging manifest is invalid: {error}"))?;
    if manifest.version != STAGING_VERSION || manifest.document_id != document_id {
        return Err("MALENJO staging manifest does not match this document.".into());
    }

    let stage_metadata = fs::symlink_metadata(&stage)
        .map_err(|error| format!("MALENJO staging copy is unavailable: {error}"))?;
    if stage_metadata.file_type().is_symlink() || !stage_metadata.is_file() {
        return Err("MALENJO staging copy is not a regular file.".into());
    }

    let mut index = load_index(&app)?;
    let entry = find_entry_mut(&mut index, &document_id)?;
    let source = canonical_user_file(&entry.path)?;
    let current_metadata = fs::metadata(&source)
        .map_err(|error| format!("Unable to inspect source document before save: {error}"))?;
    if current_metadata.len() != manifest.source_size
        || modified_ms(&current_metadata) != manifest.source_modified_ms
    {
        return Err(
            "The source document changed outside MALENJO after editing began. Reopen or Save As to avoid overwriting newer changes."
                .into(),
        );
    }

    let backup = staging_dir(&app)?.join(format!("{staging_token}-backup"));

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

    let _ = fs::remove_file(&backup);
    let _ = fs::remove_file(&stage);
    let _ = fs::remove_file(&manifest_path);

    entry.last_opened_ms = Some(now_ms());
    let document = public_document(entry);
    save_index(&app, &index)?;
    Ok(document)
}

#[tauri::command]
pub fn discard_staged_document(app: AppHandle, staging_token: String) -> Result<bool, String> {
    let stage = staging_path(&app, &staging_token)?;
    let manifest = staging_manifest_path(&app, &staging_token)?;
    let mut removed = false;

    if stage.exists() {
        let metadata = fs::symlink_metadata(&stage)
            .map_err(|error| format!("Unable to inspect MALENJO staging copy: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("MALENJO staging copy is not a regular file.".into());
        }
        fs::remove_file(&stage)
            .map_err(|error| format!("Unable to discard MALENJO staging copy: {error}"))?;
        removed = true;
    }

    if manifest.exists() {
        let metadata = fs::symlink_metadata(&manifest)
            .map_err(|error| format!("Unable to inspect MALENJO staging manifest: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("MALENJO staging manifest is not a regular file.".into());
        }
        fs::remove_file(manifest)
            .map_err(|error| format!("Unable to discard MALENJO staging manifest: {error}"))?;
        removed = true;
    }

    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::{classify_extension, classify_signature, fnv1a64, parse_index, validate_requested_path, validate_staging_token};

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
    fn rejects_invalid_or_future_index_data() {
        assert!(parse_index(b"not-json").is_err());
        assert!(parse_index(br#"{"version":999,"documents":[]}"#).is_err());
        assert!(parse_index(br#"{"version":1,"documents":[]}"#).is_ok());
    }

    #[test]
    fn signature_detection_overrides_misleading_extensions() {
        assert_eq!(classify_signature(b"%PDF-1.7", "txt"), "pdf");
        assert_eq!(classify_signature(b"\x89PNG\r\n\x1a\n", "bin"), "image");

        let mut dicom = vec![0u8; 132];
        dicom[128..132].copy_from_slice(b"DICM");
        assert_eq!(classify_signature(&dicom, "bin"), "dicom");
        assert_eq!(classify_signature(b"PK", "docx"), "docx");
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
