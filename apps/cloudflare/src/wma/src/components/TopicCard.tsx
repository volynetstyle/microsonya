import type { WmaTopic } from "../api/contracts";
import * as Accordion from "../shared/accordion";
import MomentItem from "./MomentItem";
import "./TopicCard.css";

export default function TopicCard(props: { topic: WmaTopic }) {
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
          {props.topic.moments.map((moment) => (
            <MomentItem moment={moment} />
          ))}
        </ul>
      </Accordion.Content>
    </Accordion.Item>
  );
}
