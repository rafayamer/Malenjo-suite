mod suite;
use suite::local_services::LocalServiceManager;

#[tauri::command]
fn system_status() -> serde_json::Value {
    serde_json::json!({
        "product": "MALENJO Suite",
        "mode": "student-noncommercial",
        "localFirst": true,
        "networkRequiredAtStartup": false
    })
}

#[tauri::command]
fn local_service_catalog() -> Vec<suite::local_services::ServiceDescriptor> {
    LocalServiceManager::catalog()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_status, local_service_catalog])
        .run(tauri::generate_context!())
        .expect("error while running MALENJO Suite");
}
