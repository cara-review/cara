# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants, picks one (or steals bits from each), then throws the rest away.

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options before committing."
- "Try a different layout for this screen."

## Two sub-shapes — prefer A

### Sub-shape A — adjustment to an existing page (preferred)

The route already exists. Variants are rendered on the same route, gated by `?variant=` URL search param. Existing data fetching, params, and auth stay — only rendering swaps.

If the thing doesn't have a page yet but would naturally live inside one (a new section, card, step in a flow) — still sub-shape A.

### Sub-shape B — a new page (last resort)

Only when the prototype genuinely has no existing page to live inside. Create a throwaway route following whatever routing convention the project uses. Name it obviously as a prototype.

## Process

### 1. State the question and pick N

Default to **3 variants**. Cap at 5.

### 2. Generate radically different variants

Each variant must be **structurally different** — different layout, information hierarchy, primary affordance. Not just different colours. If two drafts come out similar, redo one with an explicit constraint ("no card grid").

Hold each to:

- The page's purpose and available data
- The project's component library / styling system
- A clear exported component name (`VariantA`, `VariantB`, `VariantC`)

### 3. Wire them together

Single switcher component on the route:

```tsx
const variant = searchParams.get('variant') ?? 'A'
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A', 'B', 'C']} current={variant} />
  </>
)
```

### 4. Build the floating switcher

Fixed-position bar at bottom-centre:

- Left/right arrows cycle variants (wrap around)
- Shows current variant key + name
- Keyboard arrows also cycle (not when input focused)
- Visually distinct from the page
- Hidden in production builds

### 5. Hand it over

Surface the URL and variant keys. Typical feedback: "I want the header from B with the sidebar from C."

### 6. Capture and clean up

Write down which variant won and why. Then:

- Sub-shape A: delete losers and switcher, fold winner into the page
- Sub-shape B: promote winner to real route, delete throwaway

## Anti-patterns

- Variants that differ only in colour or copy — that's a tweak, not a prototype.
- Sharing too much code between variants — each should be free to throw out the layout.
- Wiring variants to real mutations — keep them read-only.
- Promoting prototype code directly to production — rewrite it properly.
