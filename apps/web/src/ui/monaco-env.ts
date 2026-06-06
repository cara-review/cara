// Monaco worker wiring for Vite (ADR-0006). Imported for side effect before any editor is
// created: the diff editor computes its diff on a web worker, and each language contributes
// its own. Vite bundles each via the `?worker` suffix; we route Monaco's label to the right
// one. Only `apps/web` — Monaco is a client-side presentation library.

import type { Environment } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

const environment: Environment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    return new editorWorker();
  },
};

(self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = environment;
