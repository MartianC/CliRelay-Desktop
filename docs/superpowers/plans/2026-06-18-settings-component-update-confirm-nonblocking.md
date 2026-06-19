# Settings 更新组件确认、后台准备与重启应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户点击“更新组件”后，Desktop 不弹确认框，直接在后台下载、校验、解压并暂存组件；Settings 窗口可以关闭。准备完成后按钮变为“重启”，用户点击“重启”时先弹确认框，确认后再停止服务、替换组件并重启 Desktop 应用。

**Architecture:** 更新流程拆成“准备”和“应用”两个阶段。准备阶段由 Rust 后台任务持有状态，负责下载、校验、解压和写入 `update-staging`，不弹确认框、不读取或阻断当前服务状态、不停止服务、不替换运行组件，Settings 窗口关闭后仍可继续；应用阶段只在用户点击“重启”并确认后执行，消费已准备好的 staging，按需停止自管 CliRelay 服务，原子替换组件，刷新运行时组件记录，然后调用 `AppHandle::request_restart()` 重启应用。

**Tech Stack:** React 19、Vitest、Tauri 2、`@tauri-apps/plugin-dialog`、`tauri-plugin-dialog`、Rust 1.77.2、`ureq`、`tauri::async_runtime::spawn_blocking`、`AppHandle::request_restart()`。

---

## 调查结论

- `src/components/SettingsView.tsx:139-146` 的“更新组件”按钮直接触发安装，没有系统确认框，也没有准备/重启两个阶段。
- `src/stores/settingsStore.ts:270-288` 只有一次性 `installUpdates()`，没有“后台准备中”“准备完成待重启”“正在应用并重启”的状态。
- `src-tauri/src/commands.rs:544-634` 的 `install_upstream_component_updates` 把下载、SHA-256 校验、解压、停服务、替换目录和重启服务混在一个同步 command 里。旧单阶段流程会立即进入替换路径，无法满足“先后台准备，之后按钮变重启”的交互。
- `src-tauri/src/component_update.rs` 已经有 `update_downloads_dir` 和 `update_staging_dir`，适合把下载包和解压结果保存在准备阶段；但 `install_clirelay_update()`、`install_codeproxy_update()` 当前会在同一个函数里完成替换，需要拆成 prepare/apply 两组 helper。
- 当前项目没有 dialog 插件：`src-tauri/Cargo.toml` 只有 `tauri-plugin-opener`，`package.json` 只有 `@tauri-apps/plugin-opener`，`src-tauri/capabilities/settings.json` 也没有 dialog 权限。

## 行为要求

1. 点击“更新组件”后不弹确认框，直接启动后台准备：下载、校验、解压、整理 staging。
2. 准备阶段不受当前服务状态影响：即使 CliRelay 正在 Running、External、Starting 或 Stopping，也不阻断下载、校验和解压。
3. 后台准备状态必须放在 Rust 侧共享状态中，Settings 窗口关闭后任务继续运行；重新打开 Settings 时读取最新准备状态。
4. 准备中按钮显示“准备中...”和 spinner。
5. 准备完成后按钮显示“重启”。
6. 用户点击“重启”后先出现系统确认框；确认后才执行停止服务、替换组件和重启 Desktop 应用。
7. 包含 CliRelay 的更新只在重启应用阶段重新检查服务状态；准备阶段不因为 `External`、`Starting`、`Stopping` 或其他状态禁用按钮。

## Windows 原生对话框判断

采用 Tauri v2 的 dialog 插件后，前端仍调用同一个 `confirm()` API。该插件提供原生系统对话框，并支持 `windows`、`macos`、`linux` 等桌面平台；后期发布 Windows 时不需要把业务代码切换成 Windows 专用 API。需要做的是在 Windows 构建上保留同一插件和 capability 权限，系统会按平台显示原生样式。

## 文件结构

- Modify: `package.json`
  - 新增 `@tauri-apps/plugin-dialog`。
- Modify: `pnpm-lock.yaml`
  - 锁定 JS dialog 插件版本。
- Modify: `src-tauri/Cargo.toml`
  - 新增 `tauri-plugin-dialog = "2"`。
- Modify: `src-tauri/Cargo.lock`
  - 锁定 Rust dialog 插件版本。
- Modify: `src-tauri/src/lib.rs`
  - 初始化 `tauri_plugin_dialog::init()`。
  - 注册新的准备、查询和应用命令。
- Modify: `src-tauri/capabilities/settings.json`
  - 只给 settings 窗口新增 `dialog:allow-message` 权限。
- Modify: `src/bridge/types.ts`
  - 新增组件准备状态、准备快照和应用结果类型。
- Modify: `src/bridge/commands.ts`
  - 封装重启确认对话框、准备命令、准备状态查询命令、应用并重启命令。
- Modify: `src/bridge/commands.test.ts`
  - 覆盖重启确认文案、运行中提醒、准备/查询/应用命令参数映射。
- Modify: `src/stores/settingsStore.ts`
  - 新增 `componentPreparation`、`isPreparingUpdates`、`isApplyingPreparedUpdate` 状态。
  - 点击“更新组件”后直接启动后台准备；准备完成后不安装，只让 UI 进入“重启”状态。
  - 点击“重启”时调用系统确认框，确认后才调用应用并重启命令。
  - `load()` 和 Settings 打开时查询 Rust 侧准备状态，支持窗口关闭后恢复 UI。
- Modify: `src/stores/settingsStore.test.ts`
  - 覆盖准备阶段不弹确认、准备中防重复、关闭窗口后状态恢复、准备完成按钮变重启、取消重启确认不应用、应用阶段调用替换并重启命令。
- Modify: `src/components/SettingsView.tsx`
  - 把按钮状态拆成“更新组件”“准备中...”“重启”“重启中...”。
  - 准备按钮不因服务状态禁用；重启按钮把服务状态和准备范围传给重启确认流程。
- Modify: `src/components/SettingsView.test.tsx`
  - 补齐新 prop 并覆盖准备中、准备完成、应用中按钮渲染。
- Modify: `tests/update_check.test.ts`
  - 更新 update section 测试，确保“立即检查”、后台准备和“重启”状态互不串扰。
- Modify: `src/styles/app.css`
  - 给更新按钮加稳定宽度，避免 spinner 和文案切换时布局跳动。
- Modify: `src-tauri/src/component_update.rs`
  - 把现有 install helper 拆成 prepare/apply helper。
  - prepare helper 下载、校验、解压、整理 staging。
  - apply helper 从 staging 进行备份、原子替换和组件记录更新。
- Modify: `src-tauri/src/commands.rs`
  - 新增 Rust 侧准备状态 runtime。
  - 新增 `prepare_upstream_component_updates`、`get_component_update_preparation`、`apply_prepared_component_updates`。
  - 移除或废弃旧的单阶段 `install_upstream_component_updates` 调用路径。
- Modify: `src-tauri/src/bootstrap.rs`
  - `app.manage()` 新的组件准备 runtime，使 Settings 窗口关闭后准备状态仍保存在应用进程中。

### Task 1: 接入 Tauri 原生 dialog 插件

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/settings.json`

- [ ] **Step 1: 安装 dialog 插件依赖**

Run:

```bash
pnpm tauri add dialog
```

Expected:

```text
package.json 增加 @tauri-apps/plugin-dialog
src-tauri/Cargo.toml 增加 tauri-plugin-dialog
```

原因：确认框必须是系统原生对话框；Tauri 官方 dialog 插件能在 macOS、Windows、Linux 复用同一业务调用。

- [ ] **Step 2: 初始化 Rust 插件并注册新命令**

在 `src-tauri/src/lib.rs` 的 builder 中保留 opener，并新增 dialog；命令列表从旧的单阶段安装改为准备、查询、应用：

```rust
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
```

原因：新流程需要三个后端入口：读准备状态、启动后台准备、应用 staging 并重启应用。

- [ ] **Step 3: 只给 Settings 窗口添加 message 对话框权限**

把 `src-tauri/capabilities/settings.json` 的 permissions 更新为：

```json
[
  "core:app:default",
  "core:event:default",
  "core:window:default",
  "opener:allow-open-url",
  "opener:allow-default-urls",
  "dialog:allow-message"
]
```

原因：`confirm()` 在 Tauri v2 中是 message dialog 的 Ok/Cancel 包装；只授予 settings 窗口需要的最小权限。

### Task 2: 定义前端两阶段更新契约

**Files:**
- Modify: `src/bridge/types.ts`
- Modify: `src/bridge/commands.ts`
- Modify: `src/bridge/commands.test.ts`

- [ ] **Step 1: 在类型层增加准备状态和应用结果**

在 `src/bridge/types.ts` 增加：

```ts
export type ComponentPreparationStatus = "Idle" | "Preparing" | "Ready" | "Failed";

export interface ComponentUpdatePreparationSnapshot {
  status: ComponentPreparationStatus;
  installScope: UpstreamInstallScope;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ComponentApplyResult {
  status: "Applied" | "NoPreparedUpdate";
  message: string;
  appliedScope: UpstreamInstallScope;
}
```

原因：UI 不需要知道后台 staging 目录和内部 candidate，只需要知道准备状态、范围、文案和错误；内部准备数据留在 Rust 侧，避免泄漏实现细节。

- [ ] **Step 2: 先写失败测试，重启确认文案说明会应用更新并重启**

在 `src/bridge/commands.test.ts` 增加 dialog mock：

```ts
import { confirm } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

const confirmMock = vi.mocked(confirm);
```

把 `confirmPreparedComponentUpdateRestart` 加进 `./commands` import，并在 `beforeEach` 里补充：

```ts
confirmMock.mockReset();
```

增加测试：

```ts
test("组件重启确认框说明确认后才停止服务替换组件", async () => {
  confirmMock.mockResolvedValueOnce(true);

  await expect(
    confirmPreparedComponentUpdateRestart({
      installScope: "Both",
      serviceStatus: "Running",
    }),
  ).resolves.toBe(true);

  expect(confirmMock).toHaveBeenCalledWith(
    [
      "CliRelay 和 codeProxy 更新已准备好。",
      "确认重启后会停止相关服务、替换已准备好的组件，并重启 Desktop 应用。",
      "当前 CliRelay 服务正在运行，重启前会先停止服务。",
      "现在重启并应用更新吗？",
    ].join("\n"),
    {
      title: "确认重启并应用更新",
      kind: "warning",
      okLabel: "重启",
      cancelLabel: "取消",
    },
  );
});
```

Expected before implementation:

```text
FAIL  src/bridge/commands.test.ts
confirmPreparedComponentUpdateRestart is not defined
```

原因：准备阶段不弹窗；唯一确认框必须出现在用户点击“重启”之后，并明确说明确认后才会停服务、替换组件和重启应用。

- [ ] **Step 3: 实现重启确认 helper 和命令 wrapper**

在 `src/bridge/commands.ts` 顶部新增 import：

```ts
import { confirm } from "@tauri-apps/plugin-dialog";
```

新增 helper 和命令：

```ts
export interface PreparedComponentUpdateRestartConfirmation {
  installScope: UpstreamInstallScope;
  serviceStatus: ServiceStatus;
}

export async function confirmPreparedComponentUpdateRestart(
  context: PreparedComponentUpdateRestartConfirmation,
): Promise<boolean> {
  return confirm(buildPreparedComponentUpdateRestartMessage(context), {
    title: "确认重启并应用更新",
    kind: isServiceRestartRequiredForPreparedComponentApply(context) ? "warning" : "info",
    okLabel: "重启",
    cancelLabel: "取消",
  });
}

export function buildPreparedComponentUpdateRestartMessage(
  context: PreparedComponentUpdateRestartConfirmation,
): string {
  const lines = [
    `${componentUpdateScopeLabel(context.installScope)} 更新已准备好。`,
    "确认重启后会停止相关服务、替换已准备好的组件，并重启 Desktop 应用。",
  ];

  if (isServiceRestartRequiredForPreparedComponentApply(context)) {
    lines.push("当前 CliRelay 服务正在运行，重启前会先停止服务。");
  }

  lines.push("现在重启并应用更新吗？");
  return lines.join("\n");
}

export function isServiceRestartRequiredForPreparedComponentApply({
  installScope,
  serviceStatus,
}: PreparedComponentUpdateRestartConfirmation): boolean {
  return (
    installScopeIncludesCliRelay(installScope) &&
    (serviceStatus === "Running" || serviceStatus === "Unhealthy")
  );
}

export async function getComponentUpdatePreparation(): Promise<ComponentUpdatePreparationSnapshot> {
  return toComponentUpdatePreparationSnapshot(
    await invoke<RawComponentUpdatePreparationSnapshot>("get_component_update_preparation"),
  );
}

export async function prepareUpstreamComponentUpdates(
  installScope: UpstreamInstallScope,
): Promise<ComponentUpdatePreparationSnapshot> {
  return toComponentUpdatePreparationSnapshot(
    await invoke<RawComponentUpdatePreparationSnapshot>("prepare_upstream_component_updates", {
      installScope,
    }),
  );
}

export async function applyPreparedComponentUpdates(): Promise<ComponentApplyResult> {
  return toComponentApplyResult(
    await invoke<RawComponentApplyResult>("apply_prepared_component_updates"),
  );
}
```

原因：准备命令只负责启动后台下载、校验和解压，不弹窗也不读取服务状态；重启确认 helper 只在应用阶段使用。

- [ ] **Step 4: 运行 bridge 测试**

Run:

```bash
pnpm vitest run src/bridge/commands.test.ts
```

Expected:

```text
PASS  src/bridge/commands.test.ts
```

### Task 3: 拆分 Rust 组件 prepare/apply helper

**Files:**
- Modify: `src-tauri/src/component_update.rs`

- [ ] **Step 1: 增加准备阶段内部数据结构**

在 `src-tauri/src/component_update.rs` 增加：

```rust
#[derive(Clone, Debug)]
pub struct PreparedComponentUpdate {
    pub install_scope: crate::update_check::UpstreamInstallScope,
    pub clirelay: Option<PreparedComponentArtifact>,
    pub code_proxy: Option<PreparedComponentArtifact>,
    pub prepared_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PreparedComponentArtifact {
    pub candidate: ComponentUpdateCandidate,
    pub prepared_dir: PathBuf,
}
```

原因：后台内部需要保留 candidate 和 staging 路径，应用阶段才能只做替换；这些字段不直接序列化给前端。

- [ ] **Step 2: 将 CliRelay 安装拆成准备和应用**

把原 `install_clirelay_update()` 拆成：

```rust
pub fn prepare_clirelay_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<PreparedComponentArtifact, ComponentUpdateError> {
    if candidate.subject != UpdateSubject::CliRelay {
        return Err(ComponentUpdateError::InvalidArchivePath(
            candidate.asset_name.clone(),
        ));
    }

    validate_component_asset_url(&candidate.asset_url, UpstreamComponent::CliRelay)?;
    let archive_path = download_asset(paths, "clirelay", candidate)?;
    verify_file_sha256(&archive_path, &candidate.asset_sha256)?;

    let staging = paths
        .update_staging_dir
        .join("clirelay")
        .join(&candidate.version);
    replace_dir_with_empty(&staging)?;
    unpack_tar_gz(&archive_path, &staging)?;

    let binary = find_file_named(&staging, "cli-proxy-api")?
        .ok_or_else(|| ComponentUpdateError::MissingCliRelayBinary(staging.clone()))?;
    set_executable(&binary)?;

    let prepared_dir = staging.join("sidecar");
    replace_dir_with_empty(&prepared_dir)?;
    fs::copy(&binary, prepared_dir.join("cli-proxy-api"))?;
    set_executable(&prepared_dir.join("cli-proxy-api"))?;

    Ok(PreparedComponentArtifact {
        candidate: candidate.clone(),
        prepared_dir,
    })
}

pub fn apply_prepared_clirelay_update(
    paths: &DesktopPaths,
    artifact: &PreparedComponentArtifact,
    service_status: ServiceStatus,
) -> Result<(), ComponentUpdateError> {
    if !can_install_clirelay_for_status(service_status.clone()) {
        return Err(ComponentUpdateError::InvalidServiceStatus(service_status));
    }

    let binary = artifact.prepared_dir.join("cli-proxy-api");
    if !binary.is_file() {
        return Err(ComponentUpdateError::MissingCliRelayBinary(
            artifact.prepared_dir.clone(),
        ));
    }

    let backup = backup_existing(
        &paths.runtime_sidecar_dir,
        paths,
        "clirelay",
        &artifact.candidate.version,
    )?;
    atomic_replace_dir_with_restore(
        &artifact.prepared_dir,
        &paths.runtime_sidecar_dir,
        backup.as_deref(),
    )?;
    update_component_record(paths, &artifact.candidate)?;

    Ok(())
}
```

原因：下载、校验、解压和 staging 整理发生在准备阶段；备份、原子替换和组件记录更新只能在用户点击“重启”后的应用阶段发生。

- [ ] **Step 3: 将 codeProxy 安装拆成准备和应用**

把原 `install_codeproxy_update()` 拆成：

```rust
pub fn prepare_codeproxy_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<PreparedComponentArtifact, ComponentUpdateError> {
    if candidate.subject != UpdateSubject::CodeProxy {
        return Err(ComponentUpdateError::InvalidArchivePath(
            candidate.asset_name.clone(),
        ));
    }

    validate_component_asset_url(&candidate.asset_url, UpstreamComponent::CodeProxy)?;
    let archive_path = download_asset(paths, "codeproxy", candidate)?;
    verify_file_sha256(&archive_path, &candidate.asset_sha256)?;

    let prepared_dir = paths
        .update_staging_dir
        .join("codeproxy")
        .join(&candidate.version)
        .join("panel");
    replace_dir_with_empty(&prepared_dir)?;
    unpack_zip(&archive_path, &prepared_dir)?;

    let entrypoint = prepared_dir.join("manage.html");
    if !entrypoint.is_file() {
        return Err(ComponentUpdateError::MissingPanelEntrypoint(entrypoint));
    }

    Ok(PreparedComponentArtifact {
        candidate: candidate.clone(),
        prepared_dir,
    })
}

pub fn apply_prepared_codeproxy_update(
    paths: &DesktopPaths,
    artifact: &PreparedComponentArtifact,
) -> Result<(), ComponentUpdateError> {
    let entrypoint = artifact.prepared_dir.join("manage.html");
    if !entrypoint.is_file() {
        return Err(ComponentUpdateError::MissingPanelEntrypoint(entrypoint));
    }

    let backup = backup_existing(
        &paths.panel_dir,
        paths,
        "codeproxy",
        &artifact.candidate.version,
    )?;
    atomic_replace_dir_with_restore(&artifact.prepared_dir, &paths.panel_dir, backup.as_deref())?;
    update_component_record(paths, &artifact.candidate)?;

    Ok(())
}
```

原因：codeProxy 也要遵守同样的两阶段模型；准备阶段只写 staging，应用阶段才替换 `runtime/panel`。

### Task 4: 后端新增后台准备状态和应用重启命令

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/bootstrap.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 增加可序列化准备快照和内部 runtime**

在 `src-tauri/src/commands.rs` 增加：

```rust
pub type SharedComponentPreparationRuntime = Arc<Mutex<ComponentPreparationRuntime>>;

#[derive(Default)]
pub struct ComponentPreparationRuntime {
    snapshot: ComponentUpdatePreparationSnapshot,
    prepared: Option<PreparedComponentUpdate>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUpdatePreparationSnapshot {
    pub status: ComponentPreparationStatus,
    pub install_scope: UpstreamInstallScope,
    pub message: String,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub enum ComponentPreparationStatus {
    #[default]
    Idle,
    Preparing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentApplyResult {
    pub status: ComponentApplyStatus,
    pub message: String,
    pub applied_scope: UpstreamInstallScope,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ComponentApplyStatus {
    Applied,
    NoPreparedUpdate,
}
```

原因：给前端的状态必须可序列化；内部 `PreparedComponentUpdate` 可以继续保留不可序列化的 `Url`、路径和 candidate。

- [ ] **Step 2: 在 bootstrap 中托管准备 runtime**

在 `src-tauri/src/bootstrap.rs` 中创建并托管：

```rust
use crate::commands::{ComponentPreparationRuntime, DesktopCommandState};

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
```

原因：React store 和 Settings 窗口生命周期都不可靠；准备状态必须绑定到 Desktop 应用进程。

- [ ] **Step 3: 实现准备状态查询命令**

新增：

```rust
#[tauri::command]
pub fn get_component_update_preparation(
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
) -> Result<ComponentUpdatePreparationSnapshot, CommandError> {
    let preparation = preparation
        .lock()
        .map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(preparation.snapshot.clone())
}
```

原因：Settings 窗口重新打开时需要恢复“准备中”或“重启”按钮状态。

- [ ] **Step 4: 实现启动后台准备命令**

新增：

```rust
#[tauri::command]
pub fn prepare_upstream_component_updates(
    state: tauri::State<'_, SharedDesktopCommandState>,
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
    install_scope: UpstreamInstallScope,
) -> Result<ComponentUpdatePreparationSnapshot, CommandError> {
    if install_scope == UpstreamInstallScope::None {
        return Err(CommandError::ComponentUpdate(
            "没有可准备的上游组件更新".to_string(),
        ));
    }

    let started_at = chrono::Utc::now();
    {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        if preparation.snapshot.status == ComponentPreparationStatus::Preparing {
            return Ok(preparation.snapshot.clone());
        }
        preparation.prepared = None;
        preparation.snapshot = ComponentUpdatePreparationSnapshot {
            status: ComponentPreparationStatus::Preparing,
            install_scope: install_scope.clone(),
            message: "正在后台准备组件更新".to_string(),
            started_at: Some(started_at),
            finished_at: None,
            error: None,
        };
    }

    let state = state.inner().clone();
    let preparation = preparation.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = prepare_upstream_component_updates_blocking(&state, install_scope.clone());
        let mut preparation = match preparation.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let finished_at = chrono::Utc::now();
        match result {
            Ok(prepared) => {
                let prepared_scope = prepared.install_scope.clone();
                preparation.prepared = Some(prepared);
                preparation.snapshot = ComponentUpdatePreparationSnapshot {
                    status: ComponentPreparationStatus::Ready,
                    install_scope: prepared_scope,
                    message: "组件更新已准备好，点击重启完成替换".to_string(),
                    started_at: Some(started_at),
                    finished_at: Some(finished_at),
                    error: None,
                };
            }
            Err(error) => {
                preparation.prepared = None;
                preparation.snapshot = ComponentUpdatePreparationSnapshot {
                    status: ComponentPreparationStatus::Failed,
                    install_scope,
                    message: "组件更新准备失败".to_string(),
                    started_at: Some(started_at),
                    finished_at: Some(finished_at),
                    error: Some(error.to_string()),
                };
            }
        }
    });

    get_component_update_preparation(preparation)
}
```

原因：command 立即返回“Preparing”，真正下载和解压在后台 blocking 线程运行；Settings 窗口关闭不会取消已启动的 Rust 任务。

- [ ] **Step 5: 实现准备阶段 blocking 逻辑**

新增：

```rust
fn prepare_upstream_component_updates_blocking(
    state: &SharedDesktopCommandState,
    install_scope: UpstreamInstallScope,
) -> Result<PreparedComponentUpdate, CommandError> {
    let paths = {
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.paths.clone()
    };

    let clirelay_candidate = if matches!(
        install_scope,
        UpstreamInstallScope::CliRelay | UpstreamInstallScope::Both
    ) {
        fetch_component_candidate(UpstreamComponent::CliRelay)?
    } else {
        None
    };
    let codeproxy_candidate = if matches!(
        install_scope,
        UpstreamInstallScope::CodeProxy | UpstreamInstallScope::Both
    ) {
        fetch_component_candidate(UpstreamComponent::CodeProxy)?
    } else {
        None
    };

    let clirelay = match clirelay_candidate.as_ref() {
        Some(candidate) => Some(prepare_clirelay_update(&paths, candidate)?),
        None => None,
    };
    let code_proxy = match codeproxy_candidate.as_ref() {
        Some(candidate) => Some(prepare_codeproxy_update(&paths, candidate)?),
        None => None,
    };

    Ok(PreparedComponentUpdate {
        install_scope,
        clirelay,
        code_proxy,
        prepared_at: chrono::Utc::now(),
    })
}
```

原因：准备阶段不能持有 `DesktopCommandState` 锁执行网络下载，否则服务控制和其他命令会被长时间阻塞。

- [ ] **Step 6: 实现应用 staging 并请求重启命令**

新增：

```rust
#[tauri::command]
pub fn apply_prepared_component_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
) -> Result<ComponentApplyResult, CommandError> {
    let prepared = {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        preparation.prepared.take()
    };

    let Some(prepared) = prepared else {
        return Ok(ComponentApplyResult {
            status: ComponentApplyStatus::NoPreparedUpdate,
            message: "没有已准备好的组件更新".to_string(),
            applied_scope: UpstreamInstallScope::None,
        });
    };

    let applied_scope = apply_prepared_component_updates_blocking(&state, &prepared)?;

    {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        preparation.snapshot = ComponentUpdatePreparationSnapshot::default();
        preparation.prepared = None;
    }

    app.request_restart();

    Ok(ComponentApplyResult {
        status: ComponentApplyStatus::Applied,
        message: "组件更新已应用，正在重启 Desktop".to_string(),
        applied_scope,
    })
}
```

原因：只有用户点击“重启”后才消费准备结果；替换完成后由 Tauri 统一请求应用重启。

- [ ] **Step 7: 实现应用阶段业务逻辑**

新增：

```rust
fn apply_prepared_component_updates_blocking(
    state: &SharedDesktopCommandState,
    prepared: &PreparedComponentUpdate,
) -> Result<UpstreamInstallScope, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    let mut applied_clirelay = false;
    let mut applied_codeproxy = false;
    let mut stopped_for_apply = false;

    if let Some(artifact) = prepared.clirelay.as_ref() {
        let status = state.manager.status();
        match status {
            ServiceStatus::Running | ServiceStatus::Unhealthy => {
                if state.manager.ownership() != ProcessOwnership::Owned {
                    return Err(CommandError::ComponentUpdate(
                        "只允许更新 Desktop 自管 CliRelay 服务".to_string(),
                    ));
                }
                state.manager.stop_service()?;
                stopped_for_apply = true;
            }
            ServiceStatus::External | ServiceStatus::Starting | ServiceStatus::Stopping => {
                return Err(ComponentUpdateError::InvalidServiceStatus(status).into());
            }
            ServiceStatus::Stopped | ServiceStatus::Error => {}
        }

        apply_prepared_clirelay_update(&state.paths, artifact, state.manager.status())?;
        applied_clirelay = true;
        state.refresh_runtime_components();
    }

    if let Some(artifact) = prepared.code_proxy.as_ref() {
        apply_prepared_codeproxy_update(&state.paths, artifact)?;
        applied_codeproxy = true;
        state.refresh_runtime_components();
    }

    if stopped_for_apply {
        let _ = append_desktop_log_line(&state.paths, "组件更新已停止 CliRelay，Desktop 重启后由启动策略恢复服务");
    }

    Ok(match (applied_clirelay, applied_codeproxy) {
        (true, true) => UpstreamInstallScope::Both,
        (true, false) => UpstreamInstallScope::CliRelay,
        (false, true) => UpstreamInstallScope::CodeProxy,
        (false, false) => UpstreamInstallScope::None,
    })
}
```

原因：应用阶段必须在替换前重新检查服务状态，因为准备完成后用户可能启动、停止或外部占用服务；重启应用替代旧流程中的“安装后重启服务”。

### Task 5: Store 支持准备状态恢复和重启应用阶段

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/settingsStore.test.ts`
- Modify: `tests/update_check.test.ts`

- [ ] **Step 1: 修改 store 类型和默认状态**

在 `src/stores/settingsStore.ts` 中把旧 `installUpdates()` 改为：

```ts
export interface ComponentPreparedUpdateApplyOptions {
  serviceStatus: ServiceStatus;
}

export interface SettingsStoreState {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentApplyResult | null;
  componentPreparation: ComponentUpdatePreparationSnapshot | null;
  error: string | null;
  isBusy: boolean;
  isCheckingUpdates: boolean;
  isPreparingUpdates: boolean;
  isApplyingPreparedUpdate: boolean;
}

export interface SettingsStore {
  getState(): SettingsStoreState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  setDraft(patch: Partial<SettingsDraft>): void;
  checkUpdates(): Promise<void>;
  prepareUpdates(): Promise<void>;
  refreshComponentPreparation(): Promise<void>;
  applyPreparedUpdate(options: ComponentPreparedUpdateApplyOptions): Promise<void>;
}
```

原因：安装结果语义改为应用结果；准备阶段不需要服务状态，重启确认阶段才需要当前服务状态来展示停服务提醒。

- [ ] **Step 2: 先写失败测试，load 时恢复 Rust 侧准备状态**

在 `src/stores/settingsStore.test.ts` 增加：

```ts
test("load 时恢复已准备好的组件更新状态", async () => {
  const store = createSettingsStore({
    getDesktopSettings: vi.fn(async () => loadedSettings),
    updateDesktopSettings: vi.fn(),
    checkForUpdates: vi.fn(async () => updateResult("Both")),
    getComponentUpdatePreparation: vi.fn(async () => ({
      status: "Ready",
      installScope: "Both",
      message: "组件更新已准备好，点击重启完成替换",
      startedAt: "2026-06-18T10:00:00Z",
      finishedAt: "2026-06-18T10:01:00Z",
      error: null,
    })),
    prepareUpstreamComponentUpdates: vi.fn(),
    applyPreparedComponentUpdates: vi.fn(),
    confirmPreparedComponentUpdateRestart: vi.fn(async () => true),
  });

  await store.load();

  expect(store.getState().componentPreparation?.status).toBe("Ready");
  expect(store.getState().isPreparingUpdates).toBe(false);
});
```

Expected before implementation:

```text
FAIL  src/stores/settingsStore.test.ts
getComponentUpdatePreparation does not exist in type SettingsCommands
```

原因：Settings 窗口关闭再打开时，UI 必须能把按钮恢复为“重启”。

- [ ] **Step 3: 先写失败测试，点击更新组件直接启动准备，不弹确认也不应用更新**

追加：

```ts
test("点击更新组件直接启动后台准备但不弹确认也不应用组件更新", async () => {
  const prepareUpstreamComponentUpdates = vi.fn(async () => ({
    status: "Preparing" as const,
    installScope: "CliRelay" as const,
    message: "正在后台准备组件更新",
    startedAt: "2026-06-18T10:00:00Z",
    finishedAt: null,
    error: null,
  }));
  const applyPreparedComponentUpdates = vi.fn();
  const confirmPreparedComponentUpdateRestart = vi.fn(async () => true);
  const store = createSettingsStore({
    getDesktopSettings: vi.fn(async () => loadedSettings),
    updateDesktopSettings: vi.fn(),
    checkForUpdates: vi.fn(async () => updateResult("CliRelay")),
    getComponentUpdatePreparation: vi.fn(async () => idlePreparation()),
    prepareUpstreamComponentUpdates,
    applyPreparedComponentUpdates,
    confirmPreparedComponentUpdateRestart,
  });

  await store.load();
  await store.checkUpdates();
  await store.prepareUpdates();

  expect(prepareUpstreamComponentUpdates).toHaveBeenCalledWith("CliRelay");
  expect(confirmPreparedComponentUpdateRestart).not.toHaveBeenCalled();
  expect(applyPreparedComponentUpdates).not.toHaveBeenCalled();
  expect(store.getState().componentPreparation?.status).toBe("Preparing");
  expect(store.getState().isPreparingUpdates).toBe(true);
});
```

Expected before implementation:

```text
FAIL  src/stores/settingsStore.test.ts
prepareUpdates is not a function
```

原因：准备阶段按用户要求不弹窗、不受服务状态影响；点击更新组件后直接进入后台下载、校验和解压。

- [ ] **Step 4: 先写失败测试，取消重启确认不调用应用命令**

追加：

```ts
test("用户取消重启确认时不应用已准备好的组件更新", async () => {
  const applyPreparedComponentUpdates = vi.fn();
  const store = createSettingsStore({
    getDesktopSettings: vi.fn(async () => loadedSettings),
    updateDesktopSettings: vi.fn(),
    checkForUpdates: vi.fn(async () => updateResult("Both")),
    getComponentUpdatePreparation: vi.fn(async () => ({
      status: "Ready",
      installScope: "Both",
      message: "组件更新已准备好，点击重启完成替换",
      startedAt: "2026-06-18T10:00:00Z",
      finishedAt: "2026-06-18T10:01:00Z",
      error: null,
    })),
    prepareUpstreamComponentUpdates: vi.fn(),
    applyPreparedComponentUpdates,
    confirmPreparedComponentUpdateRestart: vi.fn(async () => false),
  });

  await store.load();
  await store.applyPreparedUpdate({ serviceStatus: "Running" });

  expect(applyPreparedComponentUpdates).not.toHaveBeenCalled();
  expect(store.getState().isApplyingPreparedUpdate).toBe(false);
});
```

Expected before implementation:

```text
FAIL  src/stores/settingsStore.test.ts
confirmPreparedComponentUpdateRestart is not defined
```

原因：重启确认是唯一弹窗；用户取消时不能停止服务、替换组件或重启应用。

- [ ] **Step 5: 实现 `prepareUpdates()`、`refreshComponentPreparation()` 和 `applyPreparedUpdate()`**

核心实现：

```ts
async prepareUpdates() {
  const scope = state.updateResult?.upstream.installScope ?? "None";
  if (!canInstallScope(scope)) {
    emit({ error: "没有可准备的上游组件更新" });
    return;
  }

  if (state.isPreparingUpdates || state.isApplyingPreparedUpdate) {
    return;
  }

  emit({ isPreparingUpdates: true, error: null });
  try {
    const componentPreparation = await commands.prepareUpstreamComponentUpdates(scope);
    emit({
      componentPreparation,
      isPreparingUpdates: componentPreparation.status === "Preparing",
    });
  } catch (caught) {
    emit({
      error: toErrorMessage(caught),
      isPreparingUpdates: false,
    });
  }
},

async refreshComponentPreparation() {
  const componentPreparation = await commands.getComponentUpdatePreparation();
  emit({
    componentPreparation,
    isPreparingUpdates: componentPreparation.status === "Preparing",
  });
},

async applyPreparedUpdate(options) {
  if (state.isApplyingPreparedUpdate) {
    return;
  }
  if (state.componentPreparation?.status !== "Ready") {
    emit({ error: "没有已准备好的组件更新" });
    return;
  }

  const confirmed = await commands.confirmPreparedComponentUpdateRestart({
    installScope: state.componentPreparation.installScope,
    serviceStatus: options.serviceStatus,
  });
  if (!confirmed) {
    return;
  }

  emit({ isApplyingPreparedUpdate: true, error: null });
  try {
    const installResult = await commands.applyPreparedComponentUpdates();
    emit({
      installResult,
      isApplyingPreparedUpdate: false,
      componentPreparation: null,
    });
  } catch (caught) {
    emit({
      error: toErrorMessage(caught),
      isApplyingPreparedUpdate: false,
    });
  }
},
```

原因：准备阶段和应用阶段要各自防重复；准备命令返回 `Preparing` 后，后续完成状态通过轮询或重新打开 Settings 时查询；重启确认只保护应用阶段。

- [ ] **Step 6: 增加准备中轮询**

在 Settings 容器层或 store 使用点增加每 2 秒查询一次：

```ts
useEffect(() => {
  if (settings.componentPreparation?.status !== "Preparing") {
    return;
  }

  const timer = window.setInterval(() => {
    void settingsStore.refreshComponentPreparation();
  }, 2000);

  return () => window.clearInterval(timer);
}, [settings.componentPreparation?.status]);
```

原因：准备任务在 Rust 后台完成后不会自动推送到 React；轮询让按钮从“准备中...”自动变成“重启”。

### Task 6: SettingsView 显示更新、准备、重启三种按钮状态

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/SettingsView.test.tsx`
- Modify: `tests/update_check.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: 先写失败测试，准备完成后按钮显示“重启”**

在 `tests/update_check.test.ts` 增加：

```ts
test("组件准备完成后更新按钮变为重启", () => {
  const html = renderToStaticMarkup(
    <SettingsView
      settings={settings}
      draft={draft}
      serviceSnapshot={snapshot}
      updateResult={updateResult("Both")}
      installResult={null}
      componentPreparation={{
        status: "Ready",
        installScope: "Both",
        message: "组件更新已准备好，点击重启完成替换",
        startedAt: "2026-06-18T10:00:00Z",
        finishedAt: "2026-06-18T10:01:00Z",
        error: null,
      }}
      error={null}
      isBusy={false}
      isCheckingUpdates={false}
      isPreparingUpdates={false}
      isApplyingPreparedUpdate={false}
      initialSection="update"
      onDraftChange={vi.fn()}
      onCheckUpdates={vi.fn()}
      onPrepareUpdates={vi.fn()}
      onApplyPreparedUpdate={vi.fn()}
      onOpenDataDirectory={vi.fn()}
      onOpenLogDirectory={vi.fn()}
    />,
  );

  expect(html).toContain(">重启</button>");
  expect(html).not.toContain(">更新组件</button>");
});
```

Expected before implementation:

```text
FAIL  SettingsView
componentPreparation is missing
```

原因：准备完成后的主动作必须从“更新组件”变成“重启”。

- [ ] **Step 2: 更新 Props 和派生状态**

在 `SettingsViewProps` 中改为：

```ts
interface SettingsViewProps {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  serviceSnapshot: ServiceSnapshot | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentApplyResult | null;
  componentPreparation: ComponentUpdatePreparationSnapshot | null;
  error: string | null;
  isBusy: boolean;
  isCheckingUpdates: boolean;
  isPreparingUpdates: boolean;
  isApplyingPreparedUpdate: boolean;
  onLoad?: () => void | Promise<void>;
  onDraftChange: (patch: Partial<SettingsDraft>) => void;
  onCheckUpdates: () => void | Promise<void>;
  onPrepareUpdates: () => void | Promise<void>;
  onApplyPreparedUpdate: (options: ComponentPreparedUpdateApplyOptions) => void | Promise<void>;
  onOpenDataDirectory: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
  initialSection?: SettingsSectionId;
}
```

组件内新增：

```ts
const preparationStatus = componentPreparation?.status ?? "Idle";
const isPreparationReady = preparationStatus === "Ready";
const isPreparing = preparationStatus === "Preparing" || isPreparingUpdates;
```

原因：按钮状态由 update result 和 Rust 准备快照共同决定；准备阶段不读取服务状态，也不能因为当前服务状态禁用“更新组件”。

- [ ] **Step 3: 新增两阶段按钮组件**

替换原按钮：

```tsx
{updateResult?.upstream.action === "InstallInDesktop" ||
componentPreparation?.status === "Ready" ? (
  <ComponentUpdateActionButton
    disabled={isBusy}
    isPreparing={isPreparing}
    isApplying={isApplyingPreparedUpdate}
    isReady={isPreparationReady}
    onPrepareUpdates={onPrepareUpdates}
    onApplyPreparedUpdate={() => onApplyPreparedUpdate({ serviceStatus: status })}
  />
) : null}
```

新增组件：

```tsx
interface ComponentUpdateActionButtonProps {
  disabled: boolean;
  isPreparing: boolean;
  isApplying: boolean;
  isReady: boolean;
  onPrepareUpdates: () => void | Promise<void>;
  onApplyPreparedUpdate: () => void | Promise<void>;
}

function ComponentUpdateActionButton({
  disabled,
  isPreparing,
  isApplying,
  isReady,
  onPrepareUpdates,
  onApplyPreparedUpdate,
}: ComponentUpdateActionButtonProps) {
  const busy = isPreparing || isApplying;
  const label = isApplying
    ? "重启中..."
    : isPreparing
      ? "准备中..."
      : isReady
        ? "重启"
        : "更新组件";

  return (
    <button
      type="button"
      className="component-update-action-button"
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={() => {
        if (isReady) {
          void onApplyPreparedUpdate();
          return;
        }
        void onPrepareUpdates();
      }}
    >
      {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}
```

原因：一个按钮承载三个阶段，减少用户在同一位置寻找下一步动作的成本；服务状态只影响重启确认文案和后端应用阶段校验，不影响准备按钮可用性。

- [ ] **Step 4: App 传递新状态和回调**

在 `src/app/App.tsx` 的 `SettingsView` 调用中增加：

```tsx
componentPreparation={settings.componentPreparation}
isPreparingUpdates={settings.isPreparingUpdates}
isApplyingPreparedUpdate={settings.isApplyingPreparedUpdate}
onPrepareUpdates={settingsStore.prepareUpdates}
onApplyPreparedUpdate={settingsStore.applyPreparedUpdate}
```

并移除旧的：

```tsx
onInstallUpdates={settingsStore.installUpdates}
```

原因：App 是 Settings store 和 service store 的汇合点，负责把新阶段状态传入视图。

- [ ] **Step 5: 更新按钮宽度样式**

在 `src/styles/app.css` 中把按钮宽度规则改为：

```css
.check-updates-button,
.component-update-action-button {
  min-width: 104px;
}
```

原因：“更新组件”“准备中...”“重启中...”长度不同，固定最小宽度可避免布局抖动。

### Task 7: 验证与回归检查

**Files:**
- No source edits in this task.

- [ ] **Step 1: 运行前端测试**

Run:

```bash
pnpm vitest run src/bridge/commands.test.ts src/stores/settingsStore.test.ts src/components/SettingsView.test.tsx tests/update_check.test.ts
```

Expected:

```text
PASS  src/bridge/commands.test.ts
PASS  src/stores/settingsStore.test.ts
PASS  src/components/SettingsView.test.tsx
PASS  tests/update_check.test.ts
```

- [ ] **Step 2: 运行类型检查**

Run:

```bash
pnpm typecheck
```

Expected:

```text
无 TypeScript 错误
```

- [ ] **Step 3: 运行 Rust 测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
所有 Rust 单元测试和集成测试通过
```

- [ ] **Step 4: 手动验证 Settings 更新页**

Run:

```bash
pnpm tauri dev
```

Manual checks:

```text
1. 打开 Settings -> 更新。
2. 点击“立即检查”，确认按钮显示“检查中...”和 spinner。
3. 有上游组件更新时点击“更新组件”，确认不出现系统确认框，按钮直接显示“准备中...”和 spinner。
4. 准备阶段不停止服务，不替换运行目录；即使服务为 Running、External、Starting 或 Stopping，也能开始下载、校验和解压。
5. 准备中关闭 Settings 窗口，再重新打开，按钮仍显示“准备中...”或准备完成后的“重启”。
6. 准备完成后按钮显示“重启”。
7. 点击“重启”后确认出现系统确认框，文案说明会停止相关服务、替换已准备好的组件，并重启 Desktop。
8. 在重启确认框点击取消，确认没有停止服务、替换组件或重启应用。
9. 在重启确认框点击确认后，才停止自管 CliRelay 服务、替换组件，并重启 Desktop 应用。
10. 更新范围为 codeProxy-only 且服务为 Running 时，可以开始准备；点击“重启”后仍弹确认并重启 Desktop。
```

## 自检

- Spec coverage: 覆盖用户要求的完整两阶段行为：点击“更新组件”后不弹窗并直接后台下载/校验/解压、准备阶段不受当前服务状态影响、Settings 窗口可关闭、准备完成后按钮变“重启”、点击“重启”时才弹确认框、确认后才停止服务/替换组件/重启应用。
- Placeholder scan: 文档没有 `TBD`、`TODO`、`implement later`、`fill in details` 等占位语。
- Type consistency: `ComponentUpdatePreparationSnapshot`、`ComponentPreparationStatus`、`confirmPreparedComponentUpdateRestart`、`prepareUpdates`、`applyPreparedUpdate`、`componentPreparation`、`isPreparingUpdates`、`isApplyingPreparedUpdate` 在 bridge、store、view、tests 中命名一致。
