import type { RecognizeRawFeed } from './video';
/**
 * True only on an E2E stack (e2e/stack/remote-ui.mjs sets NEXT_PUBLIC_E2E_FIELD_HOOK=1; production builds never do).
 * A test then installs `window.__e2eFieldWatcher` before the page loads (a stand-in for the camera reader, which needs
 * model assets) and feeds events through `window.__e2eField.handle`.
 */
export const e2eFieldHook = process.env.NEXT_PUBLIC_E2E_FIELD_HOOK === '1';
/** E2E stacks only: a test installs `window.__e2eRecognize` before the page loads, as a stand-in for the card reader of the feed owner. */
export const e2eRecognize = (): RecognizeRawFeed | undefined => e2eFieldHook && typeof window !== 'undefined' ? (window as unknown as { __e2eRecognize?: RecognizeRawFeed }).__e2eRecognize : undefined;
