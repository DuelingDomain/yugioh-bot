import type { FeatureModule } from "../../runtime/types.js";
import { announcementHandlers } from "./announce.js";
import { cardHandler } from "./card.js";
import { startWelcome, welcomePreview } from "./welcome.js";
import { online, stats } from "./reports.js";
import { startStatusPublisher } from "./status.js";

const announcements = announcementHandlers(), cards = cardHandler();
export const community: FeatureModule = {
  commands: [announcements.command, cards.command, online, stats, welcomePreview],
  buttons: [announcements.button], modals: [announcements.modal],
  start(context) {
    const stopWelcome = startWelcome(context);
    const stopStatus = startStatusPublisher(context);
    return async () => { announcements.stop(); cards.stop(); await Promise.all([stopWelcome?.(), stopStatus?.()]); };
  },
};
