import { notConfigured, type SectionLoader } from "./section";

/**
 * PLACEHOLDER. Replace the body; keep the export name and the SectionLoader<"usage"> type.
 * Contract: `UsageData` in ./types. Return ok(data), notConfigured("..."), or failed("..."); never throw.
 */
export const loadUsage: SectionLoader<"usage"> = async () => notConfigured("This section is not built yet.");
