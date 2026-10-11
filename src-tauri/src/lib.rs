mod suite;

use tauri::Manager;

use suite::{
    ai::{cancel_local_ai, local_ai_chat, local_ai_status},
    enterprise::{
        admin_apply_audit_retention, admin_get_policy, admin_update_policy, automation_list_workflows,
        automation_run_local, automation_save_workflow, create_local_backup,
        dms_apply_retention, dms_list_records, dms_register_document,
        dms_retention_preview, dms_snapshot_record, dms_update_retention,
        inspect_local_backup, read_native_home_state, write_native_home_state, kopia_restore_snapshot, kopia_snapshot_app_state,
        kopia_status, restore_local_backup, restore_linked_document_copies, temporal_start_workflow, temporal_status,
    },
    library::{
        add_library_documents, list_library_documents, open_library_document,
        refresh_library_document, remove_library_document, save_as_library_document,
        stage_library_document, commit_staged_document, discard_staged_document,
    },
    local_services::LocalServiceManager,
    office::{read_office_document, write_office_copy},
    ocr::{cancel_paddle_ocr, paddle_ocr_image, paddle_ocr_status},
    pdf::{read_pdf_document, write_pdf_copy, write_pdf_tool_output},
    security::{
        clamav_scan_document, clamav_status, clear_ephemeral_secret, list_audit_events,
        pyhanko_sign_copy, pyhanko_status, pyhanko_validate_document, qpdf_change_permissions_copy, record_audit_event,
        store_ephemeral_secret, SecurityState,
    },
    support::write_support_bundle,
    url_capture::capture_public_https_html,
    cbr::{rar_cbr_status,rar_create_cbr_from_png_zip},
    pdfa::{pdfa_provider_status,convert_validated_pdfa_2b},
    tsa::{local_tsa_status,timestamp_pdf_local_tsa},
    stirling::{
        stirling_core_components, stirling_core_openapi, stirling_core_request, stirling_core_start,
        stirling_core_status, stirling_core_stop,
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
        // Recover an interrupted multi-domain swap before any window can
        // read enterprise, library or security state.
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            suite::enterprise::recover_pending_restore(&app_data)
                .map_err(std::io::Error::other)?;
            Ok(())
        })
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
            write_pdf_copy,
            write_pdf_tool_output,
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
            qpdf_change_permissions_copy,
            dms_list_records,
            dms_register_document,
            dms_snapshot_record,
            dms_update_retention,
            dms_retention_preview,
            dms_apply_retention,
            admin_get_policy,
            admin_update_policy,
            admin_apply_audit_retention,
            automation_list_workflows,
            automation_save_workflow,
            automation_run_local,
            temporal_status,
            temporal_start_workflow,
            create_local_backup,
            read_native_home_state,
            write_native_home_state,
            inspect_local_backup,
            restore_local_backup,
            restore_linked_document_copies,
            kopia_status,
            kopia_snapshot_app_state,
            kopia_restore_snapshot,
            write_support_bundle,
            stirling_core_status,
            stirling_core_components,
            stirling_core_start,
            stirling_core_stop,
            stirling_core_openapi,
            stirling_core_request,
            capture_public_https_html,
            rar_cbr_status,
            rar_create_cbr_from_png_zip,
            pdfa_provider_status,
            convert_validated_pdfa_2b,
            local_tsa_status,
            timestamp_pdf_local_tsa
        ])
        .build(tauri::generate_context!())
        .expect("error while building MALENJO Suite")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                suite::stirling::stop_owned_provider_on_exit();
            }
        });
}
