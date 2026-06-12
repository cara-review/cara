// Builds the publishable package into dist/: a single self-contained dist/index.js
// (the workspace packages + npm deps inlined, so installers need no workspace
// resolution) plus dist/web (the Monaco UI bundle the server serves). Run after
// `bun run build` has produced apps/web/dist. Wired up via the build:dist script.

import { cp, chmod, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The published bin targets Node so `npx cara` runs on any Node machine
// (ADR-0008 amendment); dev still uses `bun index.js`.
const SHEBANG = "#!/usr/bin/env node";

const root = resolve(import.meta.dir, "..");
const webDist = resolve(root, "apps/web/dist");

if (!existsSync(webDist)) {
  console.error("apps/web/dist is missing — run `bun run build` first.");
  process.exit(1);
}

await rm(resolve(root, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "index.js")],
  outdir: resolve(root, "dist"),
  target: "node",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Bun keeps the entry's own shebang (`#!/usr/bin/env bun`) inside the bundle body,
// which is a syntax error anywhere but line 1. Strip every shebang line, then prepend
// exactly one Node shebang so the bin stays executable under plain Node.
const cli = resolve(root, "dist/index.js");
const body = (await readFile(cli, "utf8"))
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#!"))
  .join("\n");
await writeFile(cli, `${SHEBANG}\n${body}`);

const packedWeb = resolve(root, "dist/web");
await cp(webDist, packedWeb, { recursive: true });

// Drop sourcemaps from the packaged web bundle — no runtime benefit, and the
// Monaco map alone is ~13.9 MB. The source apps/web/dist keeps its maps so dev
// and e2e builds are unaffected.
const maps = new Bun.Glob("**/*.map").scanSync({ cwd: packedWeb, absolute: true });
for (const map of maps) await rm(map);

await chmod(cli, 0o755);

console.log("packed dist/index.js + dist/web");
