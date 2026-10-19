import { notConfigured, type SectionLoader } from "./section";

/**
 * PLACEHOLDER. Replace the body; keep the export name and the SectionLoader<"system"> type.
 * Contract: `SystemData` in ./types. Return ok(data), notConfigured("..."), or failed("..."); never throw.
 */
export const loadSystem: SectionLoader<"system"> = async () => notConfigured("This section is not built yet.");
