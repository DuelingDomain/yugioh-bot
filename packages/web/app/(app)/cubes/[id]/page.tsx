import { Suspense } from "react";
import { CubeEditor } from "@/components/cubes/cube-editor";
import { SheetRoot } from "@/components/sheet";

export default async function CubeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cubeId = Number.parseInt(id, 10);

  return (
    <Suspense
      fallback={
        <SheetRoot>
          <p className="hint">Loading cube...</p>
        </SheetRoot>
      }
    >
      <CubeEditor cubeId={cubeId} />
    </Suspense>
  );
}
