import { useEffect, useState } from "react";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const MIN_LENGTH = 8;
const DEBOUNCE_MS = 400;
const TIMEOUT_MS = 3000;

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Asks Have I Been Pwned (k-anonymity range API) whether a password appears in a known breach. The password is hashed
 * in the browser and only the first five hex characters of the SHA-1 leave it; the suffix is compared here.
 * Returns false on any failure (network, timeout, bad status, no crypto): the check is a hint, never a gate.
 */
export async function isPasswordBreached(password: string, signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const hash = await sha1Hex(password);
    const response = await fetch(`${RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    // Each line is `SUFFIX:COUNT`; padded decoy lines have a count of 0 and are not real matches.
    return (await response.text()).split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** True once the typed password (>= 8 characters, idle for 400 ms) is found in a breach. Resets as soon as it changes. */
export function useBreachedPassword(password: string, enabled = true): boolean {
  const [hit, setHit] = useState<{ password: string } | null>(null);
  useEffect(() => {
    if (!enabled || password.length < MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void isPasswordBreached(password, controller.signal).then((breached) => {
        if (!controller.signal.aborted && breached) setHit({ password });
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [password, enabled]);
  return enabled && hit?.password === password;
}
