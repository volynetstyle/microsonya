import { For, createSignal, onSettled } from "solid-js";
import {
  TableOfContents,
  type TableOfContentsItem,
} from "../shared/table-of-contents";

const tocItems: readonly TableOfContentsItem[] = [
  { id: "intro", label: "1. Introduction" },
  { id: "principles", label: "2. Design principles" },
  {
    id: "motion",
    label: "3. Motion policy",
    children: [
      { id: "motion-tracking", label: "3.1. Tracking" },
      { id: "motion-chasing", label: "3.2. Chasing" },
      { id: "motion-ballistic", label: "3.3. Ballistic" },
      {
        id: "motion-settled",
        label: "3.4. Settled state",
        children: [
          { id: "motion-tracking1", label: "3.4.1. Tracking" },
          { id: "motion-chasing2", label: "3.4.2. Chasing" },
          { id: "motion-ballistic3", label: "3.4.3. Ballistic" },
          { id: "motion-settled4", label: "3.4.4. Settled state" },
        ],
      },
    ],
  },
  { id: "accessibility", label: "4. Accessibility" },
  { id: "api", label: "5. Component API" },
  { id: "summary", label: "6. Summary" },
];

const flatItems = tocItems.flatMap((item) => [item, ...(item.children ?? [])]);

export function TableOfContentsDemo() {
  const [activeId, setActiveId] = createSignal(flatItems[0].id);
  let scroller!: HTMLDivElement;
  let frame = 0;
  let sections: readonly HTMLElement[] = [];
  const sectionById = new Map<string, HTMLElement>();

  const updateActiveSection = () => {
    const marker = scroller.scrollTop + scroller.clientHeight * 0.32;
    let next = flatItems[0].id;
    for (const section of sections) {
      if (section.offsetTop <= marker) next = section.id;
      else break;
    }
    setActiveId(next);
  };

  const handleScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateActiveSection();
    });
  };

  const selectSection = (id: string) => {
    sectionById.get(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  onSettled(() => {
    sections = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-toc-demo-section]"),
    );
    for (const section of sections) sectionById.set(section.id, section);
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    updateActiveSection();
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      if (frame) cancelAnimationFrame(frame);
      sectionById.clear();
      sections = [];
    };
  });

  return (
    <div class="toc-demo">
      <aside class="toc-demo-navigation">
        <div class="toc-demo-status" aria-live="polite">
          <span>Active section</span>
          <strong>{activeId()}</strong>
        </div>
        <TableOfContents
          items={tocItems}
          activeId={activeId()}
          onSelect={selectSection}
        />
      </aside>

      <div ref={scroller} class="toc-demo-document" tabindex={0}>
        <For each={flatItems}>
          {(item) => (
            <section
              id={item.id}
              class="toc-demo-section"
              data-toc-demo-section
            >
              <p>{item.label}</p>
              <h3>{sectionTitle(item.id)}</h3>
              <p>
                Scroll through the document or choose a navigation item. The
                active ancestor chain stays visible while unrelated collapsed
                subtrees remain outside the navigation DOM.
              </p>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}

function sectionTitle(id: string) {
  if (id.startsWith("motion-")) return `Motion: ${id.slice(7)}`;
  return id[0].toUpperCase() + id.slice(1);
}
