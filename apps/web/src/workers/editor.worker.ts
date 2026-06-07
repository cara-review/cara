// Monaco editor (diff) worker entry. A thin wrapper so the Bun bundler emits this as a
// separate module-worker chunk (ADR-0008): monaco-env.ts instantiates it via
// `new Worker(new URL("./editor.worker.ts", import.meta.url), { type: "module" })`.
import "monaco-editor/esm/vs/editor/editor.worker.js";
