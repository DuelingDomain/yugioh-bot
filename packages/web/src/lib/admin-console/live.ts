import { notConfigured, type SectionLoader } from "./section";

/**
 * PLACEHOLDER. Replace the body; keep the export name and the SectionLoader<"live"> type.
 * Contract: `LiveData` in ./types. Return ok(data), notConfigured("..."), or failed("..."); never throw.
 */
export const loadLive: SectionLoader<"live"> = async () => notConfigured("This section is not built yet.");
