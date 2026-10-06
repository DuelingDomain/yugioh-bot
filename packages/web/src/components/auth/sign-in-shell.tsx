import type { CSSProperties, ReactNode } from "react";
import { signInFontClasses } from "./fonts";
import { PackTilt } from "./pack-tilt";
import { SignInSymbols } from "./sign-in-symbols";
import styles from "./sign-in-shell.module.css";

interface SignInShellProps {
  children: ReactNode;
  marketingUrl?: string;
  packState?: "sealed" | "open";
  tone?: "neutral" | "bad";
}

export function SignInShell({ children, marketingUrl, packState = "sealed", tone = "neutral" }: SignInShellProps) {
  return (
    <div className={`${signInFontClasses} ${styles["a-page"]}`} data-pack-state={packState} data-tone={tone}>
      <SignInSymbols />
      <a className={styles.skip} href="#form-zone">Skip to the sign-in form</a>
      <div className={styles["a-bg"]} aria-hidden="true">
        <div className={styles["rings"]}>
          <svg viewBox="0 0 1000 1000" fill="none" stroke="currentColor">
            <g className={styles["r1"]} style={{ transformOrigin: "500px 500px" }}>
              <circle cx="500" cy="500" r="470" strokeOpacity=".16" />
              <circle cx="500" cy="500" r="470" strokeOpacity=".5" strokeWidth="5" strokeDasharray="1 29.5" />
            </g>
          </svg>
          <svg viewBox="0 0 1000 1000" fill="none" stroke="currentColor">
            <g className={styles["r2"]} style={{ transformOrigin: "500px 500px" }}>
              <circle cx="500" cy="500" r="385" strokeOpacity=".2" />
              <circle cx="500" cy="500" r="385" strokeOpacity=".28" strokeWidth="12" strokeDasharray="2 60" />
            </g>
          </svg>
          <svg viewBox="0 0 1000 1000" fill="none" stroke="currentColor">
            <g className={styles["r3"]} style={{ transformOrigin: "500px 500px" }}>
              <circle cx="500" cy="500" r="300" strokeOpacity=".22" />
              <path d="M500 190v28M500 782v28M190 500h28M782 500h28" strokeOpacity=".5" strokeWidth="2" />
            </g>
          </svg>
        </div>
        <div className={`${styles["ghost"]} ${styles["g1"]}`}>
          <div className={styles["ghost-in"]} />
        </div>
        <div className={`${styles["ghost"]} ${styles["g2"]}`}>
          <div className={styles["ghost-in"]} />
        </div>
        <div className={`${styles["ghost"]} ${styles["g3"]}`}>
          <div className={styles["ghost-in"]} />
        </div>
        <div className={styles["dust"]}>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{
              left: `${8 + (i * 61) % 86}%`,
              top: `${30 + (i * 37) % 60}%`,
              "--d": `${7 + (i % 5) * 1.6}s`,
              "--dl": `${-(i * 1.3)}s`,
            } as CSSProperties} />
          ))}
        </div>
      </div>

      <header className={styles["nav"]}>
        <div className={`${styles["wrap"]} ${styles["nav-in"]}`}>
          {marketingUrl ? (
            <a className={styles["brand"]} href={marketingUrl} aria-label="Dueling Domain, home">
              <svg className={styles["lockup"]} aria-hidden="true" focusable="false">
                <use href="#dd-lockup" />
              </svg>
            </a>
          ) : (
            <span className={styles["brand"]} role="img" aria-label="Dueling Domain">
              <svg className={styles["lockup"]} aria-hidden="true" focusable="false">
                <use href="#dd-lockup" />
              </svg>
            </span>
          )}
          <div className={styles["nav-r"]}>
            <span className={styles["chip"]}>
              <i />Closed alpha
            </span>
            {marketingUrl && <a className={styles["back"]} href={marketingUrl}>Back to site</a>}
          </div>
        </div>
      </header>

      <main className={`${styles["wrap"]} ${styles["a-grid"]}`}>
        <div className={styles["a-form"]} id="form-zone" tabIndex={-1}>{children}</div>

        <div className={styles["a-stage"]} aria-hidden="true">
          <div className={styles["pack-stage3d"]}>
            <div className={styles["pack-enter"]}>
              <div className={styles["pack-bob"]}>
                <PackTilt>
                  <div className={`${styles.pack} ${packState === "open" ? `${styles["is-open"]} ${styles["mark-play"]}` : ""}`}>
                    <div className={styles["pk-peek"]}>
                      <img src="/sign-in/card-back-main-hd.webp" alt="" width="200" height="292" />
                      <img src="/sign-in/card-back-extra-hd.webp" alt="" width="200" height="292" />
                      <img src="/sign-in/card-back-main-hd.webp" alt="" width="200" height="292" />
                    </div>
                    <div className={styles["pk-rays"]} />
                    <div className={styles["pk-lip"]} />
                    <div className={styles["pk-body"]}>
                      <div className={styles["pk-foil"]} />
                      <div className={styles["pk-holo"]}>
                        <div className={styles["holo-x"]}>
                          <div className={styles["holo"]} />
                        </div>
                      </div>
                      <div className={styles["pk-light"]} />
                      <div className={styles["pk-face"]}>
                        <div className={styles["pk-name"]}>
                          <span className={styles["a"]}>Dueling</span>
                          <span className={styles["b"]}>Domain</span>
                        </div>
                        <svg className={styles["pk-glyph"]} viewBox="6 6 84 84" focusable="false">
                          <g className="mk-body">
                            <path fillRule="evenodd" d="M18 12H56L78 34V62L56 84H18Z M33 26H55A3 3 0 0 1 58 29V67A3 3 0 0 1 55 70H33A3 3 0 0 1 30 67V29A3 3 0 0 1 33 26Z" />
                          </g>
                          <g className={styles["mk-card"]}>
                            <rect x="30" y="26" width="28" height="44" rx="3" />
                          </g>
                          <g className={styles["mk-gem"]}>
                            <path d="M44 41L51 48L44 55L37 48Z" />
                          </g>
                          <g clipPath="url(#dd-clip)">
                            <g transform="rotate(20 48 48)">
                              <rect className={styles["mk-glint"]} x="-40" y="-10" width="18" height="120" fill="url(#dd-glint)" />
                            </g>
                          </g>
                        </svg>
                      </div>
                      <div className={styles["pk-ribbon"]}>Alpha edition</div>
                      <div className={styles["pk-tag"]}>Draft · Duel · Domain</div>
                      <div className={`${styles["pk-crimp"]} ${styles["b"]}`} />
                      <div className={styles["pk-edge"]} />
                    </div>
                    <div className={styles["pk-burst"]} />
                    <div className={styles["pk-top"]}>
                      <div className={styles["pk-foil"]} />
                      <div className={styles["pk-holo"]}>
                        <div className={styles["holo-x"]}>
                          <div className={styles["holo"]} />
                        </div>
                      </div>
                      <div className={`${styles["pk-crimp"]} ${styles["t"]}`} />
                      <div className={styles["pk-band"]}>
                        <i />Closed alpha<i />
                      </div>
                      <div className={styles["pk-edge"]} />
                    </div>
                  </div>
                </PackTilt>
              </div>
            </div>
          </div>
          <div className={styles["pack-hint"]}>
            <i>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
                <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
              </svg>
            </i>
            <span className={styles["t1"]}>Sealed until you sign in</span>
            <span className={styles["t2"]}>Pack’s open</span>
          </div>
        </div>
      </main>
    </div>
  );
}
