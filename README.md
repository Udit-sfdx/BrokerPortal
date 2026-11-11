# Broker Portal – workshop prototype

A clickable prototype of **Broker Portal**, a Salesforce managed package for UAE real estate brokerages, by ThinkVibes. It is used in workshops with pilot broker firms to check the workflow before the real Salesforce build starts.

- **Throwaway by design.** All data is fictional and lives in browser memory. Reloading or clicking **Reset** restores the starting point. Nothing is saved or sent anywhere.
- **Looks like Lightning.** Built with the Salesforce Lightning Design System, so screens and wording carry over to the LWC build.
- **One file.** The build produces a single self-contained `dist/index.html` that also works offline.

## What it shows

A workshop script, docked on the right, runs 12 steps in order:

1. A Property Finder lead is captured with campaign attribution, checked against the DNC registry and routed (the routing trace shows why).
2. A repeat enquiry is merged on normalised phone, so no duplicate is created.
3. An agent with an expired BRN is skipped by routing.
4. SLA breach → escalation to the team leader → automatic re-assignment.
5. The telemarketing guard blocks calls outside 09:00–18:00 GST, to DNC numbers, and after a same-day refusal.
6. Qualify and convert: a Contact, an Individual Account and a Deal are created, with optional co-broking.
7. Document and KYC gates on the drag-and-drop pipeline.
8. Payment plan with the developer commission threshold, plus a handover checklist.
9. Commission from expected to paid, feeding campaign ROI.
10. Manager dashboard: speed to lead, breaches, ageing leads, lost reasons and funnel by channel.
11. The ad-permit gate on campaigns.
12. Firm admin setup: routing rules, SLA, stages, commission, agents, emirate rule packs and the Option A/B switch.

Use **View as** in the header to switch between agent, team leader, sales director, marketing and firm admin. The **demo clock** can be sped up or moved, for example to after 18:00.

## Develop

Requires Node 20 or later.

```bash
npm ci                                # install SLDS and Playwright
npm run build                         # writes dist/index.html
npx playwright install chromium       # first time only
npm test                              # end-to-end tests against dist/index.html
```

Then open `dist/index.html` in a browser. To use an installed Chrome for tests instead of Playwright's Chromium, set `CHROME_PATH`.

| Path | What it is |
|---|---|
| `src/app.html` | The page: markup, styles and script. `/*__SLDS__*/` and `<!--__ICONS__-->` are filled in by the build. |
| `scripts/build.mjs` | Inlines the SLDS stylesheet and only the icons used. Fails if a required icon is missing. |
| `tests/prototype.spec.ts` | Playwright tests covering both the happy path and the failure cases (validation, gates, blocks, access). |
| `.github/workflows/pages.yml` | On every push: build and test. On `main`: deploy to GitHub Pages. |

## Hosting

GitHub Pages deploys from GitHub Actions on every push to `main`, but only when the tests pass. The page carries `noindex`, so search engines won't list it while the product is unannounced.

## Licences

See [NOTICE.md](NOTICE.md). Not affiliated with or endorsed by Salesforce.
