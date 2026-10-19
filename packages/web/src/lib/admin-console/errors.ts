import { notConfigured, type SectionLoader } from "./section";

/**
 * PLACEHOLDER. Replace the body; keep the export name and the SectionLoader<"errors"> type.
 * Contract: `ErrorsData` in ./types. Return ok(data), notConfigured("..."), or failed("..."); never throw.
 */
export const loadErrors: SectionLoader<"errors"> = async () => notConfigured("This section is not built yet.");
