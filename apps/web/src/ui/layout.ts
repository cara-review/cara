// Pane layout: draggable + keyboard resize handles between the three panes, and
// collapse/expand for the nav and chat panes. The diff pane is the always-present hero
// (the `1fr` remainder) and is never collapsible. Widths and collapsed state persist to
// localStorage and restore before first paint.
//
// Pure shell concern: no domain, port, or backend involvement. localStorage is a
// browser-only detail that never reaches the core. Widths are applied as `--w-nav` /
// `--w-chat` custom props on the grid, overriding the `:root` defaults so the diff pane
// reflows automatically.

import { el } from "../dom.ts";

const STORAGE_KEY = "clear-diff:layout";

const NAV_MIN = 180;
const NAV_MAX = 480;
const CHAT_MIN = 240;
const CHAT_MAX = 520;
const STEP = 16;

interface LayoutState {
  navWidth: number;
  chatWidth: number;
  navCollapsed: boolean;
  chatCollapsed: boolean;
}

const DEFAULTS: LayoutState = { navWidth: 256, chatWidth: 320, navCollapsed: false, chatCollapsed: false };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Parse + defensively validate persisted layout. Pure — the unit-tested seam. */
export function parseLayout(raw: string | null): LayoutState {
  if (raw === null) return { ...DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS };
  const p = parsed as Record<string, unknown>;
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    navWidth: clamp(num(p["navWidth"], DEFAULTS.navWidth), NAV_MIN, NAV_MAX),
    chatWidth: clamp(num(p["chatWidth"], DEFAULTS.chatWidth), CHAT_MIN, CHAT_MAX),
    navCollapsed: p["navCollapsed"] === true,
    chatCollapsed: p["chatCollapsed"] === true,
  };
}

function load(): LayoutState {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort (private browsing / disabled storage); ignore failures.
  }
}

/**
 * Insert resize/collapse dividers into the grid and wire layout behaviour. Call once after
 * the grid's panes exist. Expects grid children in order: [nav, diff, chat].
 */
export function installLayout(grid: HTMLElement): void {
  const state = load();

  const navDivider = makeDivider("nav");
  const chatDivider = makeDivider("chat");

  const [nav, diff, chat] = grid.children;
  if (nav === undefined || diff === undefined || chat === undefined) return;
  nav.after(navDivider.node);
  diff.after(chatDivider.node);

  function dispatchResize(): void {
    // Monaco's diff surface re-fits on `window` resize; signal it after any width change.
    window.dispatchEvent(new Event("resize"));
  }

  function applyWidths(): void {
    grid.style.setProperty("--w-nav", state.navCollapsed ? "0px" : `${state.navWidth}px`);
    grid.style.setProperty("--w-chat", state.chatCollapsed ? "0px" : `${state.chatWidth}px`);
    dispatchResize();
  }

  function apply(): void {
    applyWidths();
    grid.classList.toggle("grid--nav-collapsed", state.navCollapsed);
    grid.classList.toggle("grid--chat-collapsed", state.chatCollapsed);
    navDivider.update();
    chatDivider.update();
  }

  function makeDivider(side: "nav" | "chat"): { node: HTMLElement; update(): void } {
    const isNav = side === "nav";
    const name = isNav ? "navigation" : "chat";
    const min = isNav ? NAV_MIN : CHAT_MIN;
    const max = isNav ? NAV_MAX : CHAT_MAX;

    const toggle = el("button", { class: "pane-divider__toggle" });
    const node = el(
      "div",
      {
        class: "pane-divider",
        attrs: { role: "separator", "aria-orientation": "vertical", tabindex: "0" },
      },
      [toggle],
    );

    const collapsed = (): boolean => (isNav ? state.navCollapsed : state.chatCollapsed);
    const width = (): number => (isNav ? state.navWidth : state.chatWidth);
    const setCollapsed = (value: boolean): void => {
      if (isNav) state.navCollapsed = value;
      else state.chatCollapsed = value;
    };
    const setWidth = (value: number): void => {
      const next = clamp(value, min, max);
      if (isNav) state.navWidth = next;
      else state.chatWidth = next;
    };

    let startX = 0;
    let startWidth = 0;

    node.addEventListener("pointerdown", (event) => {
      if (event.target === toggle || collapsed()) return;
      event.preventDefault();
      startX = event.clientX;
      startWidth = width();
      node.setPointerCapture(event.pointerId);
      grid.classList.add("grid--resizing");
    });
    node.addEventListener("pointermove", (event) => {
      if (!node.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientX - startX;
      setWidth(startWidth + (isNav ? delta : -delta));
      applyWidths();
    });
    const endDrag = (event: PointerEvent): void => {
      if (!node.hasPointerCapture(event.pointerId)) return;
      node.releasePointerCapture(event.pointerId);
      grid.classList.remove("grid--resizing");
      save(state);
    };
    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);

    node.addEventListener("keydown", (event) => {
      if (collapsed()) return;
      if (event.key === "ArrowLeft") setWidth(width() + (isNav ? -STEP : STEP));
      else if (event.key === "ArrowRight") setWidth(width() + (isNav ? STEP : -STEP));
      else return;
      event.preventDefault();
      applyWidths();
      navDivider.update();
      chatDivider.update();
      save(state);
    });

    toggle.addEventListener("click", () => {
      setCollapsed(!collapsed());
      apply();
      save(state);
    });

    function update(): void {
      const isCollapsed = collapsed();
      // Chevron points the way the action moves the pane edge.
      const expandGlyph = isNav ? "›" : "‹";
      const collapseGlyph = isNav ? "‹" : "›";
      toggle.textContent = isCollapsed ? expandGlyph : collapseGlyph;
      toggle.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${name} pane`);
      node.setAttribute("aria-label", `Resize ${name} pane`);
      node.setAttribute("aria-valuenow", String(width()));
      node.setAttribute("aria-valuemin", String(min));
      node.setAttribute("aria-valuemax", String(max));
      node.classList.toggle("pane-divider--collapsed", isCollapsed);
    }

    return { node, update };
  }

  apply();
}
