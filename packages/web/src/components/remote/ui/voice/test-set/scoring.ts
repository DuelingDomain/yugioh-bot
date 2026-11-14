import { intentKey, type ClipResult, type Prompt } from "./model";

const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;

export function score(prompts: Prompt[], results: ClipResult[]) {
  const labeled = results.map(result => {
    const prompt = prompts.find(p => p.id === result.promptId);
    if (!prompt) throw new Error(`Unknown prompt ${result.promptId}`);
    const actions = result.observations.filter(o => o.intent !== "none");
    const correct = prompt.expected.kind === "none" ? actions.length === 0 : actions.length === 1 && actions[0].intent === intentKey(prompt.expected);
    return { ...result, phrase: prompt.phrase, category: prompt.category, expected: intentKey(prompt.expected), actions: actions.length, correct };
  });
  const commands = labeled.filter(r => r.category === "command");
  const near = labeled.filter(r => r.category === "near-miss"); const chatter = labeled.filter(r => r.category === "chatter");
  const utterances = results.flatMap(r => r.observations); const times = utterances.map(o => o.busyMs).sort((a, b) => a - b);
  const busyMs = times.reduce((sum, n) => sum + n, 0); const audioMs = utterances.reduce((sum, o) => sum + o.audioMs, 0);
  return {
    commands: commands.length, correctCommands: commands.filter(r => r.correct).length,
    commandAccuracy: rate(commands.filter(r => r.correct).length, commands.length),
    nearMissItems: near.length, falseActivatedItems: near.filter(r => r.actions > 0).length,
    falseActivationRate: rate(near.filter(r => r.actions > 0).length, near.length), nearMissActions: near.reduce((sum, r) => sum + r.actions, 0),
    chatterMs: chatter.reduce((sum, r) => sum + r.durationMs, 0), chatterActions: chatter.reduce((sum, r) => sum + r.actions, 0),
    chatterActionsPerMinute: rate(chatter.reduce((sum, r) => sum + r.actions, 0) * 60000, chatter.reduce((sum, r) => sum + r.durationMs, 0)),
    utterances: times.length, meanProcessingMs: rate(busyMs, times.length), p95ProcessingMs: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
    workerRealTimeFactor: rate(busyMs, audioMs), corpusRealTimeFactor: rate(busyMs, results.reduce((sum, r) => sum + r.durationMs, 0)),
    perPhrase: [...new Set(commands.map(r => r.phrase))].map(phrase => {
      const items = commands.filter(r => r.phrase === phrase);
      return { phrase, correct: items.filter(r => r.correct).length, total: items.length, accuracy: rate(items.filter(r => r.correct).length, items.length),
        misses: items.filter(r => !r.correct).map(r => ({ promptId: r.promptId, expected: r.expected, heard: r.observations.map(o => o.heard), intents: r.observations.map(o => o.intent) })) };
    }), items: labeled,
  };
}
