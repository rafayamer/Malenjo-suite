use serde_json::Value;
use std::{fs, path::PathBuf};

const MAX_SUPPORT_BUNDLE_BYTES: usize = 1024 * 1024;

fn sensitive_key(key: &str) -> bool {
    let normalized = key
        .to_ascii_lowercase()
        .replace('-', "")
        .replace('_', "")
        .replace(' ', "");
    if normalized.ends_with("included") {
        return false;
    }
    [
        "password",
        "passwd",
        "passphrase",
        "secret",
        "token",
        "apikey",
        "privatekey",
        "authorization",
        "cookie",
        "credential",
        "ocrtext",
        "documentcontent",
        "documentname",
        "filepath",
        "fullpath",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn redact_json(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if sensitive_key(key) {
                    *nested = Value::String("[REDACTED]".into());
                } else {
                    redact_json(nested);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_json(item);
            }
        }
        Value::String(text) => {
            let lower = text.to_ascii_lowercase();
            if let Some(index) = lower.find("bearer ") {
                let prefix = text[..index].to_string();
                *text = format!("{prefix}Bearer [REDACTED]");
            }
        }
        _ => {}
    }
}

fn validate_destination(destination: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(destination);
    if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("json")) != Some(true) {
        return Err("Diagnostic bundle destination must use a .json extension.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic bundle destination has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("Diagnostic bundle destination directory does not exist.".into());
    }
    if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect diagnostic destination: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Diagnostic destination must be a regular non-symbolic-link file.".into());
        }
    }
    Ok(path)
}

#[tauri::command]
pub fn write_support_bundle(destination: String, contents: String) -> Result<bool, String> {
    if contents.len() > MAX_SUPPORT_BUNDLE_BYTES {
        return Err("Diagnostic bundle exceeds the 1 MiB safety limit.".into());
    }

    let mut value: Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Diagnostic bundle is not valid JSON: {error}"))?;
    redact_json(&mut value);
    let sanitized = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("Unable to serialize diagnostic bundle: {error}"))?;
    if sanitized.len() > MAX_SUPPORT_BUNDLE_BYTES {
        return Err("Sanitized diagnostic bundle exceeds the 1 MiB safety limit.".into());
    }

    let path = validate_destination(&destination)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, sanitized)
        .map_err(|error| format!("Unable to write temporary diagnostic bundle: {error}"))?;

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to replace existing diagnostic bundle: {error}"))?;
    }
    fs::rename(&temp, &path)
        .map_err(|error| format!("Unable to finalize diagnostic bundle: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{redact_json, sensitive_key, MAX_SUPPORT_BUNDLE_BYTES};
    use serde_json::json;

    #[test]
    fn sensitive_fields_are_redacted_but_privacy_booleans_remain() {
        let mut value = json!({
            "password": "hunter2",
            "apiToken": "abc",
            "documentName": "secret.pdf",
            "privacy": {
                "secretsIncluded": false,
                "documentNamesIncluded": false
            },
            "safe": "Malenjo Suite"
        });
        redact_json(&mut value);
        assert_eq!(value["password"], "[REDACTED]");
        assert_eq!(value["apiToken"], "[REDACTED]");
        assert_eq!(value["documentName"], "[REDACTED]");
        assert_eq!(value["privacy"]["secretsIncluded"], false);
        assert_eq!(value["privacy"]["documentNamesIncluded"], false);
        assert_eq!(value["safe"], "Malenjo Suite");
    }

    #[test]
    fn key_classifier_and_bundle_limit_are_bounded() {
        assert!(sensitive_key("private_key"));
        assert!(sensitive_key("filePath"));
        assert!(!sensitive_key("secretsIncluded"));
        assert_eq!(MAX_SUPPORT_BUNDLE_BYTES, 1024 * 1024);
    }
}
