use std::{fs, io::Read, path::{Path, PathBuf}};
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

#[tauri::command]
pub fn write_pdf_copy(destination: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Generated content does not contain a valid PDF header.".into());
    }
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("Generated PDF exceeds the 512 MB safety limit.".into());
    }

    let path = validate_destination(&destination)?;
    let temp = path.with_extension("malenjo-pdf.tmp");
    fs::write(&temp, &bytes)
        .map_err(|error| format!("Unable to write PDF export: {error}"))?;

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to replace PDF export: {error}"))?;
    }
    fs::rename(&temp, &path)
        .map_err(|error| format!("Unable to finalize PDF export: {error}"))?;

    Ok(true)
}


const MAX_PDF_TOOL_OUTPUT_BYTES: usize = 512 * 1024 * 1024;
const PDF_TOOL_OUTPUT_EXTENSIONS: &[&str] = &[
    "pdf", "zip", "png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp",
    "txt", "csv", "json", "xml", "html", "md",
    "doc", "docx", "odt", "rtf",
    "xls", "xlsx", "ods",
    "ppt", "pptx", "odp",
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
    let temp = path.with_extension("malenjo-tool-output.tmp");
    fs::write(&temp, &bytes)
        .map_err(|error| format!("Unable to write PDF tool output: {error}"))?;

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to replace PDF tool output: {error}"))?;
    }
    fs::rename(&temp, &path)
        .map_err(|error| format!("Unable to finalize PDF tool output: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{validate_destination, validate_pdf_file, validate_tool_output_destination, MAX_PDF_BYTES, MAX_PDF_TOOL_OUTPUT_BYTES};
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
    fn tool_output_blocks_executable_extensions() {
        let allowed = temp_path("output.zip");
        let blocked = temp_path("output.exe");
        assert!(validate_tool_output_destination(allowed.to_string_lossy().as_ref()).is_ok());
        assert!(validate_tool_output_destination(blocked.to_string_lossy().as_ref()).is_err());
        assert_eq!(MAX_PDF_TOOL_OUTPUT_BYTES, 512 * 1024 * 1024);
    }
}
