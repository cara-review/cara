// Tiny element factory. The only DOM-construction primitive in the UI. Dynamic text
// is set via `textContent` (never innerHTML), so untrusted strings — the agent's
// Chapter/Section summaries (ADR-0004) and any backend text — are escaped by
// construction; there is no HTML-injection surface.

type Child = Node | string | null | undefined | false;

export interface ElProps {
  readonly class?: string;
  readonly text?: string;
  readonly title?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly onClick?: () => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.attrs) for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
  if (props.dataset) for (const [key, value] of Object.entries(props.dataset)) node.dataset[key] = value;
  if (props.onClick) node.addEventListener("click", props.onClick);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Replace an element's children in one shot. */
export function fill(parent: Element, ...children: readonly Child[]): void {
  parent.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}
