import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const appCss = readFileSync(fileURLToPath(new URL("../src/styles/app.css", import.meta.url)), "utf8");

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
});
