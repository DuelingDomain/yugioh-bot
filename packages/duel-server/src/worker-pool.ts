import { RequestError } from "./request-error.js";

const BUSY = "The duel server is busy. Try again in a minute.";

export type WorkerReservation = (() => void) & { releasePlayers(): void; setTableId(tableId: number): void };

export class WorkerPool {
  private readonly active = new Set<{ players: readonly number[]; tableId?: number }>();
  private readonly waiting: Array<{ resolve: (release: WorkerReservation) => void; reject: (error: Error) => void }> = [];
  private stopped = false;

  constructor(private readonly maxWorkers: number, private readonly maxTablesPerPlayer: number) {}

  async acquire(players: readonly number[], wait = false, signal?: AbortSignal, tableId?: number): Promise<WorkerReservation> {
    signal?.throwIfAborted();
    if (this.stopped) throw new RequestError("The duel server is shutting down.", 503);
    const seats = [...new Set(players)];
    for (const player of seats) {
      const tables = new Set([...this.active].filter(other => other.players.includes(player)).map(other => other.tableId ?? other));
      if ((tableId === undefined || !tables.has(tableId)) && tables.size >= this.maxTablesPerPlayer) {
        throw new RequestError(`You already have ${this.maxTablesPerPlayer} live duels. Finish one first.`, 429);
      }
    }
    if (this.active.size < this.maxWorkers && this.waiting.length === 0) return this.reserve(seats, tableId);
    if (!wait || this.waiting.length >= 32) throw new RequestError(BUSY, 429);
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const waiter = {
        resolve: (release: WorkerReservation) => { cleanup(); resolve(release); },
        reject: (error: Error) => { cleanup(); reject(error); },
      };
      const abort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        cleanup();
        reject(signal!.reason);
      };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private reserve(players: readonly number[], tableId?: number): WorkerReservation {
    const entry = { players, tableId };
    this.active.add(entry);
    const release = () => {
      if (!this.active.delete(entry)) return;
      while (!this.stopped && this.active.size < this.maxWorkers && this.waiting.length > 0) {
        this.waiting.shift()!.resolve(this.reserve([]));
      }
    };
    return Object.assign(release, {
      releasePlayers: () => { entry.players = []; },
      setTableId: (tableId: number) => { entry.tableId = tableId; },
    });
  }

  close(): void {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) waiter.reject(new RequestError("The duel server is shutting down.", 503));
  }
}
