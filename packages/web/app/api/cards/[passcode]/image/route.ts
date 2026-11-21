import { auth } from "@/lib/auth";
import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";
import { NextResponse } from "next/server";
import { getCardImage, ImageInvalidError, ImageMissingError, type ImageVariant } from "@/lib/card-image-store";
import { CARD_BACK_SVG, CardFetchLimitError, isCardFetchError } from "@yugidraft/shared/services";

export const runtime = "nodejs";

/** Only a cache miss needs the member, to charge the upstream fetch to them. A cache hit must not pay for a session lookup. */
async function memberId(): Promise<number | undefined> {
  try {
    const session = await auth();
    return session ? Number(session.user.id) : undefined;
  } catch { return undefined; }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode: raw } = await params;
    if (!/^\d{1,10}$/.test(raw)) {
      return NextResponse.json({ error: "Invalid card passcode" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const variant = searchParams.get("variant") ?? (searchParams.get("size") === "small" ? "small" : "full");
    if (variant !== "full" && variant !== "small" && variant !== "cropped" && variant !== "thumb") {
      return NextResponse.json({ error: "Invalid image variant" }, { status: 400 });
    }

    const { image, cacheControl } = await getCardImage(Number(raw), variant as ImageVariant, { memberId });

    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": variant === "thumb" ? "image/webp" : "image/jpeg",
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    if (error instanceof CardFetchLimitError) return cardFetchErrorResponse(error)!;
    if (error instanceof ImageMissingError) {
      return NextResponse.json({ error: "Card image not found" }, { status: 404 });
    }
    if (error instanceof ImageInvalidError) {
      return NextResponse.json({ error: "Invalid card image" }, { status: 502 });
    }
    if (isCardFetchError(error)) {
      if (error.status == null || error.status === 429 || (error.status >= 500 && error.status < 600)) {
        return new Response(CARD_BACK_SVG, { headers: {
          "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=30",
        } });
      }
      return NextResponse.json({ error: "Could not load card image" }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not load card image" }, { status: 500 });
  }
}
