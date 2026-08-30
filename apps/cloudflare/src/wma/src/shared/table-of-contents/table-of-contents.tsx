import { For, createMemo, createSignal, untrack } from "solid-js";
import "./table-of-contents.css";

export interface TableOfContentsItem {
  id: string;
  label: string;
  children?: readonly TableOfContentsItem[];
}

export interface TableOfContentsProps {
  items: readonly TableOfContentsItem[];
  activeId: string;
  ariaLabel?: string;
  class?: string;
  onSelect?: (id: string) => void;
}

interface Node {
  item: TableOfContentsItem;
  depth: number;
  parentId?: string;
}

interface VisibleNode extends Node {
  active: boolean;
  ancestorActive: boolean;
  open: boolean;
}

const INDENT = 16;
const EMPTY_IDS: ReadonlySet<string> = new Set();

export function TableOfContents(props: TableOfContentsProps) {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

  const topology = createMemo(() => {
    const nodes: Node[] = [];
    const parentById = new Map<string, string | undefined>();
    const stack: Node[] = [];

    for (let i = props.items.length - 1; i >= 0; i--) {
      stack.push({
        item: props.items[i],
        depth: 0,
      });
    }

    while (stack.length) {
      const node = stack.pop()!;

      nodes.push(node);
      parentById.set(node.item.id, node.parentId);

      const children = node.item.children;
      if (!children?.length) continue;

      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({
          item: children[i],
          depth: node.depth + 1,
          parentId: node.item.id,
        });
      }
    }

    return { nodes, parentById };
  });

  const activeAncestors = createMemo<ReadonlySet<string>>(() => {
    const { parentById } = topology();

    if (!parentById.has(props.activeId)) return EMPTY_IDS;

    const ancestors = new Set<string>();
    let id = parentById.get(props.activeId);

    while (id !== undefined) {
      ancestors.add(id);
      id = parentById.get(id);
    }

    return ancestors;
  });

  const visibleItems = createMemo<readonly VisibleNode[]>(() => {
    const { nodes } = topology();
    const ancestors = activeAncestors();
    const expandedIds = expanded();
    const activeId = props.activeId;

    const result: VisibleNode[] = [];
    let hiddenBelowDepth = Infinity;

    for (const node of nodes) {
      if (node.depth > hiddenBelowDepth) continue;

      hiddenBelowDepth = Infinity;

      const children = node.item.children;
      const active = node.item.id === activeId;
      const ancestorActive = ancestors.has(node.item.id);

      const open = Boolean(
        children?.length &&
          (active || ancestorActive || expandedIds.has(node.item.id)),
      );

      result.push({
        ...node,
        active,
        ancestorActive,
        open,
      });

      if (children?.length && !open) {
        hiddenBelowDepth = node.depth;
      }
    }

    return result;
  });

  const toggleBranch = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  return (
    <nav
      class={`toc${props.class ? ` ${props.class}` : ""}`}
      aria-label={props.ariaLabel ?? "Table of contents"}
      style={{ "--toc-indent": `${INDENT}px` }}
    >
      <ul class="toc__list">
        <For each={visibleItems()} keyed={(node) => node.item.id}>
          {(node) => {
            const item = () => node().item;
            const hasChildren = () => Boolean(item().children?.length);

            return (
              <li
                class={`toc__item${
                  node().active || node().ancestorActive
                    ? " toc__item--active"
                    : ""
                }`}
                data-nested={node().depth > 0 ? "" : undefined}
                style={{ "--toc-depth": node().depth }}
              >
                <button
                  type="button"
                  class="toc__link"
                  aria-current={node().active ? "location" : undefined}
                  aria-expanded={
                    hasChildren()
                      ? node().open
                        ? "true"
                        : "false"
                      : undefined
                  }
                  onClick={() => {
                    const selected = untrack(node).item;

                    props.onSelect?.(selected.id);

                    if (selected.children?.length) {
                      toggleBranch(selected.id);
                    }
                  }}
                >
                  <span class="toc__label">{item().label}</span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </nav>
  );
}