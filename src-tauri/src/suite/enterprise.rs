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

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes)
        .map_err(|error| format!("Unable to write temporary enterprise state: {error}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to replace enterprise state: {error}"))?;
    }
    fs::rename(&temp, path)
        .map_err(|error| format!("Unable to finalize enterprise state: {error}"))
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
    let version_id = format!("ver-{created_ms}-{}", stable_id("", &source.display().to_string()).trim_start_matches('-'));
    let rel = format!("versions/{record_id}/{version_id}-{}", safe_name(name));
    let destination = dms_root(app)?.join(&rel);
    let parent = destination
        .parent()
        .ok_or_else(|| "DMS snapshot destination has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create DMS version directory: {error}"))?;
    fs::copy(&source, &destination)
        .map_err(|error| format!("Unable to snapshot DMS document: {error}"))?;
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
    let _ = append_audit(&app, "dms-register", "info", &record.name, "Document registered and initial version snapshotted.");
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
    let _ = append_audit(app, "dms-snapshot", "info", &record.name, note);
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
    let _ = append_audit(
        &app,
        "dms-retention",
        "warning",
        &result.name,
        format!("Retention={} days; legal_hold={}.", result.retention_days, result.legal_hold),
    );
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

    let root = dms_root(&app)?;
    let mut removed = 0usize;
    for record in &mut index.records {
        let mut retained = Vec::with_capacity(record.versions.len());
        for version in record.versions.drain(..) {
            if requested.contains(&version.id) {
                let path = root.join(safe_relative(&version.snapshot_rel_path)?);
                if path.exists() {
                    fs::remove_file(&path)
                        .map_err(|error| format!("Unable to remove expired DMS version: {error}"))?;
                }
                removed += 1;
            } else {
                retained.push(version);
            }
        }
        record.versions = retained;
    }
    save_dms(&app, &index)?;
    let _ = append_audit(&app, "dms-retention-apply", "warning", "DMS", format!("Removed {removed} expired version(s)."));
    Ok(removed)
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

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
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
            continue;
        }
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Unable to copy backup file: {error}"))?;
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
        }
    }
    Ok(())
}

fn validate_backup_root(path: &Path) -> Result<BackupManifest, String> {
    let manifest_path = path.join("manifest-v1.json");
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
    let mut errors = Vec::new();
    let mut total_bytes = 0u64;
    for entry in &manifest.files {
        let relative = safe_relative(&entry.path)?;
        let file = path.join("state").join(relative);
        if !file.is_file() {
            errors.push(format!("Missing {}", entry.path));
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
    Ok(BackupInspection {
        valid: errors.is_empty(),
        file_count: manifest.files.len(),
        total_bytes,
        errors,
    })
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

    let backup = destination.join(format!("MALENJO-backup-{}", now_ms()));
    let state = backup.join("state");
    fs::create_dir_all(&state)
        .map_err(|error| format!("Unable to create backup root: {error}"))?;
    let app_data = app.path().app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    copy_dir_recursive(&app_data.join("enterprise"), &state.join("enterprise"))?;
    copy_dir_recursive(&app_data.join("security"), &state.join("security"))?;

    let mut files = Vec::new();
    collect_backup_files(&state, &state, &mut files)?;
    let manifest = BackupManifest { version:BACKUP_VERSION, created_ms:now_ms(), files };
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Unable to serialize backup manifest: {error}"))?;
    fs::write(backup.join("manifest-v1.json"), bytes)
        .map_err(|error| format!("Unable to write backup manifest: {error}"))?;

    let inspection = inspect_backup(&backup)?;
    if !inspection.valid {
        let _ = fs::remove_dir_all(&backup);
        return Err(format!("Backup verification failed: {}", inspection.errors.join("; ")));
    }
    append_audit(&app, "backup-create", "info", "Backup/DR", format!("Created {} verified file(s).", inspection.file_count))?;
    Ok(backup.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn inspect_local_backup(path: String) -> Result<BackupInspection, String> {
    inspect_backup(&PathBuf::from(path))
}

#[tauri::command]
pub fn restore_local_backup(
    app: AppHandle,
    backup_path: String,
) -> Result<bool, String> {
    require_permission(&app, "backup.restore")?;
    let backup = PathBuf::from(backup_path);
    let inspection = inspect_backup(&backup)?;
    if !inspection.valid {
        return Err(format!("Backup integrity check failed: {}", inspection.errors.join("; ")));
    }

    let app_data = app.path().app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let recovery = app_data.join(format!("restore-recovery-{}", now_ms()));
    fs::create_dir_all(&recovery)
        .map_err(|error| format!("Unable to create restore recovery directory: {error}"))?;
    copy_dir_recursive(&app_data.join("enterprise"), &recovery.join("enterprise"))?;
    copy_dir_recursive(&app_data.join("security"), &recovery.join("security"))?;

    let stage = app_data.join(format!("restore-stage-{}", now_ms()));
    fs::create_dir_all(&stage)
        .map_err(|error| format!("Unable to create restore staging directory: {error}"))?;
    copy_dir_recursive(&backup.join("state").join("enterprise"), &stage.join("enterprise"))?;
    copy_dir_recursive(&backup.join("state").join("security"), &stage.join("security"))?;

    let result = (|| -> Result<(), String> {
        if app_data.join("enterprise").exists() { fs::remove_dir_all(app_data.join("enterprise")).map_err(|error| format!("Unable to replace enterprise state: {error}"))?; }
        if app_data.join("security").exists() { fs::remove_dir_all(app_data.join("security")).map_err(|error| format!("Unable to replace security state: {error}"))?; }
        if stage.join("enterprise").exists() { fs::rename(stage.join("enterprise"), app_data.join("enterprise")).map_err(|error| format!("Unable to install enterprise restore: {error}"))?; }
        if stage.join("security").exists() { fs::rename(stage.join("security"), app_data.join("security")).map_err(|error| format!("Unable to install security restore: {error}"))?; }
        Ok(())
    })();

    let _ = fs::remove_dir_all(&stage);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(app_data.join("enterprise"));
        let _ = fs::remove_dir_all(app_data.join("security"));
        let _ = copy_dir_recursive(&recovery.join("enterprise"), &app_data.join("enterprise"));
        let _ = copy_dir_recursive(&recovery.join("security"), &app_data.join("security"));
        return Err(format!("{error}; recovery copy retained at {}.", recovery.display()));
    }

    append_audit(&app, "backup-restore", "warning", "Backup/DR", format!("Restored verified backup; recovery copy retained at {}.", recovery.display()))?;
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
    use super::{retention_candidates, role_permissions, DmsIndex, DmsRecord, DmsVersion};

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
}
