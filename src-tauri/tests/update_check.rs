use chrono::{TimeZone, Utc};
use clirelay_desktop_lib::component_update::{
    can_install_clirelay_for_status, safe_archive_entry_path, validate_component_digest,
};
use clirelay_desktop_lib::service::state::ServiceStatus;
use clirelay_desktop_lib::update_check::{
    build_update_check_result, component_releases_api_url, fetch_github_releases_with_timeout,
    is_newer_preview_version, select_component_release, validate_desktop_download_url,
    validate_desktop_preview, ComponentUpdateCandidate, CurrentVersions, GithubRelease,
    GithubReleaseAsset, UpdateSubject, UpstreamComponent, UpstreamInstallScope,
    UpstreamUpdateAction, CLIRELAY_RELEASES_API, CODEPROXY_RELEASES_API, GITHUB_RELEASES_PER_PAGE,
};
use std::io::Write;
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

#[test]
fn preview_semver_compares_prerelease_versions_and_rejects_stable_latest() {
    assert!(is_newer_preview_version("0.0.1-preview.1", "0.0.1-preview.2").unwrap());
    assert!(!is_newer_preview_version("0.0.1-preview.2", "0.0.1-preview.2").unwrap());

    let error = is_newer_preview_version("0.0.1-preview.1", "0.0.2")
        .expect_err("Preview 通道不接受 stable 版本");

    assert!(error.to_string().contains("prerelease"));
}

#[test]
fn desktop_preview_rejects_wrong_channel_and_non_github_download_url() {
    let mut preview = validate_desktop_preview_fixture();
    preview.channel = "stable".to_string();

    let error = validate_desktop_preview(&preview).expect_err("stable channel 应被拒绝");
    assert!(error.to_string().contains("preview"));

    let mut preview = validate_desktop_preview_fixture();
    preview.download_url = Url::parse("https://example.com/app.dmg").unwrap();

    let error = validate_desktop_preview(&preview).expect_err("非 github.com 下载 URL 应被拒绝");
    assert!(error.to_string().contains("github.com"));
    assert!(validate_desktop_download_url(
        &Url::parse(
            "https://github.com/MartianC/CliRelay-Desktop/releases/download/v0.0.1-preview.2/CliRelay-Desktop.dmg"
        )
        .unwrap()
    )
    .is_ok());
}

#[test]
fn release_selection_accepts_only_allowed_component_assets_with_sha256_digest() {
    let release = github_release(
        "v0.4.1",
        vec![
            asset(
                "CliRelay_0.4.1_linux_x64.tar.gz",
                "https://github.com/kittors/CliRelay/releases/download/v0.4.1/CliRelay_0.4.1_linux_x64.tar.gz",
                Some(valid_digest("1")),
            ),
            asset(
                "CliRelay_0.4.1_darwin_arm64.tar.gz",
                "https://github.com/kittors/CliRelay/releases/download/v0.4.1/CliRelay_0.4.1_darwin_arm64.tar.gz",
                Some(valid_digest("2")),
            ),
        ],
    );

    let candidate = select_component_release(&[release], UpstreamComponent::CliRelay)
        .expect("选择应成功")
        .expect("应找到 CliRelay macOS arm64 asset");

    assert_eq!(candidate.version, "v0.4.1");
    assert_eq!(candidate.asset_name, "CliRelay_0.4.1_darwin_arm64.tar.gz");
    assert_eq!(candidate.asset_sha256, "2".repeat(64));

    let bad_url_release = github_release(
        "v0.4.1",
        vec![asset(
            "panel-dist.zip",
            "https://github.com/other/codeProxy/releases/download/v0.4.1/panel-dist.zip",
            Some(valid_digest("3")),
        )],
    );
    let error = select_component_release(&[bad_url_release], UpstreamComponent::CodeProxy)
        .expect_err("非 kittors/codeProxy asset URL 应被拒绝");
    assert!(error.to_string().contains("kittors/codeProxy"));
}

#[test]
fn release_selection_uses_latest_published_release_not_largest_semver() {
    let older_larger_version = github_release_at(
        "v9.9.9",
        Utc.with_ymd_and_hms(2026, 6, 14, 0, 0, 0).unwrap(),
        vec![asset(
            "CliRelay_9.9.9_darwin_arm64.tar.gz",
            "https://github.com/kittors/CliRelay/releases/download/v9.9.9/CliRelay_9.9.9_darwin_arm64.tar.gz",
            Some(valid_digest("4")),
        )],
    );
    let newer_smaller_version = github_release_at(
        "v0.4.1",
        Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap(),
        vec![asset(
            "CliRelay_0.4.1_darwin_arm64.tar.gz",
            "https://github.com/kittors/CliRelay/releases/download/v0.4.1/CliRelay_0.4.1_darwin_arm64.tar.gz",
            Some(valid_digest("5")),
        )],
    );

    let candidate = select_component_release(
        &[older_larger_version, newer_smaller_version],
        UpstreamComponent::CliRelay,
    )
    .expect("选择应成功")
    .expect("应找到发布时间最新的 CliRelay release");

    assert_eq!(candidate.version, "v0.4.1");
    assert_eq!(candidate.asset_sha256, "5".repeat(64));
}

#[test]
fn component_release_api_urls_limit_response_page_size() {
    let clirelay_url = component_releases_api_url(UpstreamComponent::CliRelay);
    let codeproxy_url = component_releases_api_url(UpstreamComponent::CodeProxy);

    assert_eq!(
        clirelay_url,
        format!("{CLIRELAY_RELEASES_API}?per_page={GITHUB_RELEASES_PER_PAGE}")
    );
    assert_eq!(
        codeproxy_url,
        format!("{CODEPROXY_RELEASES_API}?per_page={GITHUB_RELEASES_PER_PAGE}")
    );
}

#[test]
fn github_release_fetch_can_fail_fast_with_a_short_read_timeout() {
    let url = delayed_json_server(Duration::from_millis(350), "[]");
    let started_at = Instant::now();

    let error = fetch_github_releases_with_timeout(&url, Duration::from_millis(80))
        .expect_err("慢响应应被短超时中止");

    assert!(
        started_at.elapsed() < Duration::from_millis(300),
        "短超时没有及时生效，实际耗时 {:?}",
        started_at.elapsed()
    );
    assert!(error.to_string().contains("timed out"));
}

#[test]
fn component_digest_is_required_and_must_be_sha256_hex() {
    assert_eq!(
        validate_component_digest(Some(&valid_digest("a"))).unwrap(),
        "a".repeat(64)
    );

    assert!(validate_component_digest(None).is_err());
    assert!(validate_component_digest(Some("sha512:abc")).is_err());
    assert!(validate_component_digest(Some("sha256:not-hex")).is_err());
}

#[test]
fn archive_entry_paths_reject_zip_slip_and_absolute_paths() {
    let root = std::path::Path::new("/tmp/staging");

    assert_eq!(
        safe_archive_entry_path(root, "panel/manage.html").unwrap(),
        root.join("panel").join("manage.html")
    );
    assert!(safe_archive_entry_path(root, "../manage.html").is_err());
    assert!(safe_archive_entry_path(root, "/tmp/manage.html").is_err());
}

#[test]
fn clirelay_install_is_rejected_for_external_and_transitional_statuses() {
    assert!(can_install_clirelay_for_status(ServiceStatus::Stopped));
    assert!(can_install_clirelay_for_status(ServiceStatus::Running));
    assert!(can_install_clirelay_for_status(ServiceStatus::Unhealthy));
    assert!(can_install_clirelay_for_status(ServiceStatus::Error));

    assert!(!can_install_clirelay_for_status(ServiceStatus::External));
    assert!(!can_install_clirelay_for_status(ServiceStatus::Starting));
    assert!(!can_install_clirelay_for_status(ServiceStatus::Stopping));
}

#[test]
fn update_result_keeps_desktop_open_release_separate_from_upstream_install_action() {
    let result = build_update_check_result(
        CurrentVersions {
            desktop: "0.0.1-preview.1".to_string(),
            clirelay: "v0.4.0".to_string(),
            code_proxy: "v0.4.0".to_string(),
        },
        Some(validate_desktop_preview_fixture()),
        Some(component_candidate(UpdateSubject::CliRelay, "v0.4.1")),
        Some(component_candidate(UpdateSubject::CodeProxy, "v0.4.1")),
        Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap(),
    );

    assert_eq!(result.desktop.action.to_string(), "OpenRelease");
    assert_eq!(
        result.upstream.action,
        UpstreamUpdateAction::InstallInDesktop
    );
    assert_eq!(result.upstream.install_scope, UpstreamInstallScope::Both);
    assert_eq!(
        result.desktop.release_notes_summary,
        vec!["<b>只作为纯文本</b>"]
    );
}

#[test]
fn desktop_update_messages_use_chinese_product_label() {
    let result = build_update_check_result(
        CurrentVersions {
            desktop: "0.0.1-preview.1".to_string(),
            clirelay: "v0.4.0".to_string(),
            code_proxy: "v0.4.0".to_string(),
        },
        None,
        None,
        None,
        Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap(),
    );

    assert_eq!(result.desktop.message, "桌面预览版更新源不可用");
}

#[test]
fn upstream_install_scope_tracks_which_components_have_updates() {
    let current = CurrentVersions {
        desktop: "0.0.1-preview.1".to_string(),
        clirelay: "v0.4.0".to_string(),
        code_proxy: "v0.4.0".to_string(),
    };
    let checked_at = Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap();

    let clirelay_only = build_update_check_result(
        current.clone(),
        None,
        Some(component_candidate(UpdateSubject::CliRelay, "v0.4.1")),
        Some(component_candidate(UpdateSubject::CodeProxy, "v0.4.0")),
        checked_at,
    );
    assert_eq!(
        clirelay_only.upstream.install_scope,
        UpstreamInstallScope::CliRelay
    );

    let codeproxy_only = build_update_check_result(
        current.clone(),
        None,
        Some(component_candidate(UpdateSubject::CliRelay, "v0.4.0")),
        Some(component_candidate(UpdateSubject::CodeProxy, "v0.4.1")),
        checked_at,
    );
    assert_eq!(
        codeproxy_only.upstream.install_scope,
        UpstreamInstallScope::CodeProxy
    );

    let none = build_update_check_result(
        current,
        None,
        Some(component_candidate(UpdateSubject::CliRelay, "v0.4.0")),
        Some(component_candidate(UpdateSubject::CodeProxy, "v0.4.0")),
        checked_at,
    );
    assert_eq!(none.upstream.action, UpstreamUpdateAction::Check);
    assert_eq!(none.upstream.install_scope, UpstreamInstallScope::None);
}

fn validate_desktop_preview_fixture() -> clirelay_desktop_lib::update_check::LatestPreview {
    clirelay_desktop_lib::update_check::LatestPreview {
        channel: "preview".to_string(),
        version: "0.0.1-preview.2".to_string(),
        released_at: Utc.with_ymd_and_hms(2026, 6, 12, 0, 0, 0).unwrap(),
        minimum_macos: "13.0".to_string(),
        clirelay_version: "v0.4.1".to_string(),
        code_proxy_version: "v0.4.1".to_string(),
        release_notes_summary: vec!["<b>只作为纯文本</b>".to_string()],
        release_url: Url::parse("https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.2").unwrap(),
        download_url: Url::parse("https://github.com/MartianC/CliRelay-Desktop/releases/download/v0.0.1-preview.2/CliRelay-Desktop.dmg").unwrap(),
        sha256: "f".repeat(64),
    }
}

fn github_release(tag_name: &str, assets: Vec<GithubReleaseAsset>) -> GithubRelease {
    github_release_at(
        tag_name,
        Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap(),
        assets,
    )
}

fn github_release_at(
    tag_name: &str,
    published_at: chrono::DateTime<Utc>,
    assets: Vec<GithubReleaseAsset>,
) -> GithubRelease {
    GithubRelease {
        tag_name: tag_name.to_string(),
        prerelease: false,
        draft: false,
        published_at,
        html_url: Url::parse(&format!(
            "https://github.com/kittors/CliRelay/releases/tag/{tag_name}"
        ))
        .unwrap(),
        body: Some("<b>纯文本</b>".to_string()),
        assets,
    }
}

fn asset(name: &str, url: &str, digest: Option<String>) -> GithubReleaseAsset {
    GithubReleaseAsset {
        name: name.to_string(),
        browser_download_url: Url::parse(url).unwrap(),
        digest,
    }
}

fn valid_digest(ch: &str) -> String {
    format!("sha256:{}", ch.repeat(64))
}

fn component_candidate(subject: UpdateSubject, version: &str) -> ComponentUpdateCandidate {
    ComponentUpdateCandidate {
        subject,
        version: version.to_string(),
        release_url: Url::parse("https://github.com/kittors/CliRelay/releases/tag/v0.4.1").unwrap(),
        asset_name: match subject {
            UpdateSubject::CliRelay => "CliRelay_0.4.1_darwin_arm64.tar.gz".to_string(),
            UpdateSubject::CodeProxy => "panel-dist.zip".to_string(),
            UpdateSubject::Desktop => "desktop.dmg".to_string(),
        },
        asset_url: Url::parse("https://github.com/kittors/CliRelay/releases/download/v0.4.1/CliRelay_0.4.1_darwin_arm64.tar.gz").unwrap(),
        asset_sha256: "b".repeat(64),
    }
}

fn delayed_json_server(delay: Duration, body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("绑定测试 HTTP server 失败");
    let address = listener
        .local_addr()
        .expect("读取测试 HTTP server 地址失败");

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("接受测试 HTTP 请求失败");
        thread::sleep(delay);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });

    format!("http://{address}/releases")
}
