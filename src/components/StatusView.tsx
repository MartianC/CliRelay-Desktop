import type { ServiceSnapshot } from "../bridge/types";
import { FieldRow } from "./FieldRow";

interface StatusViewProps {
  snapshot: ServiceSnapshot | null;
  error: string | null;
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onOpenPanel: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onOpenDataDirectory: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
  onCopyEndpoint: () => void | Promise<void>;
  onChangePort: () => void | Promise<void>;
  onCancelExternal: () => void | Promise<void>;
}

export function StatusView({
  snapshot,
  error,
  isBusy,
  onRefresh,
  onOpenPanel,
  onStart,
  onStop,
  onRestart,
  onOpenDataDirectory,
  onOpenLogDirectory,
  onCopyEndpoint,
  onChangePort,
  onCancelExternal,
}: StatusViewProps) {
  const canStart = !snapshot || ["Stopped", "Error"].includes(snapshot.status);
  const canStop = snapshot
    ? ["Running", "Unhealthy", "Stopping"].includes(snapshot.status)
    : false;
  const canRestart = snapshot
    ? ["Running", "Unhealthy", "Error"].includes(snapshot.status)
    : false;

  return (
    <main className="app-shell recovery-shell">
      <section className="shell-header">
        <div>
          <p className="eyebrow">菜单 / Dock / 恢复状态</p>
          <h1>CliRelay Desktop</h1>
          <p className="muted">服务未进入可打开 Panel 的状态时显示此页。</p>
        </div>
        <button type="button" className="secondary" onClick={() => void onRefresh()}>
          刷新
        </button>
      </section>

      <section className="status-summary">
        <span className={`status-dot status-${snapshot?.status.toLowerCase() ?? "unknown"}`} />
        <div>
          <span className="label">当前状态</span>
          <strong>{snapshot?.status ?? "Unknown"}</strong>
        </div>
      </section>

      <section className="surface split-layout">
        <dl className="field-list">
          <FieldRow label="当前端口" value={snapshot?.port} mono />
          <FieldRow label="PID" value={snapshot?.pid ?? "—"} mono />
          <FieldRow label="Endpoint" value={snapshot?.endpoint} mono />
          <FieldRow label="Panel URL" value={snapshot?.panelUrl} mono />
          <FieldRow label="归属" value={snapshot?.ownership} />
          <FieldRow label="最近退出码" value={snapshot?.lastExitCode ?? "—"} mono />
          <FieldRow label="错误摘要" value={snapshot?.lastError ?? error ?? "—"} />
        </dl>

        <div className="action-stack">
          <button type="button" onClick={() => void onOpenPanel()} disabled={isBusy}>
            重试打开 Panel
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onStart()}
            disabled={isBusy || !canStart}
          >
            启动服务
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onStop()}
            disabled={isBusy || !canStop}
          >
            停止服务
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onRestart()}
            disabled={isBusy || !canRestart}
          >
            重启服务
          </button>
          <button type="button" className="ghost" onClick={() => void onCopyEndpoint()}>
            复制 API Base URL
          </button>
          <button type="button" className="ghost" onClick={() => void onOpenDataDirectory()}>
            打开数据目录
          </button>
          <button type="button" className="ghost" onClick={() => void onOpenLogDirectory()}>
            打开日志目录
          </button>
        </div>
      </section>

      {snapshot?.status === "External" ? (
        <section className="surface external-choice">
          <div>
            <h2>检测到外部 CliRelay 服务</h2>
            <p className="muted">
              当前端口已有可连接服务。可以连接现有服务，或进入设置更改 Desktop 端口。
            </p>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void onOpenPanel()}>
              连接现有服务
            </button>
            <button type="button" className="secondary" onClick={() => void onChangePort()}>
              更改端口
            </button>
            <button type="button" className="ghost" onClick={() => void onCancelExternal()}>
              取消
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="inline-error">{error}</p> : null}
    </main>
  );
}
