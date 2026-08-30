import { createMemo, createSignal, Errored, Loading, Show } from "solid-js";
import { loadChatOverview, loadSummaryDetail } from "../api/bootstrap";
import type { WmaSummaryCard } from "../api/contracts";
import * as Accordion from "../shared/accordion";
import "../components/TopicCard.css";

export default function Chat(props: { chatRef: string }) {
  const overview = createMemo(async () => loadChatOverview(props.chatRef));
  return (
    <main class="screen">
      <button class="back-button" onClick={() => history.back()}>
        ‹
      </button>
      <Errored fallback={(e) => <p>{String(e())}</p>}>
        <Loading fallback={<p>Завантаження…</p>}>
          <header class="chat-header">
            <span class="chat-title">{overview().chat.title}</span>
            <span class="chat-total">
              {overview().stats.messageCount} повідомлень
            </span>
          </header>
          <Accordion.Root
            class="topic-list"
            defaultValue={overview().summaries[0]?.id}
          >
            {overview().summaries.map((summary) => (
              <SummaryCard chatRef={props.chatRef} summary={summary} />
            ))}
          </Accordion.Root>
        </Loading>
      </Errored>
    </main>
  );
}

/** The accordion owns the summary. Source messages are a second local screen
 * within that accordion item and are not requested until the user enters it. */
function SummaryCard(props: { chatRef: string; summary: WmaSummaryCard }) {
  const [showMessages, setShowMessages] = createSignal(false);
  const detail = createMemo(async () =>
    showMessages()
      ? loadSummaryDetail(props.chatRef, props.summary.id)
      : undefined,
  );
  const time = () =>
    new Date(props.summary.createdAt).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Accordion.Item value={props.summary.id} class="topic-card">
      <Accordion.Trigger class="topic-trigger">
        <span class="topic-header">
          <span class="topic-chevron" aria-hidden="true">
            ›
          </span>
          <span class="topic-heading">
            <span class="topic-title">Підсумок</span>
            <span class="topic-meta">
              {props.summary.messageCount} повідомлень · {time()}
            </span>
          </span>
        </span>
        <span class="topic-summary">
          <span class="topic-preview">{props.summary.preview}</span>
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        <Show
          when={showMessages()}
          fallback={
            <section class="summary-screen">
              <p class="summary-text">{props.summary.summary}</p>
              <button
                type="button"
                class="summary-messages-link"
                onClick={() => setShowMessages(true)}
              >
                Переглянути повідомлення ({props.summary.messageCount}) ›
              </button>
            </section>
          }
        >
          <section class="summary-screen summary-messages-screen">
            <button
              type="button"
              class="summary-messages-back"
              onClick={() => setShowMessages(false)}
            >
              ‹ Підсумок
            </button>
            <Errored fallback={(e) => <p>{String(e())}</p>}>
              <Loading fallback={<p>Завантаження повідомлень…</p>}>
                {detail() && (
                  <ul class="moment-list">
                    {detail()!.moments.map((moment) => (
                      <li class="moment">
                        <div class="moment-time">
                          {new Date(moment.sentAt).toLocaleTimeString("uk-UA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div class="moment-body">
                          <div class="moment-title">{moment.author}</div>
                          <p class="moment-text">{moment.body}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Loading>
            </Errored>
          </section>
        </Show>
      </Accordion.Content>
    </Accordion.Item>
  );
}
