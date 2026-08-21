import type { Context } from "telegraf";
import { streamTextAsDraft } from "../telegram/draftStream.js";
import { createNativeDraftTransport } from "../telegram/nativeDraftTransport.js";

const MOCK_RESPONSE = `Коротко: KoteNya розповіла, що в березні почала працювати програмістом і досі отримує задоволення від розв’язання задач, порівнюючи це ремесло зі створенням практичних речей. Вона підкреслює переваги віддаленої роботи — свободу планування, можливість займатися домашніми справами та економію часу на дорогу, а також зазначає, що програмування дозволяє їй поєднувати роботу з ілюстрацією та підтримувати хороший work-life balance. Окрім цього, KoteNya поділилася, що писала текст сама, а AI допоміг лише з пунктуацією та форматуванням. На противагу, Aliv R висловила незадоволення програмуванням, бо не відчуває його корисності, часто «тідтує» і потребує «очищення» мозку після роботи, проте вважає це своїм «харчуванням» і не уявляє іншу професію.`;

export async function runStreamTest(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  if (!chat || chat.type !== "private") {
    await ctx.reply(
      "Тест live draft поки доступний лише в особистому чаті з ботом.",
    );
    return;
  }

  await streamTextAsDraft(
    mockTextDeltas(MOCK_RESPONSE),
    createNativeDraftTransport(ctx),
  );
}

async function* mockTextDeltas(text: string): AsyncIterable<string> {
  const chunkSize = 18;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    yield text.slice(offset, offset + chunkSize);
    await delay(90);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
