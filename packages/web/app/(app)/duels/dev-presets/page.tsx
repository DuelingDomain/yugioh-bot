import { notFound } from "next/navigation";
import { scenariosEnabled } from "@/lib/duel-host";
import { DevPresets } from "./dev-presets";

export const dynamic = "force-dynamic";

export default function DevPresetsPage() {
  if (!scenariosEnabled()) notFound();
  return <DevPresets />;
}
