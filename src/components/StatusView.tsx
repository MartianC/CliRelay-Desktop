import type { DesktopLocale, ServiceSnapshot } from "../bridge/types";
import { tForLocale } from "../i18n/locales";
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
  locale?: DesktopLocale;
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
  locale = "zh-CN",
}: StatusViewProps) {
  const t = (key: Parameters<typeof tForLocale>[1]) => tForLocale(locale, key);
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
          <p className="eyebrow">{t("status.eyebrow")}</p>
          <h1>CliRelay Desktop</h1>
          <p className="muted">{t("status.description")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void onRefresh()}>
          {t("status.refresh")}
        </button>
      </section>

      <section className="status-summary">
        <span className={`status-dot status-${snapshot?.status.toLowerCase() ?? "unknown"}`} />
        <div>
          <span className="label">{t("status.title")}</span>
          <strong>{snapshot?.status ?? "Unknown"}</strong>
        </div>
      </section>

      <section className="surface split-layout">
        <dl className="field-list">
          <FieldRow label={t("status.currentPort")} value={snapshot?.port} mono />
          <FieldRow label="PID" value={snapshot?.pid ?? "—"} mono />
          <FieldRow label="Endpoint" value={snapshot?.endpoint} mono />
          <FieldRow label="Panel URL" value={snapshot?.panelUrl} mono />
          <FieldRow label={t("status.ownership")} value={snapshot?.ownership} />
          <FieldRow label={t("status.lastExitCode")} value={snapshot?.lastExitCode ?? "—"} mono />
          <FieldRow label={t("status.errorSummary")} value={snapshot?.lastError ?? error ?? "—"} />
        </dl>

        <div className="action-stack">
          <button type="button" onClick={() => void onOpenPanel()} disabled={isBusy}>
            {t("status.openPanel")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onStart()}
            disabled={isBusy || !canStart}
          >
            {t("status.start")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onStop()}
            disabled={isBusy || !canStop}
          >
            {t("status.stop")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onRestart()}
            disabled={isBusy || !canRestart}
          >
            {t("status.restart")}
          </button>
          <button type="button" className="ghost" onClick={() => void onCopyEndpoint()}>
            {t("status.copyEndpoint")}
          </button>
          <button type="button" className="ghost" onClick={() => void onOpenDataDirectory()}>
            {t("settings.openDataDirectory")}
          </button>
          <button type="button" className="ghost" onClick={() => void onOpenLogDirectory()}>
            {t("settings.openLogDirectory")}
          </button>
        </div>
      </section>

      {snapshot?.status === "External" ? (
        <section className="surface external-choice">
          <div>
            <h2>{t("status.externalTitle")}</h2>
            <p className="muted">{t("status.externalDescription")}</p>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void onOpenPanel()}>
              {t("status.connectExisting")}
            </button>
            <button type="button" className="secondary" onClick={() => void onChangePort()}>
              {t("status.changePort")}
            </button>
            <button type="button" className="ghost" onClick={() => void onCancelExternal()}>
              {t("status.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="inline-error">{error}</p> : null}
    </main>
  );
}
