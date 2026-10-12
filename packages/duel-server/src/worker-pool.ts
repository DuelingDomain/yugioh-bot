import { RequestError } from "./request-error.js";

const BUSY = "The duel server is busy. Try again in a minute.";

export type WorkerReservation = (() => void) & { releasePlayers(): void };

export class WorkerPool {
  private readonly active = new Set<{ players: readonly number[] }>();
  private readonly waiting: Array<{ resolve: (release: WorkerReservation) => void; reject: (error: Error) => void }> = [];
  private stopped = false;

  constructor(private readonly maxWorkers: number, private readonly maxTablesPerPlayer: number) {}

  async acquire(players: readonly number[], wait = false): Promise<WorkerReservation> {
    if (this.stopped) throw new RequestError("The duel server is shutting down.", 503);
    const seats = [...new Set(players)];
    for (const player of seats) {
      if ([...this.active].filter((other) => other.players.includes(player)).length >= this.maxTablesPerPlayer) {
        throw new RequestError(`You already have ${this.maxTablesPerPlayer} live duels. Finish one first.`, 429);
      }
    }
    if (this.active.size < this.maxWorkers && this.waiting.length === 0) return this.reserve(seats);
    if (!wait || this.waiting.length >= 32) throw new RequestError(BUSY, 429);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private reserve(players: readonly number[]): WorkerReservation {
    const entry = { players };
    this.active.add(entry);
    const release = () => {
      if (!this.active.delete(entry)) return;
      while (!this.stopped && this.active.size < this.maxWorkers && this.waiting.length > 0) {
        this.waiting.shift()!.resolve(this.reserve([]));
      }
    };
    return Object.assign(release, { releasePlayers: () => { entry.players = []; } });
  }

  close(): void {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) waiter.reject(new RequestError("The duel server is shutting down.", 503));
  }
}
