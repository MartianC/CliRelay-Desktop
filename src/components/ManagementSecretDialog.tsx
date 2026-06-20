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
        <h3 id="management-secret-title">管理密钥</h3>
        <div className="settings-section-body secret-dialog-body">
          <p className="muted">首次启动前需要设置 CliRelay 管理密钥。</p>

          <label className="secret-field-row">
            <span>管理密钥</span>
            <input
              type="password"
              value={secretKey}
              disabled={isSaving}
              autoFocus
              onChange={(event) => setSecretKey(event.currentTarget.value)}
            />
          </label>

          <label className="secret-field-row">
            <span>再次输入管理密钥</span>
            <input
              type="password"
              value={confirmation}
              disabled={isSaving}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
          </label>

          {visibleError ? <p className="inline-error">{visibleError}</p> : null}

          <div className="button-row secret-dialog-actions">
            <button type="submit" disabled={isSaving}>
              确认
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isSaving}
              onClick={() => void onCancel()}
            >
              取消
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
