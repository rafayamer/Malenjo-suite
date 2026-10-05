use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use super::library::resolve_library_document_path;

const AUDIT_VERSION: u32 = 1;
const MAX_AUDIT_EVENTS: usize = 250;
const MAX_DETAIL_CHARS: usize = 1600;
const CLAMAV_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Default)]
pub struct SecurityState {
    secrets: Mutex<HashMap<String, Zeroizing<String>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub version: u32,
    pub timestamp_ms: u64,
    pub action: String,
    pub severity: String,
    pub target: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterStatus {
    pub available: bool,
    pub version: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MalwareScanResult {
    pub clean: bool,
    pub infected: bool,
    pub engine: String,
    pub output: String,
    pub elapsed_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureValidationResult {
    pub valid_command: bool,
    pub output: String,
    pub elapsed_ms: u64,
}

pub fn security_baseline() -> &'static [&'static str] {
    &[
        "localhost-only services",
        "signed updates",
        "least privilege",
        "ephemeral zeroized signing secrets",
        "integrity checks",
        "append-only audit events",
    ]
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn audit_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve MALENJO app data directory: {error}"))?
        .join("security");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create MALENJO security directory: {error}"))?;
    Ok(dir.join("audit-v1.jsonl"))
}

fn truncate(value: String, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn append_audit(
    app: &AppHandle,
    action: impl Into<String>,
    severity: impl Into<String>,
    target: impl Into<String>,
    detail: impl Into<String>,
) -> Result<AuditEvent, String> {
    let event = AuditEvent {
        version: AUDIT_VERSION,
        timestamp_ms: now_ms(),
        action: truncate(action.into(), 120),
        severity: truncate(severity.into(), 32),
        target: truncate(target.into(), 260),
        detail: truncate(detail.into().replace(['\r', '\n'], " "), MAX_DETAIL_CHARS),
    };
    let mut line = serde_json::to_vec(&event)
        .map_err(|error| format!("Unable to serialize security audit event: {error}"))?;
    line.push(b'\n');

    let path = audit_path(app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Unable to open security audit log: {error}"))?;
    file.write_all(&line)
        .map_err(|error| format!("Unable to append security audit event: {error}"))?;
    let _ = file.sync_data();
    Ok(event)
}

#[tauri::command]
pub fn record_audit_event(
    app: AppHandle,
    action: String,
    severity: String,
    target: String,
    detail: String,
) -> Result<AuditEvent, String> {
    append_audit(&app, action, severity, target, detail)
}

#[tauri::command]
pub fn list_audit_events(app: AppHandle) -> Result<Vec<AuditEvent>, String> {
    let path = audit_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read security audit log: {error}"))?;

    let mut events: Vec<AuditEvent> = text
        .lines()
        .filter_map(|line| serde_json::from_str::<AuditEvent>(line).ok())
        .collect();
    if events.len() > MAX_AUDIT_EVENTS {
        events.drain(0..events.len() - MAX_AUDIT_EVENTS);
    }
    events.reverse();
    Ok(events)
}

#[tauri::command]
pub fn store_ephemeral_secret(
    state: State<'_, SecurityState>,
    secret: String,
) -> Result<String, String> {
    if secret.len() > 4096 {
        return Err("Secret exceeds the MALENJO ephemeral secret limit.".into());
    }
    let token = format!("secret-{:x}", SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos());
    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| "MALENJO secret store is unavailable.".to_string())?;
    secrets.insert(token.clone(), Zeroizing::new(secret));
    Ok(token)
}

#[tauri::command]
pub fn clear_ephemeral_secret(
    state: State<'_, SecurityState>,
    token: String,
) -> Result<bool, String> {
    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| "MALENJO secret store is unavailable.".to_string())?;
    Ok(secrets.remove(&token).is_some())
}

fn command_with_clean_env(program: &str) -> Command {
    let mut command = Command::new(program);
    let path = env::var_os("PATH");
    command.env_clear();
    if let Some(path) = path {
        command.env("PATH", path);
    }
    command
}

fn run_bounded(mut command: Command, timeout: Duration) -> Result<(i32, String, String, u64), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start isolated security adapter: {error}"))?;

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Unable to poll isolated security adapter: {error}"))?
        {
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stdout.take() {
                let _ = pipe.read_to_string(&mut stdout);
            }
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            return Ok((
                status.code().unwrap_or(-1),
                truncate(stdout, 24_000),
                truncate(stderr, 8_000),
                started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            ));
        }

        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Security adapter exceeded its execution timeout and was terminated.".into());
        }
        thread::sleep(Duration::from_millis(80));
    }
}

#[tauri::command]
pub fn clamav_status() -> AdapterStatus {
    let mut command = command_with_clean_env("clamscan");
    command.arg("--version");
    match run_bounded(command, Duration::from_secs(8)) {
        Ok((0, stdout, stderr, _)) => AdapterStatus {
            available: true,
            version: truncate(stdout.trim().to_string(), 200),
            detail: truncate(stderr.trim().to_string(), 400),
        },
        Ok((code, stdout, stderr, _)) => AdapterStatus {
            available: false,
            version: String::new(),
            detail: format!("clamscan exited with {code}: {} {}", stdout.trim(), stderr.trim()),
        },
        Err(error) => AdapterStatus {
            available: false,
            version: String::new(),
            detail: error,
        },
    }
}

#[tauri::command]
pub fn clamav_scan_document(
    app: AppHandle,
    document_id: String,
) -> Result<MalwareScanResult, String> {
    let path = resolve_library_document_path(&app, &document_id)?;
    let mut command = command_with_clean_env("clamscan");
    command
        .arg("--no-summary")
        .arg("--infected")
        .arg("--stdout")
        .arg("--")
        .arg(&path);

    let (code, stdout, stderr, elapsed_ms) = run_bounded(command, CLAMAV_TIMEOUT)?;
    let infected = code == 1;
    let clean = code == 0;
    if !clean && !infected {
        let detail = format!("ClamAV error code {code}: {} {}", stdout.trim(), stderr.trim());
        let _ = append_audit(&app, "malware-scan", "error", path.display().to_string(), detail.clone());
        return Err(detail);
    }

    let output = if stdout.trim().is_empty() { stderr } else { stdout };
    let _ = append_audit(
        &app,
        "malware-scan",
        if infected { "high" } else { "info" },
        path.display().to_string(),
        if infected { "ClamAV reported an infected document." } else { "ClamAV scan completed clean." },
    );

    Ok(MalwareScanResult {
        clean,
        infected,
        engine: "ClamAV clamscan".into(),
        output,
        elapsed_ms,
    })
}

#[tauri::command]
pub fn pyhanko_status() -> AdapterStatus {
    let mut command = command_with_clean_env("pyhanko");
    command.arg("--version");
    match run_bounded(command, Duration::from_secs(8)) {
        Ok((0, stdout, stderr, _)) => AdapterStatus {
            available: true,
            version: truncate(stdout.trim().to_string(), 200),
            detail: truncate(stderr.trim().to_string(), 400),
        },
        Ok((code, stdout, stderr, _)) => AdapterStatus {
            available: false,
            version: String::new(),
            detail: format!("pyHanko exited with {code}: {} {}", stdout.trim(), stderr.trim()),
        },
        Err(error) => AdapterStatus {
            available: false,
            version: String::new(),
            detail: error,
        },
    }
}

#[tauri::command]
pub fn pyhanko_validate_document(
    app: AppHandle,
    document_id: String,
) -> Result<SignatureValidationResult, String> {
    let path = resolve_library_document_path(&app, &document_id)?;
    let mut command = command_with_clean_env("pyhanko");
    command
        .arg("sign")
        .arg("validate")
        .arg("--pretty-print")
        .arg("--")
        .arg(&path);

    let (code, stdout, stderr, elapsed_ms) = run_bounded(command, Duration::from_secs(45))?;
    let output = format!("{}{}", stdout, stderr);
    let _ = append_audit(
        &app,
        "signature-validation",
        if code == 0 { "info" } else { "warning" },
        path.display().to_string(),
        format!("pyHanko validation exit code {code}."),
    );

    Ok(SignatureValidationResult {
        valid_command: code == 0,
        output: truncate(output, 28_000),
        elapsed_ms,
    })
}

fn validate_regular_file(path: &str, label: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Unable to inspect {label}: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} must be a regular non-symbolic-link file."));
    }
    fs::canonicalize(candidate)
        .map_err(|error| format!("Unable to canonicalize {label}: {error}"))
}

fn validate_output_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "Signing destination has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("Signing destination directory does not exist.".into());
    }
    if candidate.exists() {
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|error| format!("Unable to inspect signing destination: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Signing destination must be a regular non-symbolic-link file.".into());
        }
    }
    Ok(candidate)
}

const PYHANKO_SIGN_SCRIPT: &str = r#"
import sys
from pyhanko.sign import signers
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

source, destination, pfx = sys.argv[1:4]
passphrase = sys.stdin.buffer.read().rstrip(b"\r\n") or None
signer = signers.SimpleSigner.load_pkcs12(pfx, passphrase=passphrase)
if signer is None:
    raise SystemExit("Unable to load PKCS#12 signing identity")
meta = signers.PdfSignatureMetadata(field_name="MALENJOSignature")
with open(source, "rb") as inf:
    writer = IncrementalPdfFileWriter(inf)
    pdf_signer = signers.PdfSigner(meta, signer=signer)
    with open(destination, "wb") as outf:
        pdf_signer.sign_pdf(writer, output=outf)
"#;

#[tauri::command]
pub fn pyhanko_sign_copy(
    app: AppHandle,
    state: State<'_, SecurityState>,
    document_id: String,
    pkcs12_path: String,
    secret_token: String,
    destination: String,
) -> Result<bool, String> {
    let source = resolve_library_document_path(&app, &document_id)?;
    let identity = validate_regular_file(&pkcs12_path, "PKCS#12 identity")?;
    let destination = validate_output_path(&destination)?;

    let secret = {
        let mut secrets = state
            .secrets
            .lock()
            .map_err(|_| "MALENJO secret store is unavailable.".to_string())?;
        secrets
            .remove(&secret_token)
            .ok_or_else(|| "Signing secret token is unavailable or already consumed.".to_string())?
    };

    let python = if cfg!(target_os = "windows") { "python" } else { "python3" };
    let mut command = command_with_clean_env(python);
    command
        .arg("-c")
        .arg(PYHANKO_SIGN_SCRIPT)
        .arg(&source)
        .arg(&destination)
        .arg(&identity)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start pyHanko signing worker: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(secret.as_bytes())
            .map_err(|error| format!("Unable to supply signing secret to pyHanko: {error}"))?;
    }

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Unable to poll pyHanko signing worker: {error}"))?
        {
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stdout.take() {
                let _ = pipe.read_to_string(&mut stdout);
            }
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            let success = status.success();
            let _ = append_audit(
                &app,
                "pdf-sign",
                if success { "info" } else { "error" },
                source.display().to_string(),
                if success {
                    format!("Signed copy created at {}.", destination.display())
                } else {
                    format!("pyHanko signing failed: {}", truncate(stderr.clone(), 600))
                },
            );
            if success {
                return Ok(true);
            }
            let _ = fs::remove_file(&destination);
            return Err(format!(
                "pyHanko signing failed: {} {}",
                truncate(stdout, 1000),
                truncate(stderr, 3000)
            ));
        }
        if started.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&destination);
            let _ = append_audit(
                &app,
                "pdf-sign",
                "error",
                source.display().to_string(),
                "pyHanko signing exceeded the 90 second timeout.",
            );
            return Err("pyHanko signing timed out and was terminated.".into());
        }
        thread::sleep(Duration::from_millis(80));
    }
}

#[cfg(test)]
mod tests {
    use super::{security_baseline, truncate, AUDIT_VERSION, MAX_AUDIT_EVENTS};

    #[test]
    fn baseline_keeps_secret_and_audit_controls() {
        let baseline = security_baseline();
        assert!(baseline.iter().any(|item| item.contains("zeroized")));
        assert!(baseline.iter().any(|item| item.contains("audit")));
    }

    #[test]
    fn audit_contract_is_versioned_and_bounded() {
        assert_eq!(AUDIT_VERSION, 1);
        assert!(MAX_AUDIT_EVENTS <= 500);
        assert_eq!(truncate("abcdef".into(), 3), "abc");
    }
}
