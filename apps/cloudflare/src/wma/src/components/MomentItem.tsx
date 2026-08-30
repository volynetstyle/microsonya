import { createSignal, onCleanup } from "solid-js";
import type { WmaMoment } from "../api/contracts";
import "./MomentItem.css";

const QUOTE_PREVIEW_LENGTH = 60;

export default function MomentItem(props: { moment: WmaMoment }) {
  const quoteMoment = props.moment.type === "quote" ? props.moment : undefined;

  return (
    <li class="moment">
      <div class="moment-time">{props.moment.time}</div>
      <div class="moment-body">
        <div class="moment-title">{props.moment.title}</div>
        <p class="moment-text">{props.moment.body}</p>
        {quoteMoment && <QuoteCard moment={quoteMoment} />}
      </div>
    </li>
  );
}

function QuoteCard(props: { moment: Extract<WmaMoment, { type: "quote" }> }) {
  const isLong = props.moment.quote.length > QUOTE_PREVIEW_LENGTH;
  const [expanded, setExpanded] = createSignal(false);
  let body: HTMLDivElement | undefined;
  let heightAnimation: Animation | undefined;
  let animationFrame: number | undefined;

  const toggle = () => {
    if (!body) return;

    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    heightAnimation?.cancel();
    const startHeight = body.getBoundingClientRect().height;

    body.style.height = `${startHeight}px`;
    body.style.overflow = "hidden";
    setExpanded((value) => !value);

    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined;
      if (!body) return;

      // Measure natural layout, then restore the old height so WAAPI can
      // interpolate exact values instead of the non-interpolable `auto`.
      body.style.height = "auto";
      const endHeight = body.getBoundingClientRect().height;
      body.style.height = `${startHeight}px`;

      if (
        document.documentElement.dataset.motion === "reduced" ||
        document.documentElement.dataset.devicePerformance === "low" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        finishHeightAnimation(body);
        return;
      }

      heightAnimation = body.animate(
        [
          { height: `${startHeight}px`, opacity: 0.86 },
          { height: `${endHeight}px`, opacity: 1 },
        ],
        {
          duration: quoteAnimationDuration(endHeight - startHeight),
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        },
      );
      body.style.height = `${endHeight}px`;
      heightAnimation.onfinish = () => body && finishHeightAnimation(body);
      heightAnimation.oncancel = () => body && finishHeightAnimation(body);
    });
  };

  onCleanup(() => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    heightAnimation?.cancel();
    body = undefined;
  });

  if (!isLong) {
    return (
      <div class="quote-card">
        <QuoteText moment={props.moment} quote={props.moment.quote} />
      </div>
    );
  }

  return (
    <div ref={body} class="quote-card quote-card-expandable">
      <QuoteText
        moment={props.moment}
        quote={
          expanded()
            ? props.moment.quote
            : `${props.moment.quote.slice(0, QUOTE_PREVIEW_LENGTH)}...`
        }
      />
      <button
        type="button"
        class="quote-toggle"
        aria-expanded={expanded() ? "true" : "false"}
        onClick={toggle}
      >
        {expanded() ? "Згорнути" : "Показати повністю"} ›
      </button>
    </div>
  );
}

function quoteAnimationDuration(heightDelta: number): number {
  return Math.min(360, Math.max(160, Math.abs(heightDelta) * 1.5));
}

function finishHeightAnimation(element: HTMLElement): void {
  element.style.height = "";
  element.style.overflow = "";
}

function QuoteText(props: {
  moment: Extract<WmaMoment, { type: "quote" }>;
  quote: string;
}) {
  return (
    <div class="quote-card-content">
      <p class="quote-text">“{props.quote}”</p>
      <span class="quote-author">— {props.moment.author}</span>
    </div>
  );
}
