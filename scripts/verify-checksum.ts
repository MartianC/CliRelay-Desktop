import { readFile } from "node:fs/promises";
import {
  assertAutoUpdateDisabled,
  assertExecutable,
  configExamplePath,
  panelEntrypointPath,
  readUpstreamLock,
  sha256File,
  sidecarPath,
} from "./upstream-common";

async function main(): Promise<void> {
  await readUpstreamLock();
  await assertExecutable(sidecarPath);
  const sidecarSha256 = await sha256File(sidecarPath);

  await readFile(panelEntrypointPath, "utf8");
  await assertAutoUpdateDisabled(configExamplePath);

  console.log(`sidecar sha256: ${sidecarSha256}`);
  console.log(`panel entrypoint: ${panelEntrypointPath}`);
  console.log(`config auto-update.enabled: false`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
