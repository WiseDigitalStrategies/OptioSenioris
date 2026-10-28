# Optio Senioris website and care assistant

The static site for optiosenioris.net plus the AI care assistant: a chat on every page that takes family and caregiver enquiries, matches families against the caregiver roster, routes facility and hospice cases to Jill, and offers an intro call. Everything runs on Cloudflare Pages in one project, with no separate server.

The system keeps client and caregiver data confidential with reasonable security measures. It is **not** HIPAA compliant, and nobody should describe it that way.

## How it fits together

| Part | Where |
|---|---|
| Static pages | `*.html`, `css/`, `images/` |
| Chat widget (vanilla JS, no build step) | `js/chat-widget.js`, `css/chat-widget.css`, one `<script>` tag per page |
| Chat endpoint | `functions/api/chat.js` → `lib/chat.js` |
| Tools Claude can call | `lib/tools.js` (search, save lead, save applicant, book call, escalate) |
| Caregiver matching (deterministic, not the model) | `lib/matching.js` |
| Plain HTML form handlers (work with JavaScript off) | `functions/api/forms/*.js` → `lib/forms.js` |
| Admin page and API (behind Cloudflare Access) | `admin/`, `functions/api/admin/[[path]].js` → `lib/admin.js` |
| www → root redirect, admin guard | `functions/_middleware.js` |
| Every placeholder and fact the bot may state | `config/assistant.config.js` |
| System prompt | `prompts/system-prompt.txt` |
| Database schema | `migrations/` (Cloudflare D1) |
| Roster import | `scripts/import-roster.mjs`, `scripts/load-roster.mjs`, `scripts/roster-template.csv` |

The model is called only from the server, with the API key from a Cloudflare secret. The working conversation is kept in the visitor's browser, signed with `SESSION_SECRET` so it can't be altered. The database stores the lead or applicant and a short summary per conversation, never the transcript. Résumés go to a private R2 bucket and are downloaded through the admin page.

## Environments

| | Production | Staging |
|---|---|---|
| Branch | `main` | `staging` (any non-main branch deploys as a preview) |
| URL | https://optiosenioris.net | https://staging.optiosenioris.pages.dev |
| D1 database | `optio-assistant` | `optio-assistant-staging` |
| R2 bucket | `optio-resumes` | `optio-resumes-staging` |
| Turnstile | real keys (to set up) | Cloudflare's always-pass test keys |
| Tool calls in responses (`DEBUG_TOOLS`) | off | on, for the conversation tests |

Non-secret settings live in `wrangler.toml`. Production is the top level and staging is `[env.preview]`. When `wrangler.toml` exists, it overrides bindings and variables set in the dashboard.

## Setup checklist

Already done: both D1 databases are created and migrated, both R2 buckets are created, `SESSION_SECRET` is set in both environments, the staging Turnstile test secret is set, and the made-up test roster is loaded into staging. The Pages build command is `npm run build`.

Still to do before the chat appears on the live site. It stays hidden until `ANTHROPIC_API_KEY` is set.

1. **Anthropic API key.** Create a key for this project in the Anthropic Console and set a monthly spend limit and alert there. Then run each of these and paste the key when prompted:
   ```bash
   npx wrangler pages secret put ANTHROPIC_API_KEY --project-name optiosenioris --env preview
   ```
   ```bash
   npx wrangler pages secret put ANTHROPIC_API_KEY --project-name optiosenioris
   ```
   Use separate keys for staging and production if you can. Never put a key in the repo, in chat, or in a log.
2. **Turnstile.** In the Cloudflare dashboard, go to Turnstile and add a widget for `optiosenioris.net` in Managed mode.
   - Put the site key in `TURNSTILE_SITE_KEY` in `wrangler.toml` (top level).
   - Set the secret key with:
   ```bash
   npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name optiosenioris
   ```
3. **Cloudflare Access for the admin page.** In Zero Trust, go to Access and add a self-hosted application.
   - Domain: `optiosenioris.net`, with paths `/admin` and `/api/admin`.
   - Policy: allow Jill's and Alec's email addresses.
   - Copy the team domain (for example `optio.cloudflareaccess.com`) and the application's AUD tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml`.
   - The admin page and API return 403 until both are set, even if Access is configured.
   - Do the same for staging if you want the admin page there.
4. **Email.** Notifications go out through Cloudflare Email Sending.
   - Onboard the domain:
   ```bash
   npx wrangler email sending enable optiosenioris.net
   ```
   - Add the DNS records it asks for. The domain's SPF record currently ends in `-all` and covers Microsoft 365 and GoDaddy. Add Cloudflare's include to that same record; don't create a second SPF record, or Jill's mailboxes can break.
   - Create an API token with Email Sending permission, then run the command below and paste the token:
   ```bash
   npx wrangler pages secret put EMAIL_API_TOKEN --project-name optiosenioris
   ```
   - In the config, set `email.from` (for example `assistant@optiosenioris.net`) and `email.notifyTo`.
   - Until all of this is in place, emails are skipped, and leads still save to the database.
5. **Fill in the placeholders** in `config/assistant.config.js` as Jill confirms them (next section).
6. **Load the real roster** (see "Updating the roster").

## Placeholders (config/assistant.config.js)

Everything Jill or Wise still has to confirm is in this one file. While a value is empty, the assistant says a team member will follow up instead of guessing.

| Setting | Current state |
|---|---|
| `botName`, `greeting` | "Optio Senioris Care Assistant", until a name is chosen |
| `serviceArea` | empty: leads are marked "unknown" for area |
| `respite` hours and minimums | site wording (6am–11pm, one hour's notice), flagged as unconfirmed |
| `facilities`, `hospicePartners` | empty: the bot names no facility or hospice |
| `showCaregiverFirstNames` | false: families see the credential and reasons only |
| `faq`, `pricingWording` | empty: the bot answers from the site pages and never quotes prices |
| `booking` | empty: the bot says a team member will call to arrange a time |
| `email` | empty: emails are skipped |
| `privacy.policyUrl`, `retentionDays` | empty |
| `floridaAbuseHotline` | unverified: the bot names the hotline without a number. Verify the number before launch |
| `email.confirmation` | off until Alec approves the wording |

The model is set by `ANTHROPIC_MODEL` in `wrangler.toml` (currently `claude-opus-5-5`, effort `medium`). To switch to `claude-sonnet-5-5`, which costs about half as much per token, change the variable and push; no code changes are needed. After any model or prompt change, run the staging conversation tests.

## Updating the roster

The staff spreadsheet contains SSNs and dates of birth. Process it only on your own computer, and never paste it into an AI chat.

1. In Excel or Google Sheets, export each tab ("Hired", "PRN", "to interview") as CSV.
2. Run the import:
   ```bash
   node scripts/import-roster.mjs --hired Hired.csv --prn PRN.csv --to-interview "to interview.csv" --out roster/roster-clean.csv
   ```
   - Only allowlisted columns are read. SSN, date of birth, age, pay, interview times and comments are dropped, and the script lists the dropped column names.
   - Notes columns are scanned only for tags from `skillTags` in the config; their text is never written out.
   - The `roster/` folder is git-ignored.
3. Review `roster/roster-clean.csv` with Jill:
   - Fix anything flagged in the `needs_review` column.
   - Change `waitlist` to `prn` for each approved on-call caregiver, and set anyone who shouldn't be matched to `inactive`.
   - Only `hired` and `prn` are matched. Availability cells take `am`, `pm` and `nights` joined with `|`, or `none`. A blank cell means unknown and never counts as available.
4. Load it, staging first, then production:
   ```bash
   node scripts/load-roster.mjs roster/roster-clean.csv --db staging
   ```
   ```bash
   node scripts/load-roster.mjs roster/roster-clean.csv --db production
   ```
   The load adds and updates caregivers by name and never deletes anyone. Day-to-day changes can be made in the admin page.

## Admin page

Go to https://optiosenioris.net/admin and sign in through Cloudflare Access. It has four tabs:
- **Enquiries:** each lead's contact details, needs, schedule, suggested caregivers with reasons, status (including "Bereavement" and "Deceased: do not contact"), notes, and a delete button.
- **Flagged chats:** escalations such as emergencies, bereavement, routing, and no-match cases.
- **Applicants:** chat and careers-form applicants, a résumé download, status, and delete. Applicants never join the roster automatically.
- **Caregiver roster:** add a caregiver, or change credential, status, availability and skills.

## Development

You need Node 22.5 or newer.

```bash
npm install
```

Run the unit tests (matching, tools, chat endpoint, forms, admin, import). They need no network and no keys:
```bash
npm test
```

Run the site locally at http://localhost:8788:
```bash
npm run dev
```

For local chat, create a `.dev.vars` file (it is git-ignored) with:
- `SESSION_SECRET`
- `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`
- `TURNSTILE_SITE_KEY=1x00000000000000000000AA`
- `ANTHROPIC_API_KEY`

Then create and fill the local database:
```bash
npx wrangler d1 migrations apply optio-assistant --local
```
```bash
ROSTER_LOCAL=1 node scripts/load-roster.mjs tests/fixtures/staging-roster.csv --db production
```

### Conversation tests against the real model

These run every acceptance scenario from the brief against staging: dementia match, no overnight cover, facility and hospice routing, bereavement, 911, medication and Medicaid questions, caregiver privacy, the CNA applicant, and prompt injection. They also check for API key leaks and that a flood of requests is blocked. Staging must have `ANTHROPIC_API_KEY` set and the test roster loaded. A run makes about 30 model calls.

```bash
STAGING_URL=https://staging.optiosenioris.pages.dev npm run test:conversations
```

Add part of a scenario name to run just one. Running twice within an hour can hit the per-IP limits on new conversations; wait, or run single scenarios.

### Deploying

Push to `main` and Cloudflare Pages builds and deploys production. Push to `staging` to deploy staging. For schema changes, add a new numbered file to `migrations/`, then run `npm run db:migrate:staging` and `npm run db:migrate`.

## Privacy and safety summary

- The assistant collects only what it needs to match and call back. It never asks for SSNs, dates of birth, insurance or Medicaid numbers, license numbers, or financial details. Free-text fields that contain an SSN are refused.
- Families never see a caregiver's contact details or last name, and caregivers never see a family's details.
- Emails to Jill hold only the name, contact details, service, timing and urgency, with a link to the admin page for the rest.
- Abuse protection:
  - Turnstile before a conversation starts.
  - Per-IP, per-session and new-conversation rate limits.
  - Message and conversation length caps.
  - A honeypot and per-IP limit on the plain forms.
  - A spend limit set in the Anthropic Console.
- The admin API checks the Access login token itself, rejects cross-site changes, and escapes everything it displays.
- To delete a lead or applicant (including their résumé), use the delete buttons in the admin page. The retention period is a placeholder until it is decided.
