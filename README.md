# Broker Portal · demo website

A clickable, working website for **Broker Portal**, the ThinkVibes product for UAE brokerages: one portal where every broker firm runs leads, deals, marketing, compliance and commission, each firm's data private to it. It is built the same way as the VibeEstate demo site: plain HTML, CSS and JavaScript, no server code, data kept in the browser. Screens use the Salesforce Lightning Design System and are split into the components (`bp*`) that become LWCs in the Salesforce build.

All people, firms, licence numbers and figures are fictional.

## Pages

| Address | What it is |
|---|---|
| `/` | Product page |
| `/join/` | Request to join, sign-up from an invite (documents, verification), registration status |
| `/portal/` | The firm portal: sign-in, setup wizard, home, people; leads, deals and the rest arrive in later drops |
| `/console/` | ThinkVibes operator console: join requests, invites, verification queue, firms, email and audit logs |

Open them in separate tabs: they share one set of data, and each tab keeps its own signed-in person.

## Demo walkthrough (drop 1)

1. `/join/`, enter invite code `MGR7Q2K` (Marina Gate Realty). Follow the four steps; the SMS code shows in a toast. Any files work as documents.
2. Submit: the popup calls the document-verification API (a stub that answers "verified").
3. `/console/`, sign in as Ananya Iyer, open **Verification queue**, review Marina Gate and **Approve**. The applicant's status page updates by itself.
4. `/portal/`, sign in with `omar@marinagate.example` (the code shows on screen), finish setup and invite the team.
5. Access rules to try on the portal sign-in page: Vikram Rao's old Crescent Key login is deactivated (he now works at Palm Arc), and Oasis Point Properties is still under review.

Other invite codes: `HBV2M8D` is expired, `OPP5X9M` is already used.

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
| `js/core/` | Store (browser storage shared across tabs, resets after 8 hours idle), seed data, router and action runtime, SLDS markup helpers |
| `js/services/` | Business rules, one file per planned Apex service: auth, registration, operator, firm and people |
| `js/components/` | Screens and parts, one `bp*` component per planned LWC |
| `js/apps/` | Entry point for each page |
| `scripts/build.mjs` | Generates the page shells, copies SLDS from npm, writes `build/` |
| `legacy/workshop-prototype/` | The first single-file workshop prototype, kept for reference |

## Deploy (Hostinger)

Connect the GitHub repository, build command `npm run build`, output directory `build`. Point the subdomain (e.g. `brokers.vibeestate.space`) at it with the CNAME record Hostinger shows. The site asks search engines not to index it (`robots.txt`, `noindex`, `X-Robots-Tag`).

## Licences

See [NOTICE.md](NOTICE.md). Not affiliated with or endorsed by Salesforce.
