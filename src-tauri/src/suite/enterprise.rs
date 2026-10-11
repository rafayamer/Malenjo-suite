use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

use super::{
    library::resolve_library_document_path,
    security::{append_audit, archive_audit_older_than},
};

const DMS_VERSION: u32 = 1;
const POLICY_VERSION: u32 = 1;
const WORKFLOW_VERSION: u32 = 1;
const BACKUP_VERSION: u32 = 1;
static SNAPSHOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static STATE_WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static BACKUP_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn snapshot_version_id(source: &Path, created_ms: u64) -> String {
    let nonce = SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "ver-{created_ms}-{}-{nonce}-{}",
        std::process::id(),
        stable_id("", &source.display().to_string()).trim_start_matches('-')
    )
}
const PROCESS_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmsVersion {
    pub id: String,
    pub created_ms: u64,
    pub sha256: String,
    pub size_bytes: u64,
    pub note: String,
    pub snapshot_rel_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmsRecord {
    pub id: String,
    pub document_id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub retention_days: u32,
    pub legal_hold: bool,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub versions: Vec<DmsVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DmsIndex {
    version: u32,
    records: Vec<DmsRecord>,
}

impl Default for DmsIndex {
    fn default() -> Self {
        Self {
            version: DMS_VERSION,
            records: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionCandidate {
    pub record_id: String,
    pub version_id: String,
    pub record_name: String,
    pub created_ms: u64,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnterprisePolicy {
    pub version: u32,
    pub current_role: String,
    pub default_retention_days: u32,
    pub audit_retention_days: u32,
}

impl Default for EnterprisePolicy {
    fn default() -> Self {
        Self {
            version: POLICY_VERSION,
            current_role: "owner".into(),
            default_retention_days: 365,
            audit_retention_days: 365,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleProfile {
    pub role: String,
    pub permissions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub kind: String,
    pub record_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContract {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created_ms: u64,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResult {
    pub workflow_id: String,
    pub completed_steps: usize,
    pub messages: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterStatus {
    pub available: bool,
    pub version: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub version: u32,
    pub created_ms: u64,
    pub files: Vec<BackupFile>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    pub valid: bool,
    pub file_count: usize,
    pub total_bytes: u64,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRetentionResult {
    pub kept: usize,
    pub archived: usize,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn enterprise_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve MALENJO app data directory: {error}"))?
        .join("enterprise");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create MALENJO enterprise directory: {error}"))?;
    Ok(dir)
}

fn dms_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = enterprise_root(app)?.join("dms");
    fs::create_dir_all(dir.join("versions"))
        .map_err(|error| format!("Unable to create DMS directories: {error}"))?;
    Ok(dir)
}

fn dms_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dms_root(app)?.join("index-v1.json"))
}

fn policy_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(enterprise_root(app)?.join("policy-v1.json"))
}

fn workflows_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(enterprise_root(app)?.join("workflows-v1.json"))
}

#[cfg(windows)]
fn replace_state_file(temp: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(replaced: *const u16, replacement: *const u16,
            backup: *const u16, flags: u32, excluded: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void) -> i32;
    }
    if !destination.exists() {
        return fs::rename(temp, destination);
    }
    let old: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let new: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    // Windows ReplaceFileW preserves the original on failure; no delete gap.
    let ok = unsafe { ReplaceFileW(old.as_ptr(), new.as_ptr(), ptr::null(), 0,
        ptr::null_mut(), ptr::null_mut()) };
    if ok == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_state_file(temp: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temp, destination)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let sequence = STATE_WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temp = path.with_extension(format!("{}-{sequence}.tmp", std::process::id()));
    let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temp)
        .map_err(|error| format!("Unable to stage enterprise state: {error}"))?;
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(format!("Unable to stage enterprise state: {error}"));
    }
    let replaced = replace_state_file(&temp, path);
    if let Err(error) = replaced {
        let _ = fs::remove_file(&temp);
        return Err(format!("Unable to atomically replace enterprise state: {error}"));
    }
    Ok(())
}

fn load_dms(app: &AppHandle) -> Result<DmsIndex, String> {
    let path = dms_index_path(app)?;
    if !path.exists() {
        return Ok(DmsIndex::default());
    }
    let bytes = fs::read(path).map_err(|error| format!("Unable to read DMS index: {error}"))?;
    let index: DmsIndex = serde_json::from_slice(&bytes)
        .map_err(|error| format!("DMS index is invalid: {error}"))?;
    if index.version != DMS_VERSION {
        return Err(format!("Unsupported DMS index version {}.", index.version));
    }
    Ok(index)
}

fn save_dms(app: &AppHandle, index: &DmsIndex) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Unable to serialize DMS index: {error}"))?;
    atomic_write(&dms_index_path(app)?, &bytes)
}

fn load_policy(app: &AppHandle) -> Result<EnterprisePolicy, String> {
    let path = policy_path(app)?;
    if !path.exists() {
        let policy = EnterprisePolicy::default();
        save_policy(app, &policy)?;
        return Ok(policy);
    }
    let bytes = fs::read(path).map_err(|error| format!("Unable to read enterprise policy: {error}"))?;
    let policy: EnterprisePolicy = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Enterprise policy is invalid: {error}"))?;
    if policy.version != POLICY_VERSION {
        return Err(format!("Unsupported enterprise policy version {}.", policy.version));
    }
    Ok(policy)
}

fn save_policy(app: &AppHandle, policy: &EnterprisePolicy) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(policy)
        .map_err(|error| format!("Unable to serialize enterprise policy: {error}"))?;
    atomic_write(&policy_path(app)?, &bytes)
}

fn role_permissions(role: &str) -> Vec<String> {
    match role {
        "owner" => vec![
            "dms.read", "dms.write", "dms.retention", "automation.read", "automation.run",
            "automation.write", "backup.create", "backup.restore", "admin.read", "admin.write",
        ],
        "admin" => vec![
            "dms.read", "dms.write", "dms.retention", "automation.read", "automation.run",
            "automation.write", "backup.create", "backup.restore", "admin.read",
        ],
        "editor" => vec![
            "dms.read", "dms.write", "automation.read", "automation.run", "backup.create",
        ],
        "viewer" => vec!["dms.read", "automation.read"],
        _ => Vec::new(),
    }
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn require_permission(app: &AppHandle, permission: &str) -> Result<(), String> {
    let policy = load_policy(app)?;
    if role_permissions(&policy.current_role).iter().any(|item| item == permission) {
        Ok(())
    } else {
        Err(format!(
            "Role '{}' does not have permission '{}'.",
            policy.current_role, permission
        ))
    }
}

fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Unable to open file for hashing: {error}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)
            .map_err(|error| format!("Unable to read file for hashing: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total = total.saturating_add(read as u64);
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

fn stable_id(prefix: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("{prefix}-{}", &digest[..20])
}

fn safe_name(name: &str) -> String {
    let value: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    if value.is_empty() { "document".into() } else { value }
}

fn make_snapshot(
    app: &AppHandle,
    record_id: &str,
    document_id: &str,
    name: &str,
    note: &str,
) -> Result<DmsVersion, String> {
    let source = resolve_library_document_path(app, document_id)?;
    let created_ms = now_ms();
    let version_id = snapshot_version_id(&source, created_ms);
    let rel = format!("versions/{record_id}/{version_id}-{}", safe_name(name));
    let destination = dms_root(app)?.join(&rel);
    let parent = destination
        .parent()
        .ok_or_else(|| "DMS snapshot destination has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create DMS version directory: {error}"))?;
    // create_new prevents silently replacing a supposedly immutable version.
    let mut source_file = fs::File::open(&source)
        .map_err(|error| format!("Unable to read DMS snapshot source: {error}"))?;
    let mut target_file = fs::OpenOptions::new().write(true).create_new(true).open(&destination)
        .map_err(|error| format!("Unable to create unique DMS snapshot: {error}"))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut target_file)
        .and_then(|_| target_file.sync_all())
    {
        drop(target_file);
        let _ = fs::remove_file(&destination);
        return Err(format!("Unable to complete DMS snapshot: {error}"));
    }
    let (sha256, size_bytes) = sha256_file(&destination)?;
    Ok(DmsVersion {
        id: version_id,
        created_ms,
        sha256,
        size_bytes,
        note: note.chars().take(300).collect(),
        snapshot_rel_path: rel,
    })
}

#[tauri::command]
pub fn dms_list_records(app: AppHandle) -> Result<Vec<DmsRecord>, String> {
    require_permission(&app, "dms.read")?;
    Ok(load_dms(&app)?.records)
}

#[tauri::command]
pub fn dms_register_document(
    app: AppHandle,
    document_id: String,
    tags: Vec<String>,
    retention_days: Option<u32>,
) -> Result<DmsRecord, String> {
    require_permission(&app, "dms.write")?;
    let source = resolve_library_document_path(&app, &document_id)?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Document name is invalid.".to_string())?
        .to_string();
    let mut index = load_dms(&app)?;
    let record_id = stable_id("dms", &document_id);

    if let Some(record) = index.records.iter().find(|record| record.id == record_id) {
        return Ok(record.clone());
    }

    let policy = load_policy(&app)?;
    let created_ms = now_ms();
    let version = make_snapshot(&app, &record_id, &document_id, &name, "Initial DMS registration")?;
    let record = DmsRecord {
        id: record_id.clone(),
        document_id,
        name,
        tags: tags.into_iter().take(20).map(|tag| tag.chars().take(60).collect()).collect(),
        retention_days: retention_days.unwrap_or(policy.default_retention_days).min(36500),
        legal_hold: false,
        created_ms,
        updated_ms: created_ms,
        versions: vec![version],
    };
    index.records.push(record.clone());
    save_dms(&app, &index)?;
    append_audit(&app, "dms-register", "info", &record.name, "Document registered and initial version snapshotted.")?;
    Ok(record)
}

fn snapshot_record_internal(app: &AppHandle, record_id: &str, note: &str) -> Result<DmsRecord, String> {
    let mut index = load_dms(app)?;
    let position = index.records.iter().position(|record| record.id == record_id)
        .ok_or_else(|| "DMS record was not found.".to_string())?;
    let document_id = index.records[position].document_id.clone();
    let name = index.records[position].name.clone();
    let version = make_snapshot(app, record_id, &document_id, &name, note)?;
    index.records[position].versions.push(version);
    index.records[position].updated_ms = now_ms();
    let record = index.records[position].clone();
    save_dms(app, &index)?;
    append_audit(app, "dms-snapshot", "info", &record.name, note)?;
    Ok(record)
}

#[tauri::command]
pub fn dms_snapshot_record(
    app: AppHandle,
    record_id: String,
    note: String,
) -> Result<DmsRecord, String> {
    require_permission(&app, "dms.write")?;
    snapshot_record_internal(&app, &record_id, &note)
}

#[tauri::command]
pub fn dms_update_retention(
    app: AppHandle,
    record_id: String,
    retention_days: u32,
    legal_hold: bool,
) -> Result<DmsRecord, String> {
    require_permission(&app, "dms.retention")?;
    let mut index = load_dms(&app)?;
    let record = index.records.iter_mut().find(|record| record.id == record_id)
        .ok_or_else(|| "DMS record was not found.".to_string())?;
    record.retention_days = retention_days.min(36500);
    record.legal_hold = legal_hold;
    record.updated_ms = now_ms();
    let result = record.clone();
    save_dms(&app, &index)?;
    append_audit(
        &app,
        "dms-retention",
        "warning",
        &result.name,
        format!("Retention={} days; legal_hold={}.", result.retention_days, result.legal_hold),
    )?;
    Ok(result)
}

fn retention_candidates(index: &DmsIndex, now: u64) -> Vec<RetentionCandidate> {
    let mut result = Vec::new();
    for record in &index.records {
        if record.legal_hold || record.retention_days == 0 || record.versions.len() <= 1 {
            continue;
        }
        let age_ms = u64::from(record.retention_days).saturating_mul(86_400_000);
        let cutoff = now.saturating_sub(age_ms);
        let newest = record.versions.iter().map(|version| version.created_ms).max().unwrap_or(0);
        for version in &record.versions {
            if version.created_ms < cutoff && version.created_ms != newest {
                result.push(RetentionCandidate {
                    record_id: record.id.clone(),
                    version_id: version.id.clone(),
                    record_name: record.name.clone(),
                    created_ms: version.created_ms,
                    reason: format!("Older than {} day retention policy.", record.retention_days),
                });
            }
        }
    }
    result
}

#[tauri::command]
pub fn dms_retention_preview(app: AppHandle) -> Result<Vec<RetentionCandidate>, String> {
    require_permission(&app, "dms.retention")?;
    Ok(retention_candidates(&load_dms(&app)?, now_ms()))
}

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let value = PathBuf::from(path);
    if value.components().any(|component| matches!(
        component,
        Component::ParentDir | Component::RootDir | Component::Prefix(_)
    )) {
        return Err("Unsafe DMS relative path.".into());
    }
    Ok(value)
}

#[tauri::command]
pub fn dms_apply_retention(
    app: AppHandle,
    version_ids: Vec<String>,
) -> Result<usize, String> {
    require_permission(&app, "dms.retention")?;
    let mut index = load_dms(&app)?;
    let allowed: HashSet<String> = retention_candidates(&index, now_ms())
        .into_iter()
        .map(|candidate| candidate.version_id)
        .collect();
    let requested: HashSet<String> = version_ids.into_iter().filter(|id| allowed.contains(id)).collect();
    if requested.is_empty() {
        return Ok(0);
    }

    // Commit the index before reclaiming old snapshot files.
    let root = dms_root(&app)?;
    let mut expired_paths = Vec::new();
    for record in &mut index.records {
        record.versions.retain(|version| {
            if !requested.contains(&version.id) { return true; }
            expired_paths.push(version.snapshot_rel_path.clone());
            false
        });
    }
    let paths = expired_paths.iter()
        .map(|value| safe_relative(value).map(|relative| root.join(relative)))
        .collect::<Result<Vec<_>,_>>()?;
    save_dms(&app, &index)?;

    let mut cleanup_errors = Vec::new();
    for path in &paths {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => cleanup_errors.push(format!("{}: {error}", path.display())),
        }
    }
    append_audit(&app, "dms-retention-apply", "warning", "DMS",
        format!("Unlinked {} version(s); {} snapshot cleanup error(s).",
            paths.len(), cleanup_errors.len()))?;
    if !cleanup_errors.is_empty() {
        return Err(format!("Retention index updated but expired snapshots need cleanup: {}",
            cleanup_errors.join("; ")));
    }
    Ok(paths.len())
}

#[tauri::command]
pub fn admin_get_policy(app: AppHandle) -> Result<(EnterprisePolicy, Vec<RoleProfile>), String> {
    require_permission(&app, "admin.read")?;
    let profiles = ["owner", "admin", "editor", "viewer"]
        .into_iter()
        .map(|role| RoleProfile {
            role: role.into(),
            permissions: role_permissions(role),
        })
        .collect();
    Ok((load_policy(&app)?, profiles))
}

#[tauri::command]
pub fn admin_update_policy(
    app: AppHandle,
    current_role: String,
    default_retention_days: u32,
    audit_retention_days: u32,
) -> Result<EnterprisePolicy, String> {
    require_permission(&app, "admin.write")?;
    if !["owner", "admin", "editor", "viewer"].contains(&current_role.as_str()) {
        return Err("Unknown enterprise role.".into());
    }
    if !role_permissions(&current_role).iter().any(|permission| permission == "admin.write") {
        return Err("Local administrator cannot assign a role that removes administration access. Configure authenticated multi-user identity first.".into());
    }
    let policy = EnterprisePolicy {
        version: POLICY_VERSION,
        current_role,
        default_retention_days: default_retention_days.min(36500),
        audit_retention_days: audit_retention_days.min(36500),
    };
    save_policy(&app, &policy)?;
    let _ = append_audit(&app, "policy-update", "warning", "Administration", format!("Active local role set to {}.", policy.current_role));
    Ok(policy)
}

#[tauri::command]
pub fn admin_apply_audit_retention(app: AppHandle) -> Result<AuditRetentionResult, String> {
    require_permission(&app, "admin.write")?;
    let policy = load_policy(&app)?;
    let (kept, archived) = archive_audit_older_than(&app, policy.audit_retention_days)?;
    append_audit(
        &app,
        "audit-retention",
        "warning",
        "Administration",
        format!("Archived {archived} old audit event(s); kept {kept}."),
    )?;
    Ok(AuditRetentionResult { kept, archived })
}

fn load_workflows(app: &AppHandle) -> Result<Vec<WorkflowContract>, String> {
    let path = workflows_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|error| format!("Unable to read workflows: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Workflow store is invalid: {error}"))
}

fn save_workflows(app: &AppHandle, workflows: &[WorkflowContract]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(workflows)
        .map_err(|error| format!("Unable to serialize workflows: {error}"))?;
    atomic_write(&workflows_path(app)?, &bytes)
}

fn validate_workflow(contract: &WorkflowContract) -> Result<(), String> {
    if contract.name.trim().is_empty() || contract.name.len() > 120 {
        return Err("Workflow name must contain 1-120 characters.".into());
    }
    if contract.steps.is_empty() || contract.steps.len() > 20 {
        return Err("Workflow must contain 1-20 steps.".into());
    }
    for step in &contract.steps {
        if !["audit", "dms_snapshot"].contains(&step.kind.as_str()) {
            return Err(format!("Unsupported local workflow step '{}'.", step.kind));
        }
        if step.kind == "dms_snapshot" && step.record_id.as_deref().unwrap_or("").is_empty() {
            return Err("DMS snapshot workflow step requires a record ID.".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn automation_list_workflows(app: AppHandle) -> Result<Vec<WorkflowContract>, String> {
    require_permission(&app, "automation.read")?;
    load_workflows(&app)
}

#[tauri::command]
pub fn automation_save_workflow(
    app: AppHandle,
    mut contract: WorkflowContract,
) -> Result<WorkflowContract, String> {
    require_permission(&app, "automation.write")?;
    contract.version = WORKFLOW_VERSION;
    if contract.id.trim().is_empty() {
        contract.id = stable_id("wf", &format!("{}:{}", contract.name, now_ms()));
    }
    if contract.created_ms == 0 {
        contract.created_ms = now_ms();
    }
    validate_workflow(&contract)?;
    let mut workflows = load_workflows(&app)?;
    if let Some(existing) = workflows.iter_mut().find(|item| item.id == contract.id) {
        *existing = contract.clone();
    } else {
        workflows.push(contract.clone());
    }
    save_workflows(&app, &workflows)?;
    let _ = append_audit(&app, "workflow-save", "info", &contract.name, format!("{} step(s).", contract.steps.len()));
    Ok(contract)
}

#[tauri::command]
pub fn automation_run_local(
    app: AppHandle,
    workflow_id: String,
) -> Result<WorkflowRunResult, String> {
    require_permission(&app, "automation.run")?;
    let contract = load_workflows(&app)?
        .into_iter()
        .find(|item| item.id == workflow_id)
        .ok_or_else(|| "Workflow was not found.".to_string())?;
    validate_workflow(&contract)?;

    let mut messages = Vec::new();
    let mut completed = 0usize;
    for step in &contract.steps {
        match step.kind.as_str() {
            "audit" => {
                append_audit(
                    &app,
                    "workflow-audit",
                    "info",
                    &contract.name,
                    step.note.clone().unwrap_or_else(|| "Workflow audit checkpoint.".into()),
                )?;
                messages.push("Audit checkpoint recorded.".into());
            }
            "dms_snapshot" => {
                let record_id = step.record_id.as_deref().unwrap_or_default();
                let record = snapshot_record_internal(
                    &app,
                    record_id,
                    step.note.as_deref().unwrap_or("Automation snapshot"),
                )?;
                messages.push(format!("Snapshotted {}.", record.name));
            }
            _ => return Err("Unsupported workflow step.".into()),
        }
        completed += 1;
    }
    append_audit(&app, "workflow-run", "info", &contract.name, format!("Completed {completed} step(s)."))?;
    Ok(WorkflowRunResult {
        workflow_id: contract.id,
        completed_steps: completed,
        messages,
    })
}

fn command_with_path(program: &str) -> Command {
    let mut command = Command::new(program);
    let path = env::var_os("PATH");
    command.env_clear();
    if let Some(path) = path {
        command.env("PATH", path);
    }
    command
}

fn run_bounded(mut command: Command, timeout: Duration) -> Result<(i32, String, String), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command.spawn().map_err(|error| format!("Unable to start enterprise adapter: {error}"))?;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| format!("Unable to poll enterprise adapter: {error}"))? {
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stdout.take() { let _ = pipe.read_to_string(&mut stdout); }
            if let Some(mut pipe) = child.stderr.take() { let _ = pipe.read_to_string(&mut stderr); }
            return Ok((status.code().unwrap_or(-1), stdout.chars().take(24000).collect(), stderr.chars().take(8000).collect()));
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Enterprise adapter exceeded its timeout and was terminated.".into());
        }
        thread::sleep(Duration::from_millis(80));
    }
}

fn adapter_status(program: &str, args: &[&str]) -> AdapterStatus {
    let mut command = command_with_path(program);
    command.args(args);
    match run_bounded(command, Duration::from_secs(8)) {
        Ok((0, stdout, stderr)) => AdapterStatus { available:true, version:stdout.trim().to_string(), detail:stderr.trim().to_string() },
        Ok((code, stdout, stderr)) => AdapterStatus { available:false, version:String::new(), detail:format!("Exit {code}: {} {}", stdout.trim(), stderr.trim()) },
        Err(error) => AdapterStatus { available:false, version:String::new(), detail:error },
    }
}

#[tauri::command]
pub fn temporal_status() -> AdapterStatus {
    adapter_status("temporal", &["--version"])
}

#[tauri::command]
pub fn temporal_start_workflow(
    app: AppHandle,
    workflow_id: String,
) -> Result<String, String> {
    require_permission(&app, "automation.run")?;
    let contract = load_workflows(&app)?
        .into_iter()
        .find(|item| item.id == workflow_id)
        .ok_or_else(|| "Workflow was not found.".to_string())?;
    validate_workflow(&contract)?;
    let input = serde_json::to_string(&contract)
        .map_err(|error| format!("Unable to serialize Temporal workflow input: {error}"))?;
    if input.len() > 16_000 {
        return Err("Temporal workflow contract exceeds the Phase 7 input limit.".into());
    }
    let temporal_id = format!("malenjo-{}-{}", contract.id, now_ms());
    let mut command = command_with_path("temporal");
    command
        .arg("workflow").arg("start")
        .arg("--address").arg("127.0.0.1:7233")
        .arg("--namespace").arg("default")
        .arg("--task-queue").arg("malenjo")
        .arg("--type").arg("MalenjoDocumentWorkflow")
        .arg("--workflow-id").arg(&temporal_id)
        .arg("--input").arg(&input);
    let (code, stdout, stderr) = run_bounded(command, PROCESS_TIMEOUT)?;
    if code != 0 {
        return Err(format!("Temporal CLI failed: {} {}", stdout.trim(), stderr.trim()));
    }
    append_audit(&app, "temporal-start", "info", &contract.name, format!("Started workflow {temporal_id}."))?;
    Ok(stdout)
}


const MAX_NATIVE_HOME_BYTES: usize = 64 * 1024;

fn home_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir()
        .map_err(|error| format!("Unable to resolve Home data directory: {error}"))?.join("library");
    fs::create_dir_all(&root).map_err(|error| format!("Unable to create Home data directory: {error}"))?;
    Ok(root.join("home-state-v1.json"))
}

fn validate_home_payload(content: &str) -> Result<(), String> {
    if content.len() > MAX_NATIVE_HOME_BYTES {
        return Err("Home state exceeds its 64 KB budget.".into());
    }
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Home state is invalid JSON: {error}"))?;
    if value.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1) ||
       !value.get("starredDocumentIds").is_some_and(|v| v.is_array()) ||
       !value.get("pinnedLocations").is_some_and(|v| v.is_array()) {
        return Err("Home state is not a supported version 1 structure.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn read_native_home_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = home_state_path(&app)?;
    if !path.exists() { return Ok(None); }
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Unable to inspect Home state: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() ||
        metadata.len() > MAX_NATIVE_HOME_BYTES as u64 {
        return Err("Home state must be a bounded regular file.".into());
    }
    let content=fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read Home state: {error}"))?;
    validate_home_payload(&content)?;
    Ok(Some(content))
}

#[tauri::command]
pub fn write_native_home_state(app: AppHandle, content: String) -> Result<(), String> {
    validate_home_payload(&content)?;
    atomic_write(&home_state_path(&app)?, content.as_bytes())
}

// A local backup must include the BYTES of documents linked in the library,
// not only an index containing paths to files on another drive/computer.
const LINKED_ARCHIVE_VERSION: u32 = 1;
const MAX_LINKED_ARCHIVE_DOCUMENTS: usize = 10_000;
const MAX_LINKED_ARCHIVE_BYTES: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkedArchiveDocument {
    document_id: String,
    original_name: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkedArchiveManifest {
    version: u32,
    documents: Vec<LinkedArchiveDocument>,
}

#[derive(Deserialize)]
struct LibrarySnapshotDocument { id: String, path: String }
#[derive(Deserialize)]
struct LibrarySnapshotIndex { version: u32, documents: Vec<LibrarySnapshotDocument> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredLibraryCopy {
    pub document_id: String,
    pub original_name: String,
    pub restored_path: String,
    pub size_bytes: u64,
}

/// Each source is independently copied and then hashed on both sides. A
/// missing, substituted, or changing file prevents the backup from being
/// advertised as complete. No source file is ever written.
fn snapshot_linked_documents(state: &Path) -> Result<usize, String> {
    let lib = state.join("library");
    fs::create_dir_all(&lib)
        .map_err(|error| format!("Unable to create backup library domain: {error}"))?;
    let source_index = lib.join("index.json");
    let index: LibrarySnapshotIndex = if source_index.exists() {
        serde_json::from_slice(&fs::read(&source_index)
            .map_err(|error| format!("Unable to read backed-up library index: {error}"))?)
            .map_err(|error| format!("Unable to parse backed-up document index: {error}"))?
    } else {
        LibrarySnapshotIndex { version:1, documents:Vec::new() }
    };
    if index.version != 1 || index.documents.len() > MAX_LINKED_ARCHIVE_DOCUMENTS {
        return Err("Unsupported or oversized library document index; no full backup was published.".into());
    }
    let archive = lib.join("linked-archive-v1");
    if let Ok(metadata)=fs::symlink_metadata(&archive) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Previous linked archive is not a safe directory.".into());
        }
        // This is a private copy inside the newly reserved backup, not the
        // live user source. Replace only this stale archived snapshot.
        fs::remove_dir_all(&archive)
            .map_err(|error| format!("Unable to replace stale snapshot in new backup: {error}"))?;
    }
    fs::create_dir(&archive)
        .map_err(|error| format!("Unable to reserve new external-document backup archive: {error}"))?;
    let mut seen = HashSet::new();
    let mut total = 0u64;
    let mut documents = Vec::new();
    for document in index.documents {
        if document.id.is_empty() || document.id.len() > 96 ||
           !document.id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') ||
           !seen.insert(document.id.clone()) {
            return Err("Library index contains an unsafe or duplicate document ID.".into());
        }
        let source = PathBuf::from(&document.path);
        let metadata = fs::symlink_metadata(&source)
            .map_err(|error| format!("Indexed document unavailable for full backup ({}): {error}", document.id))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("Indexed document is not a regular file: {}", document.id));
        }
        total = total.checked_add(metadata.len())
            .ok_or("Total linked document size overflow.")?;
        if total > MAX_LINKED_ARCHIVE_BYTES {
            return Err("Linked documents exceed the 16 GiB offline backup budget.".into());
        }
        let name = source.file_name().and_then(|item| item.to_str())
            .filter(|item| !item.is_empty())
            .ok_or_else(|| format!("Document {} has an invalid filename.", document.id))?.to_string();
        let before = sha256_file(&source)?;
        let saved = archive.join(format!("{}.bin", document.id));
        // A private snapshot copy rather than a hard link: later source edits
        // must not modify the contents of this verified backup.
        let mut input = File::open(&source).map_err(|error| format!("Unable to open linked source: {error}"))?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&saved)
            .map_err(|error| format!("Unable to create independent document snapshot: {error}"))?;
        std::io::copy(&mut input, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|error| format!("Unable to durably copy linked document: {error}"))?;
        drop(output);
        let after = sha256_file(&source)?;
        let copied = sha256_file(&saved)?;
        if before != after || copied != before {
            return Err(format!("Indexed document {} changed during backup; snapshot rejected.", document.id));
        }
        documents.push(LinkedArchiveDocument {
            document_id:document.id, original_name:name,
            size_bytes:copied.1, sha256:copied.0,
        });
    }
    let bytes=serde_json::to_vec_pretty(&LinkedArchiveManifest {version:LINKED_ARCHIVE_VERSION,documents})
        .map_err(|error| format!("Unable to serialize external-document inventory: {error}"))?;
    let path=archive.join("manifest.json");
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|error| format!("Unable to create external-document manifest: {error}"))?;
    use std::io::Write;
    file.write_all(&bytes).and_then(|_|file.sync_all())
        .map_err(|error| format!("Unable to sync external-document manifest: {error}"))?;
    Ok(seen.len())
}

fn read_linked_archive(backup: &Path) -> Result<LinkedArchiveManifest, String> {
    let dir=backup.join("state/library/linked-archive-v1");
    let manifest=dir.join("manifest.json");
    let metadata=fs::symlink_metadata(&manifest)
        .map_err(|error| format!("Backup contains no recoverable linked-document inventory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len()>4*1024*1024 {
        return Err("Linked-document inventory is not a safe bounded regular file.".into());
    }
    let content=fs::read(&manifest)
        .map_err(|error| format!("Unable to read linked-document inventory: {error}"))?;
    let index:LinkedArchiveManifest=serde_json::from_slice(&content)
        .map_err(|error| format!("Linked-document inventory is invalid: {error}"))?;
    if index.version!=LINKED_ARCHIVE_VERSION || index.documents.len()>MAX_LINKED_ARCHIVE_DOCUMENTS {
        return Err("Unsupported or oversized linked-document inventory.".into());
    }
    let mut seen=HashSet::new();
    let mut total=0u64;
    for item in &index.documents {
        if item.document_id.is_empty() || item.document_id.len()>96 ||
           !item.document_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte==b'-'||byte==b'_') ||
           !seen.insert(&item.document_id) ||
           item.original_name.is_empty() ||
           Path::new(&item.original_name).file_name().and_then(|n| n.to_str())!=Some(item.original_name.as_str()) {
            return Err("Linked document manifest contains invalid or duplicate identity or filename.".into());
        }
        total=total.checked_add(item.size_bytes).ok_or("Linked document byte count overflow.")?;
        if total>MAX_LINKED_ARCHIVE_BYTES {
            return Err("Linked document manifest exceeds safe backup size.".into());
        }
        let source=dir.join(format!("{}.bin",item.document_id));
        let metadata=fs::symlink_metadata(&source)
            .map_err(|error| format!("Missing linked document bytes: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Linked document backup contains a symlink or non-file entry.".into());
        }
        let (hash,size)=sha256_file(&source)?;
        if hash!=item.sha256 || size!=item.size_bytes {
            return Err(format!("Linked document content does not match its inventory: {}",item.document_id));
        }
    }
    Ok(index)
}

/// Restore archived bytes ONLY to a directory explicitly selected by the
/// user. Existing document paths are never touched. All files are staged
/// before publishing; new names are published create-only via hard links.
fn recover_linked_document_copies(backup: &Path, destination: &Path) -> Result<Vec<RecoveredLibraryCopy>, String> {
    let inspected=inspect_backup(backup)?;
    if !inspected.valid {
        return Err("Backup integrity verification failed; linked documents were not restored.".into());
    }
    let info=fs::symlink_metadata(destination)
        .map_err(|error| format!("Unable to inspect linked-document restore directory: {error}"))?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("Linked-document restore target must be a real directory.".into());
    }
    let canonical_dest=fs::canonicalize(destination)
        .map_err(|error| format!("Unable to resolve restore destination: {error}"))?;
    let canonical_backup=fs::canonicalize(backup)
        .map_err(|error| format!("Unable to resolve backup location: {error}"))?;
    if canonical_dest.starts_with(&canonical_backup) {
        return Err("Cannot restore recovered documents into the backup itself.".into());
    }
    let archive=read_linked_archive(backup)?;
    let root=backup.join("state/library/linked-archive-v1");
    let mut staged:Vec<(PathBuf,PathBuf,RecoveredLibraryCopy)>=Vec::new();
    let mut prepared=HashSet::new();
    let prepare=(||->Result<(),String>{
        for document in archive.documents {
            let original=Path::new(&document.original_name);
            let stem=original.file_stem().and_then(|item|item.to_str()).unwrap_or("document");
            let ext=original.extension().and_then(|item|item.to_str()).unwrap_or("");
            let extension=if ext.is_empty(){String::new()}else{format!(".{ext}")};
            let dest=canonical_dest.join(format!("{stem}-recovered-{}{}",document.document_id,extension));
            if !prepared.insert(dest.clone()) { return Err("Duplicate recovered filename.".into()); }
            match fs::symlink_metadata(&dest) {
                Ok(_)=>return Err(format!("Refusing to overwrite existing recovered document: {}",dest.display())),
                Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
                Err(error)=>return Err(format!("Unable to inspect recovery destination: {error}")),
            }
            let source=root.join(format!("{}.bin",document.document_id));
            let temp=canonical_dest.join(format!(".malenjo-restore-{}-{}-{}.tmp",
                std::process::id(),now_ms(),BACKUP_DIRECTORY_SEQUENCE.fetch_add(1,Ordering::Relaxed)));
            let mut input=File::open(&source)
                .map_err(|error| format!("Unable to read verified linked document: {error}"))?;
            let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&temp)
                .map_err(|error| format!("Unable to stage linked document recovery: {error}"))?;
            let copied=std::io::copy(&mut input,&mut output)
                .and_then(|_| output.sync_all());
            drop(output);
            if let Err(error)=copied {
                let _=fs::remove_file(&temp);
                return Err(format!("Unable to stage complete linked document: {error}"));
            }
            let (hash,size)=match sha256_file(&temp) {
                Ok(result)=>result,
                Err(error)=>{
                    let _=fs::remove_file(&temp);
                    return Err(format!("Unable to verify staged recovered document: {error}"));
                }
            };
            if hash!=document.sha256 || size!=document.size_bytes {
                let _=fs::remove_file(&temp);
                return Err("Restored file bytes differ from verified backup.".into());
            }
            staged.push((temp,dest.clone(),RecoveredLibraryCopy {
                document_id:document.document_id,
                original_name:document.original_name,
                restored_path:dest.to_string_lossy().into_owned(),
                size_bytes:size,
            }));
        }
        Ok(())
    })();
    if let Err(error)=prepare {
        for (temp,_,_) in &staged { let _=fs::remove_file(temp); }
        return Err(error);
    }
    let mut published=Vec::new();
    for (temp,dest,_) in &staged {
        if let Err(error)=fs::hard_link(temp,dest) {
            // Remove only entries this operation itself created. Never unlink
            // a destination that existed before this invocation.
            for item in &published { let _=fs::remove_file(item); }
            for (stage,_,_) in &staged { let _=fs::remove_file(stage); }
            return Err(format!("Safe linked-document restore was rolled back: {error}"));
        }
        published.push(dest.clone());
    }
    for (temp,_,_) in &staged {
        fs::remove_file(temp)
            .map_err(|error| format!("Recovered files are complete but a temporary link requires cleanup: {error}"))?;
    }
    Ok(staged.into_iter().map(|(_,_,item)|item).collect())
}

#[tauri::command]
pub fn restore_linked_document_copies(
    app: AppHandle, backup_path: String, destination_directory: String
) -> Result<Vec<RecoveredLibraryCopy>, String> {
    require_permission(&app,"backup.restore")?;
    let recovered=recover_linked_document_copies(
        &PathBuf::from(backup_path), &PathBuf::from(destination_directory)
    )?;
    append_audit(&app,"backup-linked-recover","warning","Backup/DR",
        format!("Recovered {} linked document copies to a user-selected directory without modifying originals.",recovered.len()))?;
    Ok(recovered)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    let source_metadata=match fs::symlink_metadata(source) {
        Ok(metadata)=>metadata,
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(()),
        Err(error)=>return Err(format!("Unable to inspect backup source root: {error}")),
    };
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(format!("Backup source root is not a real directory: {}",source.display()));
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to create backup directory: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("Unable to read backup source: {error}"))? {
        let entry = entry.map_err(|error| format!("Unable to inspect backup source: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Unable to inspect backup file: {error}"))?;
        if metadata.file_type().is_symlink() {
            // Silently skipping a linked source creates a "verified" backup
            // that was never a complete representation of live state.
            return Err(format!("Backup source contains a symbolic link: {}", source_path.display()));
        }
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Unable to copy backup file: {error}"))?;
        } else {
            return Err(format!("Backup refuses non-regular special file: {}",source_path.display()));
        }
    }
    Ok(())
}

/// Rebuilding a backup must not recursively copy a previous restored
/// archive into the new backup before generating the current verified archive.
fn copy_live_library_for_backup(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata=match fs::symlink_metadata(source) {
        Ok(meta)=>meta,
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(()),
        Err(error)=>return Err(format!("Unable to inspect live library directory: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Live library directory must be a real directory.".into());
    }
    fs::create_dir_all(destination)
        .map_err(|error|format!("Unable to stage library state: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error|format!("Unable to list library state: {error}"))? {
        let entry=entry.map_err(|error|format!("Unable to read library entry: {error}"))?;
        let name=entry.file_name();
        let input=entry.path();
        if name=="linked-archive-v1" {
            let metadata=fs::symlink_metadata(&input)
                .map_err(|error|format!("Unable to inspect previous linked archive: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("Previous linked-document archive is not a safe directory.".into());
            }
            // The new copy will be reconstructed from the live indexed user
            // files, so inherited recovered archive copies are intentionally
            // not part of the next backup's state snapshot.
            continue;
        }
        let output=destination.join(&name);
        let metadata=fs::symlink_metadata(&input)
            .map_err(|error|format!("Unable to inspect library state: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Backup refuses a symbolic link in live library state.".into());
        }
        if metadata.is_dir() {
            copy_dir_recursive(&input,&output)?;
        } else if metadata.is_file() {
            fs::copy(&input,&output)
                .map_err(|error|format!("Unable to copy live library state: {error}"))?;
        } else {
            return Err("Backup refuses special files in live library state.".into());
        }
    }
    Ok(())
}

fn collect_backup_files(root: &Path, current: &Path, files: &mut Vec<BackupFile>) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current).map_err(|error| format!("Unable to inspect backup: {error}"))? {
        let entry = entry.map_err(|error| format!("Unable to inspect backup entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect backup entry metadata: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Backup contains a symbolic link and is rejected.".into());
        }
        if metadata.is_dir() {
            collect_backup_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path.strip_prefix(root)
                .map_err(|_| "Backup file escaped its root.".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let (sha256, size_bytes) = sha256_file(&path)?;
            files.push(BackupFile { path:relative, sha256, size_bytes });
        } else {
            return Err(format!("Backup contains unsupported special file: {}",path.display()));
        }
    }
    Ok(())
}

fn supported_backup_domain(relative: &Path) -> bool {
    matches!(relative.components().next(),
        Some(Component::Normal(value))
        if value == "enterprise" || value == "security" || value == "library")
}

fn validate_backup_root(path: &Path) -> Result<BackupManifest, String> {
    let root_metadata=fs::symlink_metadata(path)
        .map_err(|error|format!("Unable to inspect backup root: {error}"))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("Backup root must be an actual directory, not a symbolic link.".into());
    }
    let manifest_path = path.join("manifest-v1.json");
    let metadata=fs::symlink_metadata(&manifest_path)
        .map_err(|error|format!("Unable to inspect backup manifest: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() ||
       metadata.len()==0 || metadata.len()>32*1024*1024 {
        return Err("Backup manifest must be a regular file of at most 32 MB.".into());
    }
    let bytes = fs::read(&manifest_path)
        .map_err(|error| format!("Unable to read backup manifest: {error}"))?;
    let manifest: BackupManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Backup manifest is invalid: {error}"))?;
    if manifest.version != BACKUP_VERSION {
        return Err(format!("Unsupported backup manifest version {}.", manifest.version));
    }
    Ok(manifest)
}

fn inspect_backup(path: &Path) -> Result<BackupInspection, String> {
    let manifest = validate_backup_root(path)?;
    let state = path.join("state");
    let state_metadata=fs::symlink_metadata(&state)
        .map_err(|error| format!("Backup is missing its state directory: {error}"))?;
    if state_metadata.file_type().is_symlink() || !state_metadata.is_dir() {
        return Err("Backup state root must be a non-symbolic-link directory.".into());
    }
    let mut errors = Vec::new();
    let mut total_bytes = 0u64;
    let mut expected_paths=HashSet::new();
    if manifest.files.len()>100_000 {
        return Err("Backup manifest exceeds the 100,000 file safety budget.".into());
    }
    for entry in &manifest.files {
        if !expected_paths.insert(entry.path.clone()) {
            errors.push(format!("Duplicate backup manifest path: {}",entry.path));
            continue;
        }
        let relative = safe_relative(&entry.path)?;
        if !supported_backup_domain(&relative) {
            errors.push(format!("Backup contains a state domain that restore cannot install: {}",entry.path));
            continue;
        }
        let file = path.join("state").join(&relative);
        // Reject symlinked entries and ancestors; never verify one file
        // then restore a different filesystem view.
        let mut cursor = path.join("state");
        let mut safe = true;
        for component in relative.components() {
            cursor.push(component.as_os_str());
            match fs::symlink_metadata(&cursor) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    errors.push(format!("Symbolic link forbidden in backup: {}", entry.path));
                    safe = false;
                    break;
                }
                Err(error) => {
                    errors.push(format!("Missing or unreadable {}: {error}", entry.path));
                    safe = false;
                    break;
                }
                Ok(_) => {}
            }
        }
        if !safe { continue; }
        let metadata = fs::symlink_metadata(&file)
            .map_err(|error| format!("Unable to inspect backup entry: {error}"))?;
        if !metadata.is_file() {
            errors.push(format!("Not a regular backup file: {}", entry.path));
            continue;
        }
        match sha256_file(&file) {
            Ok((hash, size)) => {
                total_bytes = total_bytes.saturating_add(size);
                if hash != entry.sha256 || size != entry.size_bytes {
                    errors.push(format!("Integrity mismatch {}", entry.path));
                }
            }
            Err(error) => errors.push(format!("{}: {}", entry.path, error)),
        }
    }
    // A manifest may be internally consistent yet omit extra files from
    // state. Restoring unlisted content would introduce unverified data.
    // Enumerate the *actual* state tree and require exact inventory parity.
    let mut actual=Vec::new();
    collect_backup_files(&state,&state,&mut actual)?;
    if actual.len()>100_000 {
        errors.push("Backup contains more than 100,000 files.".into());
    }
    for file in actual {
        if !supported_backup_domain(&safe_relative(&file.path)?) {
            errors.push(format!("Backup includes unsupported restore domain: {}",file.path));
        }
        if !expected_paths.contains(&file.path) {
            errors.push(format!("Unlisted file in backup state: {}",file.path));
        }
    }
    Ok(BackupInspection {
        valid: errors.is_empty(),
        file_count: manifest.files.len(),
        total_bytes,
        errors,
    })
}

/// Never reuse an existing snapshot directory: create_dir is exclusive
/// while create_dir_all silently permits reopening and overwriting one.
fn reserve_backup_root(destination: &Path) -> Result<PathBuf, String> {
    for _ in 0..32 {
        let sequence=BACKUP_DIRECTORY_SEQUENCE.fetch_add(1,Ordering::Relaxed);
        let name=format!("MALENJO-backup-{}-{}-{sequence}",now_ms(),std::process::id());
        let path=destination.join(name);
        #[cfg(unix)]
        let created = {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder=fs::DirBuilder::new();
            builder.mode(0o700);
            builder.create(&path)
        };
        #[cfg(not(unix))]
        let created=fs::create_dir(&path);
        match created {
            Ok(()) => return Ok(path),
            Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Unable to reserve new backup folder: {error}")),
        }
    }
    Err("Unable to reserve a unique backup folder without overwriting previous snapshots.".into())
}

#[tauri::command]
pub fn create_local_backup(
    app: AppHandle,
    destination_directory: String,
) -> Result<String, String> {
    require_permission(&app, "backup.create")?;
    let destination = PathBuf::from(destination_directory);
    let metadata = fs::symlink_metadata(&destination)
        .map_err(|error| format!("Unable to inspect backup destination: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Backup destination must be an existing non-symbolic-link directory.".into());
    }

    let app_data = app.path().app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let canonical_destination=fs::canonicalize(&destination)
        .map_err(|error| format!("Unable to resolve backup destination: {error}"))?;
    let canonical_app_data=fs::canonicalize(&app_data)
        .map_err(|error| format!("Unable to resolve live app-data root: {error}"))?;
    // Never copy a freshly created backup *into itself* by placing the target
    // anywhere below the active app-data tree.
    if canonical_destination.starts_with(&canonical_app_data) {
        return Err("Backup destination must be outside MALENJO app-data to prevent recursive snapshotting.".into());
    }
    let backup = reserve_backup_root(&destination)?;
    let build = (|| -> Result<BackupInspection, String> {
        let state = backup.join("state");
        fs::create_dir(&state)
            .map_err(|error| format!("Unable to create new backup state: {error}"))?;
        copy_dir_recursive(&app_data.join("enterprise"), &state.join("enterprise"))?;
        copy_dir_recursive(&app_data.join("security"), &state.join("security"))?;
        copy_live_library_for_backup(&app_data.join("library"), &state.join("library"))?;
        snapshot_linked_documents(&state)?;

        let mut files = Vec::new();
        collect_backup_files(&state, &state, &mut files)?;
        let manifest = BackupManifest { version:BACKUP_VERSION, created_ms:now_ms(), files };
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Unable to serialize backup manifest: {error}"))?;
        let mut output=fs::OpenOptions::new().write(true).create_new(true)
            .open(backup.join("manifest-v1.json"))
            .map_err(|error| format!("Unable to write backup manifest: {error}"))?;
        use std::io::Write;
        output.write_all(&bytes).and_then(|_|output.sync_all())
            .map_err(|error| format!("Unable to sync backup manifest: {error}"))?;
        drop(output);
        let inspection = inspect_backup(&backup)?;
        if !inspection.valid {
            return Err(format!("Backup integrity check failed: {}", inspection.errors.join("; ")));
        }
        Ok(inspection)
    })();
    let inspection=match build {
        Ok(result)=>result,
        Err(error)=>{
            // Remove only this freshly reserved backup; it was never marked
            // verified. Never delete any preexisting backup or user file.
            let cleanup=fs::remove_dir_all(&backup);
            return Err(match cleanup {
                Ok(())=>format!("Backup creation failed; incomplete copy removed: {error}"),
                Err(extra)=>format!("Backup creation failed: {error}; partial output at {} could not be removed: {extra}",backup.display()),
            });
        }
    };
    append_audit(&app, "backup-create", "info", "Backup/DR",
        format!("Created {} verified file(s) at {}.",inspection.file_count,backup.display()))
        .map_err(|error| format!("Verified backup exists at {}, but the audit event failed: {error}",backup.display()))?;
    Ok(backup.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn inspect_local_backup(path: String) -> Result<BackupInspection, String> {
    inspect_backup(&PathBuf::from(path))
}


const RESTORE_JOURNAL_VERSION: u32 = 1;
const RESTORE_DOMAINS: [&str; 3] = ["enterprise", "security", "library"];

#[derive(Debug, Serialize, Deserialize)]
struct RestoreJournal {
    version: u32,
    nonce: String,
    original_domains: Vec<String>,
    restored_domains: Vec<String>,
}

fn restore_marker(app_data: &Path) -> PathBuf {
    app_data.join(".malenjo-restore-pending.json")
}

fn sync_restore_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Unable to sync restore directory: {error}"))?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// The marker is committed BEFORE the first live-directory rename. On
/// restart we always roll back an interrupted install, rather than exposing a
/// mixture of previous enterprise, security and library state.
pub(crate) fn recover_pending_restore(app_data: &Path) -> Result<bool, String> {
    let marker = restore_marker(app_data);
    let meta = match fs::symlink_metadata(&marker) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Unable to inspect restore journal: {error}")),
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 8192 {
        return Err("Restore journal is not a bounded regular file; manual recovery required.".into());
    }
    let journal: RestoreJournal = serde_json::from_slice(
        &fs::read(&marker).map_err(|error| format!("Unable to read restore journal: {error}"))?
    ).map_err(|error| format!("Restore journal is invalid; manual recovery required: {error}"))?;
    if journal.version != RESTORE_JOURNAL_VERSION ||
       journal.nonce.is_empty() || journal.nonce.len() > 39 ||
       !journal.nonce.bytes().all(|byte| byte.is_ascii_digit()) ||
       journal.original_domains.iter().any(|name| !RESTORE_DOMAINS.contains(&name.as_str())) ||
       journal.restored_domains.iter().any(|name| !RESTORE_DOMAINS.contains(&name.as_str())) {
        return Err("Restore journal contains unsupported fields; refuse unsafe recovery.".into());
    }
    let prior = app_data.join(format!("restore-prior-{}", journal.nonce));
    let quarantine = app_data.join(format!("restore-aborted-{}", journal.nonce));
    // A directory may already exist if power was lost halfway through an
    // earlier recovery attempt. Such attempts are intentionally idempotent.
    fs::create_dir_all(&quarantine)
        .map_err(|error| format!("Unable to create restore quarantine: {error}"))?;
    for name in RESTORE_DOMAINS.into_iter().rev() {
        if !journal.restored_domains.iter().any(|domain| domain == name) { continue; }
        let live = app_data.join(name);
        let prior_file = prior.join(name);
        if prior_file.exists() {
            if live.exists() {
                let discarded = quarantine.join(name);
                // No overwrite or truncation; preserve the partially installed
                // restored state for inspection even on rollback.
                if discarded.exists() {
                    return Err(format!("Restore recovery conflict at {}; manual recovery required.", discarded.display()));
                }
                fs::rename(&live, &discarded)
                    .map_err(|error| format!("Unable to quarantine incomplete {name} restore: {error}"))?;
            }
            fs::rename(&prior_file, &live)
                .map_err(|error| format!("Unable to recover previous {name} state: {error}"))?;
        } else if journal.original_domains.iter().any(|domain| domain == name) {
            if !live.exists() {
                return Err(format!("Previous {name} state is missing during recovery; inspect {}.", prior.display()));
            }
        } else if live.exists() {
            let discarded = quarantine.join(name);
            if discarded.exists() {
                return Err(format!("Restore quarantine collision: {}", discarded.display()));
            }
            fs::rename(&live, &discarded)
                .map_err(|error| format!("Unable to quarantine newly installed {name}: {error}"))?;
        }
    }
    sync_restore_directory(app_data)?;
    fs::remove_file(&marker)
        .map_err(|error| format!("Unable to clear completed rollback journal: {error}"))?;
    sync_restore_directory(app_data)?;
    Ok(true)
}

/// Restore each root with rollback directories rather than deleting active
/// enterprise/security state before the replacement is ready. A failed rename
/// rolls back earlier successful swaps; the independent recovery copy remains.
fn restore_state_with_recovery(app_data: &Path, backup: &Path) -> Result<PathBuf, String> {
    let inspection = inspect_backup(backup)?;
    if !inspection.valid {
        return Err(format!("Backup integrity check failed: {}", inspection.errors.join("; ")));
    }

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_nanos();
    let recovery = app_data.join(format!("restore-recovery-{nonce}"));
    fs::create_dir_all(&recovery)
        .map_err(|error| format!("Unable to create restore recovery directory: {error}"))?;
    for name in ["enterprise", "security", "library"] {
        copy_dir_recursive(&app_data.join(name), &recovery.join(name))?;
    }

    let stage = app_data.join(format!("restore-stage-{nonce}"));
    fs::create_dir_all(&stage)
        .map_err(|error| format!("Unable to create restore staging directory: {error}"))?;
    for name in ["enterprise", "security", "library"] {
        copy_dir_recursive(&backup.join("state").join(name), &stage.join(name))?;
    }

    let prior_root = app_data.join(format!("restore-prior-{nonce}"));
    fs::create_dir(&prior_root)
        .map_err(|error| format!("Unable to reserve restore rollback: {error}"))?;
    let restored_domains: Vec<String> = RESTORE_DOMAINS.iter()
        .filter(|name| stage.join(name).exists()).map(|name| name.to_string()).collect();
    let original_domains: Vec<String> = RESTORE_DOMAINS.iter()
        .filter(|name| app_data.join(name).exists()).map(|name| name.to_string()).collect();
    let marker = restore_marker(app_data);
    if marker.exists() {
        return Err("Another interrupted restore requires recovery before continuing.".into());
    }
    let journal = RestoreJournal {
        version: RESTORE_JOURNAL_VERSION, nonce: nonce.to_string(),
        original_domains, restored_domains: restored_domains.clone(),
    };
    atomic_write(&marker, &serde_json::to_vec(&journal)
        .map_err(|error| format!("Unable to serialize restore journal: {error}"))?)?;
    sync_restore_directory(app_data)?;
    let result = (|| -> Result<(), String> {
        for name in &restored_domains {
            let target = app_data.join(name);
            if target.exists() {
                fs::rename(&target, prior_root.join(name))
                    .map_err(|error| format!("Unable to retain live {name} state: {error}"))?;
            }
            fs::rename(stage.join(name), &target)
                .map_err(|error| format!("Unable to install restored {name} state: {error}"))?;
        }
        sync_restore_directory(app_data)?;
        Ok(())
    })();
    if let Err(error) = result {
        let rollback = recover_pending_restore(app_data);
        return Err(format!("{error}; recovery at {}; automatic rollback: {:?}",
            recovery.display(), rollback));
    }
    // Recovery copy remains independent of the active state. The journal must
    // not be cleared until all three installed directories are durable.
    fs::remove_file(&marker)
        .map_err(|error| format!("Restore was installed, but cleanup requires intervention: {error}"))?;
    sync_restore_directory(app_data)?;
    let _ = fs::remove_dir_all(&prior_root);
    let _ = fs::remove_dir_all(&stage);
    Ok(recovery)
}

#[tauri::command]
pub fn restore_local_backup(
    app: AppHandle,
    backup_path: String,
) -> Result<bool, String> {
    require_permission(&app, "backup.restore")?;
    let backup = PathBuf::from(backup_path);
    let app_data = app.path().app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    recover_pending_restore(&app_data)?;
    let recovery = restore_state_with_recovery(&app_data, &backup)?;
    append_audit(
        &app,
        "backup-restore",
        "warning",
        "Backup/DR",
        format!("Restored verified backup; recovery copy retained at {}.", recovery.display()),
    )?;
    Ok(true)
}

#[tauri::command]
pub fn kopia_status() -> AdapterStatus {
    adapter_status("kopia", &["--version"])
}

#[tauri::command]
pub fn kopia_snapshot_app_state(app: AppHandle) -> Result<String, String> {
    require_permission(&app, "backup.create")?;
    let source = enterprise_root(&app)?;
    let mut command = command_with_path("kopia");
    command.arg("snapshot").arg("create").arg(&source).arg("--json");
    let (code, stdout, stderr) = run_bounded(command, PROCESS_TIMEOUT)?;
    if code != 0 {
        return Err(format!("Kopia snapshot failed: {} {}", stdout.trim(), stderr.trim()));
    }
    append_audit(&app, "kopia-snapshot", "info", "Backup/DR", "Kopia snapshot created for enterprise app state.")?;
    Ok(stdout)
}

#[tauri::command]
pub fn kopia_restore_snapshot(
    app: AppHandle,
    snapshot_id: String,
    destination_directory: String,
) -> Result<String, String> {
    require_permission(&app, "backup.restore")?;
    if snapshot_id.is_empty() || snapshot_id.len() > 180 || snapshot_id.chars().any(|value| value.is_control()) {
        return Err("Invalid Kopia snapshot identifier.".into());
    }
    let destination = PathBuf::from(destination_directory);
    if !destination.is_dir() {
        return Err("Kopia restore destination must be an existing directory.".into());
    }
    let mut command = command_with_path("kopia");
    command.arg("snapshot").arg("restore").arg(&snapshot_id).arg(&destination);
    let (code, stdout, stderr) = run_bounded(command, PROCESS_TIMEOUT)?;
    if code != 0 {
        return Err(format!("Kopia restore failed: {} {}", stdout.trim(), stderr.trim()));
    }
    append_audit(&app, "kopia-restore", "warning", "Backup/DR", format!("Restored Kopia snapshot {} to explicit destination.", snapshot_id))?;
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_backup_files, copy_live_library_for_backup, inspect_backup, restore_state_with_recovery, recover_pending_restore, snapshot_linked_documents, recover_linked_document_copies, RestoreJournal, RESTORE_JOURNAL_VERSION, retention_candidates,
        reserve_backup_root, role_permissions, supported_backup_domain, validate_home_payload, BackupManifest, DmsIndex, DmsRecord, DmsVersion, BACKUP_VERSION,
    };
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn viewer_is_read_only() {
        let permissions = role_permissions("viewer");
        assert!(permissions.contains(&"dms.read".to_string()));
        assert!(!permissions.contains(&"dms.write".to_string()));
        assert!(!permissions.contains(&"backup.restore".to_string()));
    }

    #[test]
    fn legal_hold_blocks_retention_candidates() {
        let index = DmsIndex {
            version: 1,
            records: vec![DmsRecord {
                id: "r".into(),
                document_id: "d".into(),
                name: "doc".into(),
                tags: vec![],
                retention_days: 1,
                legal_hold: true,
                created_ms: 1,
                updated_ms: 1,
                versions: vec![
                    DmsVersion { id:"v1".into(), created_ms:1, sha256:"a".into(), size_bytes:1, note:String::new(), snapshot_rel_path:"versions/r/v1".into() },
                    DmsVersion { id:"v2".into(), created_ms:2, sha256:"b".into(), size_bytes:1, note:String::new(), snapshot_rel_path:"versions/r/v2".into() },
                ],
            }],
        };
        assert!(retention_candidates(&index, 10_000_000_000).is_empty());
    }

    #[test]
    fn newest_version_is_never_a_retention_candidate() {
        let index = DmsIndex {
            version: 1,
            records: vec![DmsRecord {
                id: "r".into(),
                document_id: "d".into(),
                name: "doc".into(),
                tags: vec![],
                retention_days: 1,
                legal_hold: false,
                created_ms: 1,
                updated_ms: 1,
                versions: vec![
                    DmsVersion { id:"old".into(), created_ms:1, sha256:"a".into(), size_bytes:1, note:String::new(), snapshot_rel_path:"versions/r/old".into() },
                    DmsVersion { id:"new".into(), created_ms:9_000_000_000, sha256:"b".into(), size_bytes:1, note:String::new(), snapshot_rel_path:"versions/r/new".into() },
                ],
            }],
        };
        let candidates = retention_candidates(&index, 10_000_000_000);
        assert!(candidates.iter().any(|candidate| candidate.version_id == "old"));
        assert!(!candidates.iter().any(|candidate| candidate.version_id == "new"));
    }
    fn temp_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        std::env::temp_dir().join(format!("malenjo-phase7-{label}-{nonce}"))
    }

    fn create_test_backup(root: &std::path::Path) -> std::path::PathBuf {
        let backup = root.join("backup");
        let state = backup.join("state");
        fs::create_dir_all(state.join("enterprise")).expect("create backup state");
        fs::write(state.join("enterprise").join("new.txt"), b"new-state").expect("write backup state");
        let mut files = Vec::new();
        collect_backup_files(&state, &state, &mut files).expect("collect backup files");
        let manifest = BackupManifest { version:BACKUP_VERSION, created_ms:1, files };
        fs::write(
            backup.join("manifest-v1.json"),
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        ).expect("write manifest");
        backup
    }

    #[test]
    fn home_preferences_validate_schema_and_size() {
        assert!(validate_home_payload(r#"{"schemaVersion":1,"starredDocumentIds":[],"pinnedLocations":[]}"#).is_ok());
        assert!(validate_home_payload(r#"{"schemaVersion":2,"starredDocumentIds":[],"pinnedLocations":[]}"#).is_err());
        assert!(validate_home_payload("INVALID").is_err());
        assert!(validate_home_payload(&"x".repeat(65537)).is_err());
    }

    #[test]
    fn restores_library_index_and_home_state_with_recovery() {
        let root=temp_root("home-recovery");
        let live=root.join("live");
        fs::create_dir_all(live.join("library")).unwrap();
        fs::write(live.join("library/index.json"),b"old index").unwrap();
        fs::write(live.join("library/home-state-v1.json"),b"old home").unwrap();
        let backup=create_test_backup(&root);
        fs::create_dir_all(backup.join("state/library")).unwrap();
        fs::write(backup.join("state/library/index.json"),b"new index").unwrap();
        fs::write(backup.join("state/library/home-state-v1.json"),b"new home").unwrap();
        let mut files=Vec::new();
        collect_backup_files(&backup.join("state"),&backup.join("state"),&mut files).unwrap();
        let manifest=BackupManifest {version:BACKUP_VERSION,created_ms:1,files};
        fs::write(backup.join("manifest-v1.json"),serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        let recovery=restore_state_with_recovery(&live,&backup).unwrap();
        assert_eq!(fs::read(live.join("library/index.json")).unwrap(),b"new index");
        assert_eq!(fs::read(live.join("library/home-state-v1.json")).unwrap(),b"new home");
        assert_eq!(fs::read(recovery.join("library/index.json")).unwrap(),b"old index");
        assert_eq!(fs::read(recovery.join("library/home-state-v1.json")).unwrap(),b"old home");
        let _=fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_multi_root_install_recovers_prior_state_without_overwriting_sources() {
        let root=temp_root("restore-power-loss");
        fs::create_dir_all(&root).unwrap();
        let prior=root.join("restore-prior-1122");
        fs::create_dir_all(prior.join("enterprise")).unwrap();
        fs::write(prior.join("enterprise/old.txt"), b"previous enterprise").unwrap();
        fs::create_dir_all(root.join("enterprise")).unwrap();
        fs::write(root.join("enterprise/new.txt"), b"incomplete new enterprise").unwrap();
        fs::create_dir_all(root.join("security")).unwrap();
        fs::write(root.join("security/old.txt"), b"original security").unwrap();
        let journal=RestoreJournal {
            version:RESTORE_JOURNAL_VERSION, nonce:"1122".into(),
            original_domains:vec!["enterprise".into(),"security".into()],
            restored_domains:vec!["enterprise".into(),"security".into()],
        };
        fs::write(root.join(".malenjo-restore-pending.json"),
            serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(recover_pending_restore(&root).unwrap());
        assert_eq!(fs::read(root.join("enterprise/old.txt")).unwrap(),b"previous enterprise");
        assert_eq!(fs::read(root.join("security/old.txt")).unwrap(),b"original security");
        assert_eq!(fs::read(root.join("restore-aborted-1122/enterprise/new.txt")).unwrap(),b"incomplete new enterprise");
        assert!(!root.join(".malenjo-restore-pending.json").exists());
        assert!(!recover_pending_restore(&root).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_recovery_journal_fails_closed_without_touching_live_state() {
        let root=temp_root("restore-journal-injection");
        fs::create_dir_all(root.join("enterprise")).unwrap();
        fs::write(root.join("enterprise/safe.txt"),b"unchanged").unwrap();
        let journal=RestoreJournal {
            version:RESTORE_JOURNAL_VERSION, nonce:"../unsafe".into(),
            original_domains:vec!["enterprise".into()],
            restored_domains:vec!["enterprise".into()],
        };
        fs::write(root.join(".malenjo-restore-pending.json"),
            serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(recover_pending_restore(&root).is_err());
        assert_eq!(fs::read(root.join("enterprise/safe.txt")).unwrap(),b"unchanged");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_does_not_recopy_old_linked_archives_before_new_snapshot() {
        let root=temp_root("archive-not-recursive");
        let previous=root.join("live-library");
        fs::create_dir_all(previous.join("linked-archive-v1")).unwrap();
        fs::write(previous.join("linked-archive-v1/old.bin"),b"obsolete huge snapshot").unwrap();
        fs::write(previous.join("index.json"),b"{}").unwrap();
        let state=root.join("backup-library");
        copy_live_library_for_backup(&previous,&state).unwrap();
        assert_eq!(fs::read(state.join("index.json")).unwrap(),b"{}");
        assert!(!state.join("linked-archive-v1").exists());
        assert_eq!(fs::read(previous.join("linked-archive-v1/old.bin")).unwrap(),
            b"obsolete huge snapshot");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_document_backup_reopens_source_bytes_after_original_changes() {
        let root=temp_root("linked-bytes");
        fs::create_dir_all(&root).unwrap();
        let source=root.join("external-report.pdf");
        fs::write(&source,b"%PDF-1.7 original saved snapshot").unwrap();
        let backup=create_test_backup(&root);
        let state=backup.join("state");
        fs::create_dir_all(state.join("library")).unwrap();
        fs::write(state.join("library/index.json"),
            serde_json::to_vec(&serde_json::json!({
                "version":1,
                "documents":[{"id":"doc-a1b2","path":source.to_string_lossy(),
                    "addedMs":1,"lastOpenedMs":null}]
            })).unwrap()).unwrap();
        assert_eq!(snapshot_linked_documents(&state).unwrap(),1);
        let mut files=Vec::new();
        collect_backup_files(&state,&state,&mut files).unwrap();
        fs::write(backup.join("manifest-v1.json"),
            serde_json::to_vec_pretty(&BackupManifest{
                version:BACKUP_VERSION,created_ms:1,files
            }).unwrap()).unwrap();
        assert!(inspect_backup(&backup).unwrap().valid);
        fs::write(&source,b"%PDF-1.7 original edited after backup").unwrap();
        let restored=root.join("restored");
        fs::create_dir(&restored).unwrap();
        let copies=recover_linked_document_copies(&backup,&restored).unwrap();
        assert_eq!(copies.len(),1);
        assert_eq!(copies[0].document_id,"doc-a1b2");
        assert_eq!(fs::read(&copies[0].restored_path).unwrap(),b"%PDF-1.7 original saved snapshot");
        assert_eq!(fs::read(&source).unwrap(),b"%PDF-1.7 original edited after backup");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn linked_document_recovery_refuses_existing_filename_without_overwriting() {
        let root=temp_root("linked-refuse-overwrite");
        fs::create_dir_all(&root).unwrap();
        let source=root.join("original.pdf");
        fs::write(&source,b"original document").unwrap();
        let backup=create_test_backup(&root);
        let state=backup.join("state");
        fs::create_dir_all(state.join("library")).unwrap();
        fs::write(state.join("library/index.json"),
            serde_json::to_vec(&serde_json::json!({
                "version":1,"documents":[{"id":"doc-aa","path":source.to_string_lossy()}]
            })).unwrap()).unwrap();
        snapshot_linked_documents(&state).unwrap();
        let mut files=Vec::new(); collect_backup_files(&state,&state,&mut files).unwrap();
        fs::write(backup.join("manifest-v1.json"),
            serde_json::to_vec(&BackupManifest{
                version:BACKUP_VERSION,created_ms:1,files
            }).unwrap()).unwrap();
        let restored=root.join("restored");
        fs::create_dir(&restored).unwrap();
        let conflict=restored.join("original-recovered-doc-aa.pdf");
        fs::write(&conflict,b"preexisting user work").unwrap();
        assert!(recover_linked_document_copies(&backup,&restored).is_err());
        assert_eq!(fs::read(&conflict).unwrap(),b"preexisting user work");
        assert_eq!(fs::read(&source).unwrap(),b"original document");
        assert_eq!(fs::read_dir(&restored).unwrap().count(),1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_linked_document_prevents_claiming_complete_backup() {
        let root=temp_root("linked-missing");
        let backup=create_test_backup(&root);
        let state=backup.join("state");
        fs::create_dir_all(state.join("library")).unwrap();
        fs::write(state.join("library/index.json"),
            serde_json::to_vec(&serde_json::json!({
                "version":1,"documents":[{"id":"doc-dead","path":
                    root.join("unavailable.pdf").to_string_lossy()}]
            })).unwrap()).unwrap();
        assert!(snapshot_linked_documents(&state).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn offline_restore_keeps_recovery_copy() {
        let root = temp_root("restore");
        let app_data = root.join("app");
        fs::create_dir_all(app_data.join("enterprise")).expect("create app state");
        fs::write(app_data.join("enterprise").join("old.txt"), b"old-state").expect("write old state");
        let backup = create_test_backup(&root);

        let recovery = restore_state_with_recovery(&app_data, &backup).expect("restore state");
        assert_eq!(fs::read(app_data.join("enterprise").join("new.txt")).expect("new state"), b"new-state");
        assert_eq!(fs::read(recovery.join("enterprise").join("old.txt")).expect("recovery state"), b"old-state");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_rejects_hash_valid_files_from_unknown_state_roots() {
        let root=temp_root("unrestorable");
        let backup=create_test_backup(&root);
        fs::create_dir_all(backup.join("state/undocumented")).unwrap();
        fs::write(backup.join("state/undocumented/private.bin"),b"unrestorable").unwrap();
        let mut files=Vec::new();
        collect_backup_files(&backup.join("state"),&backup.join("state"),&mut files).unwrap();
        let manifest=BackupManifest {version:BACKUP_VERSION,created_ms:1,files};
        fs::write(backup.join("manifest-v1.json"),serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        let result=inspect_backup(&backup).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|message|message.contains("restore domain")));
        let _=fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn restore_rejects_symlinked_manifest_even_if_json_is_valid() {
        use std::os::unix::fs::symlink;
        let root=temp_root("manifest-link");
        let backup=create_test_backup(&root);
        let manifest=backup.join("manifest-v1.json");
        let real=backup.join("real-manifest.json");
        fs::rename(&manifest,&real).unwrap();
        symlink(&real,&manifest).unwrap();
        assert!(inspect_backup(&backup).is_err());
        let _=fs::remove_dir_all(root);
    }

    #[test]
    fn only_declared_restore_domains_are_eligible() {
        use std::path::Path;
        for name in ["enterprise/a.json","security/events.jsonl","library/index.json"] {
            assert!(supported_backup_domain(Path::new(name)));
        }
        for name in ["documents/a.pdf","undocumented/data","missing/a.json"] {
            assert!(!supported_backup_domain(Path::new(name)));
        }
    }

    #[test]
    fn a_new_backup_never_reuses_a_prior_snapshot_directory() {
        let root=temp_root("backup-unique-root");
        fs::create_dir_all(&root).unwrap();
        let first=reserve_backup_root(&root).unwrap();
        fs::write(first.join("snapshot-marker"),b"FIRST").unwrap();
        let second=reserve_backup_root(&root).unwrap();
        assert_ne!(first,second);
        assert_eq!(fs::read(first.join("snapshot-marker")).unwrap(),b"FIRST");
        assert!(second.is_dir());
        assert_eq!(fs::read_dir(&second).unwrap().count(),0);
        let _=fs::remove_dir_all(root);
    }

    #[test]
    fn backup_rejects_unlisted_state_files_before_restore() {
        let root=temp_root("unlisted");
        let backup=create_test_backup(&root);
        fs::write(backup.join("state/enterprise/extra.txt"),b"injected").unwrap();
        let result=inspect_backup(&backup).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|error|error.contains("Unlisted file")));
        let _=fs::remove_dir_all(root);
    }

    #[test]
    fn backup_rejects_duplicate_manifest_entries() {
        let root=temp_root("duplicates");
        let backup=create_test_backup(&root);
        let path=backup.join("manifest-v1.json");
        let mut manifest:BackupManifest=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest.files.push(manifest.files[0].clone());
        fs::write(&path,serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        let result=inspect_backup(&backup).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|error|error.contains("Duplicate")));
        let _=fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn backup_rejects_symlinks_in_manifest_or_unlisted_tree() {
        use std::os::unix::fs::symlink;
        let root=temp_root("symlinks");
        let backup=create_test_backup(&root);
        symlink("/etc/hosts",backup.join("state/enterprise/linked.txt")).unwrap();
        assert!(inspect_backup(&backup).is_err());
        let _=fs::remove_dir_all(root);
    }

    #[test]
    fn tampered_backup_fails_integrity_inspection() {
        let root = temp_root("tamper");
        let backup = create_test_backup(&root);
        fs::write(backup.join("state").join("enterprise").join("new.txt"), b"tampered").expect("tamper backup");
        let inspection = inspect_backup(&backup).expect("inspect backup");
        assert!(!inspection.valid);
        assert!(!inspection.errors.is_empty());
        let _ = fs::remove_dir_all(root);
    }

}
