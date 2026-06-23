import { useEffect, useState, type FormEvent } from "react";

export interface ManagementSecretDialogProps {
  error: string | null;
  isSaving: boolean;
  onSubmit: (secretKey: string) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

export function ManagementSecretDialog({
  error,
  isSaving,
  onSubmit,
  onCancel,
}: ManagementSecretDialogProps) {
  const [secretKey, setSecretKey] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const visibleError = localError ?? error;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        void onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onCancel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!secretKey.trim()) {
      setLocalError("管理密钥不能为空");
      return;
    }

    if (secretKey !== confirmation) {
      setLocalError("两次输入的管理密钥不一致");
      return;
    }

    setLocalError(null);
    await onSubmit(secretKey);
  }

  return (
    <div className="secret-dialog-backdrop" role="presentation">
      <form
        className="secret-dialog settings-section"
        role="dialog"
        aria-modal="true"
        aria-labelledby="management-secret-title"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="dialog-step-row" aria-label="首次启动进度">
          <span className="dialog-step-chip complete">配置文件已就绪</span>
          <span className="dialog-step-chip active">首次启动 2/2</span>
        </div>
        <header className="secret-dialog-header">
          <h3 id="management-secret-title">设置管理密钥</h3>
          <p className="muted">
            写入 CliRelay remote-management 密钥，用于后续管理面板访问。
          </p>
        </header>
        <div className="settings-section-body secret-dialog-body">
          <div className="secret-fields-card" aria-label="管理密钥">
            <label className="secret-field-row">
              <span>管理密钥</span>
              <span className="password-field">
                <input
                  type="password"
                  value={secretKey}
                  disabled={isSaving}
                  autoFocus
                  onChange={(event) => setSecretKey(event.currentTarget.value)}
                />
              </span>
            </label>

            <label className="secret-field-row">
              <span>再次输入管理密钥</span>
              <span className="password-field">
                <input
                  type="password"
                  value={confirmation}
                  disabled={isSaving}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                />
              </span>
            </label>
          </div>

          {visibleError ? <p className="inline-error">{visibleError}</p> : null}

          <div className="button-row secret-dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={isSaving}
              onClick={() => void onCancel()}
            >
              取消
            </button>
            <button type="submit" disabled={isSaving}>
              确认
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
