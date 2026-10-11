use std::{fs, io::Read, path::{Path, PathBuf}};
use tauri::{ipc::Response, AppHandle};

use super::library::resolve_library_document_path;

const MAX_OFFICE_BYTES: u64 = 256 * 1024 * 1024;

fn validate_ooxml(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect Office document: {error}"))?;

    if !metadata.is_file() {
        return Err("The selected Office document is not a regular file.".into());
    }
    if metadata.len() == 0 {
        return Err("The selected Office document is empty.".into());
    }
    if metadata.len() > MAX_OFFICE_BYTES {
        return Err(format!(
            "The selected Office document exceeds the Phase 3 safety limit of {} MB.",
            MAX_OFFICE_BYTES / (1024 * 1024)
        ));
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("Unable to open Office document: {error}"))?;
    let mut header = [0u8; 4];
    file.read_exact(&mut header)
        .map_err(|error| format!("Unable to read Office document header: {error}"))?;

    if &header != b"PK\x03\x04" && &header != b"PK\x05\x06" && &header != b"PK\x07\x08" {
        return Err("The selected file is not an OOXML ZIP package.".into());
    }

    Ok(metadata.len())
}

fn validate_destination(destination: &str) -> Result<PathBuf, String> {
    if destination.trim().is_empty() {
        return Err("Destination path is empty.".into());
    }

    let path = PathBuf::from(destination);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect destination: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Refusing to overwrite a symbolic-link destination.".into());
        }
        if !metadata.is_file() {
            return Err("Destination is not a regular file.".into());
        }
    }

    let parent = path.parent()
        .ok_or_else(|| "Destination has no parent folder.".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err("Destination folder does not exist.".into());
    }

    Ok(path)
}

#[tauri::command]
pub fn read_office_document(app: AppHandle, document_id: String) -> Result<Response, String> {
    let path = resolve_library_document_path(&app, &document_id)?;
    validate_ooxml(&path)?;
    let bytes = fs::read(path)
        .map_err(|error| format!("Unable to read Office document: {error}"))?;
    Ok(Response::new(bytes))
}

/// Publish an Office export only under a NEW filename. Never remove the
/// destination as a fallback: Save Copy must not be able to destroy an original.
fn write_office_new_copy(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Office export destination has no parent directory.")?;
    let temp = parent.join(format!(
        ".malenjo-office-{}-{:x}.tmp",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default().as_nanos()
    ));
    let mut staged = fs::OpenOptions::new().create_new(true).write(true).open(&temp)
        .map_err(|error| format!("Unable to stage Office export: {error}"))?;
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        staged.write_all(bytes)?;
        staged.sync_all()?;
        Ok(())
    })();
    drop(staged);
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(format!("Unable to stage Office export: {error}"));
    }
    let committed = fs::hard_link(&temp, path);
    if let Err(error) = committed {
        let _ = fs::remove_file(&temp);
        return Err(format!("Office export destination must not exist and must support safe copy creation: {error}"));
    }
    fs::remove_file(&temp)
        .map_err(|error| format!("Office export saved, but temporary staged link could not be removed: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn write_office_copy(destination: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.is_empty() {
        return Err("Refusing to write an empty Office document.".into());
    }
    if bytes.len() as u64 > MAX_OFFICE_BYTES {
        return Err("Generated Office document exceeds the Phase 3 safety limit.".into());
    }
    if bytes.len() < 4 || (&bytes[..4] != b"PK\x03\x04" && &bytes[..4] != b"PK\x05\x06") {
        return Err("Generated content is not an OOXML ZIP package.".into());
    }

    let path = validate_destination(&destination)?;
    write_office_new_copy(&path, &bytes)?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{validate_destination, validate_ooxml, write_office_new_copy, MAX_OFFICE_BYTES};
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("malenjo-office-{nonce}-{name}"))
    }

    #[test]
    fn accepts_zip_signature_for_ooxml() {
        let path = temp_path("fixture.docx");
        fs::write(&path, b"PK\x03\x04synthetic").expect("write fixture");
        assert!(validate_ooxml(&path).is_ok());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_non_zip_office_file() {
        let path = temp_path("fake.docx");
        fs::write(&path, b"not-ooxml").expect("write fixture");
        assert!(validate_ooxml(&path).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn office_payload_is_bounded() {
        assert_eq!(MAX_OFFICE_BYTES, 256 * 1024 * 1024);
    }

    #[test]
    fn copy_rejects_existing_file_and_preserves_bytes() {
        let path = temp_path("existing-copy.docx");
        fs::write(&path, b"existing").expect("write existing destination");
        assert!(write_office_new_copy(&path, b"PK\x03\x04updated").is_err());
        assert_eq!(fs::read(&path).expect("read original"), b"existing");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn copy_creates_new_complete_office_file() {
        let path = temp_path("new-copy.docx");
        write_office_new_copy(&path, b"PK\x03\x04payload").expect("write copy");
        assert_eq!(fs::read(&path).expect("read new copy"), b"PK\x03\x04payload");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn destination_requires_existing_parent() {
        assert!(validate_destination("").is_err());
    }
}
