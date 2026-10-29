# Beuk Weekly press — runbook

Each Thursday, a drafter on V's Legion writes the next Beuk Weekly issue
and uploads it to the Beuk server. The server emails the editor a preview
link. The issue goes live only when an admin presses **Approve and
publish** on that preview. Nothing ever publishes on its own.

The design is in the spec (kept outside git). The code is in
`src/weekly/drafts.ts`, `src/routes/weekly-press.ts`, `src/weekly/preview.ts`
and `tools/weekly/`.

## One-time setup

### On the server

Add these to the server's `.env` (never to git):

```
WEEKLY_DRAFT_TOKEN=<32+ random characters>
WEEKLY_EDITOR_EMAIL=<the editor's address>
```

To make a token:
`node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
A token shorter than 32 characters counts as unset, and every upload is
refused. `WEEKLY_EDITOR_EMAIL` falls back to `ALERT_EMAIL`.

**The email needs SMTP.** `SMTP_URL` and `MAIL_FROM` must be set, the same
as for every other Beuk email (`docs/email-setup.md`). Until they are, the
mailer is in console mode: nothing is sent, and the draft email, preview
link included, goes to the server log (`docker compose logs app`). The
Housekeeping check `weekly.mail.configured` reports NotConfigured until the
email can actually go out.

Drafts and published issues live on the `weekly` volume at `/data/weekly`
(`drafts/<id>/` and `published/<NNN>/`). The `weekly_drafts` table is in
the backups. The volume's files are not: pull each published issue into
git (below), and git is then its backup.

### On the Legion

1. Store the token as a generic credential named `BeukWeeklyDraftToken`:
   `cmdkey /generic:BeukWeeklyDraftToken /user:beuk /pass:<token>`.
2. Make sure `claude` is logged in with V's subscription: run `claude` once
   interactively. The run clears `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`
   and `CLAUDE_API_KEY` for itself, so it can never use API credits.
3. Keep the repo's `main` pulled. The run checks out the commit the server
   reports as its build. If that commit isn't local, the run fails and
   says "pull main first".
4. Register the schedule:
   `powershell -File tools\weekly\register-task.ps1 -Server https://beuk.studio`.
   This creates `BeukWeeklyDrafter`: Thursday 07:00, and daily 07:30. A
   missed start runs at the next wake.
5. Pictures: see `tools/weekly/README.md`. The local image model is not
   chosen yet. Until it is, a story gets a picture only when V drops one
   into `content/weekly/inbox/<story-slug>.jpg`.

## A run by hand

```
powershell -File tools\weekly\draft.ps1 -Server https://beuk.studio -DryRun -Force
```

`-DryRun` drafts and checks but uploads nothing. `-Force` drafts even when
it isn't Thursday. `-DraftFrom <folder>` skips the writing step and uses a
folder you already have, which is useful for testing everything else.
Logs go to `%LOCALAPPDATA%\beuk-weekly\logs\<stamp>.log`.

## What each email means

| Subject | Meaning | What to do |
|---|---|---|
| Beuk Weekly draft ready: <banner> | A draft is waiting. The email lists the headlines, every outside source, what was dropped and why, the outlets read, stories without a picture, and the commit it was written from | Open the preview (sign in as an admin). Approve and publish, or Send back with notes |
| Beuk Weekly: no draft this week | The run failed. The email gives the step and the reason (claude not logged in, server down, the checks failed, …) | Fix it, then run `draft.ps1 -Force` by hand, or wait for the next daily run |
| …: last week's draft is still waiting: <link> | Thursday came while a draft was still open, so no new one was made | Approve, send back or withdraw the waiting one |

## On the preview page

- **Approve and publish** gives the issue the next number (the highest in
  git or published, plus 1) and dates it the Monday of this week. It then
  moves it to `published/`, and it is live at `/school/weekly/<n>` at
  once. A double-click or a second tab cannot publish twice.
- **Send back** stores your notes. The next daily run rewrites the issue
  with them and emails a fresh preview.
- **Withdraw** asks again inline, then discards the draft. Its number
  stays free.

Every action is recorded in the Housekeeping audit (`weekly.approve`,
`weekly.send-back`, `weekly.withdraw`).

## Pulling a published issue into git

```
docker compose cp app:/data/weekly/published/002 content/weekly/en/002
```

Then delete it from the volume
(`docker compose exec app rm -r /data/weekly/published/002`) **before** the
next deploy. One number in both places is refused, and the Housekeeping
check `weekly.published.no-duplicate-numbers` goes red. Commit the folder
as with any content change.

## When something is red

- `weekly.drafts.no-orphans`: a draft row without its folder, a folder
  without a row, a published row without `published/NNN`, or a row stuck
  in `approved`. A stuck `approved` row means a publish stopped half-way:
  check whether `published/NNN` exists, then set the row by hand.
- `weekly.published.no-duplicate-numbers`: see "Pulling a published issue
  into git".
- `weekly.mail.configured`: NotConfigured until SMTP and an editor address
  are set.
