// Ambient declarations for Vite (the app compiles with `types: []`, so `vite/client`
// is not auto-included). Only the surface the app actually uses.
declare module "*.css" {}

interface ImportMeta {
  readonly env: {
    /** True under `vite dev`, false in production builds (dead-code-eliminated). */
    readonly DEV: boolean;
  };
}
