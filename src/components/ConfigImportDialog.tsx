import { useEffect } from "react";

export interface ConfigImportDialogProps {
  error: string | null;
  isBusy: boolean;
  onImport: () => void | Promise<void>;
  onUseDefault: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export function ConfigImportDialog({
  error,
  isBusy,
  onImport,
  onUseDefault,
  onCancel,
}: ConfigImportDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        event.preventDefault();
        void onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onCancel]);

  return (
    <div className="secret-dialog-backdrop" role="presentation">
      <section
        className="config-import-dialog secret-dialog settings-section"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-import-title"
      >
        <div className="dialog-step-row" aria-label="首次启动进度">
          <span className="dialog-step-chip active">首次启动 1/2</span>
          <span className="dialog-step-chip">后续：管理密钥</span>
        </div>
        <header className="secret-dialog-header">
          <h3 id="config-import-title">导入配置文件</h3>
          <p className="muted">选择已有 CliRelay config，或从应用内置模板创建默认配置。</p>
        </header>
        <div className="settings-section-body secret-dialog-body">
          <section className="dialog-inner-card" aria-labelledby="config-card-title">
            <h4 id="config-card-title">CliRelay config</h4>
            <div>
              <strong>未找到 config 文件</strong>
              <p className="muted">支持 .yaml / .yml。导入完成后会继续检查管理密钥。</p>
            </div>
          </section>

          {error ? <p className="inline-error">{error}</p> : null}

          <div className="button-row secret-dialog-actions config-import-actions">
            <button
              type="button"
              className="ghost"
              disabled={isBusy}
              onClick={() => void onCancel()}
            >
              退出
            </button>
            <span className="dialog-action-spacer" aria-hidden="true" />
            <button
              type="button"
              className="secondary"
              disabled={isBusy}
              onClick={() => void onUseDefault()}
            >
              使用默认
            </button>
            <button type="button" disabled={isBusy} onClick={() => void onImport()}>
              选择已有 config
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
