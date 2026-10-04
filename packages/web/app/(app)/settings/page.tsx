import { SheetRoot } from "@/components/sheet";
import { AnnouncementToggles } from "@/components/settings/announcement-toggles";
import { DuelViewToggle } from "@/components/settings/duel-view-toggle";
import { SeasonControl } from "@/components/settings/season-control";

export default function SettingsPage() {
  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Settings</h1>
          <p className="page-sub">Server controls first, then options for this device</p>
        </div>
      </header>
      <div className="set-page">
        <SeasonControl />
        <AnnouncementToggles />
        <DuelViewToggle />
      </div>
    </SheetRoot>
  );
}
