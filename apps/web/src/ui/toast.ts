// Non-blocking failure feedback for the fire-and-forget mark/skip/file-toggle actions. A mark
// travels over the tRPC transport (backend.ts) and can reject — an `ok:false` reply, or a dropped
// socket (#29) — but the keyboard and the diff surface dispatch these actions fire-and-forget, so
// without this the rejection is swallowed and the reviewer never learns the mark didn't land.
// `dispatchMark` runs such an action and, on rejection, raises a non-blocking toast offering a
// Retry that re-issues it. DOM-bound; the only UI chrome mounted outside the view tree.

import { el } from "../dom.ts";

const DISMISS_MS = 6000;
let host: HTMLElement | null = null;

function toastHost(): HTMLElement {
  if (host !== null) return host;
  host = el("div", { class: "toast-host", attrs: { role: "status", "aria-live": "polite" } });
  document.body.append(host);
  return host;
}

/** Run a fire-and-forget mark action; on failure raise a retry toast that re-issues it. */
export function dispatchMark(message: string, action: () => Promise<void>): void {
  action().catch(() => raise(message, () => dispatchMark(message, action)));
}

function raise(message: string, retry: () => void): void {
  const toast = el("div", { class: "toast" }, [
    el("span", { class: "toast__message", text: message }),
    el("button", {
      class: "toast__retry",
      text: "Retry",
      onClick: () => {
        dismiss();
        retry();
      },
    }),
  ]);
  const timer = window.setTimeout(dismiss, DISMISS_MS);
  function dismiss(): void {
    window.clearTimeout(timer);
    toast.remove();
  }
  toastHost().append(toast);
}
