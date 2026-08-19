import { Show } from "solid-js";
import type { Moment } from "../mock/chat";
import * as Accordion from "../shared/accordion";

const QUOTE_PREVIEW_LENGTH = 60;

export default function MomentItem(props: { moment: Moment }) {
  const quoteMoment = () =>
    props.moment.type === "quote" ? props.moment : undefined;

  return (
    <li class="moment">
      <div class="moment-time">{props.moment.time}</div>
      <div class="moment-body">
        <div class="moment-title">{props.moment.title}</div>
        <p class="moment-text">{props.moment.body}</p>
        <Show when={quoteMoment()}>
          {(moment) => <QuoteCard moment={moment()} />}
        </Show>
      </div>
    </li>
  );
}

function QuoteCard(props: { moment: Extract<Moment, { type: "quote" }> }) {
  const isLong = () => props.moment.quote.length > QUOTE_PREVIEW_LENGTH;

  return (
    <Show
      when={isLong()}
      fallback={
        <div class="quote-card">
          <QuoteText moment={props.moment} quote={props.moment.quote} />
        </div>
      }
    >
      <Accordion.Root>
        <Accordion.Item value="quote" class="accordion-item quote-card">
          <Accordion.Trigger class="quote-trigger">
            <span class="quote-trigger-collapsed">
              <QuoteText
                moment={props.moment}
                quote={`${props.moment.quote.slice(0, QUOTE_PREVIEW_LENGTH)}…`}
              />
              <span class="quote-toggle">Показати повністю ›</span>
            </span>
            <span class="quote-trigger-expanded quote-toggle">Згорнути ›</span>
          </Accordion.Trigger>
          <Accordion.Content class="quote-expanded">
            <QuoteText moment={props.moment} quote={props.moment.quote} />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </Show>
  );
}

function QuoteText(props: {
  moment: Extract<Moment, { type: "quote" }>;
  quote: string;
}) {
  return (
    <div class="quote-card-content">
      <p class="quote-text">“{props.quote}”</p>
      <span class="quote-author">— {props.moment.author}</span>
    </div>
  );
}
