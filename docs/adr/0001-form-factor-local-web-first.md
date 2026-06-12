---
status: accepted
---

# Form factor: local web app first, Electron deferred

cara is built as a **local web app**: the `cara` CLI boots a localhost HTTP/WS server and opens the UI in an `--app`-mode browser window, architected so wrapping it in **Electron** later is a thin, additive change. The in-host MCP option is rejected outright; a native desktop shell is deferred, not chosen.

## Considered options

- **In-host MCP app** (inline HTML in Claude Code / Claude Desktop) — *rejected.* Inline HTML needs a graphical canvas, but the dominant host (Claude Code) is a terminal with none. A focused, keyboard-driven, split-pane experience cannot live in a borrowed chat panel with the host owning the keybindings. Building for the minority host (Claude Desktop) only isn't worth it.
- **Local web app** — *chosen for v1.* All real work (git, atom hashing, open-in-editor) lives in a local Node server; the form factor is only the rendering shell. Light, instant via `npx`, matches the chosen CLI invocation model, and keeps the fastest UI dev loop (browser devtools + hot reload), which matters most while the core model is still being proven.
- **Standalone desktop (Electron)** — *deferred, not rejected.* Electron is the natural desktop choice for this project because its main process **is** Node, so the existing logic runs in-process. Because local-web and Electron are the same app (Node backend + web UI) differing only in how the window opens, Electron becomes a thin later wrapper: a `BrowserWindow` loading the same `localhost` URL, plus a native window/menu/dock shell.
- **Standalone desktop (Tauri)** — *rejected.* Tauri's Rust backend mismatches cara's Node logic, forcing a rewrite or a Node sidecar and negating its lightness advantage.

## Consequences

- Build discipline: keep a clean UI↔backend split over a **localhost transport** so the Electron wrap stays free. Don't bake in browser-tab-only assumptions.
- **Voice is not built.** Speech→text is delegated to OS-level dictation (e.g. Super Whisper) into any focused field; the "agent drafts a comment from spoken intent" feature is independent of input method and survives.
- Distribution is downstream of this and unconstrained: `npx cara` and a brew **formula** now; a brew **cask** (Electron `.app`) or a `curl … /install.sh` script optional later. `npx` and `curl` both favour the lightweight local-web build (Electron over `npx` means a ~150MB Chromium pull). Developer audience means auto-update is unneeded (`brew upgrade` / always-latest `npx`) and notarization is light-to-skippable until/unless an Electron cask ships.

## Open

The **Electron trigger** is unresolved by design: whether `--app`-mode keyboard ownership (a browser tab leaks `Cmd-W`/`Cmd-L` and some shortcuts) is good enough, or whether the native window is needed. Resolve by **dogfooding the local-web build** — wrap in Electron only if the gap actually bites.
