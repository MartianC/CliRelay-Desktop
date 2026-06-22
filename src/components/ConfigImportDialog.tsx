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
        <h3 id="config-import-title">导入 CliRelay config</h3>
        <div className="settings-section-body secret-dialog-body">
          <p className="muted">
            未找到 CliRelay config 文件。可以导入已有 config，或从应用内置模板创建默认配置。
          </p>

          {error ? <p className="inline-error">{error}</p> : null}

          <div className="button-row secret-dialog-actions config-import-actions">
            <button type="button" disabled={isBusy} onClick={() => void onImport()}>
              选择已有 config 文件
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isBusy}
              onClick={() => void onUseDefault()}
            >
              使用默认配置
            </button>
            <button
              type="button"
              className="ghost"
              disabled={isBusy}
              onClick={() => void onCancel()}
            >
              退出
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
