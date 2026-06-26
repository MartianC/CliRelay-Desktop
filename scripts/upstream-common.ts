import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface UpstreamLock {
  clirelay: {
    repository: string;
    version: string;
    commit: string;
    assets: {
      "aarch64-apple-darwin": {
        fileName: string;
        downloadUrl: string;
        sha256: string;
        extractedBinaryPath: string;
      };
    };
  };
  codeProxy: {
    repository: string;
    version: string;
    commit: string;
    asset: {
      fileName: string;
      downloadUrl: string;
      sha256: string;
      entrypoint: string;
    };
  };
}

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const upstreamLockPath = join(repoRoot, "upstream-lock.json");
export const upstreamLockingDocPath = join(repoRoot, "docs", "dev", "upstream-locking.md");
export const thirdPartyNoticesPath = join(repoRoot, "THIRD_PARTY_NOTICES.md");
export const srcTauriDir = join(repoRoot, "src-tauri");
export const sidecarPath = join(srcTauriDir, "binaries", "clirelay-aarch64-apple-darwin");
export const configExamplePath = join(srcTauriDir, "resources", "config.example.yaml");
export const panelDir = join(srcTauriDir, "resources", "panel");
export const panelEntrypointPath = join(panelDir, "manage.html");

export async function readUpstreamLock(): Promise<UpstreamLock> {
  const raw = await readFile(upstreamLockPath, "utf8");
  return JSON.parse(raw) as UpstreamLock;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const file = createReadStream(filePath);

  for await (const chunk of file) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function downloadFile(url: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });

  const response = await fetch(url, {
    headers: {
      "User-Agent": "CliRelay-Desktop-upstream-fetch",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`下载失败: ${url} (${response.status} ${response.statusText})`);
  }

  await pipeline(response.body, createWriteStream(destination));
}

export async function assertSha256(filePath: string, expected: string): Promise<string> {
  const actual = await sha256File(filePath);

  if (actual !== expected) {
    throw new Error(`SHA-256 不匹配: ${filePath}\nexpected: ${expected}\nactual:   ${actual}`);
  }

  return actual;
}

export function run(command: string, args: string[], cwd = repoRoot): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [`命令失败: ${command} ${args.join(" ")}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

export async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });
  await import("node:fs/promises").then(({ cp }) => cp(source, destination, { recursive: true }));
}

export async function ensureExecutable(filePath: string): Promise<void> {
  await access(filePath);
  await chmod(filePath, 0o755);
}

export async function assertExecutable(filePath: string): Promise<void> {
  const mode = (await stat(filePath)).mode;

  if ((mode & 0o111) === 0) {
    throw new Error(`文件不可执行: ${filePath}`);
  }
}

export async function copyFileEnsuringParent(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export function disableAutoUpdate(config: string): string {
  const lines = config.split(/\r?\n/);
  let inAutoUpdate = false;
  let autoUpdateIndent = -1;
  let replaced = false;

  const updated = lines.map((line) => {
    const autoUpdateMatch = line.match(/^(\s*)auto-update:\s*$/);

    if (autoUpdateMatch) {
      inAutoUpdate = true;
      autoUpdateIndent = autoUpdateMatch[1].length;
      return line;
    }

    if (inAutoUpdate) {
      const currentIndent = line.match(/^(\s*)/)?.[1].length ?? 0;

      if (line.trim() && currentIndent <= autoUpdateIndent) {
        inAutoUpdate = false;
      } else if (/^\s*enabled:\s*(true|false)\s*$/.test(line)) {
        replaced = true;
        return line.replace(/enabled:\s*(true|false)/, "enabled: false");
      }
    }

    return line;
  });

  if (!replaced) {
    throw new Error("config.example.yaml 中未找到 auto-update.enabled");
  }

  return updated.join("\n");
}

export async function assertAutoUpdateDisabled(filePath: string): Promise<void> {
  const raw = await readFile(filePath, "utf8");
  const autoUpdateBlock = raw.match(/^auto-update:\n(?:^[ \t]+.*\n?)*/m)?.[0];

  if (!autoUpdateBlock || !/^\s+enabled:\s*false\s*$/m.test(autoUpdateBlock)) {
    throw new Error(`${filePath} 未禁用 auto-update.enabled`);
  }
}

export async function writeTextFileEnsuringParent(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
