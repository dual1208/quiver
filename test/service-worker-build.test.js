import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const buildScript = join(repositoryRoot, "service-worker", "build.js");

const fakeWorkboxSource = `
const { readdir, readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

exports.generateSW = async ({ globDirectory, swDest }) => {
  const entries = (await readdir(globDirectory))
    .filter((entry) => entry !== "service-worker.js")
    .sort();
  const sources = await Promise.all(
    entries.map((entry) => readFile(join(globDirectory, entry), "utf8")),
  );
  const artifact = sources.join("\\n");
  await writeFile(swDest, artifact);
  return { count: entries.length, size: Buffer.byteLength(artifact), warnings: [] };
};
`;

async function readUtf8OrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

describe("legacy service-worker build", () => {
  it("reads the legacy app and writes its generated artifact beside it", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "quiver-service-worker-"));
    const serviceWorkerDirectory = join(fixtureRoot, "service-worker");
    const legacyDirectory = join(fixtureRoot, "legacy-web");
    const staleDirectory = join(fixtureRoot, "src");
    const fakeModules = join(fixtureRoot, "fake-node-modules");
    const fakeWorkbox = join(fakeModules, "workbox-build", "index.js");

    try {
      await Promise.all([
        mkdir(serviceWorkerDirectory),
        mkdir(legacyDirectory),
        mkdir(staleDirectory),
        mkdir(dirname(fakeWorkbox), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(legacyDirectory, "app.txt"), "current legacy app"),
        writeFile(join(staleDirectory, "app.txt"), "stale removed app"),
        writeFile(fakeWorkbox, fakeWorkboxSource),
      ]);

      await execFileAsync(process.execPath, [buildScript], {
        cwd: serviceWorkerDirectory,
        env: { ...process.env, NODE_PATH: fakeModules },
      });

      await expect(
        Promise.all([
          readUtf8OrNull(join(legacyDirectory, "service-worker.js")),
          readUtf8OrNull(join(staleDirectory, "service-worker.js")),
        ]),
      ).resolves.toEqual(["current legacy app", null]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
