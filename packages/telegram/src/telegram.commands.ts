export interface TelegramBotCommand {
  readonly command: string;
  readonly description: string;
  readonly is_ephemeral?: boolean;
}

export type TelegramBotCommandScope =
  | { readonly type: "default" }
  | { readonly type: "all_private_chats" }
  | { readonly type: "all_group_chats" }
  | { readonly type: "all_chat_administrators" }
  | {
      readonly type: "chat";
      readonly chat_id: string | number;
    }
  | {
      readonly type: "chat_administrators";
      readonly chat_id: string | number;
    }
  | {
      readonly type: "chat_member";
      readonly chat_id: string | number;
      readonly user_id: number;
    };

export interface TelegramCommandSet {
  readonly scope: TelegramBotCommandScope;
  readonly language_code?: string;
  readonly commands: readonly TelegramBotCommand[];
}

export const APP_COMMAND = {
  command: "app",
  description: "Відкрити Microsonya",
  is_ephemeral: true,
} as const satisfies TelegramBotCommand;

export const SUMMARY_COMMAND = {
  command: "summary",
  description: "Створити підсумок",
} as const satisfies TelegramBotCommand;

export const TELEGRAM_COMMAND_SETS = [
  {
    scope: { type: "all_private_chats" },
    commands: [
      {
        command: APP_COMMAND.command,
        description: APP_COMMAND.description,
      },
      SUMMARY_COMMAND,
    ],
  },
  {
    scope: { type: "all_group_chats" },
    commands: [APP_COMMAND, SUMMARY_COMMAND],
  },
] as const satisfies readonly TelegramCommandSet[];

export const APP_COMMAND_NAME = APP_COMMAND.command;
export const SUMMARY_COMMAND_NAME = SUMMARY_COMMAND.command;
