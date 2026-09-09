export interface ProgressiveTransport {
  begin(): Promise<void>;
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  fail(): Promise<void>;
}
