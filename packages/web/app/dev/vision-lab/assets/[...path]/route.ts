// Reuse the same gated, traversal-safe file handler. The nested URL also receives
// the lab's COEP header: dedicated workers and their WASM thread workers need it.
export { GET, HEAD } from "../../../vision-assets/[...path]/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
