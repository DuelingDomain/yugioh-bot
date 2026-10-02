import Image from "next/image";
import { AlertTriangle, Info } from "lucide-react";
import { SheetRoot, SummonCircle } from "@/components/sheet";
import { signInWithDiscord } from "./actions";
import { describeLoginError } from "./login-errors";
import { LoginButton } from "./login-button";
import { BrandMark } from "./login-marks";

const FAN = [
  { id: 46986418, alt: "Dark Magician" },
  { id: 89631146, alt: "Blue-Eyes White Dragon" },
  { id: 72989439, alt: "Blue-Eyes Ultimate Dragon" },
];

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = describeLoginError(params.error);

  return (
    <SheetRoot>
      <main className="si" style={{ minHeight: "100dvh" }}>
        <div className="si-box">
          <span className="si-fan" aria-hidden="true">
            <SummonCircle className="si-smn" />
            {FAN.map((card) => (
              <Image
                key={card.id}
                src={`https://images.ygoprodeck.com/images/cards_small/${card.id}.jpg`}
                alt=""
                width={86}
                height={126}
              />
            ))}
          </span>
          <h1 className="si-brand sheet-head">
            <BrandMark />
            YugiDraft
          </h1>
          <p className="si-sub">
            Drafts, tournaments and duels for your Discord server. Sign in with the account you use there.
          </p>
          {message && (
            <div
              className={`banner si-msg${message.tone === "bad" ? " banner-bad" : ""}`}
              role={message.tone === "bad" ? "alert" : "status"}
            >
              {message.tone === "bad" ? (
                <AlertTriangle className="ic" aria-hidden="true" />
              ) : (
                <Info className="ic" aria-hidden="true" />
              )}
              <div>
                <b style={{ color: "var(--ink)", fontWeight: 450 }}>{message.title}</b> {message.body}
                {message.code && <span className="code">Error: {message.code}</span>}
              </div>
            </div>
          )}
          <form className="si-form" action={signInWithDiscord}>
            <LoginButton />
          </form>
          <p className="si-fine">
            Discord shares your name, avatar and email. YugiDraft can&apos;t read or send messages as you.
          </p>
        </div>
      </main>
    </SheetRoot>
  );
}
