// Pane layout: draggable + keyboard resize handle for the nav pane, and collapse/expand.
// The diff pane is the always-present hero (the `1fr` remainder) and is never
// collapsible. Width and collapsed state persist to localStorage and restore before
// first paint.
//
// Pure shell concern: no domain, port, or backend involvement. localStorage is a
// browser-only detail that never reaches the core. Width is applied as `--w-nav`
// custom prop on the grid, overriding the `:root` default so the diff pane reflows.

import { el } from "../dom.ts";

const STORAGE_KEY = "cara:layout";

const NAV_MIN = 180;
const NAV_MAX = 480;
const STEP = 16;

interface LayoutState {
  navWidth: number;
  navCollapsed: boolean;
}

const DEFAULTS: LayoutState = { navWidth: 256, navCollapsed: false };

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
    navCollapsed: p["navCollapsed"] === true,
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
 * Insert resize/collapse divider into the grid and wire layout behaviour. Call once after
 * the grid's panes exist. Expects grid children in order: [nav, diff].
 */
export function installLayout(grid: HTMLElement): void {
  const state = load();

  const navDivider = makeDivider();

  const [nav, diff] = grid.children;
  if (nav === undefined || diff === undefined) return;
  nav.after(navDivider.node);

  function dispatchResize(): void {
    // Monaco's diff surface re-fits on `window` resize; signal it after any width change.
    window.dispatchEvent(new Event("resize"));
  }

  function applyWidths(): void {
    grid.style.setProperty("--w-nav", state.navCollapsed ? "0px" : `${state.navWidth}px`);
    dispatchResize();
  }

  function apply(): void {
    applyWidths();
    grid.classList.toggle("grid--nav-collapsed", state.navCollapsed);
    navDivider.update();
  }

  function makeDivider(): { node: HTMLElement; update(): void } {
    const toggle = el("button", { class: "pane-divider__toggle" });
    const node = el(
      "div",
      {
        class: "pane-divider",
        attrs: { role: "separator", "aria-orientation": "vertical", tabindex: "0" },
      },
      [toggle],
    );

    let startX = 0;
    let startWidth = 0;

    node.addEventListener("pointerdown", (event) => {
      if (event.target === toggle || state.navCollapsed) return;
      event.preventDefault();
      startX = event.clientX;
      startWidth = state.navWidth;
      node.setPointerCapture(event.pointerId);
      grid.classList.add("grid--resizing");
    });
    node.addEventListener("pointermove", (event) => {
      if (!node.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientX - startX;
      state.navWidth = clamp(startWidth + delta, NAV_MIN, NAV_MAX);
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
      if (state.navCollapsed) return;
      if (event.key === "ArrowLeft") state.navWidth = clamp(state.navWidth - STEP, NAV_MIN, NAV_MAX);
      else if (event.key === "ArrowRight") state.navWidth = clamp(state.navWidth + STEP, NAV_MIN, NAV_MAX);
      else return;
      event.preventDefault();
      applyWidths();
      navDivider.update();
      save(state);
    });

    toggle.addEventListener("click", () => {
      state.navCollapsed = !state.navCollapsed;
      apply();
      save(state);
    });

    function update(): void {
      const isCollapsed = state.navCollapsed;
      toggle.textContent = isCollapsed ? "›" : "‹";
      toggle.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} navigation pane`);
      node.setAttribute("aria-label", "Resize navigation pane");
      node.setAttribute("aria-valuenow", String(state.navWidth));
      node.setAttribute("aria-valuemin", String(NAV_MIN));
      node.setAttribute("aria-valuemax", String(NAV_MAX));
      node.classList.toggle("pane-divider--collapsed", isCollapsed);
    }

    return { node, update };
  }

  apply();
}
