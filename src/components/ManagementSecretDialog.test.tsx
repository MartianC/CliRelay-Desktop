import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { ManagementSecretDialog } from "./ManagementSecretDialog";

describe("ManagementSecretDialog", () => {
  test("渲染管理密钥双密码输入弹窗", () => {
    const html = renderToStaticMarkup(
      <ManagementSecretDialog
        error={null}
        isSaving={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("管理密钥");
    expect(html).toContain("再次输入管理密钥");
    expect(html).toContain("确认");
    expect(html).toContain("取消");
    expect(html).toContain('type="password"');
    expect(html).toContain("settings-section");
    expect(html).toContain("settings-section-body");
    expect(html).toContain("secret-field-row");
  });
});
