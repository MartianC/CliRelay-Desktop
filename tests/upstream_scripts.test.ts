import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import upstreamLock from "../upstream-lock.json";

const sha256Pattern = /^[a-f0-9]{64}$/;
const ignoredUpstreamOutputs = [
  "src-tauri/binaries/clirelay-aarch64-apple-darwin",
  "src-tauri/resources/config.example.yaml",
  "src-tauri/resources/panel/manage.html",
  "src-tauri/resources/panel/assets/panel-chunk.js",
];

describe("upstream-lock.json", () => {
  test("can be parsed", () => {
    expect(upstreamLock).toHaveProperty("clirelay");
    expect(upstreamLock).toHaveProperty("codeProxy");
  });

  test("locks the macOS arm64 CliRelay asset", () => {
    const asset = upstreamLock.clirelay.assets["aarch64-apple-darwin"];

    expect(asset.fileName).toBe("CliRelay_0.4.6_darwin_arm64.tar.gz");
    expect(asset.downloadUrl).toBe(
      "https://github.com/kittors/CliRelay/releases/download/v0.4.6/CliRelay_0.4.6_darwin_arm64.tar.gz",
    );
    expect(asset.sha256).toMatch(sha256Pattern);
    expect(asset.extractedBinaryPath).toBe("cli-proxy-api");
  });

  test("uses github.com for the CliRelay download URL", () => {
    const asset = upstreamLock.clirelay.assets["aarch64-apple-darwin"];

    expect(new URL(asset.downloadUrl).host).toBe("github.com");
  });

  test("locks the codeProxy panel asset", () => {
    const asset = upstreamLock.codeProxy.asset;

    expect(asset.fileName).toBe("panel-dist.zip");
    expect(asset.downloadUrl).toBe("https://github.com/kittors/codeProxy/releases/download/v0.4.7/panel-dist.zip");
    expect(asset.sha256).toMatch(sha256Pattern);
    expect(asset.entrypoint).toBe("manage.html");
  });

  test("uses github.com for the codeProxy download URL", () => {
    expect(new URL(upstreamLock.codeProxy.asset.downloadUrl).host).toBe("github.com");
  });

  test("ignores fetched upstream outputs", () => {
    for (const outputPath of ignoredUpstreamOutputs) {
      expect(() => {
        execFileSync("git", ["check-ignore", "--quiet", outputPath]);
      }).not.toThrow();
    }
  });
});
