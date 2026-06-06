---
number: 26-020
title: Pane resize / collapse + persisted layout
kind: plan
status: active
issue: "#17"
tags: [web, ui, shell, layout, persistence]
---

# TN-26-020: Pane resize / collapse + persisted layout

Fast-follow on the web shell (#11) and Monaco diff surface (#27). Makes the 3-pane
shell adjustable: drag/keyboard resize handles between panes, collapse/expand for the
**nav** and **chat** panes, and persistence of widths + collapsed state across launches.
The **diff** pane is the always-present hero — never collapsible, takes the `1fr`
remainder.

Pure `apps/web` shell concern. No domain, port, or backend involvement — localStorage is
a browser-only adapter detail that never reaches the core. No ADR needed.

## Approach

A self-contained `ui/layout.ts` module owns the behaviour; `view.ts` wires it once after
building the grid. Two **divider** elements (class `pane-divider` — namespaced to avoid
Monaco's own `.gutter`) are inserted into the grid between panes:

```
[ nav ] [divider] [ diff (1fr) ] [divider] [ chat ]
```

- **Resize (drag):** pointerdown on a divider captures the pointer; pointermove adjusts
  the adjacent pane's width (nav grows rightward, chat grows leftward), clamped to
  min/max; pointerup persists. Widths applied as `--w-nav` / `--w-chat` custom props on
  the grid element (overriding the `:root` defaults), so the diff pane reflows via `1fr`.
- **Resize (keyboard):** each divider is `role="separator"`, focusable, with
  `aria-valuenow/min/max`; ArrowLeft/ArrowRight nudge width by a fixed step.
- **Collapse:** each divider hosts a toggle button. Collapsing sets the pane's column to
  `0` and `display:none`s the pane; the divider stays visible so the expand affordance is
  always reachable. Diff has no collapse.
- **Persistence:** `{navWidth, chatWidth, navCollapsed, chatCollapsed}` in localStorage
  (`clear-diff:layout`), parsed + clamped defensively on load (`parseLayout`, the one
  pure/unit-tested seam), restored before first paint.

## Monaco

The diff surface uses manual layout (`automaticLayout: false`) and only re-fits on
content change, so a width change alone would leave it mis-sized. The surface gains a
single `window` `resize` listener calling its existing `scheduleFit`; the layout module
dispatches a `resize` event after every width/collapse change. Surface internals are
otherwise untouched — it just gets a genuinely resizable container.

## Testing

`parseLayout` (load/validation/clamp) is pure → `node --test`. Drag/keyboard/collapse DOM
behaviour is verified in the real app (manual + Playwright), the established split for the
shell's thin DOM layer.
