import { describe, expect, test } from "vitest";
import type { UpstreamLock } from "../scripts/upstream-common";
import {
  buildUpdatedLock,
  findCliRelayAsset,
  findCodeProxyAsset,
  parseArgs,
  parseGitHubRepository,
  renderThirdPartyNotices,
  renderUpstreamLockingDoc,
  requireSha256Digest,
  resolveTagCommitFromRef,
} from "../scripts/update-upstream-lock";

const currentLock: UpstreamLock = {
  clirelay: {
    repository: "https://github.com/kittors/CliRelay",
    version: "v0.4.6",
    commit: "eafc44b0fc978c769b7502cb69e1359578bb04bd",
    assets: {
      "aarch64-apple-darwin": {
        fileName: "CliRelay_0.4.6_darwin_arm64.tar.gz",
        downloadUrl: "https://github.com/kittors/CliRelay/releases/download/v0.4.6/CliRelay_0.4.6_darwin_arm64.tar.gz",
        sha256: "2ec5b2d9132ecafcd175eded6c03b642d29e13d664bc70cac4c7814aa6b73dfc",
        extractedBinaryPath: "cli-proxy-api",
      },
    },
  },
  codeProxy: {
    repository: "https://github.com/kittors/codeProxy",
    version: "v0.4.7",
    commit: "d1e963d31b785986d355f85ccdf891ad8dcfc7f8",
    asset: {
      fileName: "panel-dist.zip",
      downloadUrl: "https://github.com/kittors/codeProxy/releases/download/v0.4.7/panel-dist.zip",
      sha256: "00cfa8c1735dae9785c197dc91e3431d9aa1bfc31913363a5821daaaaf0abfee",
      entrypoint: "manage.html",
    },
  },
};

const cliRelease = {
  tag_name: "v0.4.8",
  assets: [
    {
      name: "CliRelay_0.4.8_linux_amd64.tar.gz",
      browser_download_url: "https://github.com/kittors/CliRelay/releases/download/v0.4.8/CliRelay_0.4.8_linux_amd64.tar.gz",
      digest: "sha256:" + "1".repeat(64),
    },
    {
      name: "CliRelay_0.4.8_darwin_arm64.tar.gz",
      browser_download_url: "https://github.com/kittors/CliRelay/releases/download/v0.4.8/CliRelay_0.4.8_darwin_arm64.tar.gz",
      digest: "sha256:" + "a".repeat(64),
    },
  ],
};

const codeProxyRelease = {
  tag_name: "v0.4.9",
  assets: [
    {
      name: "panel-dist.zip",
      browser_download_url: "https://github.com/kittors/codeProxy/releases/download/v0.4.9/panel-dist.zip",
      digest: "sha256:" + "b".repeat(64),
    },
  ],
};

describe("update-upstream-lock helpers", () => {
  test("parses GitHub repository URLs", () => {
    expect(parseGitHubRepository("https://github.com/kittors/CliRelay")).toEqual({
      owner: "kittors",
      repo: "CliRelay",
    });
  });

  test("parses pnpm argument separator and validates explicit version arguments", () => {
    expect(parseArgs(["--", "--dry-run", "--clirelay-version", "v0.4.8", "--codeproxy-version", "v0.4.9"])).toEqual({
      dryRun: true,
      clirelayVersion: "v0.4.8",
      codeProxyVersion: "v0.4.9",
    });

    expect(() => parseArgs(["--clirelay-version"])).toThrow(/缺少参数值/);
    expect(() => parseArgs(["--codeproxy-version", "--dry-run"])).toThrow(/缺少参数值/);
    expect(() => parseArgs(["--clirelay-version", "v0.4.8bad"])).toThrow(/vX\.Y\.Z/);
    expect(() => parseArgs(["--unexpected"])).toThrow(/未知参数/);
  });

  test("selects the macOS Apple Silicon CliRelay asset for the release version", () => {
    expect(findCliRelayAsset(cliRelease).name).toBe("CliRelay_0.4.8_darwin_arm64.tar.gz");
    expect(() => findCliRelayAsset({ ...cliRelease, assets: [] })).toThrow(/未找到 macOS arm64 CliRelay asset/);
  });

  test("selects the codeProxy panel dist asset", () => {
    expect(findCodeProxyAsset(codeProxyRelease).name).toBe("panel-dist.zip");
    expect(() => findCodeProxyAsset({ ...codeProxyRelease, assets: [] })).toThrow(/未找到 codeProxy panel asset/);
  });

  test("requires a sha256 release asset digest", () => {
    expect(requireSha256Digest(cliRelease.assets[1])).toBe("a".repeat(64));
    expect(() => requireSha256Digest({ ...cliRelease.assets[1], digest: "sha512:abc" })).toThrow(/sha256/);
    expect(() => requireSha256Digest({ ...cliRelease.assets[1], digest: undefined })).toThrow(/digest/);
  });

  test("resolves annotated and lightweight tag refs to commit sha", () => {
    expect(resolveTagCommitFromRef({ object: { type: "commit", sha: "c".repeat(40) } }, undefined)).toBe(
      "c".repeat(40),
    );

    expect(
      resolveTagCommitFromRef(
        { object: { type: "tag", sha: "d".repeat(40) } },
        { object: { type: "commit", sha: "e".repeat(40) } },
      ),
    ).toBe("e".repeat(40));

    expect(() => resolveTagCommitFromRef({ object: { type: "tag", sha: "d".repeat(40) } }, undefined)).toThrow(
      /无法解析 tag commit/,
    );
  });

  test("builds the updated upstream lock from release metadata", () => {
    const next = buildUpdatedLock({
      currentLock,
      cliRelease,
      cliCommit: "8".repeat(40),
      codeProxyRelease,
      codeProxyCommit: "9".repeat(40),
    });

    expect(next.clirelay.version).toBe("v0.4.8");
    expect(next.clirelay.commit).toBe("8".repeat(40));
    expect(next.clirelay.assets["aarch64-apple-darwin"]).toEqual({
      fileName: "CliRelay_0.4.8_darwin_arm64.tar.gz",
      downloadUrl: "https://github.com/kittors/CliRelay/releases/download/v0.4.8/CliRelay_0.4.8_darwin_arm64.tar.gz",
      sha256: "a".repeat(64),
      extractedBinaryPath: "cli-proxy-api",
    });

    expect(next.codeProxy.version).toBe("v0.4.9");
    expect(next.codeProxy.commit).toBe("9".repeat(40));
    expect(next.codeProxy.asset).toEqual({
      fileName: "panel-dist.zip",
      downloadUrl: "https://github.com/kittors/codeProxy/releases/download/v0.4.9/panel-dist.zip",
      sha256: "b".repeat(64),
      entrypoint: "manage.html",
    });
  });

  test("renders synchronized docs and notices", () => {
    const next = buildUpdatedLock({
      currentLock,
      cliRelease,
      cliCommit: "8".repeat(40),
      codeProxyRelease,
      codeProxyCommit: "9".repeat(40),
    });

    expect(renderUpstreamLockingDoc(next)).toContain("- CliRelay version: v0.4.8");
    expect(renderUpstreamLockingDoc(next)).toContain("- codeProxy SHA-256: " + "b".repeat(64));
    expect(renderThirdPartyNotices(next)).toContain("scripts/update-upstream-lock.ts");
    expect(renderThirdPartyNotices(next)).toContain("- CliRelay v0.4.8");
    expect(renderThirdPartyNotices(next)).toContain("- codeProxy v0.4.9");
  });
});
