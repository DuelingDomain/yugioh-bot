import { moderation } from "./moderation/index.js";
import { server } from "./server/index.js";
import { waitlist } from "./waitlist/index.js";
import { community } from "./community/index.js";
/** Both gateway dispatch and guild command deployment consume this list. */
export const features = [moderation, server, waitlist, community];
