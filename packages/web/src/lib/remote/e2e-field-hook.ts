/**
 * True only on an E2E stack (e2e/stack/remote-ui.mjs sets NEXT_PUBLIC_E2E_FIELD_HOOK=1; production builds never do).
 * A test then installs `window.__e2eFieldWatcher` before the page loads (a stand-in for the camera reader, which needs
 * model assets) and feeds events through `window.__e2eField.handle`.
 */
export const e2eFieldHook = process.env.NEXT_PUBLIC_E2E_FIELD_HOOK === '1';
