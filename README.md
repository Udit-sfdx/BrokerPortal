# Broker Portal · demo website

A clickable, working website for **Broker Portal**, the ThinkVibes product for UAE brokerages: one portal where every broker firm runs leads, deals, marketing, compliance and commission, each firm's data private to it. It is built the same way as the VibeEstate demo site: plain HTML, CSS and JavaScript, no server code, data kept in the browser. Screens use the Salesforce Lightning Design System and are split into the components (`bp*`) that become LWCs in the Salesforce build.

All people, firms, licence numbers and figures are fictional.

## Pages

| Address | What it is |
|---|---|
| `/` | Product page: roles, AI agents, privacy, plans and a guided demo |
| `/join/` | Request to join, sign-up from an invite (documents, verification), registration status |
| `/portal/` | The firm portal: My Day, leads, pipeline and deal room, inventory, campaign studio, team performance, commission, compliance centre, firm settings, people, the Copilot and Ctrl+K search. Works on a phone |
| `/console/` | ThinkVibes operator console: join requests, invites, verification queue, firms, email and audit logs |

Open them in separate tabs: they share one set of data, and each tab keeps its own signed-in person.

## Demo walkthrough (drop 1)

1. `/join/`, enter invite code `MGR7Q2K` (Marina Gate Realty). Follow the four steps; the SMS code shows in a toast. Any files work as documents.
2. Submit: the popup calls the document-verification API (a stub that answers "verified").
3. `/console/`, sign in as Ananya Iyer, open **Verification queue**, review Marina Gate and **Approve**. The applicant's status page updates by itself.
4. `/portal/`, sign in with `omar@marinagate.example` (the code shows on screen), finish setup and invite the team.
5. Access rules to try on the portal sign-in page: Vikram Rao's old Crescent Key login is deactivated (he now works at Palm Arc), and Oasis Point Properties is still under review.

Other invite codes: `HBV2M8D` is expired, `OPP5X9M` is already used.

## Demo walkthrough (drop 2: leads and deals)

Sign in on `/portal/` from the demo list.

1. **My Day** as Sara Khan (agent): the morning brief, her next 3 actions, live SLA timers, today's viewings and the deal the Deal Coach flags. **Quick capture** adds a walk-in that stays with her.
2. **Leads**: open the inbox in two tabs and press **Simulate portal lead** in one: the lead is routed in under a second and appears in the other tab without a refresh. Hover a score for the Lead Qualifier's reasons, or an owner for the routing trace. Dmitri Volkov (expired BRN) never receives leads.
3. **Lead workspace**: send a WhatsApp in Arabic from a template, log a call (blocked for do-not-call numbers and outside 09:00–18:00 GST; the blocked dialog has a demo-only switch for evening demos), let the Lead Qualifier fill the missing fields, mark qualified and convert, with co-broking if you like.
4. **Pipeline**: drag a deal from EOI to Booking. The drop is refused, and the dialog lists exactly which document, KYC step or payment is missing, with a link to fix each.
5. **Deal room**: upload a passport (put `mismatch` or `expired` in the file name to see those checks), confirm the Document Reader's fields, submit KYC. Then sign in as Huda Karim (Compliance) in another tab to screen and verify it, record the booking deposit, and the move goes through.
6. **Compliance**: run screening on Viktor Brankovich's deal (Crescent Key, secondary): a possible watchlist match blocks it until Compliance clears it, and his AED 120,000 cash deposit asks for a REAR draft.
7. **Privacy**: as Faisal Noor (Palm Arc), search a Crescent Key client's phone: nothing. The same client enquired at both firms; neither firm sees a duplicate warning.

## Demo walkthrough (drops 3 and 4: the rest of the firm)

1. **Inventory** (Sara Khan): pick one of her leads under *Match a lead*. **Send** opens a WhatsApp with the unit filled in; a second click sends it. The same matches show on every lead.
2. **Campaign studio** (Maya Rizk, marketing): *Harbor Lights Q4* cannot go live: no permit, no approved creative. Add a permit (6–10 digits), draft Arabic copy with the Marketing Analyst (it carries the permit number), approve it as Khalid in another tab, then go live. Palm Arc (Option A) has no campaigns.
3. **Team performance** (Rania Aziz): leaderboard, speed to lead, and the re-assign queue: pick a new owner on a stalled lead and press **Re-assign**. **Coaching** opens a note drafted from the agent's numbers.
4. **Commission** (Khalid Mansour): expected → invoiced → collected → paid out, who owes what by age, agent payouts, and a ledger where every row links to its deal, lead, source and campaign.
5. **Compliance centre** (Huda Karim): KYC queue, the Palmyra permit and Dmitri's BRN expiring within 30 days, screening, REAR cases, do-not-call hits, audit log. **Run privacy check** tries 10 ways into another firm's data and shows each one blocked.
6. **Firm settings** (Khalid): change the first-reply SLA or a stage gate and the next lead or deal follows it at once. KYC and screening gates are locked by regulation.
7. **Copilot** (button at the top, or the bottom bar on a phone): "which deals are at risk?", "show team overdue follow-ups", "re-assign <lead> to Omar" (asks first), "how many leads does Palm Arc have?" (refused).
8. **Ctrl+K**: "2BR leads from Meta this month", a name, a phone or a page.
9. **Phone**: open the portal at 390 px: menu drawer, bottom bar (Today, Leads, Deals, Copilot) and a floating + for quick capture.
10. **Demo controls** in the user menu: demo clock (+1 hour, +1 day), simulate a lead, view as another persona, reset.
11. **Console** (Ananya Iyer) → a firm: health and churn risk from counts only.

## Copilot model (optional)

The Copilot works everywhere with its built-in engine (questions about leads, deals, follow-ups, pipeline, commission, KYC; re-assigning; refusing other firms). On Hostinger, `api/copilot.php` also sends free-form questions to Claude, with only the asking user's own records as context:

1. Copy `api/config.example.php` to `api/config.php` on the server (never commit it; it is in `.gitignore`), add the API key and the site's origin.
2. `api/.htaccess` blocks direct access to the config files. The proxy accepts same-origin requests only and allows 20 questions a minute per visitor.
3. GitHub Pages cannot run PHP, so there the Copilot stays on the built-in engine.

## Run it locally

Needs Node.js 20 or newer.

```bash
npm install
npm start            # builds into build/ and serves it at http://localhost:3000
```

`npm run build` writes the publishable site to `build/` (pages, SLDS styles and icons, scripts).

## Tests

```bash
npm run build
npx playwright install chromium   # first time only
npm test
```

## How it is built

| Path | Role |
|---|---|
| `js/core/` | Store (browser storage shared across tabs, resets after 8 hours idle, upgrades data saved by an earlier drop), seed data, router and action runtime, SLDS markup helpers |
| `js/core/rules.js` | Pure business rules shared by the seed and services: routing, lead score, SLA, stage gates, deal risk, commission, screening |
| `js/services/` | Business rules, one file per planned Apex service: auth, registration, operator, firm and people, leads and tasks, deals, and the scripted AI agents (`aiService`) |
| `js/components/` | Screens and parts, one `bp*` component per planned LWC |
| `js/apps/` | Entry point for each page |
| `scripts/build.mjs` | Generates the page shells, copies SLDS from npm, writes `build/` |
| `legacy/workshop-prototype/` | The first single-file workshop prototype, kept for reference |

## Deploy (Hostinger)

Connect the GitHub repository, build command `npm run build`, output directory `build` (it includes `api/`; add `api/config.php` by hand for the Copilot model). Point the subdomain (e.g. `brokers.vibeestate.space`) at it with the CNAME record Hostinger shows. The site asks search engines not to index it (`robots.txt`, `noindex`, `X-Robots-Tag`).

## Licences

See [NOTICE.md](NOTICE.md). Not affiliated with or endorsed by Salesforce.
