use reqwest::{multipart, redirect::Policy, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const STIRLING_PORT: u16 = 28970;
const STIRLING_BASE_URL: &str = "http://127.0.0.1:28970";
const STIRLING_HEALTH_PATH: &str = "/api/v1/info/health";
const STIRLING_OPENAPI_PATH: &str = "/v1/api-docs";
const START_TIMEOUT: Duration = Duration::from_secs(75);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_INPUT_BYTES: usize = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 512 * 1024 * 1024;

fn process_slot() -> &'static Mutex<Option<Child>> {
    static SLOT: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StirlingCoreStatus {
    pub installed: bool,
    pub running: bool,
    pub java: Option<String>,
    pub jar_path: Option<String>,
    pub base_url: String,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StirlingComponentStatus {
    pub id: String,
    pub available: bool,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StirlingFormField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StirlingInputFile {
    pub field: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StirlingResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub content_disposition: Option<String>,
    pub bytes: Vec<u8>,
}

fn java_candidates(app: &AppHandle) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(value) = env::var("MALENJO_JAVA_BIN") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = if cfg!(windows) {
            resource_dir.join("runtime/java/bin/java.exe")
        } else {
            resource_dir.join("runtime/java/bin/java")
        };
        if bundled.is_file() {
            candidates.push(bundled.to_string_lossy().to_string());
        }
    }

    if cfg!(windows) {
        candidates.push("java.exe".into());
        candidates.push("java".into());
    } else {
        candidates.push("java".into());
    }

    candidates
}

fn available_java(app: &AppHandle) -> Option<String> {
    java_candidates(app).into_iter().find(|candidate| {
        Command::new(candidate)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
}

fn candidate_jar_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(value) = env::var("MALENJO_STIRLING_JAR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            paths.push(PathBuf::from(trimmed));
        }
    }

    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../provider-packs/stirling-core/stirling-pdf.jar"),
    );

    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join("provider-packs/stirling-core/stirling-pdf.jar"));
    }

    paths
}

fn stirling_jar_path(app: &AppHandle) -> Option<PathBuf> {
    candidate_jar_paths(app)
        .into_iter()
        .find(|path| path.is_file())
}

fn qpdf_candidates(app: &AppHandle) -> Vec<(String, String)> {
    let mut candidates = Vec::new();

    if let Ok(value) = env::var("MALENJO_QPDF_BIN") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let configured = PathBuf::from(trimmed);
            if configured.is_file() {
                if let Ok(canonical) = configured.canonicalize() {
                    candidates.push((canonical.to_string_lossy().to_string(), "configured".into()));
                }
            }
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../provider-packs/qpdf/runtime/bin/qpdf.exe");
    if development.is_file() {
        candidates.push((development.to_string_lossy().to_string(), "bundled".into()));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("provider-packs/qpdf/runtime/bin/qpdf.exe");
        if bundled.is_file() {
            candidates.push((bundled.to_string_lossy().to_string(), "bundled".into()));
        }
    }

    candidates
}

fn parse_qpdf_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| {
            let mut chars = token.chars();
            chars.next().is_some_and(|ch| ch.is_ascii_digit())
                && token.chars().any(|ch| ch == '.')
        })
        .map(|token| token.trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '.').to_string())
        .filter(|value| !value.is_empty())
}

fn available_qpdf(app: &AppHandle) -> Option<(String, String, String)> {
    for (candidate, source) in qpdf_candidates(app) {
        let output = Command::new(&candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .output();
        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if let Some(version) = parse_qpdf_version(&combined) {
            return Some((candidate, source, version));
        }
    }
    None
}

fn qpdf_component_status(app: &AppHandle) -> StirlingComponentStatus {
    if let Some((executable, source, version)) = available_qpdf(app) {
        let supported = version
            .split('.')
            .next()
            .and_then(|major| major.parse::<u32>().ok())
            .is_some_and(|major| major >= 12);
        if supported {
            return StirlingComponentStatus {
                id: "qpdf".into(),
                available: true,
                version: Some(version.clone()),
                executable: Some(executable),
                source,
                message: format!("qpdf {version} is available for local PDF repair/compression."),
            };
        }
        return StirlingComponentStatus {
            id: "qpdf".into(),
            available: false,
            version: Some(version.clone()),
            executable: Some(executable),
            source,
            message: format!("qpdf {version} is below the pinned Stirling minimum 12.0.0."),
        };
    }

    StirlingComponentStatus {
        id: "qpdf".into(),
        available: false,
        version: None,
        executable: None,
        source: "unavailable".into(),
        message: "The approved qpdf component pack is not installed.".into(),
    }
}

fn tesseract_candidates(app: &AppHandle) -> Vec<(String, String)> {
    let mut candidates = Vec::new();

    if let Ok(value) = env::var("MALENJO_TESSERACT_BIN") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let configured = PathBuf::from(trimmed);
            if configured.is_file() {
                if let Ok(canonical) = configured.canonicalize() {
                    candidates.push((canonical.to_string_lossy().to_string(), "configured".into()));
                }
            }
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../provider-packs/tesseract/runtime/bin/tesseract.exe");
    if development.is_file() {
        candidates.push((development.to_string_lossy().to_string(), "bundled".into()));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("provider-packs/tesseract/runtime/bin/tesseract.exe");
        if bundled.is_file() {
            candidates.push((bundled.to_string_lossy().to_string(), "bundled".into()));
        }
    }

    candidates
}

fn parse_tesseract_version(output: &str) -> Option<String> {
    let first_line = output.lines().find(|line| !line.trim().is_empty())?.trim();
    let mut parts = first_line.split_whitespace();
    if !parts.next()?.eq_ignore_ascii_case("tesseract") {
        return None;
    }
    let token = parts.next()?.trim_start_matches(['v', 'V']);
    let version = token
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect::<String>();
    if version.starts_with(|ch: char| ch.is_ascii_digit()) && version.contains('.') {
        Some(version)
    } else {
        None
    }
}

fn tesseract_data_dir(executable: &str) -> Option<(PathBuf, bool)> {
    if let Ok(value) = env::var("MALENJO_TESSDATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let configured = PathBuf::from(trimmed);
            if configured.join("eng.traineddata").is_file()
                && configured.join("osd.traineddata").is_file()
            {
                if let Ok(canonical) = configured.canonicalize() {
                    return Some((canonical, true));
                }
            }
        }
    }

    let executable = PathBuf::from(executable);
    let parent = executable.parent()?;
    let mut candidates = vec![parent.join("tessdata")];
    if let Some(runtime) = parent.parent() {
        candidates.push(runtime.join("tessdata"));
    }
    candidates.into_iter().find_map(|path| {
        if path.join("eng.traineddata").is_file() && path.join("osd.traineddata").is_file() {
            Some((path, false))
        } else {
            None
        }
    })
}

fn available_tesseract(app: &AppHandle) -> Option<(String, String, String, PathBuf)> {
    for (candidate, source) in tesseract_candidates(app) {
        let output = Command::new(&candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .output();
        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let Some(version) = parse_tesseract_version(&combined) else {
            continue;
        };
        let Some((tessdata, tessdata_configured)) = tesseract_data_dir(&candidate) else {
            continue;
        };
        let resolved_source = if tessdata_configured {
            "configured".to_string()
        } else {
            source
        };
        return Some((candidate, resolved_source, version, tessdata));
    }
    None
}

fn tesseract_component_status(app: &AppHandle) -> StirlingComponentStatus {
    if let Some((executable, source, version, tessdata)) = available_tesseract(app) {
        let supported = version
            .split('.')
            .next()
            .and_then(|major| major.parse::<u32>().ok())
            .is_some_and(|major| major >= 5);
        if supported {
            return StirlingComponentStatus {
                id: "tesseract".into(),
                available: true,
                version: Some(version.clone()),
                executable: Some(executable),
                source,
                message: format!(
                    "Tesseract {version} is available with reviewed eng/osd data at {}.",
                    tessdata.display()
                ),
            };
        }
        return StirlingComponentStatus {
            id: "tesseract".into(),
            available: false,
            version: Some(version.clone()),
            executable: Some(executable),
            source,
            message: format!("Tesseract {version} is below the reviewed 5.x provider floor."),
        };
    }

    StirlingComponentStatus {
        id: "tesseract".into(),
        available: false,
        version: None,
        executable: None,
        source: "unavailable".into(),
        message: "The reviewed Tesseract pack with eng/osd model data is not installed.".into(),
    }
}

fn set_reviewed_provider_path(command: &mut Command, mut paths: Vec<PathBuf>) -> Result<(), String> {
    paths.sort();
    paths.dedup();
    let joined = env::join_paths(paths)
        .map_err(|error| format!("Unable to construct reviewed local provider PATH: {error}"))?;
    command.env("PATH", joined);
    Ok(())
}

fn configure_provider_environment(command: &mut Command, app: &AppHandle) -> Result<(), String> {
    let mut paths = Vec::new();

    if let Some((executable, _source, _version)) = available_qpdf(app) {
        let executable_path = PathBuf::from(executable);
        let parent = executable_path
            .parent()
            .ok_or_else(|| "qpdf executable has no parent directory.".to_string())?;
        paths.push(parent.to_path_buf());
    }

    if let Some((executable, _source, _version, tessdata)) = available_tesseract(app) {
        let executable_path = PathBuf::from(executable);
        let parent = executable_path
            .parent()
            .ok_or_else(|| "Tesseract executable has no parent directory.".to_string())?;
        paths.push(parent.to_path_buf());
        command.env("TESSDATA_PREFIX", tessdata);
    } else {
        command.env_remove("TESSDATA_PREFIX");
    }

    set_reviewed_provider_path(command, paths)
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Unable to create local Stirling client: {error}"))
}

fn validate_api_path(path: &str) -> Result<String, String> {
    if !path.starts_with("/api/v1/") {
        return Err("Only Stirling core /api/v1/* paths may be called.".into());
    }
    if path.contains("://") || path.contains("..") || path.contains('\\') || path.contains('\0') {
        return Err("Invalid Stirling API path.".into());
    }
    if path.len() > 512 {
        return Err("Stirling API path is too long.".into());
    }
    Ok(format!("{STIRLING_BASE_URL}{path}"))
}

async fn health_payload() -> Option<Value> {
    let client = api_client().ok()?;
    let response = client
        .get(format!("{STIRLING_BASE_URL}{STIRLING_HEALTH_PATH}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

async fn is_healthy() -> bool {
    health_payload()
        .await
        .and_then(|value| value.get("status").and_then(Value::as_str).map(str::to_owned))
        .is_some_and(|status| status.eq_ignore_ascii_case("UP"))
}

fn version_from_health(value: &Value) -> Option<String> {
    ["version", "buildVersion", "implementationVersion"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_owned))
}

fn process_running() -> bool {
    let Ok(mut guard) = process_slot().lock() else {
        return false;
    };
    let Some(child) = guard.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            *guard = None;
            false
        }
    }
}

#[cfg(windows)]
fn suppress_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_windows_console(_command: &mut Command) {}

fn spawn_core(java: &str, jar: &Path, app: &AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve MALENJO data directory: {error}"))?
        .join("stirling-core");
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Unable to create Stirling core data directory: {error}"))?;

    let mut command = Command::new(java);
    command
        .arg("-Xms128m")
        .arg("-Xmx1536m")
        .arg("-jar")
        .arg(jar)
        .arg(format!("--server.address=127.0.0.1"))
        .arg(format!("--server.port={STIRLING_PORT}"))
        .arg("--spring.main.banner-mode=off")
        .env("STIRLING_FLAVOR", "core")
        .env("DISABLE_ADDITIONAL_FEATURES", "true")
        .env("ENABLE_SAAS", "false")
        .env("DOCKER_ENABLE_SECURITY", "false")
        .env("SYSTEM_CUSTOMHTMLFILES", "false")
        .env("STIRLING_HOME", &data_dir)
        .current_dir(&data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_provider_environment(&mut command, app)?;
    suppress_windows_console(&mut command);

    let child = command
        .spawn()
        .map_err(|error| format!("Unable to start the local Stirling core provider: {error}"))?;

    let mut guard = process_slot()
        .lock()
        .map_err(|_| "Unable to lock Stirling core process state.".to_string())?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub async fn stirling_core_status(app: AppHandle) -> StirlingCoreStatus {
    let jar = stirling_jar_path(&app);
    let java = available_java(&app);
    let health = health_payload().await;
    let healthy = health
        .as_ref()
        .and_then(|value| value.get("status").and_then(Value::as_str))
        .is_some_and(|value| value.eq_ignore_ascii_case("UP"));
    let child_running = process_running();

    let message = if healthy {
        "Local Stirling open-core PDF provider is ready.".to_string()
    } else if jar.is_none() {
        "The local Stirling core provider pack is not installed. Build or install the reviewed core pack before using provider-backed PDF tools.".to_string()
    } else if java.is_none() {
        "The Stirling core pack is installed, but no Java 25 runtime is available.".to_string()
    } else if child_running {
        "The local Stirling core provider process is starting or unhealthy.".to_string()
    } else {
        "The local Stirling core provider is installed but stopped.".to_string()
    };

    StirlingCoreStatus {
        installed: jar.is_some(),
        running: healthy,
        java,
        jar_path: jar.map(|path| path.to_string_lossy().to_string()),
        base_url: STIRLING_BASE_URL.into(),
        version: health.as_ref().and_then(version_from_health),
        message,
    }
}

#[tauri::command]
pub async fn stirling_core_components(app: AppHandle) -> Vec<StirlingComponentStatus> {
    vec![qpdf_component_status(&app), tesseract_component_status(&app)]
}

#[tauri::command]
pub async fn stirling_core_start(app: AppHandle) -> Result<StirlingCoreStatus, String> {
    if is_healthy().await {
        return Ok(stirling_core_status(app).await);
    }

    if process_running() {
        let started = Instant::now();
        while started.elapsed() < START_TIMEOUT {
            if is_healthy().await {
                return Ok(stirling_core_status(app).await);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        return Err("The existing Stirling core process did not become healthy within 75 seconds.".into());
    }

    let jar = stirling_jar_path(&app)
        .ok_or_else(|| "Stirling core provider pack is not installed.".to_string())?;
    let java = available_java(&app)
        .ok_or_else(|| "Java 25 is not available for the local Stirling core provider.".to_string())?;

    spawn_core(&java, &jar, &app)?;

    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if is_healthy().await {
            return Ok(stirling_core_status(app).await);
        }

        if !process_running() {
            return Err("The local Stirling core provider exited before becoming healthy.".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let _ = stirling_core_stop().await;
    Err("The local Stirling core provider exceeded the 75 second startup timeout.".into())
}

#[tauri::command]
pub async fn stirling_core_stop() -> Result<bool, String> {
    let mut guard = process_slot()
        .lock()
        .map_err(|_| "Unable to lock Stirling core process state.".to_string())?;
    let Some(child) = guard.as_mut() else {
        return Ok(false);
    };
    let _ = child.kill();
    let _ = child.wait();
    *guard = None;
    Ok(true)
}

#[tauri::command]
pub async fn stirling_core_openapi(app: AppHandle) -> Result<Value, String> {
    let _ = stirling_core_start(app).await?;
    let client = api_client()?;
    let response = client
        .get(format!("{STIRLING_BASE_URL}{STIRLING_OPENAPI_PATH}"))
        .send()
        .await
        .map_err(|error| format!("Unable to read local Stirling OpenAPI catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Local Stirling OpenAPI catalog returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Local Stirling OpenAPI catalog returned invalid JSON: {error}"))
}

#[tauri::command]
pub async fn stirling_core_request(
    app: AppHandle,
    method: String,
    path: String,
    fields: Vec<StirlingFormField>,
    files: Vec<StirlingInputFile>,
) -> Result<StirlingResponse, String> {
    let _ = stirling_core_start(app).await?;
    let url = validate_api_path(&path)?;
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err("Only GET and POST are allowed for local Stirling core requests.".into()),
    };

    let total_input = files
        .iter()
        .try_fold(0usize, |total, file| total.checked_add(file.bytes.len()))
        .ok_or_else(|| "Stirling request input size overflow.".to_string())?;
    if total_input > MAX_INPUT_BYTES {
        return Err("Stirling request exceeds the 512 MB aggregate input safety limit.".into());
    }
    if files.iter().any(|file| file.field.len() > 128 || file.filename.len() > 512) {
        return Err("Stirling request contains an invalid file field or filename.".into());
    }
    if fields.iter().any(|field| field.name.len() > 128 || field.value.len() > 1_000_000) {
        return Err("Stirling request contains an invalid or oversized form field.".into());
    }

    let client = api_client()?;
    let mut request = client.request(method.clone(), url);

    if method == Method::POST {
        let mut form = multipart::Form::new();
        for field in fields {
            form = form.text(field.name, field.value);
        }
        for file in files {
            let mut part = multipart::Part::bytes(file.bytes).file_name(file.filename);
            if let Some(content_type) = file.content_type {
                part = part
                    .mime_str(&content_type)
                    .map_err(|error| format!("Invalid local Stirling upload content type: {error}"))?;
            }
            form = form.part(file.field, part);
        }
        request = request.multipart(form);
    } else if !fields.is_empty() {
        request = request.query(
            &fields
                .iter()
                .map(|field| (field.name.as_str(), field.value.as_str()))
                .collect::<Vec<_>>(),
        );
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Local Stirling request failed: {error}"))?;

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let content_disposition = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    if response.content_length().is_some_and(|length| length > MAX_OUTPUT_BYTES as u64) {
        return Err("Local Stirling response exceeds the 512 MB output safety limit.".into());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Unable to read local Stirling response: {error}"))?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err("Local Stirling response exceeds the 512 MB output safety limit.".into());
    }

    if !(200..300).contains(&status) {
        let body = String::from_utf8_lossy(&bytes);
        let compact = body.chars().take(2000).collect::<String>();
        return Err(format!("Local Stirling tool returned HTTP {status}: {compact}"));
    }

    Ok(StirlingResponse {
        status,
        content_type,
        content_disposition,
        bytes: bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        parse_qpdf_version, parse_tesseract_version, set_reviewed_provider_path, validate_api_path,
        MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, STIRLING_BASE_URL, STIRLING_PORT,
    };
    use std::{path::PathBuf, process::Command};

    #[test]
    fn stirling_proxy_accepts_only_local_v1_paths() {
        assert_eq!(
            validate_api_path("/api/v1/general/merge-pdfs").unwrap(),
            format!("{STIRLING_BASE_URL}/api/v1/general/merge-pdfs")
        );
        assert!(validate_api_path("https://example.com/api/v1/test").is_err());
        assert!(validate_api_path("/api/v1/../admin").is_err());
        assert!(validate_api_path("/v3/api-docs").is_err());
    }

    #[test]
    fn qpdf_version_parser_requires_a_numeric_version_token() {
        assert_eq!(parse_qpdf_version("qpdf version 12.4.2"), Some("12.4.2".into()));
        assert_eq!(parse_qpdf_version("qpdf version unknown"), None);
    }

    #[test]
    fn tesseract_version_parser_requires_a_numeric_version_token() {
        assert_eq!(parse_tesseract_version("tesseract 5.5.3\n leptonica-1.85"), Some("5.5.3".into()));
        assert_eq!(parse_tesseract_version("tesseract v5.5.3.20260724\n leptonica-1.87.0"), Some("5.5.3.20260724".into()));
        assert_eq!(parse_tesseract_version("libgif 5.2.2\ntesseract unknown"), None);
    }

    #[test]
    fn provider_path_does_not_inherit_unreviewed_system_tools() {
        let mut command = Command::new("java");
        set_reviewed_provider_path(&mut command, Vec::new()).unwrap();
        let path = command
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        assert!(path.is_empty());
    }

    #[test]
    fn provider_path_contains_only_explicit_reviewed_directories() {
        let mut command = Command::new("java");
        let first = PathBuf::from("reviewed-provider-qpdf/bin");
        let second = PathBuf::from("reviewed-provider-tesseract/bin");
        set_reviewed_provider_path(&mut command, vec![second.clone(), first.clone(), first.clone()]).unwrap();
        let path = command
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .and_then(|(_, value)| value)
            .map(|value| value.to_os_string())
            .unwrap_or_default();
        let parts = std::env::split_paths(&path).collect::<Vec<_>>();
        assert_eq!(parts, vec![first, second]);
    }

    #[test]
    fn stirling_limits_and_port_are_fixed() {
        assert_eq!(STIRLING_PORT, 28970);
        assert_eq!(MAX_INPUT_BYTES, 512 * 1024 * 1024);
        assert_eq!(MAX_OUTPUT_BYTES, 512 * 1024 * 1024);
        assert_eq!(STIRLING_BASE_URL, "http://127.0.0.1:28970");
    }
}
