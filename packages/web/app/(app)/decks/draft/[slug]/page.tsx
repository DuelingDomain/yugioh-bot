import { DraftDeckEditor } from "@/components/decks/draft-deck-editor";

export default async function DraftDeckPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DraftDeckEditor key={slug} slug={slug} />;
}
