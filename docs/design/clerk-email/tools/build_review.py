"""Build the local review page from clerk_preview.py output.
Usage: python3 build_review.py <out_dir>   -> <out_dir>/review.html
"""
import json, html, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.dirname(HERE)
OUT = sys.argv[1]
SAMPLE = "https://accounts.duelingdomain.com/sign-up?__clerk_ticket=sample"
INFO = {
 "waitlist_confirmation": ("Waitlist confirmation", "Sent right after someone joins the waitlist. No button."),
 "waitlist_invitation": ("Waitlist invitation", "Sent when you approve a waitlist entry in the Clerk dashboard."),
 "invitation": ("Invitation", "Sent when you invite someone directly. Same layout as the waitlist invitation, different footer line."),
 "verification_code": ("Verification code", "Sent to verify an email address during sign-up or sign-in."),
 "reset_password_code": ("Reset password code", "Sent when someone starts a password reset."),
 "password_changed": ("Password changed", "Security notice after a password change."),
 "primary_email_address_changed": ("Primary email address changed", "Security notice after the account email changes."),
 "new_device_sign_in": ("Sign in from new device", "Security notice when a new device signs in. The sign-out button only shows when Clerk provides a revoke link."),
 "account_locked": ("Account locked", "Security notice after too many failed sign-in attempts (lockout is on: 10 attempts, 60 minutes)."),
}
ORDER = list(json.load(open(f"{SRC}/subjects.json")).keys())
INVERT = "<style>html{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}</style>"

def load(v, slug, invert):
    s = open(f"{OUT}/{v}/{slug}.html").read()
    s = s.replace('href="#"', f'href="{SAMPLE}"')
    if invert: s = s.replace("</head>", INVERT + "</head>", 1)
    return s
def subj(v, slug): return json.load(open(f"{OUT}/{v}/{slug}.json"))["subject"]

def fig(v, slug, w, mode, label):
    inv = mode in ("inv", "worst")
    stage = "dark" if mode in ("dark", "inv", "worst") else "light"
    doc = load(v, slug, inv)
    return f'''<figure class="fig w{w}"><figcaption>{html.escape(label)}</figcaption>
<div class="stage {stage}" style="width:{w}px"><div class="subj"><span>Subject</span>{html.escape(subj(v, slug))}</div>
<iframe title="{html.escape(label)} {slug}" data-w="{w}" style="width:{w}px" scrolling="no" sandbox="allow-same-origin" srcdoc="{html.escape(doc, quote=True)}"></iframe></div></figure>'''

secs = []
for s in ORDER:
    name, when = INFO[s]
    sb, sa = subj("before", s), subj("after", s)
    changed = "" if sb == sa else f' <span class="was">was: {html.escape(sb)}</span>'
    secs.append(f'''<section id="{s}">
<header class="sh"><p class="slug">{s}</p><h2>{name}</h2>
<dl><dt>Subject</dt><dd><b>{html.escape(sa)}</b>{changed}</dd><dt>When</dt><dd>{when}</dd></dl></header>
<h3>600px, light client</h3>
<div class="row">{fig("before", s, 600, "light", "Current")}{fig("after", s, 600, "light", "New")}</div>
<h3>600px, dark client <small>Current is inverted by the client. New is dark already, so clients leave it alone.</small></h3>
<div class="row">{fig("before", s, 600, "inv", "Current, inverted")}{fig("after", s, 600, "dark", "New, as sent")}</div>
<h3>390px, phone</h3>
<div class="row">{fig("before", s, 390, "light", "Current, light")}{fig("after", s, 390, "light", "New, light")}{fig("before", s, 390, "inv", "Current, dark")}{fig("after", s, 390, "dark", "New, dark")}</div>
</section>''')
worst = "".join(fig("after", s, 390, "worst", INFO[s][0]) for s in ORDER)
nav = "".join(f'<a href="#{s}">{INFO[s][0]}</a>' for s in ORDER)
page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dueling Domain Clerk emails</title>
<style>
:root{{--bg:#0A0E1A;--surface:#141929;--border:#2A3150;--text:#E8ECF4;--text2:#AEB7D0;--text3:#8892B0;--gold:#F3DDA0;--purple:#A78BFA}}
*{{box-sizing:border-box}}
html{{-webkit-text-size-adjust:100%}}
body{{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;overflow-x:hidden}}
main{{max-width:1760px;margin:0 auto;padding:32px 16px 72px}}
h1{{font-size:30px;line-height:1.2;margin:0 0 8px}}
h2{{font-size:24px;line-height:1.2;margin:0 0 10px}}
h3{{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:30px 0 12px}}
h3 small{{text-transform:none;letter-spacing:0;font-size:13px;color:var(--text3);font-weight:400;margin-left:8px}}
.lede{{color:var(--text2);max-width:76ch;margin:0 0 18px}}
.notes{{margin:0 0 18px;padding:14px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text2);font-size:14px;max-width:100ch}}
.notes ul{{margin:6px 0 0;padding-left:20px}}
nav{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}}
nav a{{padding:6px 12px;border:1px solid var(--border);border-radius:999px;color:var(--text);text-decoration:none;font-size:14px;background:var(--surface)}}
nav a:hover{{border-color:var(--gold)}}
section{{margin-top:56px;padding-top:28px;border-top:1px solid var(--border)}}
.slug{{margin:0 0 4px;font:13px ui-monospace,Menlo,Consolas,monospace;color:var(--text3)}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0;font-size:15px;color:var(--text2)}}
dt{{color:var(--text3)}} dd{{margin:0}} dd b{{color:var(--text)}}
.was{{display:block;color:var(--text3);font-size:13px}}
.row{{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}}
.fig{{margin:0}}
figcaption{{font-size:13px;color:var(--text3);margin:0 0 6px}}
.stage{{border:1px solid var(--border);border-radius:10px;overflow:hidden}}
.stage.light{{background:#fff}} .stage.dark{{background:#202124}}
.subj{{font-size:13px;padding:8px 12px;border-bottom:1px solid rgba(128,128,128,.28);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.stage.light .subj{{color:#202124}} .stage.dark .subj{{color:#e8eaed}}
.subj span{{color:#80868b;margin-right:8px}}
iframe{{display:block;border:0;max-width:none}}
.worst{{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}}
@media (max-width:760px){{
  main{{padding:20px 16px 56px}}
  .fig.w600{{zoom:.58}}
  .row,.worst{{gap:16px}}
  h1{{font-size:26px}}
}}
@media (max-width:480px){{ .fig.w390{{zoom:.9}} }}
</style></head><body><main>
<h1>Dueling Domain emails, branded</h1>
<p class="lede">Nine Clerk emails a player can get, before and after. "Current" is what is stored on the instance now (the earlier wording-only version for the three waitlist and invite emails, Clerk's stock design for the rest). "New" is the branded set. Every frame is the HTML Clerk's own preview endpoint returned.</p>
<div class="notes">What changed in the system
<ul>
<li>Dark card on the app's navy (#0A0E1A / #141929), gold eyebrow label, Russo One headings that fall back to Arial Black, then a bold system sans. Purple is only on the button and the small fallback link.</li>
<li>Logo at the top is the live https://duelingdomain.com/logo-512.png at 44px next to a live-text wordmark, so it still reads with images blocked.</li>
<li>The raw ticket URL is gone. Under the button there is one short line, "Button not working? Open your invite", pointing at the same link.</li>
<li>Code emails show the code large in gold in its own panel. The security emails put the one thing to do in a gold-barred callout.</li>
<li>Footer on every email says why the player got it and gives support@duelingdomain.com.</li>
<li>Dark and light clients: every layer has an explicit background colour, so there is nothing for a client to flip. The dark-client frames below simulate a client that inverts light emails (Current) and leaves dark ones alone (New). The last section is the worst case, a client that inverts everything.</li>
</ul></div>
<nav aria-label="Templates">{nav}<a href="#worst">Forced inversion</a></nav>
{"".join(secs)}
<section id="worst"><header class="sh"><h2>Worst case: forced inversion</h2><p class="lede">If a client inverted the new emails too (images left alone), text would flip to dark on light. Gold turns brown and the purple button turns lighter, which still reads. Real clients do not do this to a dark design.</p></header>
<div class="worst">{worst}</div></section>
</main>
<script>
function fit(f){{try{{var d=f.contentDocument;var h=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight);f.style.height=h+"px"}}catch(e){{}}}}
document.querySelectorAll("iframe").forEach(function(f){{f.addEventListener("load",function(){{fit(f);setTimeout(function(){{fit(f)}},300)}});if(f.contentDocument&&f.contentDocument.readyState==="complete")fit(f)}});
</script></body></html>'''
open(f"{OUT}/review.html", "w").write(page)
print("review.html", len(page))
