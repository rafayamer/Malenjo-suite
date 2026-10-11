use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const INDEX_VERSION: u32 = 1;
const STAGING_VERSION: u32 = 1;

/// Serialize library index mutations within a desktop process. Each mutating
/// command holds the lock across load, mutation and durable write.
fn library_mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(windows)]
fn replace_document_file(new_file: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(replaced: *const u16, replacement: *const u16,
            backup: *const u16, flags: u32, excluded: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void) -> i32;
    }
    let old: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let new: Vec<u16> = new_file.as_os_str().encode_wide().chain(Some(0)).collect();
    let status = unsafe {
        ReplaceFileW(old.as_ptr(), new.as_ptr(), ptr::null(), 0,
            ptr::null_mut(), ptr::null_mut())
    };
    if status == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_document_file(new_file: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(new_file, destination)
}

/// Copy to an exclusively created staging file *beside* the original; replace
/// the original only after the new file is complete and synced. On replacement
/// failure the old source file is unchanged.
fn install_staged_document(stage: &Path, source: &Path, nonce: u128) -> Result<(), String> {
    let parent = source.parent().ok_or("Source document has no parent folder.")?;
    let sibling = parent.join(format!(
        ".malenjo-install-{}-{nonce:x}.tmp", std::process::id()
    ));
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&sibling)
        .map_err(|error| format!("Unable to stage new document beside source: {error}"))?;
    let copied = (|| -> std::io::Result<()> {
        let mut input = fs::File::open(stage)?;
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = copied {
        let _ = fs::remove_file(&sibling);
        return Err(format!("Unable to prepare complete source replacement: {error}"));
    }
    if let Err(error) = replace_document_file(&sibling, source) {
        let _ = fs::remove_file(&sibling);
        return Err(format!("Unable to install document without overwriting it in place: {error}"));
    }
    Ok(())
}

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

/// Publish library index and its prior-version recovery copy using synced,
/// same-directory files. Never delete a live index as a rename fallback.
/// A successful call guarantees a complete readable index; a failure before
/// replacement leaves the previous index untouched.
fn save_index_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let nonce=staging_nonce();
    let stage=path.with_extension(format!("json-{}-{nonce}.tmp",std::process::id()));
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&stage)
        .map_err(|error| format!("Unable to stage library index: {error}"))?;
    let written=(||->std::io::Result<()>{
        file.write_all(bytes)?;
        file.sync_all()
    })();
    drop(file);
    if let Err(error)=written {
        let _=fs::remove_file(&stage);
        return Err(format!("Unable to safely stage library index: {error}"));
    }
    // Make a verified recovery copy before changing the primary. The backup
    // must itself be published transactionally; otherwise a failed write
    // would destroy the sole working rollback candidate.
    if let Ok(meta)=fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            let _=fs::remove_file(&stage);
            return Err("Library index destination is not a regular file.".into());
        }
        let backup=path.with_extension("json.bak");
        let backup_stage=path.with_extension(format!("bak-{}-{nonce}.tmp",std::process::id()));
        let copied=(||->std::io::Result<()>{
            let mut input=fs::File::open(path)?;
            let mut output=fs::OpenOptions::new().create_new(true).write(true).open(&backup_stage)?;
            std::io::copy(&mut input,&mut output)?;
            output.sync_all()
        })();
        if let Err(error)=copied {
            let _=fs::remove_file(&backup_stage);
            let _=fs::remove_file(&stage);
            return Err(format!("Unable to prepare library index recovery: {error}"));
        }
        let backup_result=if backup.exists() {
            replace_document_file(&backup_stage,&backup)
        } else {
            fs::rename(&backup_stage,&backup)
        };
        if let Err(error)=backup_result {
            let _=fs::remove_file(&backup_stage);
            let _=fs::remove_file(&stage);
            return Err(format!("Unable to publish library index recovery: {error}"));
        }
        if let Err(error)=replace_document_file(&stage,path) {
            let _=fs::remove_file(&stage);
            return Err(format!("Unable to replace library index atomically: {error}"));
        }
    } else {
        if let Err(error)=fs::rename(&stage,path) {
            let _=fs::remove_file(&stage);
            return Err(format!("Unable to create library index: {error}"));
        }
    }
    Ok(())
}

fn save_index(app: &AppHandle, index: &LibraryIndex) -> Result<(), String> {
    let bytes=serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Unable to serialize MALENJO library index: {error}"))?;
    save_index_file(&index_path(app)?,&bytes)
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
        "docx" => "docx",
        "xlsx" => "xlsx",
        "pptx" => "pptx",
        // Legacy binary / non-OOXML formats are library entries, not files
        // the current OOXML-only editor can safely open or reserialize.
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

pub(super) fn resolve_library_document_path(
    app: &AppHandle,
    document_id: &str,
) -> Result<PathBuf, String> {
    let index = load_index(app)?;
    let entry = find_entry(&index, document_id)?;
    canonical_user_file(&entry.path)
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
    let _index_guard = library_mutation_lock().lock()
        .map_err(|_| "Library mutation lock is poisoned.".to_string())?;
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
    let _index_guard = library_mutation_lock().lock()
        .map_err(|_| "Library mutation lock is poisoned.".to_string())?;
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
    let _index_guard = library_mutation_lock().lock()
        .map_err(|_| "Library mutation lock is poisoned.".to_string())?;
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
    // A Save As *copy* may never replace a file, directory, hard-link alias,
    // or dangling symbolic link; reject even when Path::exists() is false.
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            return Err("Save As destination already exists. Choose a new filename; existing files are never replaced.".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Unable to inspect Save As destination: {error}")),
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Save As destination has no parent directory.".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err("Save As destination folder does not exist.".into());
    }
    Ok(path)
}

/// Copy an indexed source document into a *new* destination without writing
/// a single byte to an existing user file. Stage and sync the copy beside the
/// destination, then atomically create its directory entry via hard-link.
/// hard_link fails with AlreadyExists even if another process wins a race
/// after destination_path() checked that the target did not exist.
fn save_as_new_file(source: &Path, destination: &Path) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(_) => return Err("Save As destination already exists; no files were changed.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Unable to inspect Save As destination: {error}")),
    }

    let parent = destination.parent()
        .ok_or_else(|| "Save As destination has no parent folder.".to_string())?;
    let stage = parent.join(format!(
        ".malenjo-saveas-{}-{:x}.tmp", std::process::id(), staging_nonce()
    ));

    // create_new makes concurrent stage-name collisions fail closed. Never
    // remove the stage if it was not successfully created by this operation.
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|error| format!("Unable to stage Save As copy: {error}"))?;

    let copied = (|| -> std::io::Result<()> {
        let mut input = fs::File::open(source)?;
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = copied {
        let _ = fs::remove_file(&stage);
        return Err(format!("Unable to stage complete Save As copy: {error}"));
    }

    if let Err(error) = fs::hard_link(&stage, destination) {
        let _ = fs::remove_file(&stage);
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return Err("Save As destination was created by another operation. No existing file was changed.".into());
        }
        return Err(format!("Unable to finalize Save As without overwriting a destination: {error}"));
    }

    if let Err(error) = fs::remove_file(&stage) {
        return Err(format!(
            "Save As copy was created at {}, but could not clean up temporary file {} ({error}).",
            destination.display(), stage.display()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn save_as_library_document(
    app: AppHandle,
    document_id: String,
    destination: String,
) -> Result<LibraryDocument, String> {
    let _index_guard = library_mutation_lock().lock()
        .map_err(|_| "Library mutation lock is poisoned.".to_string())?;
    let mut index = load_index(&app)?;
    let source_entry = find_entry(&index, &document_id)?.clone();
    let source = canonical_user_file(&source_entry.path)?;
    let destination = destination_path(&destination)?;

    let source_normalized = source.to_string_lossy().to_lowercase();
    let destination_normalized = destination.to_string_lossy().to_lowercase();
    if source_normalized == destination_normalized {
        return Err("Save As destination must be different from the source file.".into());
    }

    save_as_new_file(&source, &destination)?;

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
    let _index_guard = library_mutation_lock().lock()
        .map_err(|_| "Library mutation lock is poisoned.".to_string())?;
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

    // The original stays intact until a same-folder, completely synced
    // replacement is installed. No in-place truncation or restore-by-copy.
    install_staged_document(&stage, &source, staging_nonce())?;

    // Keep recovery material until the replacement and index update complete.

    entry.last_opened_ms = Some(now_ms());
    let document = public_document(entry);
    save_index(&app, &index)?;
    let _ = fs::remove_file(&backup);
    let _ = fs::remove_file(&stage);
    let _ = fs::remove_file(&manifest_path);
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
    use super::{classify_extension, classify_signature, destination_path, fnv1a64, install_staged_document, parse_index, save_as_new_file, save_index_file, validate_requested_path, validate_staging_token};
    use std::{fs, path::PathBuf, sync::{Arc, Barrier}, thread, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn staged_save_commits_only_complete_bytes() {
        let folder = test_directory("staged-success");
        let original = folder.join("user.pdf");
        let stage = folder.join("edited.bin");
        fs::write(&original, b"unaltered").expect("source");
        fs::write(&stage, b"complete edited PDF bytes").expect("stage");
        install_staged_document(&stage, &original, 23).expect("transactional replace");
        assert_eq!(fs::read(&original).expect("updated"), b"complete edited PDF bytes");
        assert_eq!(fs::read(&stage).expect("stage preserved"), b"complete edited PDF bytes");
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[test]
    fn failed_staged_save_preserves_original_bytes() {
        let folder = test_directory("staged-failure");
        let original = folder.join("user.pdf");
        fs::write(&original, b"unaltered").expect("source");
        assert!(install_staged_document(&folder.join("missing"), &original, 24).is_err());
        assert_eq!(fs::read(&original).expect("source intact"), b"unaltered");
        assert_eq!(fs::read_dir(&folder).expect("no leftovers").count(), 1);
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[test]
    fn library_index_atomic_save_retains_previous_verified_version() {
        let root=test_directory("index-atomic");
        let path=root.join("index.json");
        let first=br#"{"version":1,"documents":[]}"#;
        let second=br#"{"version":1,"documents":[{"id":"d","path":"C:/example.pdf","added_ms":1,"last_opened_ms":null}]}"#;
        save_index_file(&path,first).expect("create library index");
        save_index_file(&path,second).expect("replace library index");
        assert_eq!(fs::read(&path).unwrap(),second);
        assert_eq!(fs::read(root.join("index.json.bak")).unwrap(),first);
        assert!(parse_index(&fs::read(&path).unwrap()).is_ok());
        assert!(parse_index(&fs::read(root.join("index.json.bak")).unwrap()).is_ok());
        assert_eq!(fs::read_dir(&root).unwrap().count(),2);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn library_index_rejects_non_file_destination_without_removing_it() {
        let root=test_directory("index-directory");
        let path=root.join("index.json");
        fs::create_dir(&path).unwrap();
        assert!(save_index_file(&path,b"replacement").is_err());
        assert!(path.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(),1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn library_index_rejects_failed_staging_without_destroying_existing_bytes() {
        let root=test_directory("index-closed");
        let path=root.join("index.json");
        fs::write(&path,b"original").unwrap();
        // Nonexistent parent makes staging fail before the live index is touched.
        assert!(save_index_file(&root.join("missing").join("index.json"),b"new").is_err());
        assert_eq!(fs::read(&path).unwrap(),b"original");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn maps_supported_document_extensions() {
        assert_eq!(classify_extension("pdf"), "pdf");
        assert_eq!(classify_extension("docx"), "docx");
        assert_eq!(classify_extension("xlsx"), "xlsx");
        assert_eq!(classify_extension("pptx"), "pptx");
        for unsupported in ["doc", "xls", "ppt", "odt", "ods", "odp", "rtf", "csv", "xlsm"] {
            assert_eq!(classify_extension(unsupported), "other");
        }
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

    fn test_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "malenjo-saveas-{}-{label}-{nonce}", std::process::id()
        ));
        fs::create_dir(&directory).expect("create isolated test directory");
        directory
    }

    #[test]
    fn save_as_creates_a_complete_new_copy() {
        let directory = test_directory("new");
        let source = directory.join("source.txt");
        let destination = directory.join("copy.txt");
        fs::write(&source, b"contents to preserve").expect("write source");
        assert!(destination_path(destination.to_string_lossy().as_ref()).is_ok());
        save_as_new_file(&source, &destination).expect("save new copy");
        assert_eq!(fs::read(&source).expect("read source"), b"contents to preserve");
        assert_eq!(fs::read(&destination).expect("read copy"), b"contents to preserve");
        assert_eq!(fs::read_dir(&directory).expect("read directory").count(), 2);
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn save_as_refuses_an_existing_destination_without_changing_either_file() {
        let directory = test_directory("existing");
        let source = directory.join("source.txt");
        let destination = directory.join("existing.txt");
        fs::write(&source, b"source bytes").expect("source");
        fs::write(&destination, b"existing user bytes").expect("destination");
        assert!(destination_path(destination.to_string_lossy().as_ref()).is_err());
        assert!(save_as_new_file(&source, &destination).is_err());
        assert_eq!(fs::read(&source).expect("source unchanged"), b"source bytes");
        assert_eq!(fs::read(&destination).expect("destination unchanged"), b"existing user bytes");
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn save_as_refuses_source_path_and_hard_link_alias() {
        let directory = test_directory("aliases");
        let source = directory.join("source.txt");
        let alias = directory.join("alias.txt");
        fs::write(&source, b"unaltered source").expect("source");
        fs::hard_link(&source, &alias).expect("alias");
        assert!(save_as_new_file(&source, &source).is_err());
        assert!(save_as_new_file(&source, &alias).is_err());
        assert_eq!(fs::read(&source).expect("source unchanged"), b"unaltered source");
        assert_eq!(fs::read(&alias).expect("alias unchanged"), b"unaltered source");
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn save_as_missing_source_leaves_no_destination_or_stage() {
        let directory = test_directory("missing");
        let source = directory.join("missing-source.txt");
        let destination = directory.join("copy.txt");
        assert!(save_as_new_file(&source, &destination).is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(&directory).expect("no stages").count(), 0);
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn save_as_refuses_directories_without_removing_them() {
        let directory = test_directory("target-dir");
        let source = directory.join("source.txt");
        let destination = directory.join("subdir.txt");
        fs::write(&source, b"source bytes").expect("source");
        fs::create_dir(&destination).expect("destination directory");
        assert!(save_as_new_file(&source, &destination).is_err());
        assert!(destination.is_dir());
        assert_eq!(fs::read(&source).expect("unchanged"), b"source bytes");
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[cfg(unix)]
    #[test]
    fn save_as_refuses_dangling_symlink_destinations() {
        use std::os::unix::fs::symlink;
        let directory = test_directory("dangling-link");
        let source = directory.join("source.txt");
        let destination = directory.join("link.txt");
        fs::write(&source, b"source bytes").expect("source");
        symlink(directory.join("not-present.txt"), &destination).expect("create dangling link");
        assert!(!destination.exists());
        assert!(destination_path(destination.to_string_lossy().as_ref()).is_err());
        assert!(save_as_new_file(&source, &destination).is_err());
        assert!(fs::symlink_metadata(&destination).expect("link retained").file_type().is_symlink());
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn concurrent_save_as_to_same_name_never_overwrites_the_winner() {
        let directory = test_directory("race");
        let first = directory.join("first.txt");
        let second = directory.join("second.txt");
        let destination = directory.join("result.txt");
        fs::write(&first, b"first source").expect("first");
        fs::write(&second, b"second source").expect("second");
        let barrier = Arc::new(Barrier::new(3));
        let workers: Vec<_> = [first, second].into_iter().map(|source| {
            let barrier = Arc::clone(&barrier);
            let destination = destination.clone();
            thread::spawn(move || {
                barrier.wait();
                save_as_new_file(&source, &destination)
            })
        }).collect();
        barrier.wait();
        let outcomes: Vec<_> = workers.into_iter()
            .map(|worker| worker.join().expect("copy thread")).collect();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        let actual = fs::read(&destination).expect("complete winning file");
        assert!(actual == b"first source" || actual == b"second source");
        assert_eq!(fs::read_dir(&directory).expect("read directory").count(), 3);
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn rejects_path_like_staging_tokens() {
        assert!(validate_staging_token("doc-123-abc").is_ok());
        assert!(validate_staging_token("../escape").is_err());
        assert!(validate_staging_token("bad/token").is_err());
    }
}
