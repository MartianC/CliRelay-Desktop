import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const appCss = readFileSync(fileURLToPath(new URL("../src/styles/app.css", import.meta.url)), "utf8");
const designGuide = readFileSync(
  fileURLToPath(new URL("../docs/dev/settings-frontend-design-guidelines.md", import.meta.url)),
  "utf8",
);
const settingsCapability = readFileSync(
  fileURLToPath(new URL("../src-tauri/capabilities/settings.json", import.meta.url)),
  "utf8",
);

function cssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(appCss.matchAll(new RegExp(`(^|\\n)${escapedSelector} \\{`, "g")));
  const start = matches.at(-1)?.index ?? -1;

  if (start === -1) {
    return "";
  }

  const bodyStart = appCss.indexOf("{", start) + 1;
  const bodyEnd = appCss.indexOf("}", bodyStart);

  return appCss.slice(bodyStart, bodyEnd);
}

describe("Settings 样式", () => {
  test("内容铺满 Settings 窗口且不显示外层灰边", () => {
    expect(appCss).toContain(".settings-shell {");
    expect(appCss).toContain(".settings-layout {");

    const shell = cssBlock(".settings-shell");
    const layout = cssBlock(".settings-layout");

    expect(shell).toContain("min-height: 100vh");
    expect(shell).toContain("padding: 0");
    expect(shell).toContain("gap: 0");
    expect(layout).toContain("min-height: 100vh");
    expect(layout).not.toContain("border:");
    expect(layout).not.toContain("border-radius:");
    expect(layout).not.toContain("box-shadow:");
  });

  test("右侧内容栏在小窗口内独立滚动", () => {
    const layout = cssBlock(".settings-layout");
    const content = cssBlock(".settings-content");

    expect(layout).toContain("height: 100vh");
    expect(layout).toContain("overflow: hidden");
    expect(content).toContain("min-height: 0");
    expect(content).toContain("overflow-y: auto");
  });

  test("Settings 分栏和间距遵循固定前端设计规范", () => {
    const layout = cssBlock(".settings-layout");
    const sidebar = cssBlock(".settings-sidebar");
    const content = cssBlock(".settings-content");
    const updateTitle = cssBlock(".update-block-header h3");

    expect(layout).toContain("grid-template-columns: 184px minmax(0, 1fr)");
    expect(sidebar).toContain("padding: 18px 12px 14px");
    expect(content).toContain("padding: 20px 22px 24px");
    expect(updateTitle).toContain("font-size: 0.92rem");
    expect(designGuide).toContain("Settings 窗口前端设计规范");
    expect(designGuide).toContain("侧栏宽度固定为 184px");
  });

  test("Settings 窗口允许通过 opener 打开默认网页", () => {
    const capability = JSON.parse(settingsCapability) as { permissions: string[] };

    expect(capability.permissions).toContain("opener:allow-open-url");
    expect(capability.permissions).toContain("opener:allow-default-urls");
    expect(capability.permissions).not.toContain("opener:default");
  });

  test("窄窗口时 Settings 仍保持两栏布局", () => {
    const smallWindowMedia = /@media \(max-width: 760px\) \{[\s\S]*\}\s*$/.exec(appCss)?.[0] ?? "";

    expect(smallWindowMedia).not.toContain(".settings-shell");
    expect(smallWindowMedia).not.toContain(".settings-header");
    expect(smallWindowMedia).not.toContain(".settings-layout");
    expect(smallWindowMedia).not.toContain(".settings-sidebar");
  });

  test("Settings 开关使用自定义轨道而不是原生 checkbox 外观", () => {
    const toggleInput = cssBlock(".toggle-input");
    const toggleControl = cssBlock(".toggle-control");

    expect(toggleInput).toContain("opacity: 0");
    expect(toggleInput).toContain("position: absolute");
    expect(toggleControl).toContain("border-radius: 999px");
    expect(toggleControl).toContain("width: 38px");
    expect(appCss).toContain(".toggle-input:checked + .toggle-control");
  });

  test("关于页产品信息块按内容适配高度", () => {
    const aboutProduct = cssBlock(".settings-about-product");

    expect(aboutProduct).toContain("align-self: start");
  });
});
