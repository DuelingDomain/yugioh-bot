import type { Reservation } from "./budget-ledger.js";
import { MAX_OUTPUT_TOKENS, MODEL } from "./budget-ledger.js";
import { buildUserMessage, tagBatchFormat } from "./tagging-prompt.js";
import type { Card } from "@yugidraft/shared/cards/effects";

export interface BatchClient {
  create(reservation: Reservation): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ processing_status: string }>;
  results(id: string): Promise<unknown[]>;
}
/** Native fetch performs no implicit retries. In particular, creation is issued
 * exactly once after durable submission intent, even when the response is lost.
 */
export class AnthropicBatchClient implements BatchClient {
  private baseUrl: string;
  constructor(private options: { apiKey: string; baseUrl?: string; allowLoopback?: boolean; signal?: AbortSignal }) {
    const base = new URL(options.baseUrl ?? "https://api.anthropic.com");
    const production = base.href === "https://api.anthropic.com/";
    const loopback = options.allowLoopback && base.protocol === "http:" && base.hostname === "127.0.0.1" && base.pathname === "/";
    if ((!production && !loopback) || base.username || base.password || base.search || base.hash) throw new Error("Invalid Anthropic API origin");
    if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY is required for live Batch operations");
    this.baseUrl = base.origin;
  }
  private async request(path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/v1/messages/batches${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Anthropic Batch HTTP ${response.status}`); }
    return response;
  }
  private validId(id: string) {
    if (!/^msgbatch_[a-zA-Z0-9_]+$/.test(id)) throw new Error("Invalid immutable batch ID");
    return id;
  }
  async create(reservation: Reservation): Promise<{ id: string }> {
    const requests = reservation.requests.map(req => ({ custom_id: req.customId, params: {
      model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: reservation.systemPrompt,
      messages: [{ role: "user", content: buildUserMessage(req.cards as Card[]) }],
      output_config: { format: tagBatchFormat() },
    } }));
    const body = { requests };
    // Bound local memory and reject abnormally large input; the pinned model's
    // 200K context limit bounds accepted/billed input, including schema tokens.
    if (requests.some(req => Buffer.byteLength(JSON.stringify(req.params), "utf8") > 500_000)) throw new Error("Tagging request exceeds input safety bound");
    const result = await (await this.request("", body)).json() as { id?: unknown };
    if (typeof result.id !== "string") throw new Error("Missing Batch creation identity");
    return { id: this.validId(result.id) };
  }
  async retrieve(id: string): Promise<{ processing_status: string }> {
    const value = await (await this.request(`/${this.validId(id)}`)).json() as { id?: unknown; processing_status?: unknown };
    if (value.id !== id || !["in_progress", "canceling", "ended"].includes(String(value.processing_status))) throw new Error("Invalid Batch status response");
    return { processing_status: String(value.processing_status) };
  }
  async results(id: string): Promise<unknown[]> {
    const response = await this.request(`/${this.validId(id)}/results`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing Batch results body");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 16_000_000) throw new Error("Batch results exceed safety bound");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const content = Buffer.concat(chunks).toString("utf8").trim();
    return content ? content.split("\n").map(line => JSON.parse(line)) : [];
  }
}
