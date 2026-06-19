pub mod bootstrap;
pub mod commands;
pub mod component_update;
pub mod paths;
pub mod platform;
pub mod runtime_resources;
pub mod service;
pub mod settings;
pub mod tray;
pub mod update_check;
pub mod windows;

pub const APP_DISPLAY_NAME: &str = "CliRelay Desktop";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(bootstrap::setup)
        .on_window_event(windows::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_service_snapshot,
            commands::start_service,
            commands::stop_service,
            commands::restart_service,
            commands::open_panel,
            commands::open_settings,
            commands::open_log_directory,
            commands::open_data_directory,
            commands::copy_endpoint,
            commands::copy_v1_endpoint,
            commands::get_desktop_settings,
            commands::update_desktop_settings,
            commands::check_for_updates,
            commands::get_component_update_preparation,
            commands::prepare_upstream_component_updates,
            commands::apply_prepared_component_updates,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(windows::handle_run_event);
}
