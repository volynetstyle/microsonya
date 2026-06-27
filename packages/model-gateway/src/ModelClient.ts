export type ModelResponseFormat = "text" | "json";

export type ModelClient = {
  complete(
    prompt: string,
    responseFormat?: ModelResponseFormat,
  ): Promise<string>;
  getFreeModelSwitchSnapshot?(): unknown[];
};
