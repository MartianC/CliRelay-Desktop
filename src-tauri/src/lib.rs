pub mod bootstrap;
pub mod commands;
pub mod paths;
pub mod platform;
pub mod service;
pub mod settings;
pub mod windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(windows::handle_run_event);
}
