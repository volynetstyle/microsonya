export type CommandLane = "hot" | "cold";

export interface CommandInvocation {
  chatId: string;
  messageId: number;
  userId?: string;
  date: number;

  name: string;
  args: readonly string[];

  rawText: string;

  threadId?: number;
  ephemeralMessageId?: number;
}

export interface CommandContext {
  invocation: CommandInvocation;

  telegram: TelegramGateway;
  services: AppServices;
}

export interface CommandDefinition<TArgs = unknown> {
  name: string;

  lane: CommandLane;

  telegram: {
    description: string;
    ephemeral?: boolean;
    visibility?: "default" | "private" | "groups" | "admins";
  };

  parse(args: readonly string[]): TArgs | undefined;

  execute(ctx: CommandContext, args: TArgs): Promise<void> | void;
}
