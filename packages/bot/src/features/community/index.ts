import type { FeatureModule } from "../../runtime/types.js";
import { announcementHandlers } from "./announce.js";
import { cardHandler } from "./card.js";
import { online, stats } from "./reports.js";

const announcements = announcementHandlers(), cards = cardHandler();
export const community: FeatureModule = {
  commands: [announcements.command, cards.command, online, stats],
  buttons: [announcements.button], modals: [announcements.modal],
  start() { return () => { announcements.stop(); cards.stop(); }; },
};
