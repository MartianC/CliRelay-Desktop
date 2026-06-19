use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::commands::{ComponentPreparationRuntime, DesktopCommandState};
use crate::windows;

pub fn setup<R: tauri::Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let command_state = DesktopCommandState::from_app(app.handle())?;
    let paths = command_state.paths().clone();

    app.manage(Arc::new(Mutex::new(command_state)));
    app.manage(Arc::new(Mutex::new(ComponentPreparationRuntime::default())));
    app.manage(Mutex::new(windows::DesktopWindowState::new(paths.clone())));

    windows::main::configure_main_window(app.handle(), &paths)?;
    crate::tray::setup(app.handle())?;

    Ok(())
}
