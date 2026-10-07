export type PreviewState = "idle" | "typed" | "pending" | "mismatch" | "retry" | "server" | "signed_out";
export const PREVIEW_STATES: readonly PreviewState[] = ["idle", "typed", "pending", "mismatch", "retry", "server", "signed_out"];
export const isPreviewState = (value: string | undefined): value is PreviewState => PREVIEW_STATES.includes(value as PreviewState);
