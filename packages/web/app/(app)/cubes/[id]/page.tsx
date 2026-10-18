import { Suspense } from "react";
import { CubeEditor } from "@/components/cubes/cube-editor";
import { PageFrameFallback } from "@/components/decks/page-frame";
import { effectSearchEnabled } from "@yugidraft/shared/cards/effects/capability";
import { themeDraftsEnabled } from "@/lib/theme-drafts";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { cubeOwnerAccess } from "@/lib/cube-access";

// The theme draft and effect search flags are read per request on the server; the editor only receives them.
export const dynamic = "force-dynamic";

export default async function CubeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cubeId = Number(id);
  const session = await auth();
  if (!session?.user?.id || !Number.isSafeInteger(cubeId) || cubeId <= 0
    || cubeOwnerAccess(getDb(), cubeId, { userId: session.user.id })) notFound();

  return (
    <Suspense
      fallback={
        <PageFrameFallback title="Cube" label="Loading cube..." />
      }
    >
      <CubeEditor cubeId={cubeId} themeDraftsEnabled={themeDraftsEnabled()} effectSearchEnabled={effectSearchEnabled()} />
    </Suspense>
  );
}
