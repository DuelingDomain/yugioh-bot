import { createServer, type Server } from "node:http";
import { isDuelInviteReference, type AnnouncePayload } from "@yugidraft/shared/notify";
import { DuelInviteRefusalError } from "@yugidraft/shared/services";
import { readAnnounceRequest } from "./auth.js";

export type { AnnouncePayload };

type OmitKind<T extends { kind: string }> = Omit<T, "kind">;

export interface AnnounceHandlers {
  onDraftStatus(payload: { draftId: number }): Promise<void>;
  onDraftCreated(payload: OmitKind<Extract<AnnouncePayload, { kind: "draft-created" }>>): Promise<void>;
  onDraftStarted(payload: OmitKind<Extract<AnnouncePayload, { kind: "draft-started" }>>): Promise<void>;
  onDraftNudge(payload: OmitKind<Extract<AnnouncePayload, { kind: "draft-nudge" }>>): Promise<void>;
  onDraftCompleted(payload: OmitKind<Extract<AnnouncePayload, { kind: "draft-completed" }>>): Promise<void>;
  onTournamentCreated(payload: OmitKind<Extract<AnnouncePayload, { kind: "tournament-created" }>>): Promise<void>;
  onTournamentStarted(payload: OmitKind<Extract<AnnouncePayload, { kind: "tournament-started" }>>): Promise<void>;
  onMatchReportPending(payload: OmitKind<Extract<AnnouncePayload, { kind: "match-report-pending" }>>): Promise<void>;
  onMatchResolved(payload: OmitKind<Extract<AnnouncePayload, { kind: "match-resolved" }>>): Promise<void>;
  onTournamentCompleted(payload: OmitKind<Extract<AnnouncePayload, { kind: "tournament-completed" }>>): Promise<void>;
  onDuelInvite(payload: OmitKind<Extract<AnnouncePayload, { kind: "duel-invite" }>>): Promise<void>;
}

export function createAnnounceServer(opts: {
  secret: string;
  handlers: AnnounceHandlers;
}) {
  const routes: Record<string, (data: any) => Promise<void>> = {
    "/internal/announce/draft-status": (d) => opts.handlers.onDraftStatus(d),
    "/internal/announce/draft-created": (d) => opts.handlers.onDraftCreated(d),
    "/internal/announce/draft-started": (d) => opts.handlers.onDraftStarted(d),
    "/internal/announce/draft-nudge": (d) => opts.handlers.onDraftNudge(d),
    "/internal/announce/draft-completed": (d) => opts.handlers.onDraftCompleted(d),
    "/internal/announce/tournament-created": (d) => opts.handlers.onTournamentCreated(d),
    "/internal/announce/tournament-started": (d) => opts.handlers.onTournamentStarted(d),
    "/internal/announce/match-report-pending": (d) => opts.handlers.onMatchReportPending(d),
    "/internal/announce/match-resolved": (d) => opts.handlers.onMatchResolved(d),
    "/internal/announce/tournament-completed": (d) => opts.handlers.onTournamentCompleted(d),
    "/internal/announce/duel-invite": (d) => opts.handlers.onDuelInvite(d),
  };

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || !routes[url.pathname]) {
      return new Response("Not found", { status: 404 });
    }
    const result = await readAnnounceRequest(req, opts.secret);
    if (!result.ok) return new Response(result.status === 401 ? "Unauthorized" : result.status === 413 ? "Request too large" : "Bad JSON", { status: result.status });
    const parsed = result.body;
    if (url.pathname === "/internal/announce/duel-invite" && !isDuelInviteReference(parsed)) {
      return new Response("Bad duel reference", { status: 400 });
    }
    try {
      await routes[url.pathname](parsed);
      return new Response(null, { status: 204 });
    } catch (err) {
      if (err instanceof DuelInviteRefusalError) {
        console.warn(`[announce] refused invite for ${url.pathname}:`, err.message);
        return Response.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error(`[announce] handler failed for ${url.pathname}:`, err);
      return new Response("Handler error", { status: 500 });
    }
  }

  function listen(port: number): Server {
    const server = createServer(async (nodeReq, nodeRes) => {
      try {
        const maxBytes = 65536;
        const url = `http://${nodeReq.headers.host ?? "localhost"}${nodeReq.url ?? "/"}`;
        const rejectSize = () => {
          console.warn("internal request rejected", { purpose: "bot-announce", path: new URL(url).pathname, reason: "body too large" });
          nodeReq.pause();
          nodeRes.writeHead(413, { connection: "close" });
          nodeRes.end("Request too large");
        };
        if (Number(nodeReq.headers["content-length"]) > maxBytes) { rejectSize(); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of nodeReq.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > maxBytes) { rejectSize(); return; }
          chunks.push(chunk as Buffer);
        }
        const buf = Buffer.concat(chunks, size);
        const res = await handle(new Request(url, {
          method: nodeReq.method,
          headers: nodeReq.headers as any,
          body: buf.length ? buf : undefined,
        }));
        nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
        nodeRes.end(await res.text());
      } catch (error) {
        console.error("Internal request handler failed", error);
        if (!nodeRes.headersSent) nodeRes.writeHead(500);
        nodeRes.end("Something went wrong");
      }
    });
    server.listen(port, () => console.log(`[announce] listening on :${port}`));
    return server;
  }

  return { handle, listen };
}
