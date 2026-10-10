use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use tauri::{ipc::Response, AppHandle};

use super::library::resolve_library_document_path;

const MAX_PDF_BYTES: u64 = 512 * 1024 * 1024;

fn validate_destination(destination: &str) -> Result<PathBuf, String> {
    if destination.trim().is_empty() {
        return Err("Destination path is empty.".into());
    }
    let path = PathBuf::from(destination);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect PDF destination: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Refusing to overwrite a symbolic-link PDF destination.".into());
        }
        if !metadata.is_file() {
            return Err("PDF destination is not a regular file.".into());
        }
    }
    let parent = path.parent()
        .ok_or_else(|| "PDF destination has no parent folder.".to_string())?;
    if !parent.exists() || !parent.is_dir() {
        return Err("PDF destination folder does not exist.".into());
    }
    Ok(path)
}

fn validate_pdf_file(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect PDF: {error}"))?;

    if !metadata.is_file() {
        return Err("The selected PDF is not a regular file.".into());
    }

    if metadata.len() == 0 {
        return Err("The selected PDF is empty.".into());
    }

    if metadata.len() > MAX_PDF_BYTES {
        return Err(format!(
            "The selected PDF is larger than the Phase 2 safety limit of {} MB.",
            MAX_PDF_BYTES / (1024 * 1024)
        ));
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("Unable to open PDF: {error}"))?;
    let mut header = [0u8; 5];
    file.read_exact(&mut header)
        .map_err(|error| format!("Unable to read PDF header: {error}"))?;

    if &header != b"%PDF-" {
        return Err("The selected file does not contain a valid PDF header.".into());
    }

    Ok(metadata.len())
}

#[tauri::command]
pub fn read_pdf_document(app: AppHandle, document_id: String) -> Result<Response, String> {
    let path = resolve_library_document_path(&app, &document_id)?;
    validate_pdf_file(&path)?;

    let bytes = fs::read(&path)
        .map_err(|error| format!("Unable to read PDF document: {error}"))?;

    Ok(Response::new(bytes))
}

static PDF_SAVE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Stage the full export and retain a recoverable copy of any existing file
/// until the new output has been installed. Never delete the prior destination
/// before a successful final rename. Files are staged alongside the destination
/// to avoid cross-filesystem rename failures.
fn write_export_with_recovery(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let sequence = PDF_SAVE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let tag = format!("{}-{}", std::process::id(), sequence);
    let temp = path.with_extension(format!("malenjo-stage-{tag}.tmp"));
    let backup = path.with_extension(format!("malenjo-backup-{tag}.tmp"));

    let staged = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_file(&temp);
        return Err(format!("Unable to safely stage PDF export: {error}"));
    }

    let had_original = path.exists();
    if had_original {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Unable to recheck prior PDF destination: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            let _ = fs::remove_file(&temp);
            return Err("Refusing to replace a symlink or non-file PDF destination.".into());
        }
        if let Err(error) = fs::rename(path, &backup) {
            let _ = fs::remove_file(&temp);
            return Err(format!("Unable to retain prior PDF export: {error}"));
        }
    }

    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        if had_original {
            if let Err(restore_error) = fs::rename(&backup, path) {
                return Err(format!(
                    "Unable to finalize PDF export ({error}) or restore original ({restore_error}). Original remains at {}.",
                    backup.display()
                ));
            }
        }
        return Err(format!("Unable to finalize PDF export; original was preserved: {error}"));
    }

    if had_original {
        // Sensitive source bytes must never be silently left beside a
        // protected or sanitized export. Report their exact retained path.
        if let Err(error) = fs::remove_file(&backup) {
            return Err(format!(
                "PDF export was written, but the previous (potentially unprotected) file remains at {} because cleanup failed ({error}). Remove that backup securely.",
                backup.display()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn write_pdf_copy(destination: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Generated content does not contain a valid PDF header.".into());
    }
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("Generated PDF exceeds the 512 MB safety limit.".into());
    }

    let path = validate_destination(&destination)?;
    write_export_with_recovery(&path, &bytes)?;

    Ok(true)
}


const MAX_PDF_TOOL_OUTPUT_BYTES: usize = 512 * 1024 * 1024;
const PDF_TOOL_OUTPUT_EXTENSIONS: &[&str] = &[
    "pdf", "zip", "png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp",
    "txt", "csv", "json", "xml", "html", "md",
    "doc", "docx", "odt", "rtf",
    "xls", "xlsx", "ods",
    "ppt", "pptx", "odp", "epub", "cbz", "cbr", "svg", "bin",
];

fn validate_tool_output_destination(destination: &str) -> Result<PathBuf, String> {
    let path = validate_destination(destination)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "PDF tool output destination requires a supported file extension.".to_string())?;
    if !PDF_TOOL_OUTPUT_EXTENSIONS.iter().any(|allowed| *allowed == extension) {
        return Err(format!("PDF tool output extension '.{extension}' is not allowed."));
    }
    Ok(path)
}

#[tauri::command]
pub fn write_pdf_tool_output(destination: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.is_empty() {
        return Err("PDF tool output is empty.".into());
    }
    if bytes.len() > MAX_PDF_TOOL_OUTPUT_BYTES {
        return Err("PDF tool output exceeds the 512 MB safety limit.".into());
    }

    let path = validate_tool_output_destination(&destination)?;
    write_export_with_recovery(&path, &bytes)?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{validate_destination, validate_pdf_file, validate_tool_output_destination, write_export_with_recovery, MAX_PDF_BYTES, MAX_PDF_TOOL_OUTPUT_BYTES};
    use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

    fn temp_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("malenjo-{nonce}-{name}"))
    }

    #[test]
    fn accepts_pdf_header() {
        let path = temp_path("valid.pdf");
        fs::write(&path, b"%PDF-1.7\n%%EOF\n").expect("write fixture");
        assert!(validate_pdf_file(&path).is_ok());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_non_pdf_header() {
        let path = temp_path("fake.pdf");
        fs::write(&path, b"not a pdf").expect("write fixture");
        assert!(validate_pdf_file(&path).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn phase_two_pdf_limit_is_bounded() {
        assert_eq!(MAX_PDF_BYTES, 512 * 1024 * 1024);
    }

    #[test]
    fn destination_requires_existing_parent() {
        assert!(validate_destination("").is_err());
    }

    #[test]
    fn native_export_safely_replaces_existing_file() {
        let path = temp_path("recovery.pdf");
        fs::write(&path, b"old bytes").expect("write prior user document");
        write_export_with_recovery(&path, b"%PDF-1.7\nnew\n%%EOF\n")
            .expect("replace output");
        assert_eq!(fs::read(&path).expect("read new output"), b"%PDF-1.7\nnew\n%%EOF\n");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn native_export_rejects_directory_destination_without_removing_it() {
        let path = temp_path("protected.pdf");
        fs::create_dir(&path).expect("create protected destination");
        assert!(write_export_with_recovery(&path, b"new").is_err());
        assert!(path.is_dir());
        let _ = fs::remove_dir(path);
    }

    #[test]
    fn tool_output_allows_document_conversion_formats() {
        for extension in ["epub", "cbz", "cbr", "svg", "docx", "pdf"] {
            let path = temp_path(&format!("converted.{extension}"));
            assert!(validate_tool_output_destination(path.to_string_lossy().as_ref()).is_ok());
        }
    }

    #[test]
    fn tool_output_blocks_executable_extensions() {
        let allowed = temp_path("output.zip");
        let blocked = temp_path("output.exe");
        assert!(validate_tool_output_destination(allowed.to_string_lossy().as_ref()).is_ok());
        assert!(validate_tool_output_destination(blocked.to_string_lossy().as_ref()).is_err());
        assert_eq!(MAX_PDF_TOOL_OUTPUT_BYTES, 512 * 1024 * 1024);
    }
}
