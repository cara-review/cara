// Monaco worker wiring for the Bun bundler (ADR-0006, ADR-0008). Imported for side
// effect before any editor is created: the diff editor computes its diff on a web
// worker, and each language contributes its own. The workers are built as separate
// entrypoints (see apps/web/package.json `build`) into the bundle root as
// `<name>.worker.js`; here we resolve each relative to the loaded bundle
// (`import.meta.url`) and route Monaco's label to the right one. Only `apps/web` —
// Monaco is a client-side library.

import type { Environment } from "monaco-editor";

const worker = (name: string): Worker =>
  new Worker(new URL(`./${name}.worker.js`, import.meta.url), { type: "module" });

const editorWorker = (): Worker => worker("editor");
const tsWorker = (): Worker => worker("ts");
const jsonWorker = (): Worker => worker("json");
const cssWorker = (): Worker => worker("css");
const htmlWorker = (): Worker => worker("html");

const environment: Environment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") return tsWorker();
    if (label === "json") return jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return htmlWorker();
    return editorWorker();
  },
};

(self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = environment;
