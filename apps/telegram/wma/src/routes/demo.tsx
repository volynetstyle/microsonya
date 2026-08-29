import { createSignal } from "solid-js";
import { TableOfContentsDemo } from "../components/TableOfContentsDemo";
import * as Accordion from "../shared/accordion";
import * as ContextMenu from "../shared/context-menu";
import * as Dropdown from "../shared/dropdown";
import * as Menu from "../shared/menu";
import * as Popover from "../shared/popover";
import "./Demo.css";

export default function PrimitiveDemo() {
  const [lastAction, setLastAction] = createSignal("Nothing selected yet");

  const contextMenu = ContextMenu.createContextMenu({
    targets: "[data-demo-context]",
    longPressMs: 200,
    closeOnScroll: true,
  });

  const selectAction = (label: string) => setLastAction(label);

  return (
    <main class="screen demo-screen">
      <header class="demo-header">
        <div>
          <a class="demo-back" href="/">
            ‹ Back to home
          </a>
          <p class="demo-kicker">Microsonya / shared</p>
          <h1>Primitive playground</h1>
          <p class="demo-lead">
            An interactive showcase for the native details, popover and menu
            contracts used by the app.
          </p>
        </div>
        <span class="demo-badge">/demo</span>
      </header>

      <div class="demo-grid">
        <section class="demo-card demo-card-wide">
          <DemoHeading
            name="TableOfContents"
            description="Recursive navigation with active ancestor rails."
          />
          <TableOfContentsDemo />
        </section>

        <section class="demo-card demo-card-wide">
          <DemoHeading
            name="Accordion"
            description="Native details topology with multiple panels."
          />
          <Accordion.Root
            class="demo-accordion"
            multiple
            defaultValue={["motion"]}
          >
            <Accordion.Item value="motion">
              <Accordion.Trigger>Motion contract</Accordion.Trigger>
              <Accordion.Content>
                <p>
                  Height, opacity and reduced-motion policies belong to the
                  accordion primitive.
                </p>
              </Accordion.Content>
            </Accordion.Item>
            <Accordion.Item value="native">
              <Accordion.Trigger>Native state</Accordion.Trigger>
              <Accordion.Content>
                <p>
                  The browser owns the details toggle; Solid synchronizes
                  controlled state only when requested.
                </p>
              </Accordion.Content>
            </Accordion.Item>
            <Accordion.Item value="multiple">
              <Accordion.Trigger>Multiple panels</Accordion.Trigger>
              <Accordion.Content>
                <p>Open this panel together with any of the others.</p>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        </section>

        <section class="demo-card">
          <DemoHeading
            name="Popover"
            description="Element anchor, native light-dismiss and Escape."
          />
          <Popover.Root placement="bottom-start">
            <Popover.Trigger class="demo-button">Open popover</Popover.Trigger>
            <Popover.Content>
              <Popover.Surface class="demo-surface">
                <strong>Anchored surface</strong>
                <p>This panel lives in the browser top layer.</p>
              </Popover.Surface>
            </Popover.Content>
          </Popover.Root>
        </section>

        <section class="demo-card">
          <DemoHeading
            name="Dropdown"
            description="Popover geometry with a generic panel surface."
          />
          <Dropdown.Root placement="bottom-end">
            <Dropdown.Trigger class="demo-button">
              Open dropdown
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Panel class="demo-surface">
                <strong>Dropdown panel</strong>
                <p>Useful for notifications, settings and small workflows.</p>
                <button
                  class="demo-inline-action"
                  type="button"
                  onClick={() => selectAction("Dropdown action")}
                >
                  Run action
                </button>
              </Dropdown.Panel>
            </Dropdown.Content>
          </Dropdown.Root>
        </section>

        <section class="demo-card">
          <DemoHeading
            name="Menu"
            description="Arrows, Home/End, typeahead and Tab dismissal."
          />
          <Menu.Root>
            <Menu.Trigger class="demo-button">Open menu</Menu.Trigger>
            <Menu.Content aria-label="Demo actions">
              <Menu.Item onSelect={() => selectAction("Reply")}>
                Reply
              </Menu.Item>
              <Menu.Item onSelect={() => selectAction("Copy")}>Copy</Menu.Item>
              <Menu.Separator />
              <Menu.Item onSelect={() => selectAction("Forward")}>
                Forward
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </section>

        <section class="demo-card demo-card-wide">
          <DemoHeading
            name="ContextMenu"
            description="Right click, Shift+F10 and 200 ms long press on touch."
          />

          <div
            ref={contextMenu.setTargetRoot}
            class="context-demo-target"
            data-demo-context
            {...contextMenu.handlers}
            tabindex={0}
          >
            <strong>Try the context menu here</strong>
            <span>Right-click this area or press Shift+F10 when focused.</span>
            <span class="context-demo-hint">
              On touch devices, press and hold for 200 ms.
            </span>
          </div>
          <ContextMenu.Content
            controller={contextMenu}
            aria-label="Context actions"
          >
            <Menu.Item onSelect={() => selectAction("Context: Reply")}>
              Reply
            </Menu.Item>
            <Menu.Item onSelect={() => selectAction("Context: Copy")}>
              Copy
            </Menu.Item>
            <Menu.Item onSelect={() => selectAction("Context: Forward")}>
              Forward
            </Menu.Item>
          </ContextMenu.Content>
        </section>
      </div>

      <output class="demo-output" aria-live="polite">
        <span>Last action</span>
        <strong>{lastAction()}</strong>
      </output>
    </main>
  );
}

function DemoHeading(props: { name: string; description: string }) {
  return (
    <div class="demo-heading">
      <div>
        <p class="demo-component-name">{props.name}</p>
        <p class="demo-description">{props.description}</p>
      </div>
      <code>shared/{props.name.toLowerCase()}</code>
    </div>
  );
}
