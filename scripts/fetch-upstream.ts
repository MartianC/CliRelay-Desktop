import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSha256,
  configExamplePath,
  copyDirectoryContents,
  copyFileEnsuringParent,
  disableAutoUpdate,
  downloadFile,
  ensureExecutable,
  panelDir,
  panelEntrypointPath,
  readUpstreamLock,
  run,
  sidecarPath,
  writeTextFileEnsuringParent,
} from "./upstream-common";

async function main(): Promise<void> {
  const upstream = await readUpstreamLock();
  const clirelayAsset = upstream.clirelay.assets["aarch64-apple-darwin"];
  const workDir = await mkdtemp(join(tmpdir(), "clirelay-upstream-"));

  try {
    const clirelayArchive = join(workDir, clirelayAsset.fileName);
    const clirelayExtractDir = join(workDir, "clirelay");

    await downloadFile(clirelayAsset.downloadUrl, clirelayArchive);
    await assertSha256(clirelayArchive, clirelayAsset.sha256);
    await mkdir(clirelayExtractDir, { recursive: true });
    run("tar", ["-xzf", clirelayArchive, "-C", clirelayExtractDir]);

    const extractedBinary = join(clirelayExtractDir, clirelayAsset.extractedBinaryPath);
    const extractedConfig = join(clirelayExtractDir, "config.example.yaml");

    await copyFileEnsuringParent(extractedBinary, sidecarPath);
    await ensureExecutable(sidecarPath);

    const config = disableAutoUpdate(await readFile(extractedConfig, "utf8"));
    await writeTextFileEnsuringParent(configExamplePath, config);

    const codeProxyArchive = join(workDir, upstream.codeProxy.asset.fileName);
    const codeProxyExtractDir = join(workDir, "codeproxy");

    await downloadFile(upstream.codeProxy.asset.downloadUrl, codeProxyArchive);
    await assertSha256(codeProxyArchive, upstream.codeProxy.asset.sha256);
    await rm(codeProxyExtractDir, { force: true, recursive: true });
    run("unzip", ["-q", codeProxyArchive, "-d", codeProxyExtractDir]);
    await copyDirectoryContents(codeProxyExtractDir, panelDir);

    await readFile(panelEntrypointPath, "utf8");

    console.log(`CliRelay archive verified: ${clirelayAsset.sha256}`);
    console.log(`codeProxy archive verified: ${upstream.codeProxy.asset.sha256}`);
    console.log(`Sidecar written: ${sidecarPath}`);
    console.log(`Panel written: ${panelDir}`);
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
