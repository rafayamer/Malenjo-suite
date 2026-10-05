mod suite;

use suite::{
    library::{
        add_library_documents, list_library_documents, open_library_document,
        refresh_library_document, remove_library_document, save_as_library_document,
        stage_library_document, commit_staged_document, discard_staged_document,
    },
    local_services::LocalServiceManager,
    office::{read_office_document, write_office_copy},
    pdf::read_pdf_document,
};

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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            system_status,
            local_service_catalog,
            list_library_documents,
            add_library_documents,
            open_library_document,
            refresh_library_document,
            remove_library_document,
            save_as_library_document,
            stage_library_document,
            commit_staged_document,
            discard_staged_document,
            read_pdf_document,
            read_office_document,
            write_office_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running MALENJO Suite");
}
