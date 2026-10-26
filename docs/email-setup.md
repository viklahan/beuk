# Setting up email for beuk.studio

For V. Beuk works without email today: nothing is sent, nothing is ever
reported as sent, and every page that would mention a message says
"email isn't set up on this server". Email switches on when two settings
are filled in, `SMTP_URL` and `MAIL_FROM`, and the app is restarted. No
code change is needed.

This page covers: choosing a provider, the two settings, the DNS records
for beuk.studio, a mailbox for replies and support, how to test, and a
list of every email Beuk can send.

Provider facts below were checked on **26 October 2026** on each
provider's own pages (linked). Prices and limits change; check the page
before you sign up.

## 1. Choosing a transactional email provider

Beuk sends a small number of account emails (a welcome with a
confirmation link, password resets, change-of-address links). Any
provider with SMTP works. Four that fit:

| Provider | Free | Cheapest paid | SMTP | Notes | Source |
|---|---|---|---|---|---|
| Postmark | 100 emails a month, no overage | Basic: $15.00 a month, from 10,000 emails a month; extra emails $1.80 per 1,000 | `smtp.postmarkapp.com`, ports 25, 2525 or 587 with STARTTLS | Transactional mail only on the default "outbound" stream; known for delivery of account email | [pricing](https://postmarkapp.com/pricing), [SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp) |
| Resend | 3,000 emails a month, at most 100 a day, 3 domains | Pro: $20 a month for 50,000 emails | `smtp.resend.com`; 465 or 2465 implicit TLS, 25, 587 or 2587 STARTTLS; user `resend`, password = API key | Recommends sending from a subdomain | [pricing](https://resend.com/pricing), [SMTP](https://resend.com/docs/send-with-smtp) |
| Amazon SES | New AWS customers get up to $200 of Free Tier credits (6-month free plan; credits used within 12 months) | $0.10 per 1,000 emails, pay as you go | `email-smtp.<region>.amazonaws.com`; 25, 587 or 2587 STARTTLS, 465 or 2465 TLS | New accounts start in a **sandbox**: only verified recipients, 200 messages a day, 1 a second, until production access is granted (AWS answers within 96 hours) | [pricing](https://aws.amazon.com/ses/pricing/), [SMTP](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html), [sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) |

I could not read Brevo's pricing page when checking, so it is not in the
table; if you want a fourth option, check it yourself.

A plain suggestion, not a fact about the providers: at launch volumes
the free tiers of Postmark or Resend cover Beuk's account email, and
Postmark's paid plan is the simpler upgrade if delivery matters more
than price. SES is the cheapest at volume but needs the sandbox review
and more DNS work.

**Hetzner blocks outgoing ports 25 and 465 on all cloud servers by
default; port 587 is open** ([Hetzner Cloud FAQ](https://docs.hetzner.com/cloud/servers/faq/)).
So use port **587 with STARTTLS** (`smtp://…:587`), not 465.

Whichever you choose, turn **open and click tracking off** at the
provider. Beuk's emails carry live one-time links (reset, confirm), and
rewritten links send them through the provider's tracking domain first.

## 2. The two settings

Set these in `.env` on the server and restart the app container.

```
SMTP_URL=smtp://USERNAME:PASSWORD@HOST:587
MAIL_FROM=Beuk <hello@mail.beuk.studio>
```

- `SMTP_URL` is a nodemailer connection URL. `smtp://` upgrades with
  STARTTLS when the server offers it; `smtps://` is implicit TLS (port
  465, blocked on Hetzner). Characters such as `@`, `:` or `/` in the
  username or password must be percent-encoded (`@` → `%40`).
  `SMTP_URL` is a secret: Housekeeping scrubs it from every output and
  backups leave it out.
- `MAIL_FROM` is the From address. It must be on a domain the provider
  has verified for you. `hello@mail.beuk.studio` is an example; pick the
  address you want writers to see.

Per provider (replace the capitals; nothing below is a real credential):

| Provider | SMTP_URL |
|---|---|
| Postmark | `smtp://SERVER_TOKEN:SERVER_TOKEN@smtp.postmarkapp.com:587` (Server API Token as both user and password; Postmark then uses its default transactional stream. An SMTP Token's Access Key and Secret Key work too.) |
| Resend | `smtp://resend:API_KEY@smtp.resend.com:587` |
| Amazon SES | `smtp://SMTP_USERNAME:SMTP_PASSWORD@email-smtp.REGION.amazonaws.com:587` (SES SMTP credentials, made in the SES console; they are not your AWS access keys) |

Leave `MAIL_LOG_LINKS` unset in production. It writes the would-be
email, live links included, to the server log when email is not
configured; it is for a local stack only.

## 3. DNS records for beuk.studio

Three kinds of record decide whether mail from beuk.studio is trusted:
SPF (which servers may send), DKIM (a signature on each message), and
DMARC (what receivers should do when the first two don't line up with
the From address).

**Use a sending subdomain** such as `mail.beuk.studio` for Beuk's
email. It keeps the reputation of Beuk's account mail apart from any
mailbox on the root domain. Resend recommends this explicitly.

### SPF and DKIM: provider-specific

**This part comes from the provider, not from this page.** When you add
the domain in the provider's dashboard, it shows the exact records,
names and values. Copy them as shown. What each one usually asks for:

- **Postmark:** a DKIM TXT record (name and value shown on the domain's
  DNS Settings page) and a Return-Path CNAME, by default
  `pm_bounces` → `pm.mtasv.net` ([Postmark: verify a domain](https://postmarkapp.com/support/article/1046-how-do-i-verify-a-domain)).
  The Return-Path is what makes SPF line up.
- **Resend:** the records shown when you add the domain in its
  dashboard ([Resend: domains](https://resend.com/docs/dashboard/domains/introduction)).
- **Amazon SES:** the three DKIM CNAME records SES shows when you verify
  the domain ("Easy DKIM"), and optionally a custom MAIL FROM subdomain so SPF lines
  up with your domain ([SES: verify a domain](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)).

One rule that holds for all of them: a name can carry only **one** SPF
record (`v=spf1 …`). If a name already has one, merge the provider's
`include:` into it instead of adding a second.

If beuk.studio itself (the root) sends no mail at all, a root SPF record
of `v=spf1 -all` tells receivers so. Don't add it if the support mailbox
in section 4 sends from the root domain; use that mailbox host's SPF
record instead.

### DMARC: start gently, then tighten

DMARC is one TXT record at `_dmarc.beuk.studio` (it covers subdomains
too unless they have their own). Start by only collecting reports:

```
_dmarc.beuk.studio   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@beuk.studio"
```

`p=none` changes nothing about delivery; it asks receivers to send
aggregate reports to the `rua` address. Use an address you read (or a
DMARC report service). Then, once the reports show only your provider
(and your mailbox host) sending as beuk.studio, and they pass:

1. after a couple of weeks of clean reports: `p=quarantine; pct=25`,
   then raise `pct` to 100;
2. after that holds: `p=reject`.

Each step is just an edit of the same TXT record. The DMARC standard is
[RFC 7489](https://www.rfc-editor.org/rfc/rfc7489); SPF is
[RFC 7208](https://www.rfc-editor.org/rfc/rfc7208).

## 4. A mailbox for replies and support

Beuk's account emails come from `MAIL_FROM`; writers will sometimes
reply to them. Two settings decide where writers are told to write:

- `SUPPORT_EMAIL`: the address shown in Help, on the account page, on
  the status page, in the studio (the top bar's Support button and a line
  in Project Settings), and on /compare's "tell us". While it is unset,
  none of these name an address, a person or a reply time, and the
  studio's Support button is hidden.
- `SUPPORT_NAME`, `SUPPORT_REPLY_PROMISE`: optional, shown in Help only
  when set.

The support mailbox needs a mailbox host (whoever hosts your inbox),
separate from the sending provider; sending providers are not inboxes.
Point the root domain's MX records at that host, and set `MAIL_FROM` to
an address that either is that mailbox or forwards to it, so a reply
reaches someone. Beuk does not set a separate Reply-To today.

## 5. Testing

1. Set `SMTP_URL` and `MAIL_FROM`, restart the app.
2. Housekeeping → Mail (`GET /api/housekeeping/mail`) should say
   `SMTP via smtp://HOST:587, from …`.
3. `POST /api/housekeeping/mail/test` sends one email, in the same layout
   writers get, to your own admin address and reports what the SMTP
   server said. A `502` carries the server's reason; nothing is ever
   reported as sent unless the SMTP server accepted it.
4. Run the self-checks: `auth.mail.delivery-state-honest` connects and
   authenticates.
5. Make a throwaway account with an address you can read: you should
   get one email, the welcome with the confirmation link. Open the link
   and press the button.
6. In a mail client, look at the message's headers for
   `dkim=pass`, `spf=pass` and `dmarc=pass` (Gmail: "Show original").

## 6. What Beuk sends

Every email Beuk's code can send. Each one is caused by something a
writer or the operator did; Beuk sends no newsletters and no marketing.
None of these can be turned off by a writer, because each is the only
way that action can work; the operator can turn all of them off by
leaving email unconfigured.

| Email | Trigger | Recipient | Content | Can it be turned off? |
|---|---|---|---|---|
| `welcome` | Creating an account, once, only when email is configured | The new account's address | Subject "Confirm your email address, and welcome to Beuk": the confirmation link (one use, 48 hours), what an account adds (shelf, archive, beta-reader links, the server's EPUBCheck and PDF/X), that writing never needs an account, the trial in plain words (7 days; then "one price, announced before launch", or `BILLING_PRICE_LABEL` if it is set), links to Help and /account | Only by leaving email unconfigured. Without email, nothing is sent |
| `signup-confirm` | "Send the link again" on /account; and, at sign-up on a server without email, the would-be confirmation that is logged (`MAIL_LOG_LINKS`) and never sent | The account's address | Subject "Confirm your email address for Beuk": the confirmation link (one use, 48 hours) and that the shelf works either way | Writer: only by not asking. Never sent without email |
| `email-change-confirm` | Changing the email address on /account (needs the current password) | The NEW address | Subject "Confirm your new email address for Beuk": the link that makes the change (one use, 48 hours) | No: the address cannot change without it. Refused while email is unconfigured |
| `email-change-notice` | The same change, right after the link is sent | The OLD address | Subject "Your Beuk email address is about to change": the new address, no link to confirm, what to do if it wasn't you | No: it is the account's protection |
| `password-reset` | "Forgot password?" in the studio (at most 3 per address per hour) | The address asked for, only if an account has it | Subject "Reset your Beuk password": the reset link (one use, 60 minutes) | Writer: only by not asking |
| `housekeeping-test` | An admin's `POST /api/housekeeping/mail/test` | That admin's own address | Subject "Beuk test email": one line naming the server and build | Operator only |
| `backup-alert` | A backup self-check turning red, its retry, it turning green again, or an admin's alert test | `ALERT_EMAIL` (the operator), only when set and email is configured | Subjects "Beuk: backups need attention" / "Beuk: backups are working again": check names and their scrubbed detail, no writer data | Leave `ALERT_EMAIL` unset |
| `self-check-probe` | The `auth.mail.delivery-state-honest` self-check | `probe@invalid.example` | Never sent: the check gives it only to an unconfigured mailer, to prove that mailer refuses to claim a delivery | Not an email anyone receives |
| `stripe-receipt` | A successful payment, once billing is live | The paying writer | **Sent by Stripe, not by Beuk.** Beuk sends no receipts of its own. Stripe sends them when "Successful payments" is turned on in the Dashboard under Settings → Business → Customer emails ([Stripe: receipts](https://docs.stripe.com/receipts)); receipts cover subscription payments too | In the Stripe Dashboard |

Writer-facing emails (`welcome`, `signup-confirm`, `email-change-*`,
`password-reset`) and the Housekeeping test share one layout
(src/email/layout.ts): plain text plus simple HTML, no images, no remote
fonts, no tracking pixel, and a footer that says why the email was sent,
who sent it (`MAIL_FROM`) and links to /account. Backup alerts stay plain
text for the operator.

A test (tests/email-lifecycle.test.ts) reads every `.send({ … })` call
in `src/` and fails if one has no `email-kind:` marker or if its kind is
missing from this table.
