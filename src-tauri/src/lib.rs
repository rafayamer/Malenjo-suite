mod suite;

use suite::{
    ai::{cancel_local_ai, local_ai_chat, local_ai_status},
    enterprise::{
        admin_get_policy, admin_update_policy, automation_list_workflows,
        automation_run_local, automation_save_workflow, create_local_backup,
        dms_apply_retention, dms_list_records, dms_register_document,
        dms_retention_preview, dms_snapshot_record, dms_update_retention,
        inspect_local_backup, kopia_restore_snapshot, kopia_snapshot_app_state,
        kopia_status, restore_local_backup, temporal_start_workflow, temporal_status,
    },
    library::{
        add_library_documents, list_library_documents, open_library_document,
        refresh_library_document, remove_library_document, save_as_library_document,
        stage_library_document, commit_staged_document, discard_staged_document,
    },
    local_services::LocalServiceManager,
    office::{read_office_document, write_office_copy},
    ocr::{cancel_paddle_ocr, paddle_ocr_image, paddle_ocr_status},
    pdf::read_pdf_document,
    security::{
        clamav_scan_document, clamav_status, clear_ephemeral_secret, list_audit_events,
        pyhanko_sign_copy, pyhanko_status, pyhanko_validate_document, record_audit_event,
        store_ephemeral_secret, SecurityState,
    },
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
        .manage(SecurityState::default())
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
            write_office_copy,
            paddle_ocr_status,
            paddle_ocr_image,
            cancel_paddle_ocr,
            local_ai_status,
            local_ai_chat,
            cancel_local_ai,
            record_audit_event,
            list_audit_events,
            store_ephemeral_secret,
            clear_ephemeral_secret,
            clamav_status,
            clamav_scan_document,
            pyhanko_status,
            pyhanko_validate_document,
            pyhanko_sign_copy,
            dms_list_records,
            dms_register_document,
            dms_snapshot_record,
            dms_update_retention,
            dms_retention_preview,
            dms_apply_retention,
            admin_get_policy,
            admin_update_policy,
            automation_list_workflows,
            automation_save_workflow,
            automation_run_local,
            temporal_status,
            temporal_start_workflow,
            create_local_backup,
            inspect_local_backup,
            restore_local_backup,
            kopia_status,
            kopia_snapshot_app_state,
            kopia_restore_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running MALENJO Suite");
}
