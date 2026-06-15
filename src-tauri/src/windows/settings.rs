use super::{WindowSizeSpec, WindowSpec};

pub const SETTINGS_WINDOW_LABEL: &str = "settings";

pub fn settings_window_spec() -> WindowSpec {
    WindowSpec {
        label: SETTINGS_WINDOW_LABEL,
        title: "CliRelay Desktop Settings",
        size: WindowSizeSpec {
            width: 900,
            height: 600,
            min_width: 900,
            min_height: 600,
        },
    }
}

pub fn show_settings_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.show()?;
        return window.set_focus();
    }

    let spec = settings_window_spec();

    WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(spec.title)
    .inner_size(spec.size.width as f64, spec.size.height as f64)
    .min_inner_size(spec.size.min_width as f64, spec.size.min_height as f64)
    .center()
    .build()?;

    Ok(())
}
