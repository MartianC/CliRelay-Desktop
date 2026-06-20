import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(join(currentDir, "app.css"), "utf8");

function collectLanguageSegmentedRules(css) {
  const matches = css.match(/\.language-segmented[^{]*\{[^}]*\}/g) ?? [];
  return matches.join("\n");
}

describe("app.css", () => {
  test("语言分段控件使用纯色胶囊和选中浮层", () => {
    const languageSegmentedCss = collectLanguageSegmentedRules(appCss);

    expect(languageSegmentedCss).toContain(".language-segmented-control");
    expect(languageSegmentedCss).not.toContain("linear-gradient");
    expect(languageSegmentedCss).toContain("background: #f0f1f3");
    expect(languageSegmentedCss).toContain("background: #ffffff");
    expect(languageSegmentedCss).toContain("box-shadow");
    expect(languageSegmentedCss).toContain("grid-template-columns: repeat(2, minmax(72px, 1fr))");
    expect(languageSegmentedCss).toContain("min-height: 30px");
    expect(languageSegmentedCss).toContain("font-size: 0.84rem");
    expect(languageSegmentedCss).toContain("padding: 0 12px");
  });
});
