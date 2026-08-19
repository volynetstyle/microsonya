import { For } from "solid-js";
import type { Topic } from "../mock/chat";
import * as Accordion from "../shared/accordion";
import MomentItem from "./MomentItem";

export default function TopicCard(props: { topic: Topic }) {
  return (
    <Accordion.Item value={props.topic.id} class="accordion-item topic-card">
      <Accordion.Trigger class="topic-trigger">
        <span class="topic-header">
          <span class="topic-chevron" aria-hidden="true">
            ›
          </span>
          <span class="topic-heading">
            <span class="topic-title">{props.topic.title}</span>
            <span class="topic-meta">
              {props.topic.messageCount} повідомлень · {props.topic.timeRange}
            </span>
          </span>
        </span>
        <span class="topic-summary">
          <span class="topic-preview">{props.topic.preview}</span>
          <span class="topic-key-points">
            {props.topic.keyPointsCount} ключові моменти ›
          </span>
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        <ul class="moment-list">
          <For each={props.topic.moments}>
            {(moment) => <MomentItem moment={moment} />}
          </For>
        </ul>
      </Accordion.Content>
    </Accordion.Item>
  );
}
