use reqwest::{multipart, redirect::Policy, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env,
    io::Read,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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

struct OwnedStirlingProcess {
    child: Child,
    context_path: String,
}

fn process_slot() -> &'static Mutex<Option<OwnedStirlingProcess>> {
    static SLOT: OnceLock<Mutex<Option<OwnedStirlingProcess>>> = OnceLock::new();
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

const STIRLING_PIN: &str = "25220cbdbde2d526cebf173b94357884e180b8c1";
const OFFICE_CONVERT_VERSION: &str = "0.2.2";
const OFFICE_CONVERT_SOURCE_COMMIT: &str = "673aab8d6ac784524cd1d90141c95e74b9fd26ae";
const OFFICE_CONVERT_LICENSE_TEXT: &str =
    include_str!("../../../third_party/stirling-office-convert/LICENSE.txt");
const OFFICE_CONVERT_DEPENDENCIES_TEXT: &str =
    include_str!("../../../third_party/stirling-office-convert/DEPENDENCIES.md");
const OFFICE_CONVERT_ARTIFACT_PINS: &str =
    include_str!("../../../third_party/stirling-office-convert/ARTIFACTS.sha256");
const OFFICE_CONVERT_LICENSE_REPORT_PIN: &str =
    include_str!("../../../third_party/stirling-office-convert/DEPENDENCY_LICENSE_REPORT.sha256");

fn sha256_reader_hex<R: Read>(reader: &mut R) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Unable to hash stream: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Unable to open {} for hashing: {error}", path.display()))?;
    sha256_reader_hex(&mut file)
}

fn selected_stirling_source(jar: &Path) -> String {
    let Ok(configured) = env::var("MALENJO_STIRLING_JAR") else {
        return "core".into();
    };
    let configured = PathBuf::from(configured.trim());
    let same = configured
        .canonicalize()
        .ok()
        .zip(jar.canonicalize().ok())
        .is_some_and(|(left, right)| left == right);
    if same {
        "configured".into()
    } else {
        "core".into()
    }
}

#[derive(Clone, PartialEq)]
struct OfficePackFingerprint {
    jar: PathBuf,
    jar_len: u64,
    jar_modified: Option<SystemTime>,
    manifest_len: u64,
    manifest_modified: Option<SystemTime>,
    report_len: u64,
    report_modified: Option<SystemTime>,
    license_len: u64,
    license_modified: Option<SystemTime>,
    dependencies_len: u64,
    dependencies_modified: Option<SystemTime>,
}

#[derive(Clone)]
struct OfficeStatusCacheEntry {
    fingerprint: OfficePackFingerprint,
    status: StirlingComponentStatus,
}

fn office_status_cache() -> &'static Mutex<Option<OfficeStatusCacheEntry>> {
    static CACHE: OnceLock<Mutex<Option<OfficeStatusCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn office_pack_files(jar: &Path) -> Option<(Value, PathBuf, PathBuf, PathBuf, PathBuf)> {
    let manifest_path = jar.parent()?.join("manifest.json");
    let manifest_text = std::fs::read_to_string(&manifest_path).ok()?;
    let manifest: Value = serde_json::from_str(manifest_text.trim_start_matches('\u{feff}')).ok()?;
    let report_relative = manifest.get("dependencyLicenseReport")?.as_str()?;
    if report_relative.is_empty() {
        return None;
    }
    let pack_dir = jar.parent()?;
    let license_report = pack_dir.join(report_relative);
    let office_license = pack_dir.join("malenjo-notices/stirling-office-convert-LICENSE.txt");
    let office_dependencies =
        pack_dir.join("malenjo-notices/stirling-office-convert-DEPENDENCIES.md");
    Some((
        manifest,
        manifest_path,
        license_report,
        office_license,
        office_dependencies,
    ))
}

fn office_pack_fingerprint(jar: &Path) -> Option<OfficePackFingerprint> {
    let (_, manifest_path, license_report, office_license, office_dependencies) =
        office_pack_files(jar)?;
    let jar_meta = std::fs::metadata(jar).ok()?;
    let manifest_meta = std::fs::metadata(&manifest_path).ok()?;
    let report_meta = std::fs::metadata(&license_report).ok()?;
    let license_meta = std::fs::metadata(&office_license).ok()?;
    let dependencies_meta = std::fs::metadata(&office_dependencies).ok()?;
    Some(OfficePackFingerprint {
        jar: jar.canonicalize().unwrap_or_else(|_| jar.to_path_buf()),
        jar_len: jar_meta.len(),
        jar_modified: jar_meta.modified().ok(),
        manifest_len: manifest_meta.len(),
        manifest_modified: manifest_meta.modified().ok(),
        report_len: report_meta.len(),
        report_modified: report_meta.modified().ok(),
        license_len: license_meta.len(),
        license_modified: license_meta.modified().ok(),
        dependencies_len: dependencies_meta.len(),
        dependencies_modified: dependencies_meta.modified().ok(),
    })
}

fn reviewed_office_artifact_hash(name: &str) -> Option<&'static str> {
    OFFICE_CONVERT_ARTIFACT_PINS.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let artifact = parts.next()?;
        (parts.next().is_none()
            && artifact == name
            && hash.len() == 64
            && hash.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then_some(hash)
    })
}

fn reviewed_dependency_report_hash() -> Option<&'static str> {
    OFFICE_CONVERT_LICENSE_REPORT_PIN.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let artifact = parts.next()?;
        (parts.next().is_none()
            && artifact == "stirling-dependency-licenses.json"
            && hash.len() == 64
            && hash.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then_some(hash)
    })
}

fn embedded_office_artifacts_match(jar: &Path) -> bool {
    let Ok(file) = std::fs::File::open(jar) else {
        return false;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return false;
    };
    for name in [
        "stirling-office-convert-0.2.2.jar",
        "stirling-office-convert-legacy-0.2.2.jar",
        "stirling-office-convert-topdf-0.2.2.jar",
    ] {
        let entry_name = format!("BOOT-INF/lib/{name}");
        let actual = {
            let Ok(mut artifact) = archive.by_name(&entry_name) else {
                return false;
            };
            if artifact.size() > 128 * 1024 * 1024 {
                return false;
            }
            let Ok(hash) = sha256_reader_hex(&mut artifact) else {
                return false;
            };
            hash
        };
        let Some(expected) = reviewed_office_artifact_hash(name) else {
            return false;
        };
        if actual != expected {
            return false;
        }
    }
    true
}

fn license_artifact_matches(manifest: &Value, relative: &str, path: &Path) -> bool {
    let Some(expected) = manifest
        .get("licenseArtifacts")
        .and_then(Value::as_object)
        .and_then(|items| items.get(relative))
        .and_then(Value::as_str)
    else {
        return false;
    };
    expected.len() == 64
        && expected.chars().all(|ch| ch.is_ascii_hexdigit())
        && sha256_file_hex(path).is_ok_and(|actual| actual == expected)
}

fn office_convert_pack_is_verified(jar: &Path) -> bool {
    let Some((manifest, _manifest_path, license_report, office_license, office_dependencies)) =
        office_pack_files(jar)
    else {
        return false;
    };

    let expected_hash = manifest.get("sha256").and_then(Value::as_str);
    let actual_hash = sha256_file_hex(jar).ok();
    let office = manifest.get("embeddedOfficeConvert");
    let jars = office.and_then(|value| value.get("jars")).and_then(Value::as_object);
    let required_jars = [
        "stirling-office-convert-0.2.2.jar",
        "stirling-office-convert-legacy-0.2.2.jar",
        "stirling-office-convert-topdf-0.2.2.jar",
    ];
    let office_jars_valid = jars.is_some_and(|items| {
        required_jars.iter().all(|name| {
            let Some(expected) = reviewed_office_artifact_hash(name) else {
                return false;
            };
            items.get(*name).and_then(Value::as_str) == Some(expected)
        })
    }) && embedded_office_artifacts_match(jar);

    let office_license_text = std::fs::read_to_string(&office_license).ok();
    let office_dependencies_text = std::fs::read_to_string(&office_dependencies).ok();
    let report_content = std::fs::read_to_string(&license_report).ok();
    let report_semantically_valid = report_content.as_deref().is_some_and(|content| {
        content.len() > 1000
            && content.contains("stirling-office-convert")
            && serde_json::from_str::<Value>(content).is_ok()
    });
    let report_matches_reviewed_pin = reviewed_dependency_report_hash().is_some_and(|expected| {
        sha256_file_hex(&license_report).is_ok_and(|actual| actual == expected)
    });

    manifest.get("provider").and_then(Value::as_str) == Some("stirling-open-core")
        && manifest.get("upstreamCommit").and_then(Value::as_str) == Some(STIRLING_PIN)
        && expected_hash.is_some()
        && actual_hash.as_deref() == expected_hash
        && office.and_then(|value| value.get("version")).and_then(Value::as_str)
            == Some(OFFICE_CONVERT_VERSION)
        && office.and_then(|value| value.get("upstream")).and_then(Value::as_str)
            == Some("Stirling-Tools/Stirling-Office-Convert")
        && office.and_then(|value| value.get("sourceCommit")).and_then(Value::as_str)
            == Some(OFFICE_CONVERT_SOURCE_COMMIT)
        && office.and_then(|value| value.get("license")).and_then(Value::as_str) == Some("MIT")
        && office.and_then(|value| value.get("verification")).and_then(Value::as_str)
            == Some("pinned-published-sha256")
        && office_jars_valid
        && office_license_text.as_deref() == Some(OFFICE_CONVERT_LICENSE_TEXT)
        && office_dependencies_text.as_deref() == Some(OFFICE_CONVERT_DEPENDENCIES_TEXT)
        && license_artifact_matches(
            &manifest,
            "malenjo-notices/stirling-office-convert-LICENSE.txt",
            &office_license,
        )
        && license_artifact_matches(
            &manifest,
            "malenjo-notices/stirling-office-convert-DEPENDENCIES.md",
            &office_dependencies,
        )
        && license_artifact_matches(
            &manifest,
            "malenjo-notices/stirling-dependency-licenses.json",
            &license_report,
        )
        && report_semantically_valid
        && report_matches_reviewed_pin
}

fn office_convert_component_status(app: &AppHandle) -> StirlingComponentStatus {
    let Some(jar) = stirling_jar_path(app) else {
        return StirlingComponentStatus {
            id: "stirling-office-convert".into(),
            available: false,
            version: None,
            executable: None,
            source: "unavailable".into(),
            message: "The reviewed Stirling core provider pack is not installed.".into(),
        };
    };

    let source = selected_stirling_source(&jar);
    if source == "configured" {
        return StirlingComponentStatus {
            id: "stirling-office-convert".into(),
            available: false,
            version: None,
            executable: Some(jar.to_string_lossy().to_string()),
            source,
            message: "A MALENJO_STIRLING_JAR override is not eligible for embedded Office Convert approval; use the reviewed generated/bundled core pack.".into(),
        };
    }
    if let Some(fingerprint) = office_pack_fingerprint(&jar) {
        if let Ok(cache) = office_status_cache().lock() {
            if let Some(entry) = cache.as_ref() {
                if entry.fingerprint == fingerprint {
                    return entry.status.clone();
                }
            }
        }

        let valid = office_convert_pack_is_verified(&jar);
        let status = StirlingComponentStatus {
            id: "stirling-office-convert".into(),
            available: valid,
            version: valid.then(|| OFFICE_CONVERT_VERSION.into()),
            executable: Some(jar.to_string_lossy().to_string()),
            source,
            message: if valid {
                "Embedded Stirling Office Convert 0.2.2 matches MALENJO's reviewed published artifact pins.".into()
            } else {
                "The selected Stirling JAR does not match the reviewed MALENJO Office Convert 0.2.2 pack provenance.".into()
            },
        };
        if let Ok(mut cache) = office_status_cache().lock() {
            *cache = Some(OfficeStatusCacheEntry {
                fingerprint,
                status: status.clone(),
            });
        }
        return status;
    }

    StirlingComponentStatus {
        id: "stirling-office-convert".into(),
        available: false,
        version: None,
        executable: Some(jar.to_string_lossy().to_string()),
        source,
        message: "The selected Stirling JAR is missing the reviewed MALENJO manifest, dependency-license report, or Office Convert license notice.".into(),
    }
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

fn validate_api_path(base_url: &str, path: &str) -> Result<String, String> {
    if !path.starts_with("/api/v1/") {
        return Err("Only Stirling core /api/v1/* paths may be called.".into());
    }
    if path.contains("://") || path.contains("..") || path.contains('\\') || path.contains('\0') {
        return Err("Invalid Stirling API path.".into());
    }
    if path.len() > 512 {
        return Err("Stirling API path is too long.".into());
    }
    Ok(format!("{base_url}{path}"))
}

async fn health_payload(base_url: &str) -> Option<Value> {
    let client = api_client().ok()?;
    let response = client
        .get(format!("{base_url}{STIRLING_HEALTH_PATH}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

async fn is_healthy(base_url: &str) -> bool {
    health_payload(base_url)
        .await
        .and_then(|value| value.get("status").and_then(Value::as_str).map(str::to_owned))
        .is_some_and(|status| status.eq_ignore_ascii_case("UP"))
}

fn version_from_health(value: &Value) -> Option<String> {
    ["version", "buildVersion", "implementationVersion"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_owned))
}

fn new_context_path() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let seed = format!("{}:{nanos}", std::process::id());
    let token = format!("{:x}", Sha256::digest(seed.as_bytes()));
    format!("/malenjo-{}", &token[..24])
}

fn owned_base_url() -> Option<String> {
    let Ok(mut guard) = process_slot().lock() else {
        return None;
    };
    let Some(owned) = guard.as_mut() else {
        return None;
    };
    match owned.child.try_wait() {
        Ok(None) => Some(format!("{STIRLING_BASE_URL}{}", owned.context_path)),
        Ok(Some(_)) | Err(_) => {
            *guard = None;
            None
        }
    }
}

fn process_running() -> bool {
    owned_base_url().is_some()
}

fn stirling_port_in_use() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], STIRLING_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

#[cfg(windows)]
fn suppress_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_windows_console(_command: &mut Command) {}

fn spawn_core(java: &str, jar: &Path, app: &AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve MALENJO data directory: {error}"))?
        .join("stirling-core");
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Unable to create Stirling core data directory: {error}"))?;

    let context_path = new_context_path();
    let mut command = Command::new(java);
    command
        .arg("-Xms128m")
        .arg("-Xmx1536m")
        .arg("-jar")
        .arg(jar)
        .arg(format!("--server.address=127.0.0.1"))
        .arg(format!("--server.port={STIRLING_PORT}"))
        .arg(format!("--server.servlet.context-path={context_path}"))
        .arg("--spring.main.banner-mode=off")
        .arg("--system.stirlingOfficeConversion=true")
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
    *guard = Some(OwnedStirlingProcess {
        child,
        context_path: context_path.clone(),
    });
    Ok(format!("{STIRLING_BASE_URL}{context_path}"))
}

#[tauri::command]
pub async fn stirling_core_status(app: AppHandle) -> StirlingCoreStatus {
    let jar = stirling_jar_path(&app);
    let java = available_java(&app);
    let owned_url = owned_base_url();
    let health = match owned_url.as_deref() {
        Some(base_url) => health_payload(base_url).await,
        None => None,
    };
    let owned_ready = health
        .as_ref()
        .and_then(|value| value.get("status").and_then(Value::as_str))
        .is_some_and(|value| value.eq_ignore_ascii_case("UP"));
    let child_running = owned_url.is_some();
    let foreign_listener = !child_running && stirling_port_in_use();

    let message = if owned_ready {
        "Local Stirling open-core PDF provider is ready.".to_string()
    } else if foreign_listener {
        "Port 28970 is occupied by a local service that was not started by MALENJO. It will not be trusted or used.".to_string()
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
        running: owned_ready,
        java,
        jar_path: jar.map(|path| path.to_string_lossy().to_string()),
        base_url: owned_url.unwrap_or_else(|| STIRLING_BASE_URL.into()),
        version: health.as_ref().and_then(version_from_health),
        message,
    }
}

#[tauri::command]
pub async fn stirling_core_components(app: AppHandle) -> Vec<StirlingComponentStatus> {
    let child_running = process_running();
    let mut office = office_convert_component_status(&app);
    if !child_running && stirling_port_in_use() {
        office.available = false;
        office.version = None;
        office.message =
            "Port 28970 is occupied by an unowned service; MALENJO will not approve Office conversion against that live process.".into();
    }
    vec![
        qpdf_component_status(&app),
        tesseract_component_status(&app),
        office,
    ]
}

#[tauri::command]
pub async fn stirling_core_start(app: AppHandle) -> Result<StirlingCoreStatus, String> {
    if let Some(base_url) = owned_base_url() {
        let started = Instant::now();
        while started.elapsed() < START_TIMEOUT {
            if is_healthy(&base_url).await {
                return Ok(stirling_core_status(app).await);
            }
            if !process_running() {
                return Err("The local Stirling core provider exited before becoming healthy.".into());
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        return Err("The existing Stirling core process did not become healthy within 75 seconds.".into());
    }

    if stirling_port_in_use() {
        return Err(
            "Port 28970 is already occupied by a process that MALENJO did not start. The local PDF provider will not connect to an unowned sidecar.".into(),
        );
    }

    let jar = stirling_jar_path(&app)
        .ok_or_else(|| "Stirling core provider pack is not installed.".to_string())?;
    let java = available_java(&app)
        .ok_or_else(|| "Java 25 is not available for the local Stirling core provider.".to_string())?;

    let base_url = spawn_core(&java, &jar, &app)?;

    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if is_healthy(&base_url).await {
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
    let Some(owned) = guard.as_mut() else {
        return Ok(false);
    };
    let _ = owned.child.kill();
    let _ = owned.child.wait();
    *guard = None;
    Ok(true)
}

#[tauri::command]
pub async fn stirling_core_openapi(app: AppHandle) -> Result<Value, String> {
    let status = stirling_core_start(app).await?;
    let client = api_client()?;
    let response = client
        .get(format!("{}{STIRLING_OPENAPI_PATH}", status.base_url))
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
    let status = stirling_core_start(app).await?;
    let url = validate_api_path(&status.base_url, &path)?;
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
        new_context_path, office_convert_pack_is_verified, parse_qpdf_version, reviewed_dependency_report_hash, reviewed_office_artifact_hash,
        parse_tesseract_version, set_reviewed_provider_path, sha256_file_hex, validate_api_path,
        MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, OFFICE_CONVERT_DEPENDENCIES_TEXT,
        OFFICE_CONVERT_LICENSE_TEXT, OFFICE_CONVERT_SOURCE_COMMIT, OFFICE_CONVERT_VERSION,
        STIRLING_BASE_URL, STIRLING_PIN, STIRLING_PORT,
    };
    use std::{path::PathBuf, process::Command};

    #[test]
    fn stirling_proxy_accepts_only_local_v1_paths() {
        assert_eq!(
            validate_api_path("http://127.0.0.1:28970/malenjo-test", "/api/v1/general/merge-pdfs").unwrap(),
            "http://127.0.0.1:28970/malenjo-test/api/v1/general/merge-pdfs"
        );
        assert!(validate_api_path(STIRLING_BASE_URL, "https://example.com/api/v1/test").is_err());
        assert!(validate_api_path(STIRLING_BASE_URL, "/api/v1/../admin").is_err());
        assert!(validate_api_path(STIRLING_BASE_URL, "/v3/api-docs").is_err());
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
    fn office_pack_verifier_rejects_jar_and_license_tampering() {
        let root = std::env::temp_dir().join(format!(
            "malenjo-office-pack-test-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let notices = root.join("malenjo-notices");
        std::fs::create_dir_all(&notices).unwrap();
        let jar = root.join("stirling-pdf.jar");
        let office_license = notices.join("stirling-office-convert-LICENSE.txt");
        let office_dependencies = notices.join("stirling-office-convert-DEPENDENCIES.md");
        let license_report = notices.join("stirling-dependency-licenses.json");

        std::fs::write(&jar, b"reviewed-stirling-pack").unwrap();
        std::fs::write(&office_license, OFFICE_CONVERT_LICENSE_TEXT.as_bytes()).unwrap();
        std::fs::write(&office_dependencies, OFFICE_CONVERT_DEPENDENCIES_TEXT.as_bytes()).unwrap();
        let report = serde_json::json!({
            "component": "stirling-office-convert",
            "padding": "x".repeat(1200)
        });
        std::fs::write(&license_report, serde_json::to_vec(&report).unwrap()).unwrap();

        let jar_hash = sha256_file_hex(&jar).unwrap();
        let license_hash = sha256_file_hex(&office_license).unwrap();
        let dependencies_hash = sha256_file_hex(&office_dependencies).unwrap();
        let report_hash = sha256_file_hex(&license_report).unwrap();
        let manifest = serde_json::json!({
            "provider": "stirling-open-core",
            "upstreamCommit": STIRLING_PIN,
            "sha256": jar_hash,
            "dependencyLicenseReport": "malenjo-notices/stirling-dependency-licenses.json",
            "licenseArtifacts": {
                "malenjo-notices/stirling-office-convert-LICENSE.txt": license_hash,
                "malenjo-notices/stirling-office-convert-DEPENDENCIES.md": dependencies_hash,
                "malenjo-notices/stirling-dependency-licenses.json": report_hash
            },
            "embeddedOfficeConvert": {
                "version": OFFICE_CONVERT_VERSION,
                "upstream": "Stirling-Tools/Stirling-Office-Convert",
                "sourceCommit": OFFICE_CONVERT_SOURCE_COMMIT,
                "license": "MIT",
                "verification": "pinned-published-sha256",
                "jars": {
                    "stirling-office-convert-0.2.2.jar": reviewed_office_artifact_hash("stirling-office-convert-0.2.2.jar").unwrap(),
                    "stirling-office-convert-legacy-0.2.2.jar": reviewed_office_artifact_hash("stirling-office-convert-legacy-0.2.2.jar").unwrap(),
                    "stirling-office-convert-topdf-0.2.2.jar": reviewed_office_artifact_hash("stirling-office-convert-topdf-0.2.2.jar").unwrap()
                }
            }
        });
        std::fs::write(root.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();

        assert!(!office_convert_pack_is_verified(&jar));
        std::fs::write(&office_license, b"tampered license").unwrap();
        assert!(!office_convert_pack_is_verified(&jar));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn dependency_license_report_has_an_immutable_reviewed_pin() {
        assert_eq!(
            reviewed_dependency_report_hash(),
            Some("05c4ef33b49a9f16d7029c81575938bb9673ddcaea28da91d90fb50b66260cf1")
        );
    }

    #[test]
    fn owned_provider_context_path_is_scoped() {
        let context = new_context_path();
        assert!(context.starts_with("/malenjo-"));
        assert_eq!(context.matches('/').count(), 1);
        assert!(context.len() >= 16);
    }

    #[test]
    fn sha256_file_hex_is_deterministic() {
        let path = std::env::temp_dir().join("malenjo-stirling-hash-test.txt");
        std::fs::write(&path, b"MALENJO").unwrap();
        let hash = sha256_file_hex(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(hash, "ad3d17309ba071186689402aa15d136f4069db0d28881943d979a4bc206a0702");
    }

    #[test]
    fn stirling_limits_and_port_are_fixed() {
        assert_eq!(STIRLING_PORT, 28970);
        assert_eq!(MAX_INPUT_BYTES, 512 * 1024 * 1024);
        assert_eq!(MAX_OUTPUT_BYTES, 512 * 1024 * 1024);
        assert_eq!(STIRLING_BASE_URL, "http://127.0.0.1:28970");
    }
}
