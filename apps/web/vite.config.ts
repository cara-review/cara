import { defineConfig } from "vite";

// Monaco's editor + language workers are bundled via the `?worker` suffix (see ui/monaco-env.ts);
// emit them as ES modules so the browser loads them as `type: module` workers.
export default defineConfig({
  worker: { format: "es" },
});
