/** Test-only stand-ins for next/navigation in the Suggestions harness: the editor never leaves the page. */
export function useRouter() {
  const none = () => undefined;
  return { push: none, replace: none, back: none, forward: none, refresh: none, prefetch: none };
}
export function usePathname(): string {
  return window.location.pathname;
}
export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
export function useParams() {
  return {};
}
export function redirect(): never {
  throw new Error("redirect is not used in the harness");
}
export function notFound(): never {
  throw new Error("notFound is not used in the harness");
}
