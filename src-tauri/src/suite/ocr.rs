use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_OCR_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const OCR_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaddleStatus {
    pub available: bool,
    pub python: Option<String>,
    pub worker_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaddleResult {
    pub text: String,
    pub confidence: f64,
}

fn python_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["python", "py", "python3"]
    } else {
        &["python3", "python"]
    }
}

fn available_python() -> Option<String> {
    for candidate in python_candidates() {
        let status = Command::new(candidate)
            .args(["-c", "import sys; print(sys.version_info[0])"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if status.is_ok_and(|value| value.success()) {
            return Some((*candidate).to_string());
        }
    }
    None
}

fn worker_path(app: &AppHandle) -> Option<PathBuf> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../workers/paddleocr/worker.py");
    if dev.is_file() {
        return Some(dev);
    }

    app.path()
        .resource_dir()
        .ok()
        .map(|root| root.join("workers/paddleocr/worker.py"))
        .filter(|path| path.is_file())
}

fn paddle_importable(python: &str) -> bool {
    Command::new(python)
        .args(["-c", "import paddleocr; print('ok')"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|value| value.success())
}

#[tauri::command]
pub fn paddle_ocr_status(app: AppHandle) -> PaddleStatus {
    let python = available_python();
    let worker = worker_path(&app);

    match (python, worker) {
        (Some(python), Some(worker)) if paddle_importable(&python) => PaddleStatus {
            available: true,
            python: Some(python),
            worker_path: Some(worker.to_string_lossy().to_string()),
            message: "Local PaddleOCR worker is available.".into(),
        },
        (Some(python), Some(worker)) => PaddleStatus {
            available: false,
            python: Some(python),
            worker_path: Some(worker.to_string_lossy().to_string()),
            message: "Python is available, but the optional PaddleOCR pack is not installed.".into(),
        },
        (python, worker) => PaddleStatus {
            available: false,
            python,
            worker_path: worker.map(|path| path.to_string_lossy().to_string()),
            message: "The optional local PaddleOCR worker is unavailable.".into(),
        },
    }
}

fn temp_image_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Unable to resolve MALENJO cache directory: {error}"))?
        .join("ocr");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create MALENJO OCR cache directory: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(root.join(format!("job-{nonce}.image")))
}

fn read_pipe(mut pipe: impl Read) -> String {
    let mut value = String::new();
    let _ = pipe.read_to_string(&mut value);
    value
}

#[tauri::command]
pub fn paddle_ocr_image(
    app: AppHandle,
    bytes: Vec<u8>,
    language: Option<String>,
) -> Result<PaddleResult, String> {
    if bytes.is_empty() {
        return Err("OCR image is empty.".into());
    }
    if bytes.len() > MAX_OCR_IMAGE_BYTES {
        return Err("OCR image exceeds the 25 MB worker safety limit.".into());
    }

    let status = paddle_ocr_status(app.clone());
    if !status.available {
        return Err(status.message);
    }

    let python = status.python.ok_or_else(|| "Python executable was not resolved.".to_string())?;
    let worker = status.worker_path.ok_or_else(|| "PaddleOCR worker path was not resolved.".to_string())?;
    let temp = temp_image_path(&app)?;
    fs::write(&temp, &bytes)
        .map_err(|error| format!("Unable to stage OCR image: {error}"))?;

    let mut child = Command::new(&python)
        .arg(&worker)
        .arg("--input")
        .arg(&temp)
        .arg("--lang")
        .arg(language.unwrap_or_else(|| "en".into()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start PaddleOCR worker: {error}"))?;

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child.stdout.take().map(read_pipe).unwrap_or_default();
                let stderr = child.stderr.take().map(read_pipe).unwrap_or_default();
                let _ = fs::remove_file(&temp);

                if !status.success() {
                    return Err(if stderr.trim().is_empty() {
                        "PaddleOCR worker failed.".into()
                    } else {
                        format!("PaddleOCR worker failed: {}", stderr.trim())
                    });
                }

                return serde_json::from_str::<PaddleResult>(stdout.trim())
                    .map_err(|error| format!("PaddleOCR worker returned invalid JSON: {error}"));
            }
            Ok(None) if started.elapsed() < OCR_TIMEOUT => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&temp);
                return Err("PaddleOCR worker exceeded the 120 second job timeout.".into());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = fs::remove_file(&temp);
                return Err(format!("Unable to supervise PaddleOCR worker: {error}"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_OCR_IMAGE_BYTES, OCR_TIMEOUT};

    #[test]
    fn ocr_resource_limits_are_bounded() {
        assert_eq!(MAX_OCR_IMAGE_BYTES, 25 * 1024 * 1024);
        assert_eq!(OCR_TIMEOUT.as_secs(), 120);
    }
}
