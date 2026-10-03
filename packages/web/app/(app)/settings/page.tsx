import { SheetRoot } from "@/components/sheet";
import { AnnouncementToggles } from "@/components/settings/announcement-toggles";
import { SeasonControl } from "@/components/settings/season-control";

export default function SettingsPage() {
  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Settings</h1>
          <p className="page-sub">For the whole server</p>
        </div>
      </header>
      <div className="set-page">
        <SeasonControl />
        <AnnouncementToggles />
      </div>
    </SheetRoot>
  );
}
