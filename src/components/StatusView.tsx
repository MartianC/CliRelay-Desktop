import { useState } from "react";

import type { DesktopLocale, ServiceSnapshot } from "../bridge/types";
import { tForLocale } from "../i18n/locales";
import { FieldRow } from "./FieldRow";

interface StatusViewProps {
  snapshot: ServiceSnapshot | null;
  error: string | null;
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onOpenPanel: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
  onChangePort: () => void | Promise<void>;
  locale?: DesktopLocale;
}

export function StatusView({
  snapshot,
  error,
  isBusy,
  onRefresh,
  onOpenPanel,
  onRestart,
  onOpenLogDirectory,
  onChangePort,
  locale = "zh-CN",
}: StatusViewProps) {
  const t = (key: Parameters<typeof tForLocale>[1]) => tForLocale(locale, key);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const port = snapshot?.port ?? 8317;
  const statusLabel = snapshot?.status === "External" ? "Error" : (snapshot?.status ?? "Unknown");
  const problemTitle =
    snapshot?.status === "External"
      ? t("status.problemPortInUse").replace("{port}", String(port))
      : (snapshot?.lastError ?? error ?? statusLabel);
  const problemDescription =
    snapshot?.status === "External"
      ? t("status.problemExternalDescription")
      : (snapshot?.lastError ?? error ?? t("status.description"));
  const diagnosticSummary = [
    `Endpoint: ${snapshot?.endpoint ?? "—"}`,
    `PID: ${snapshot?.pid ?? "—"}`,
    `${t("status.lastExitCode")}: ${snapshot?.lastExitCode ?? "—"}`,
  ].join(" · ");

  return (
    <main className="settings-shell status-settings-shell">
      <section className="settings-content status-settings-content">
        <header className="settings-content-header">
          <div>
            <p className="eyebrow">{t("status.eyebrow")}</p>
            <h2>{t("status.title")}</h2>
            <p className="muted">{t("status.description")}</p>
          </div>
          <button type="button" className="secondary" onClick={() => void onRefresh()}>
            {t("status.refresh")}
          </button>
        </header>

        <section className="settings-section recovery-problem-card" aria-label={t("status.problemTitle")}>
          <div className="recovery-problem-body">
            <div className="recovery-alert-icon" aria-hidden="true">!</div>
            <div className="recovery-problem-copy">
              <div className="recovery-problem-heading-row">
                <strong>{problemTitle}</strong>
                <span className="recovery-status-badge">
                  <span aria-hidden="true" />
                  {statusLabel}
                </span>
              </div>
              <p>{problemDescription}</p>
            </div>
          </div>
          <div className="recovery-meta-row recovery-meta-footer" aria-label={t("status.diagnosticDetails")}>
            <span>{t("status.currentPort")}</span>
            <code>{port}</code>
            <span className="recovery-meta-divider">/</span>
            <span>{t("status.ownership")}</span>
            <strong>{snapshot?.ownership ?? t("settings.unknown")}</strong>
          </div>
        </section>

        <section className="settings-section recovery-actions-card">
          <div>
            <h3>{t("status.recommendedActions")}</h3>
            <p className="muted">{t("status.recommendedActionsDescription")}</p>
          </div>
          <div className="recovery-actions">
            <button type="button" onClick={() => void onOpenPanel()} disabled={isBusy}>
              {t("status.connectExisting")}
            </button>
            <button type="button" className="secondary" onClick={() => void onChangePort()} disabled={isBusy}>
              {t("status.changePort")}
            </button>
            <button type="button" className="secondary" onClick={() => void onRestart()} disabled={isBusy}>
              {t("status.retry")}
            </button>
            <button type="button" className="ghost recovery-log-link" onClick={() => void onOpenLogDirectory()}>
              {t("settings.openLogDirectory")}
            </button>
          </div>
        </section>

        <section className="settings-section recovery-diagnostics-card">
          <div>
            <h3>{t("status.diagnosticDetails")}</h3>
            <p className="muted mono">{diagnosticSummary}</p>
          </div>
          <button
            type="button"
            className="ghost recovery-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? t("status.collapseDetails") : t("status.expandDetails")}
            <ChevronIcon open={detailsOpen} />
          </button>
          {detailsOpen ? (
            <dl className="field-list compact recovery-details-list">
              <FieldRow label="Endpoint" value={snapshot?.endpoint} mono />
              <FieldRow label="Panel URL" value={snapshot?.panelUrl} mono />
              <FieldRow label="PID" value={snapshot?.pid ?? "—"} mono />
              <FieldRow label={t("status.errorSummary")} value={snapshot?.lastError ?? error ?? "—"} />
            </dl>
          ) : null}
        </section>

        {error ? <p className="inline-error">{error}</p> : null}
      </section>
    </main>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="recovery-chevron-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-open={open ? "true" : "false"}
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}
