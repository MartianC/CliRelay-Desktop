#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanelNavigationDecision {
    Allow,
    OpenExternal,
    Block,
}

pub const PANEL_WINDOW_LABEL: &str = "panel";

pub fn panel_window_title() -> &'static str {
    crate::APP_DISPLAY_NAME
}

pub fn panel_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/manage")
}

pub fn decide_panel_navigation(current_port: u16, url: &tauri::Url) -> PanelNavigationDecision {
    if is_current_panel_origin(current_port, url) {
        return PanelNavigationDecision::Allow;
    }

    if url.scheme() == "https" && !is_local_host(url.host_str()) {
        return PanelNavigationDecision::OpenExternal;
    }

    PanelNavigationDecision::Block
}

fn is_current_panel_origin(current_port: u16, url: &tauri::Url) -> bool {
    url.scheme() == "http"
        && url.port_or_known_default() == Some(current_port)
        && is_local_host(url.host_str())
}

fn is_local_host(host: Option<&str>) -> bool {
    matches!(host, Some("127.0.0.1" | "localhost"))
}

pub fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    port: u16,
) -> tauri::Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let target_url = tauri::Url::parse(&panel_url(port)).expect("Panel URL 由有效端口构造");

    if let Some(window) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        if window.url().map(|url| url != target_url).unwrap_or(true) {
            window.navigate(target_url)?;
        }
        window.show()?;
        return window.set_focus();
    }

    let app_handle = app.clone();

    let window =
        WebviewWindowBuilder::new(app, PANEL_WINDOW_LABEL, WebviewUrl::External(target_url))
            .title(panel_window_title())
            .inner_size(1200.0, 900.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .on_navigation(move |url| {
                let current_port = current_panel_port(&app_handle).unwrap_or(port);

                match decide_panel_navigation(current_port, url) {
                    PanelNavigationDecision::Allow => true,
                    PanelNavigationDecision::OpenExternal => {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                        false
                    }
                    PanelNavigationDecision::Block => false,
                }
            })
            .build()?;

    window.set_focus()
}

fn current_panel_port<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<u16> {
    use tauri::Manager;

    app.try_state::<crate::commands::SharedDesktopCommandState>()?
        .lock()
        .ok()
        .map(|state| state.service_snapshot().port)
}
