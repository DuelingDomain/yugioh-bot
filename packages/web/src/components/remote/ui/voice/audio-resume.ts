/**
 * Chrome can leave an AudioContext suspended (autoplay policy), and then the worklet gets no frames. Resume it; if it stays
 * suspended (the resume promise can stay pending), resume on the next click or key press anywhere on the page.
 * Resolves once the first try is over; `context.state` tells whether it runs.
 */
export async function resumeAudioContext(context: AudioContext): Promise<boolean> {
  const wake = () => { if (context.state === "suspended") void context.resume().catch(() => undefined); };
  await Promise.race([context.resume().catch(() => undefined), new Promise(done => setTimeout(done, 1000))]);
  if (context.state === "running") return true;
  const events = ["pointerdown", "keydown"] as const;
  const onGesture = () => { wake(); if (context.state !== "suspended") events.forEach(name => window.removeEventListener(name, onGesture, true)); };
  events.forEach(name => window.addEventListener(name, onGesture, true));
  context.addEventListener("statechange", () => { if (context.state !== "suspended") events.forEach(name => window.removeEventListener(name, onGesture, true)); });
  return false;
}
