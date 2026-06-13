use serde_json::Value;

fn tauri_config() -> Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json 应是合法 JSON")
}

#[test]
fn tauri_app_display_name_is_consistent() {
    let config = tauri_config();
    let app_name = Some("CliRelay Desktop");

    assert_eq!(
        config.pointer("/productName").and_then(Value::as_str),
        app_name
    );
    assert_eq!(
        config.pointer("/mainBinaryName").and_then(Value::as_str),
        app_name
    );
    assert_eq!(
        config
            .pointer("/bundle/macOS/bundleName")
            .and_then(Value::as_str),
        app_name
    );
}
