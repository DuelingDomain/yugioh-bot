export interface YdkCard {
  id: number;
  frameType: string;
  name?: string;
  type?: string;
  forced?: boolean;
}

const EXTRA_DECK_FRAME_TYPES = new Set([
  "fusion",
  "synchro",
  "xyz",
  "link",
  "fusion_pendulum",
  "synchro_pendulum",
  "xyz_pendulum",
]);

function isExtraDeckCard(frameType: string): boolean {
  return EXTRA_DECK_FRAME_TYPES.has(frameType.toLowerCase());
}

export function generateYdk(cards: YdkCard[]): string {
  const main: number[] = [];
  const extra: number[] = [];
  const identity = (card: YdkCard) => card.name !== undefined && card.type !== undefined
    ? JSON.stringify([card.name.trim().toLowerCase(), card.type]) : `id:${card.id}`;
  const copies = new Map<string, number>();
  const forced = new Map<string, number>();
  for (const card of cards) {
    if (!card.forced) continue;
    const key = identity(card);
    forced.set(key, (forced.get(key) ?? 0) + 1);
  }

  for (const card of cards) {
    const key = identity(card);
    const held = copies.get(key) ?? 0;
    if (held >= 3 + (forced.get(key) ?? 0)) continue;
    copies.set(key, held + 1);
    if (isExtraDeckCard(card.frameType)) {
      extra.push(card.id);
    } else {
      main.push(card.id);
    }
  }

  return ["#main", ...main.map(String), "#extra", ...extra.map(String), "", "!side", ""].join("\n");
}

export function downloadYdk(cards: YdkCard[], filename: string): void {
  const content = generateYdk(cards);
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
