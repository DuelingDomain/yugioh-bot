"""Build the Dueling Domain Clerk email templates.

One spec per template (below) renders two things:
  <slug>.body.html    the table-based HTML Clerk sends (canonical; this is what the PUT stores in `body`)
  <slug>.markup.html  a best-effort Revolvapp (re-*) version so the dashboard editor opens on a similar design
plus subjects.json and requests/<slug>.put.json (the exact PUT body: name, subject, markup, body).

Run:  python3 docs/design/clerk-email/tools/build.py [--logo-url URL]
"""
import json, os, sys, html as H

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
LOGO = "https://duelingdomain.com/logo-512.png"
if "--logo-url" in sys.argv:
    LOGO = sys.argv[sys.argv.index("--logo-url") + 1]
SITE = "https://duelingdomain.com"
SUPPORT = "support@duelingdomain.com"

# Brand tokens (site/public/style.css, docs/design/sign-in/shared/base.css)
PAGE = "#0A0E1A"      # --bg, identical to the logo tile so the mark sits seamlessly
CARD = "#141929"      # --surface
WELL = "#0E1224"      # --field: code panel, detail rows
RAISE = "#1B2138"     # callout fill
BORDER = "#2A3150"    # --border
DIVIDER = "#1E2440"   # --elevated
TEXT = "#E8ECF4"      # --text
BODY = "#C9D0E4"      # body copy
MUTED = "#AEB7D0"     # --text-3, secondary copy and labels
FOOT = "#8892B0"      # --text-2, footer
GOLD = "#C9A45C"      # --gold-soft, eyebrow and callout bar
GOLD_HI = "#F3DDA0"   # --gold-hi, the code
LINK = "#A78BFA"      # --purple-hi
BTN = "#6D2BDB"       # sign-in primary button base
BTN_EDGE = "#8B4DF6"

DISPLAY = "'Russo One','Arial Black','Segoe UI',Helvetica,Arial,sans-serif"
SANS = "'Chakra Petch','Segoe UI',Helvetica,Arial,sans-serif"

W = 560  # card width

# ---------- content ----------
# node kinds: eyebrow, h1, p, small, button, link, otp, rows, callout, if
def P(t): return ("p", t)
def S(t): return ("small", t)
INVITE_BODY = "You're invited to the Dueling Domain closed alpha. Create your account with this email address, or sign up with Discord."
EXPIRY = "The invite expires in {{invitation.expires_in_days}} days."
SUP_LINK = f'<a href="mailto:{SUPPORT}" style="color:{TEXT};text-decoration:underline;">{SUPPORT}</a>'
CODE_NOTES = [
    ("callout", "Don't share this code with anyone. Dueling Domain staff will never ask for it."),
    ("small", "Requested from {{requested_from}} at {{requested_at}}. If that wasn't you, you can ignore this email."),
]
WASNT_YOU = ("callout", f"Wasn't you? Email {SUP_LINK} right away and we'll help you secure your account.")

T = {}
def tpl(slug, name, subject, preheader, why, nodes, questions=True):
    T[slug] = dict(slug=slug, name=name, subject=subject, preheader=preheader, why=why, nodes=nodes)

tpl("waitlist_confirmation", "Waitlist confirmation", "You're on the Dueling Domain waitlist",
    "We'll email you an invite when your spot opens.",
    "You're getting this because this email address joined the waitlist at duelingdomain.com.",
    [("eyebrow", "Closed alpha waitlist"), ("h1", "You're on the list"),
     P("Thanks for joining the Dueling Domain closed alpha waitlist. We let new players in a few at a time, and we'll email you an invite when your spot opens.")])

def invite(slug, name, why):
    tpl(slug, name, "Your Dueling Domain invite", "Create your account to join the closed alpha.", why,
        [("eyebrow", "Closed alpha invite"), ("h1", "Your spot is ready"), P(INVITE_BODY), S(EXPIRY),
         ("button", "Create your account", "{{action_url}}"),
         ("link", "Button not working? Open your invite", "{{action_url}}")])
invite("waitlist_invitation", "Waitlist invitation", "You're getting this because you joined the waitlist at duelingdomain.com.")
invite("invitation", "Invitation", "You're getting this because the Dueling Domain team invited you.")

tpl("verification_code", "Verification code", "{{otp_code}} is your Dueling Domain verification code",
    "Your code is {{otp_code}}.",
    "You're getting this because someone tried to sign up for or sign in to Dueling Domain with this email address.",
    [("eyebrow", "Verification code"), ("h1", "Confirm your email"),
     P("Enter this code in Dueling Domain to verify your email address."), ("otp", "{{otp_code}}")] + CODE_NOTES)

tpl("reset_password_code", "Reset password code", "{{otp_code}} is your Dueling Domain password reset code",
    "Your code is {{otp_code}}.",
    "You're getting this because a password reset was requested for this email address.",
    [("eyebrow", "Password reset"), ("h1", "Reset your password"),
     P("Enter this code in Dueling Domain to choose a new password."), ("otp", "{{otp_code}}")] + CODE_NOTES)

tpl("password_changed", "Password changed", "Your Dueling Domain password was changed",
    "The password on your account was just changed.",
    "You're getting this because the password on your Dueling Domain account changed.",
    [("eyebrow", "Security notice"), ("h1", "Your password was changed"),
     P("The password for {{primary_email_address}} was just changed. If that was you, there's nothing more to do."), WASNT_YOU])

tpl("primary_email_address_changed", "Primary email address changed", "Your Dueling Domain email address was changed",
    "The email address on your account was just changed.",
    "You're getting this because the email address on a Dueling Domain account changed.",
    [("eyebrow", "Security notice"), ("h1", "Your email address was changed"),
     P("The email address on your Dueling Domain account is now {{new_email_address}}. If that was you, there's nothing more to do."), WASNT_YOU])

tpl("new_device_sign_in", "Sign in from new device", "New sign in to your Dueling Domain account",
    "A new device just signed in to your account.",
    "You're getting this because a new device signed in to your Dueling Domain account.",
    [("eyebrow", "Security notice"), ("h1", "New sign in to your account"),
     P("A new device just signed in to your Dueling Domain account. If that was you, you can ignore this email."),
     ("rows", [("Sign in type", "{{sign_in_method}}", "sign_in_method"),
               ("Device", "{{browser_name}} on {{operating_system}}", None),
               ("Location", "{{location}}", None), ("IP", "{{ip_address}}", None), ("Time", "{{session_created_at}}", None)]),
     ("if", "revoke_session_url", [
        P("Don't recognize it? Sign out of that device now."),
        ("button", "Sign out of that device", "{{revoke_session_url}}"),
        ("link", "Button not working? Sign out of that device", "{{revoke_session_url}}")])])

tpl("account_locked", "Account Locked", "Your Dueling Domain account is locked",
    "Sign-ins are paused after too many failed attempts.",
    "You're getting this because sign-ins on your Dueling Domain account were paused for security.",
    [("eyebrow", "Security notice"), ("h1", "Your account is locked for now"),
     P("We paused sign-ins on your account after too many failed attempts, to keep it safe."),
     ("rows", [("Locked on", "{{locked_date}}", None), ("Failed attempts", "{{failed_attempts}}", None), ("Unlocks", "{{unlock_time}}", None)]),
     P("It unlocks on its own after {{lockout_duration}}. You don't need to do anything."),
     ("callout", f"Didn't expect this? Email {SUP_LINK} and we'll look into it.")])

ORDER = ["waitlist_confirmation", "waitlist_invitation", "invitation", "verification_code", "reset_password_code",
         "password_changed", "primary_email_address_changed", "new_device_sign_in", "account_locked"]

# ---------- HTML renderer ----------
def gap(kind):  # top padding before a node, by node kind and what came before
    return {"eyebrow": 0, "h1": 12, "p": 16, "small": 12, "button": 28, "link": 16, "otp": 24, "rows": 24, "callout": 24}[kind]

def a_inline(t):  # links inside copy
    return t

def node_html(n, prev):
    k = n[0]
    if k == "if":
        inner = ""
        pv = prev
        for c in n[2]:
            inner += node_html(c, pv); pv = c[0]
        return "{{#if %s}}\n%s{{/if}}\n" % (n[1], inner)
    pad = gap(k)
    if k == "p" and prev in ("p",):
        pad = 14
    tdo = f'<tr><td style="padding:{pad}px 0 0 0;">'
    tdc = '</td></tr>\n'
    if k == "eyebrow":
        return (f'{tdo}<p style="margin:0;font-family:{SANS};font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;'
                f'text-transform:uppercase;color:{GOLD};">{n[1]}</p>{tdc}')
    if k == "h1":
        return (f'{tdo}<h1 style="margin:0;padding:0;font-family:{DISPLAY};font-size:28px;line-height:34px;font-weight:700;'
                f'color:{TEXT};">{n[1]}</h1>{tdc}')
    if k == "p":
        return (f'{tdo}<p style="margin:0;font-family:{SANS};font-size:16px;line-height:26px;color:{BODY};">{n[1]}</p>{tdc}')
    if k == "small":
        return (f'{tdo}<p style="margin:0;font-family:{SANS};font-size:14px;line-height:22px;color:{MUTED};">{n[1]}</p>{tdc}')
    if k == "button":
        return (f'{tdo}<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-table" style="border-collapse:separate;"><tr>'
                f'<td align="center" bgcolor="{BTN}" style="background-color:{BTN};border:1px solid {BTN_EDGE};border-radius:8px;">'
                f'<a href="{n[2]}" target="_blank" class="btn" style="display:inline-block;padding:14px 28px;font-family:{SANS};font-size:16px;line-height:20px;'
                f'font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;white-space:nowrap;">{n[1]}</a>'
                f'</td></tr></table>{tdc}')
    if k == "link":
        return (f'{tdo}<p style="margin:0;font-family:{SANS};font-size:14px;line-height:22px;color:{MUTED};">'
                f'<a href="{n[2]}" target="_blank" style="color:{LINK};text-decoration:underline;">{n[1]}</a></p>{tdc}')
    if k == "otp":
        return (f'{tdo}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;"><tr>'
                f'<td align="center" bgcolor="{WELL}" class="otp" style="background-color:{WELL};border:1px solid {BORDER};border-radius:10px;padding:24px 6px 24px 16px;">'
                f'<p style="margin:0;font-family:{DISPLAY};font-size:42px;line-height:50px;font-weight:700;letter-spacing:10px;color:{GOLD_HI};'
                f'text-align:center;white-space:nowrap;">{n[1]}</p></td></tr></table>{tdc}')
    if k == "rows":
        rows = n[1]; out = ""
        for i, (lab, val, cond) in enumerate(rows):
            last = i == len(rows) - 1
            bb = "none" if last else f"1px solid {DIVIDER}"
            r = (f'<tr><td valign="top" style="width:38%;padding:11px 8px 11px 16px;border-bottom:{bb};font-family:{SANS};font-size:14px;line-height:20px;color:{MUTED};">{lab}</td>'
                 f'<td valign="top" style="padding:11px 16px 11px 0;border-bottom:{bb};font-family:{SANS};font-size:14px;line-height:20px;font-weight:700;color:{TEXT};word-break:break-word;">{val}</td></tr>\n')
            out += ("{{#if %s}}" % cond + r + "{{/if}}\n") if cond else r
        return (f'{tdo}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{WELL}" style="width:100%;border-collapse:separate;'
                f'background-color:{WELL};border:1px solid {BORDER};border-radius:10px;"><tbody>\n{out}</tbody></table>{tdc}')
    if k == "callout":
        return (f'{tdo}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;"><tr>'
                f'<td bgcolor="{RAISE}" style="background-color:{RAISE};border-left:3px solid {GOLD};border-radius:6px;padding:14px 16px;'
                f'font-family:{SANS};font-size:15px;line-height:23px;color:{BODY};">{n[1]}</td></tr></table>{tdc}')
    raise ValueError(k)

HEAD_CSS = f"""
@font-face{{font-family:'Russo One';font-style:normal;font-weight:400;src:url(https://duelingdomain.com/fonts/russo-one-400-latin.woff2) format('woff2');}}
@font-face{{font-family:'Russo One';font-style:normal;font-weight:700;src:url(https://duelingdomain.com/fonts/russo-one-400-latin.woff2) format('woff2');}}
@font-face{{font-family:'Chakra Petch';font-style:normal;font-weight:400;src:url(https://duelingdomain.com/fonts/chakra-petch-400-latin.woff2) format('woff2');}}
@font-face{{font-family:'Chakra Petch';font-style:normal;font-weight:700;src:url(https://duelingdomain.com/fonts/chakra-petch-700-latin.woff2) format('woff2');}}
:root{{color-scheme:dark light;supported-color-schemes:dark light;}}
body,table,td,a{{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}}
table,td{{mso-table-lspace:0;mso-table-rspace:0;}}
img{{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}}
body{{margin:0;padding:0;width:100%!important;background-color:{PAGE};}}
a{{color:{LINK};}}
@media all and (max-width:599px){{
  .container{{width:100%!important;}}
  .pad{{padding:28px 20px 32px 20px!important;}}
  .otp p{{font-size:36px!important;letter-spacing:7px!important;line-height:44px!important;}}
  .lg{{padding-left:16px!important;}}
  .ft{{padding-left:20px!important;padding-right:20px!important;}}
  .btn-table{{width:100%!important;}}
  .btn{{display:block!important;padding-left:12px!important;padding-right:12px!important;white-space:normal!important;}}
  h1{{font-size:26px!important;line-height:32px!important;}}
}}
"""

def body_html(t):
    inner = ""; prev = None
    for n in t["nodes"]:
        inner += node_html(n, prev); prev = n[0]
    pre = H.escape(t["preheader"], quote=False).replace("&#x27;", "'")
    pre = t["preheader"] + "&nbsp;&zwnj;" * 40
    why = t["why"]
    footer_lines = (f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:20px;color:{FOOT};">{why}</p>'
                    f'<p style="margin:6px 0 0 0;font-family:{SANS};font-size:13px;line-height:20px;color:{FOOT};">Questions? Email '
                    f'<a href="mailto:{SUPPORT}" style="color:{MUTED};text-decoration:underline;">{SUPPORT}</a>.</p>')
    logo = (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>'
            f'<td valign="middle" style="padding:0;"><a href="{SITE}" target="_blank" style="text-decoration:none;">'
            f'<img src="{LOGO}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:10px;"></a></td>'
            f'<td valign="middle" style="padding:0 0 0 12px;"><a href="{SITE}" target="_blank" style="text-decoration:none;font-family:{DISPLAY};font-size:17px;line-height:22px;'
            f'font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{TEXT};">Dueling <span style="color:{GOLD};">Domain</span></a></td></tr></table>')
    def wrap(td_style, content, cls="container", tdcls=""):
        return (f'<!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="{W}"><tr><td><![endif]-->'
                f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="{W}" class="{cls}" style="width:{W}px;max-width:{W}px;"><tr>'
                f'<td align="left" valign="top" class="{tdcls}" style="{td_style}">{content}</td></tr></table>'
                f'<!--[if mso]></td></tr></table><![endif]-->')
    card = wrap(f"background-color:{CARD};border:1px solid {BORDER};border-radius:12px;padding:0;",
                f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="pad" bgcolor="{CARD}" style="padding:36px 32px 40px 32px;background-color:{CARD};border-radius:12px;">'
                f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>\n{inner}</tbody></table></td></tr></table>')
    card = card.replace(f'<td align="left" valign="top" style="background-color:{CARD}', f'<td align="left" valign="top" bgcolor="{CARD}" style="background-color:{CARD}', 1)
    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>{t['subject']}</title>
<style type="text/css">{HEAD_CSS}</style>
<!--[if mso]><style type="text/css">body,table,td,a,p,h1{{font-family:Arial,Helvetica,sans-serif!important;}}</style><![endif]-->
</head>
<body bgcolor="{PAGE}" style="margin:0;padding:0;background-color:{PAGE};font-family:{SANS};">
<span style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;color:{PAGE};">{pre}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{PAGE}" style="width:100%;background-color:{PAGE};"><tr>
<td align="center" valign="top" style="padding:28px 16px 40px 16px;background-color:{PAGE};">
{wrap("padding:0 0 20px 22px;", logo, tdcls="lg")}
{card}
{wrap("padding:24px 32px 0 32px;", footer_lines, tdcls="ft")}
</td></tr></table>
</body>
</html>
"""

# ---------- Revolvapp markup (best effort, for the dashboard editor) ----------
def node_markup(n, ind="            "):
    k = n[0]
    if k == "if":
        return "".join([f"{ind}{{{{#if {n[1]}}}}}\n"] + [node_markup(c, ind) for c in n[2]] + [f"{ind}{{{{/if}}}}\n"])
    if k == "eyebrow":
        return f'{ind}<re-text margin="0px 0px 0px 0px" font-size="12px" line-height="16px" font-weight="bold" color="{GOLD}">{n[1].upper()}</re-text>\n'
    if k == "h1":
        return f'{ind}<re-heading margin="10px 0px 0px 0px" level="h1" align="left" color="{TEXT}" font-size="28px" line-height="34px">{n[1]}</re-heading>\n'
    if k == "p":
        return f'{ind}<re-text margin="16px 0px 0px 0px" align="left" font-size="16px" line-height="26px" color="{BODY}">{n[1]}</re-text>\n'
    if k == "small":
        return f'{ind}<re-text margin="12px 0px 0px 0px" align="left" font-size="14px" line-height="22px" color="{MUTED}">{n[1]}</re-text>\n'
    if k == "button":
        return f'{ind}<re-button padding="14px 28px" href="{n[2]}" font-size="16px" border-radius="8px" margin="28px 0px 0px 0px" background-color="{BTN}" color="#ffffff">{n[1]}</re-button>\n'
    if k == "link":
        return f'{ind}<re-text margin="16px 0px 0px 0px" align="left" font-size="14px" line-height="22px" color="{MUTED}"><a href="{n[2]}" style="color:{LINK};text-decoration:underline;">{n[1]}</a></re-text>\n'
    if k == "otp":
        return (f'{ind}<re-block margin="24px 0px 0px 0px" padding="22px 16px" align="center" background-color="{WELL}" border-radius="10px">\n'
                f'{ind}    <re-heading level="h2" align="center" color="{GOLD_HI}" font-size="42px" line-height="50px"><span style="letter-spacing:10px;">{n[1]}</span></re-heading>\n{ind}</re-block>\n')
    if k == "rows":
        out = f'{ind}<re-block margin="24px 0px 0px 0px" padding="0px" background-color="{WELL}" border-radius="10px">\n'
        for lab, val, cond in n[1]:
            g = (f'{ind}    <re-grid>\n{ind}        <re-column width="38%" padding="10px 8px 10px 16px" background-color="{WELL}"><re-text font-size="14px" color="{MUTED}">{lab}</re-text></re-column>\n'
                 f'{ind}        <re-column width="62%" padding="10px 16px 10px 0" background-color="{WELL}"><re-text font-size="14px" font-weight="bold" color="{TEXT}">{val}</re-text></re-column>\n{ind}    </re-grid>\n')
            out += (f"{ind}    {{{{#if {cond}}}}}\n{g}{ind}    {{{{/if}}}}\n") if cond else g
        return out + f"{ind}</re-block>\n"
    if k == "callout":
        return (f'{ind}<re-block margin="24px 0px 0px 0px" padding="14px 16px" align="left" background-color="{RAISE}" border-radius="6px">\n'
                f'{ind}    <re-text font-size="15px" line-height="23px" color="{BODY}">{n[1]}</re-text>\n{ind}</re-block>\n')
    raise ValueError(k)

def markup(t):
    inner = "".join(node_markup(n) for n in t["nodes"])
    return f'''<re-html>
<re-head>
    <re-title>
        {t["subject"]}
    </re-title>
</re-head>
<re-body background-color="{PAGE}" padding="28px 16px 40px 16px">
    <re-preheader>
        {t["preheader"]}
    </re-preheader>
    <re-header padding="0px 0px 20px 22px">
        <re-image src="{LOGO}" width="44" alt="Dueling Domain" href="{SITE}"></re-image>
    </re-header>
    <re-main background-color="{CARD}" border-radius="12px">
        <re-block border-radius="12px" align="left" padding="36px 32px 40px 32px" background-color="{CARD}" font-size="16px">
{inner}        </re-block>
    </re-main>
    <re-footer padding="24px 32px 0px 32px">
        <re-text margin="0px 0px 0px 0px" font-size="13px" line-height="20px" color="{FOOT}">{t["why"]}</re-text>
        <re-text margin="6px 0px 0px 0px" font-size="13px" line-height="20px" color="{FOOT}">Questions? Email <a href="mailto:{SUPPORT}" style="color:{MUTED};text-decoration:underline;">{SUPPORT}</a>.</re-text>
    </re-footer>
</re-body>
</re-html>
'''

if __name__ == "__main__":
    os.makedirs(f"{OUT}/requests", exist_ok=True)
    subjects = {}
    for slug in ORDER:
        t = T[slug]; b = body_html(t); m = markup(t)
        open(f"{OUT}/{slug}.body.html", "w").write(b)
        open(f"{OUT}/{slug}.markup.html", "w").write(m)
        subjects[slug] = t["subject"]
        json.dump({"name": t["name"], "subject": t["subject"], "markup": m, "body": b}, open(f"{OUT}/requests/{slug}.put.json", "w"), indent=1, ensure_ascii=False)
        print(slug, len(b))
    json.dump(subjects, open(f"{OUT}/subjects.json", "w"), indent=2)
