"use client";

import { useParams } from "next/navigation";
import { DuelRoomView } from "@/components/duel/room";

export default function DuelRoomPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) return null;
  return <DuelRoomView slug={slug} />;
}
