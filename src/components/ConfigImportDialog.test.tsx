import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { ConfigImportDialog } from "./ConfigImportDialog";

describe("ConfigImportDialog", () => {
  test("渲染 config 导入选择弹窗", () => {
    const html = renderToStaticMarkup(
      <ConfigImportDialog
        error={null}
        isBusy={false}
        onImport={vi.fn()}
        onUseDefault={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("导入 CliRelay config");
    expect(html).toContain("选择已有 config 文件");
    expect(html).toContain("使用默认配置");
    expect(html).toContain("退出");
    expect(html).toContain("config-import-dialog");
    expect(html).toContain("settings-section-body");
  });
});
