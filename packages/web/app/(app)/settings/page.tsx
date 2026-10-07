import { redirect } from "next/navigation";

/** The guild settings page is gone. Old links land on the account page. */
export default function SettingsPage() {
  redirect("/settings/account");
}
