import { notConfigured, type SectionLoader } from "./section";

/**
 * PLACEHOLDER. Replace the body; keep the export name and the SectionLoader<"waitlist"> type.
 * Contract: `WaitlistData` in ./types. Return ok(data), notConfigured("..."), or failed("..."); never throw.
 */
export const loadWaitlist: SectionLoader<"waitlist"> = async () => notConfigured("This section is not built yet.");
