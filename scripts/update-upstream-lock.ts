import { readFile } from "node:fs/promises";
import {
  readUpstreamLock,
  thirdPartyNoticesPath,
  upstreamLockingDocPath,
  upstreamLockPath,
  type UpstreamLock,
  writeTextFileEnsuringParent,
} from "./upstream-common";

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

interface GitHubRef {
  object: {
    type: string;
    sha: string;
  };
}

interface GitHubTag {
  object: {
    type: string;
    sha: string;
  };
}

interface UpdateOptions {
  dryRun: boolean;
  clirelayVersion?: string;
  codeProxyVersion?: string;
}

interface BuildUpdatedLockInput {
  currentLock: UpstreamLock;
  cliRelease: GitHubRelease;
  cliCommit: string;
  codeProxyRelease: GitHubRelease;
  codeProxyCommit: string;
}

export function parseGitHubRepository(repositoryUrl: string): GitHubRepository {
  const url = new URL(repositoryUrl);
  const [owner, repo] = url.pathname.replace(/^\/|\/$/g, "").split("/");

  if (url.hostname !== "github.com" || !owner || !repo) {
    throw new Error(`不是有效的 GitHub repository URL: ${repositoryUrl}`);
  }

  return { owner, repo };
}

function tagVersionNumber(tagName: string): string {
  return tagName.replace(/^v/, "");
}

export function requireSha256Digest(asset: GitHubReleaseAsset): string {
  const digest = asset.digest ?? "";
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);

  if (!match) {
    throw new Error(`${asset.name} 缺少 sha256 release asset digest`);
  }

  return match[1].toLowerCase();
}

export function findCliRelayAsset(release: GitHubRelease): GitHubReleaseAsset {
  const expectedName = `CliRelay_${tagVersionNumber(release.tag_name)}_darwin_arm64.tar.gz`;
  const exact = release.assets.find((asset) => asset.name === expectedName);

  if (exact) {
    return exact;
  }

  throw new Error(`${release.tag_name} 未找到 macOS arm64 CliRelay asset: ${expectedName}`);
}

export function findCodeProxyAsset(release: GitHubRelease): GitHubReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === "panel-dist.zip");

  if (!asset) {
    throw new Error(`${release.tag_name} 未找到 codeProxy panel asset: panel-dist.zip`);
  }

  return asset;
}

export function resolveTagCommitFromRef(ref: GitHubRef, tag?: GitHubTag): string {
  if (ref.object.type === "commit") {
    return ref.object.sha;
  }

  if (ref.object.type === "tag" && tag?.object.type === "commit") {
    return tag.object.sha;
  }

  throw new Error(`无法解析 tag commit: ref=${ref.object.type}, tag=${tag?.object.type ?? "missing"}`);
}

export function buildUpdatedLock(input: BuildUpdatedLockInput): UpstreamLock {
  const cliAsset = findCliRelayAsset(input.cliRelease);
  const codeProxyAsset = findCodeProxyAsset(input.codeProxyRelease);

  return {
    clirelay: {
      repository: input.currentLock.clirelay.repository,
      version: input.cliRelease.tag_name,
      commit: input.cliCommit,
      assets: {
        "aarch64-apple-darwin": {
          fileName: cliAsset.name,
          downloadUrl: cliAsset.browser_download_url,
          sha256: requireSha256Digest(cliAsset),
          extractedBinaryPath: input.currentLock.clirelay.assets["aarch64-apple-darwin"].extractedBinaryPath,
        },
      },
    },
    codeProxy: {
      repository: input.currentLock.codeProxy.repository,
      version: input.codeProxyRelease.tag_name,
      commit: input.codeProxyCommit,
      asset: {
        fileName: codeProxyAsset.name,
        downloadUrl: codeProxyAsset.browser_download_url,
        sha256: requireSha256Digest(codeProxyAsset),
        entrypoint: input.currentLock.codeProxy.asset.entrypoint,
      },
    },
  };
}

export function renderUpstreamLockingDoc(lock: UpstreamLock): string {
  const cliAsset = lock.clirelay.assets["aarch64-apple-darwin"];

  return `# Upstream Locking

V0 Preview only bundles CliRelay and codeProxy assets from GitHub Releases.

Current lock:

- CliRelay repository: ${lock.clirelay.repository}
- CliRelay version: ${lock.clirelay.version}
- CliRelay commit: ${lock.clirelay.commit}
- CliRelay macOS arm64 asset: ${cliAsset.fileName}
- CliRelay SHA-256: ${cliAsset.sha256}
- CliRelay extracted binary: ${cliAsset.extractedBinaryPath}
- codeProxy repository: ${lock.codeProxy.repository}
- codeProxy version: ${lock.codeProxy.version}
- codeProxy commit: ${lock.codeProxy.commit}
- codeProxy asset: ${lock.codeProxy.asset.fileName}
- codeProxy SHA-256: ${lock.codeProxy.asset.sha256}
- codeProxy entrypoint: ${lock.codeProxy.asset.entrypoint}

Update flow:

1. Run \`pnpm upstream:update\` to update \`upstream-lock.json\`, this document, and third-party notices.
2. Run \`pnpm upstream:fetch\` to download and verify the locked assets into ignored local build inputs.
3. Run \`pnpm upstream:verify\` before building or releasing.
4. Commit the lock, docs, and tests. Do not commit fetched \`src-tauri/binaries/\` or \`src-tauri/resources/\` outputs.

To pin a specific release, pass explicit tags:

\`\`\`bash
pnpm upstream:update -- --clirelay-version vX.Y.Z --codeproxy-version vX.Y.Z
\`\`\`
`;
}

export function renderThirdPartyNotices(lock: UpstreamLock): string {
  return `# Third Party Notices

This file is updated by \`scripts/update-upstream-lock.ts\` when the bundled upstream component lock changes.

Bundled upstream component:

- CliRelay ${lock.clirelay.version}, ${lock.clirelay.repository}
- codeProxy ${lock.codeProxy.version}, ${lock.codeProxy.repository}
`;
}

export function parseArgs(argv: string[]): UpdateOptions {
  const options: UpdateOptions = { dryRun: false };
  const readValue = (name: string, index: number): string => {
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${name} 缺少参数值`);
    }

    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--clirelay-version") {
      options.clirelayVersion = readValue(arg, index);
      index += 1;
      continue;
    }

    if (arg === "--codeproxy-version") {
      options.codeProxyVersion = readValue(arg, index);
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  for (const [name, value] of Object.entries({
    "--clirelay-version": options.clirelayVersion,
    "--codeproxy-version": options.codeProxyVersion,
  })) {
    if (value !== undefined && !/^v\d+\.\d+\.\d+$/.test(value)) {
      throw new Error(`${name} 必须是 vX.Y.Z 形式: ${value}`);
    }
  }

  return options;
}

async function githubJson<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CliRelay-Desktop-upstream-update",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API 请求失败: ${path} (${response.status} ${response.statusText})\n${body}`);
  }

  return (await response.json()) as T;
}

async function fetchRelease(repository: GitHubRepository, version?: string): Promise<GitHubRelease> {
  const releasePath = version
    ? `/repos/${repository.owner}/${repository.repo}/releases/tags/${encodeURIComponent(version)}`
    : `/repos/${repository.owner}/${repository.repo}/releases/latest`;

  return githubJson<GitHubRelease>(releasePath);
}

async function resolveTagCommit(repository: GitHubRepository, tagName: string): Promise<string> {
  const ref = await githubJson<GitHubRef>(
    `/repos/${repository.owner}/${repository.repo}/git/ref/tags/${encodeURIComponent(tagName)}`,
  );

  if (ref.object.type === "tag") {
    const tag = await githubJson<GitHubTag>(`/repos/${repository.owner}/${repository.repo}/git/tags/${ref.object.sha}`);
    return resolveTagCommitFromRef(ref, tag);
  }

  return resolveTagCommitFromRef(ref);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const currentLock = await readUpstreamLock();
  const cliRepository = parseGitHubRepository(currentLock.clirelay.repository);
  const codeProxyRepository = parseGitHubRepository(currentLock.codeProxy.repository);

  const [cliRelease, codeProxyRelease] = await Promise.all([
    fetchRelease(cliRepository, options.clirelayVersion),
    fetchRelease(codeProxyRepository, options.codeProxyVersion),
  ]);

  const [cliCommit, codeProxyCommit] = await Promise.all([
    resolveTagCommit(cliRepository, cliRelease.tag_name),
    resolveTagCommit(codeProxyRepository, codeProxyRelease.tag_name),
  ]);

  const nextLock = buildUpdatedLock({
    currentLock,
    cliRelease,
    cliCommit,
    codeProxyRelease,
    codeProxyCommit,
  });

  const lockJson = `${JSON.stringify(nextLock, null, 2)}\n`;
  const lockingDoc = renderUpstreamLockingDoc(nextLock);
  const notices = renderThirdPartyNotices(nextLock);

  if (options.dryRun) {
    console.log("Dry run: would write:");
    console.log(`- ${upstreamLockPath}`);
    console.log(`- ${upstreamLockingDocPath}`);
    console.log(`- ${thirdPartyNoticesPath}`);
    console.log("");
    console.log("Updated upstream-lock.json:");
    console.log(lockJson);
    return;
  }

  await readFile(thirdPartyNoticesPath, "utf8");
  await writeTextFileEnsuringParent(upstreamLockPath, lockJson);
  await writeTextFileEnsuringParent(upstreamLockingDocPath, lockingDoc);
  await writeTextFileEnsuringParent(thirdPartyNoticesPath, notices);

  console.log(`CliRelay locked: ${nextLock.clirelay.version} (${nextLock.clirelay.commit})`);
  console.log(`codeProxy locked: ${nextLock.codeProxy.version} (${nextLock.codeProxy.commit})`);
  console.log("Next: pnpm upstream:fetch && pnpm upstream:verify");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
