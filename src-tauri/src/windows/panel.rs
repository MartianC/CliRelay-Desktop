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

pub fn panel_language_storage_value(locale: crate::settings::DesktopLocale) -> String {
    let language = locale.as_panel_language();
    let payload = serde_json::json!({
        "language": language,
        "state": { "language": language }
    });

    serde_json::to_string(&payload).expect("panel language payload must serialize")
}

pub fn panel_language_sync_script(locale: crate::settings::DesktopLocale, reload: bool) -> String {
    let language = locale.as_panel_language();
    let storage_value = panel_language_storage_value(locale);
    let storage_value_literal =
        serde_json::to_string(&storage_value).expect("storage value must serialize");
    let language_literal = serde_json::to_string(language).expect("language must serialize");
    let reload_script = if reload {
        " window.location.reload();"
    } else {
        ""
    };

    format!(
        "localStorage.setItem('cli-proxy-language', {storage_value_literal}); document.documentElement.lang = {language_literal};{reload_script}",
    )
}

pub fn sync_panel_language<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    locale: crate::settings::DesktopLocale,
    reload: bool,
) -> tauri::Result<()> {
    use tauri::Manager;

    let Some(window) = app.get_webview_window(PANEL_WINDOW_LABEL) else {
        return Ok(());
    };

    window.eval(&panel_language_sync_script(locale, reload))
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
    let locale = current_panel_locale(app);

    if let Some(window) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        if window.url().map(|url| url != target_url).unwrap_or(true) {
            window.navigate(target_url)?;
        } else {
            window.eval(&panel_language_sync_script(locale, false))?;
        }
        window.show()?;
        return window.set_focus();
    }

    let app_handle = app.clone();
    let sync_locale = locale;

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
            .on_page_load(move |window, payload| {
                if window.label() != PANEL_WINDOW_LABEL {
                    return;
                }
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = window.eval(&panel_language_sync_script(sync_locale, false));
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

fn current_panel_locale<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> crate::settings::DesktopLocale {
    use tauri::Manager;

    app.try_state::<crate::commands::SharedDesktopCommandState>()
        .and_then(|state| state.lock().ok().map(|state| state.locale()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::DesktopLocale;

    #[test]
    fn panel_language_storage_value_is_valid_json_string() {
        assert_eq!(
            panel_language_storage_value(DesktopLocale::En),
            r#"{"language":"en","state":{"language":"en"}}"#
        );
    }

    #[test]
    fn panel_language_sync_script_sets_code_proxy_language_key() {
        let script = panel_language_sync_script(DesktopLocale::En, true);

        assert!(script.contains("cli-proxy-language"));
        assert!(script.contains(r#""{\"language\":\"en\",\"state\":{\"language\":\"en\"}}""#));
        assert!(script.contains("window.location.reload()"));
    }
}
