import { test, expect, Page, BrowserContext } from '@playwright/test';

// Drop 2: My Day, Leads inbox, Lead workspace, Pipeline, Deal room. One test per acceptance line,
// plus the privacy and permission rules (negative cases).

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
});
test.afterEach(() => expect(errors, 'no JavaScript errors').toEqual([]));

/** Signs in through the demo list when the persona is listed, otherwise by email and one-time code. */
async function signIn(page: Page, userId: string) {
  await page.goto('portal/');
  await page.waitForSelector('#email');
  const quick = page.locator(`[data-act="demoUser"][data-id="${userId}"]`);
  if (await quick.count()) {
    await quick.click();
  } else {
    const email = await page.evaluate((id) => JSON.parse(localStorage.getItem('bp.state')!).users.find((u: any) => u.id === id).email, userId);
    await page.fill('#email', email);
    await page.click('text=Send sign-in code');
    const code = (await page.locator('.bp-demo-code').innerText()).match(/(\d{6})/)![1];
    await page.fill('#code', code);
    await page.click('button:has-text("Sign in")');
  }
  await expect(page.locator('.bp-shell')).toBeVisible();
}

/** SLDS hides the real checkbox input; people click its label, so the tests do too. */
const tick = (page: Page, id: string) => page.click(`label[for="${id}"]`);

async function newTab(context: BrowserContext, userId: string) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(`pageerror (tab 2): ${e.message}`));
  await signIn(p, userId);
  return p;
}

const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bp.state')!));
const main = (page: Page) => page.locator('#main');
const modal = (page: Page) => page.locator('#modal-root');

test.describe('P2 My Day', () => {
  test('an agent sees the next 3 actions, live SLA timers and today\'s schedule', async ({ page }) => {
    await signIn(page, 'U-CK-10');
    await expect(page.locator('.bp-nav')).toContainText('My Day');
    await expect(page.locator('.bp-next-card')).toHaveCount(3);
    await expect(page.locator('.bp-next-card').first()).toContainText(/Call|Chase|Follow up|Viewing|Unblock/);
    await expect(page.locator('.bp-brief')).toContainText('waiting for a first call');
    // The 1-second ticker moves timers without a re-render: give one a known deadline and watch it update.
    const timer = page.locator('.bp-prio .bp-sla[data-due]').first();
    await timer.evaluate((el: HTMLElement) => { el.dataset.due = String(Date.now() + 7 * 60_000 + 30_000); });
    await expect(timer.locator('.bp-sla-text')).toHaveText('7m left', { timeout: 2500 });
    await timer.evaluate((el: HTMLElement) => { el.dataset.due = String(Date.now() - 3 * 60_000 - 5_000); });
    await expect(timer.locator('.bp-sla-text')).toHaveText('3m late', { timeout: 2500 });
    await expect(timer).toHaveClass(/breached/);
    await expect(main(page)).toContainText("Today's schedule");
    // Done on a task removes it from the schedule.
    const firstTask = page.locator('.bp-agenda [data-act="toggleTask"]').first();
    const count = await page.locator('.bp-agenda li').count();
    await firstTask.click();
    await expect(page.locator('#toast-root')).toContainText('Done');
    await expect(page.locator('.bp-agenda li')).toHaveCount(count - 1);
  });

  test('quick capture keeps a walk-in with the agent and validates the form', async ({ page }) => {
    await signIn(page, 'U-CK-10');
    await page.click('[data-act="quickCapture"]');
    await page.click('button:has-text("Save lead")');
    await expect(page.locator('#modal-errors')).toContainText('Client name is required');
    await page.fill('#qcName', 'Rashid Walkin');
    await page.fill('#qcPhone', '12');
    await page.click('button:has-text("Save lead")');
    await expect(page.locator('#modal-errors')).toContainText('Mobile number is not valid');
    await page.fill('#qcPhone', '055 300 4411');
    await page.click('button:has-text("Save lead")');
    await expect(page).toHaveURL(/#\/lead\/L-/);
    await expect(main(page)).toContainText('Rashid Walkin');
    await expect(main(page)).toContainText('owner Sara Khan');
  });

  test('a team leader\'s My Day is about the team', async ({ page }) => {
    await signIn(page, 'U-CK-3');
    await expect(page.locator('.bp-next-card').first()).toContainText(/Chase|Unblock|Assign/);
    await expect(main(page)).toContainText('Team open leads');
  });
});

test.describe('P3 Leads inbox', () => {
  test('a new portal lead appears in another open tab without refresh and is routed in seconds', async ({ page, context }) => {
    await signIn(page, 'U-CK-1');
    await page.goto('portal/#/leads/all');
    const rows = page.locator('[data-lead-row]');
    const firstBefore = await rows.first().getAttribute('data-lead-row');
    const other = await newTab(context, 'U-CK-3');
    await other.goto('portal/#/leads/all');
    await other.click('[data-act="simulateLead"]');
    await expect(other.locator('#toast-root')).toContainText('New lead from');
    const s = await state(other);
    const newest = s.leads[s.leads.length - 1];
    expect(newest.ownerId, 'routed to an agent').toBeTruthy();
    expect(newest.ownerId).not.toBe('U-CK-13');
    expect(newest.routingTrace.join(' ')).toContain('Valid BRN');
    // The first tab never reloaded but shows the new lead at the top, highlighted.
    await expect(rows.first()).toHaveAttribute('data-lead-row', newest.id);
    expect(newest.id).not.toBe(firstBefore);
    await expect(rows.first()).toHaveClass(/bp-arrive/);
  });

  test('views, filters, search, board layout and saved views', async ({ page }) => {
    await signIn(page, 'U-CK-1');
    await page.goto('portal/#/leads/hot');
    await expect(page.locator('.bp-page-title')).toContainText('Hot (70+)');
    const scores = await page.locator('.bp-lead-table .bp-score').allInnerTexts();
    expect(scores.length).toBeGreaterThan(0);
    for (const sc of scores) expect(Number(sc.trim().split(/\s/)[0])).toBeGreaterThanOrEqual(70);
    await page.selectOption('#inbox-source', 'Property Finder');
    for (const src of await page.locator('.bp-lead-table tbody td:nth-child(5)').allInnerTexts()) expect(src).toBe('Property Finder');
    await page.click('[data-act="saveLeadView"]');
    await page.fill('#viewName', 'Hot PF');
    await page.click('#modal-root button:has-text("Save view")');
    await expect(page).toHaveURL(/#\/leads\/view\/V-/);
    await expect(page.locator('.bp-pill-saved')).toContainText('Hot PF');
    await page.click('[data-act="inboxLayout"][data-layout="board"]');
    await expect(page.locator('.bp-lead-board .bp-col')).toHaveCount(4);
    await page.click('[data-act="inboxLayout"][data-layout="list"]');
    await page.goto('portal/#/leads/all');
    await page.fill('#inbox-q', 'zzzz-no-such-client');
    await page.press('#inbox-q', 'Enter');
    await expect(main(page)).toContainText('No leads in this view');
  });

  test('bulk assign by a team leader: own team only, expired BRN never offered, agents cannot assign', async ({ page, context }) => {
    await signIn(page, 'U-CK-3');
    await page.goto('portal/#/leads/all');
    const ids = await page.locator('[data-act="selectLead"]:not([disabled])').evaluateAll((els) => els.slice(0, 2).map((e) => e.id));
    await tick(page, ids[0]);
    await tick(page, ids[1]);
    await expect(page.locator('.bp-bulk')).toContainText('2 selected');
    const options = await page.locator('#bulk-owner option').allInnerTexts();
    expect(options.join(' ')).not.toContain('Dmitri');
    expect(options.join(' ')).not.toContain('Priya');
    await page.selectOption('#bulk-owner', 'U-CK-12');
    await page.click('[data-act="bulkAssign"]');
    await expect(page.locator('#toast-root')).toContainText('2 leads assigned');
    const agent = await newTab(context, 'U-CK-10');
    await agent.goto('portal/#/leads/mine');
    await expect(agent.locator('[data-act="selectLead"]')).toHaveCount(0);
    await expect(agent.locator('.bp-viewbar')).not.toContainText('Unassigned');
  });

  test('privacy: another firm\'s client is invisible, and the same client at two firms is not a duplicate', async ({ page }) => {
    await signIn(page, 'U-PA-1');
    const s = await state(page);
    const ckTwin = s.leads.find((l: any) => l.firmId === 'F-CK' && l.crossFirmTwin);
    const paTwin = s.leads.find((l: any) => l.firmId === 'F-PA' && l.crossFirmTwin);
    expect(ckTwin.phone).toBe(paTwin.phone);
    expect(paTwin.duplicateOf).toBeNull();
    await page.goto('portal/#/leads/all');
    const ckOnly = s.leads.find((l: any) => l.firmId === 'F-CK' && !l.crossFirmTwin);
    await page.fill('#inbox-q', ckOnly.phone);
    await page.press('#inbox-q', 'Enter');
    await expect(main(page)).toContainText('No leads in this view');
    await page.goto(`portal/#/lead/${ckOnly.id}`);
    await expect(main(page)).toContainText('not visible to you');
    const ckDeal = s.deals.find((d: any) => d.firmId === 'F-CK');
    await page.goto(`portal/#/deal/${ckDeal.id}`);
    await expect(main(page)).toContainText('not visible to you');
  });

  test('an agent cannot open a colleague\'s lead', async ({ page }) => {
    await signIn(page, 'U-CK-10');
    const s = await state(page);
    const colleagues = s.leads.find((l: any) => l.firmId === 'F-CK' && l.ownerId && l.ownerId !== 'U-CK-10');
    await page.goto(`portal/#/lead/${colleagues.id}`);
    await expect(main(page)).toContainText('not visible to you');
  });
});

test.describe('P4 Lead workspace', () => {
  test('a lead is contacted, qualified and converted without leaving the page', async ({ page }) => {
    await signIn(page, 'U-CK-10');
    await page.click('[data-act="quickCapture"]');
    await page.fill('#qcName', 'Layla Darwish');
    await page.fill('#qcPhone', '050 812 3344');
    await page.selectOption('#qcLang', 'Arabic');
    await tick(page, 'qcConsent');
    await page.click('button:has-text("Save lead")');
    await expect(page).toHaveURL(/#\/lead\/L-/);
    const url = page.url();

    // Qualifying before any contact is refused with the reason.
    await page.click('[data-act="qualifyLead"]');
    await expect(page.locator('#toast-root')).toContainText('Speak to or message the client');

    // WhatsApp in Arabic from an approved template.
    await page.click('.bp-record-actions [data-act="composeMessage"]');
    await page.selectOption('#msgLang', 'Arabic');
    await expect(page.locator('#msgText')).toHaveAttribute('dir', 'rtl');
    await page.click('button:has-text("Send WhatsApp")');
    await expect(page.locator('#toast-root')).toContainText('WhatsApp sent');
    await expect(page.locator('.bp-timeline')).toContainText('WhatsApp ("First reply", Arabic)');

    // Call: blocked outside hours (demo switch available) or allowed; log the outcome.
    await page.click('.bp-record-actions [data-act="callLead"]');
    if (await modal(page).locator('text=Call blocked').count()) {
      await expect(modal(page)).toContainText('Calls are allowed 09:00');
      await page.click('[data-act="demoAllowCalls"]');
    }
    await page.click('button:has-text("Log call")');
    await expect(page.locator('#modal-errors')).toContainText('Choose the call outcome');
    await page.selectOption('#callOutcome', 'Answered');
    await page.fill('#callMinutes', '6');
    await page.fill('#callNote', 'Wants a 2BR for investment, cash, buying now.');
    await page.click('button:has-text("Log call")');
    await expect(page.locator('.bp-timeline')).toContainText('Call: answered, 6 min');

    // Lead Qualifier proposes the missing fields; the agent confirms.
    await page.click('[data-act="runQualifier"]');
    await expect(modal(page)).toContainText('Lead Qualifier');
    await page.click('button:has-text("Confirm values")');
    await expect(page.locator('.bp-timeline')).toContainText('Lead Qualifier values confirmed');
    await page.selectOption('#nd-area', 'Dubai Hills Estate');
    await page.click('#needs-form button[type="submit"]');
    await expect(page.locator('.bp-ready')).toContainText('Ready to qualify');
    await page.click('.bp-record-actions [data-act="qualifyLead"]');
    await expect(page.locator('.bp-record-title')).toContainText('Qualified');

    // Convert with co-broking: a bad ORN is caught in the modal, then the deal is created.
    await page.click('.bp-record-actions [data-act="convertLead"]');
    await page.fill('#cvValue', '1750000');
    await page.fill('#cvUnit', 'Tower A · 1204');
    await tick(page, 'cvCo');
    await page.fill('#cvCoFirm', 'Harbour View Estates');
    await page.fill('#cvCoOrn', '12');
    await page.click('button:has-text("Create deal")');
    await expect(page.locator('#modal-errors')).toContainText('ORN must be 4 to 6 digits');
    await page.fill('#cvCoOrn', '28810');
    await page.click('button:has-text("Create deal")');
    await expect(page).toHaveURL(/#\/deal\/D-/);
    await expect(main(page)).toContainText('Layla Darwish');
    await page.goto(url);
    await expect(page.locator('.bp-record-title')).toContainText('Converted');
  });

  test('do-not-call numbers can never be called, and WhatsApp needs consent', async ({ page }) => {
    await signIn(page, 'U-CK-1');
    const s = await state(page);
    const dnc = s.leads.find((l: any) => l.firmId === 'F-CK' && l.dnc && ['New', 'Contacted', 'Qualified'].includes(l.status));
    await page.goto(`portal/#/lead/${dnc.id}`);
    await page.click('.bp-record-actions [data-act="callLead"]');
    await expect(modal(page)).toContainText('do-not-call registry');
    await expect(modal(page).locator('[data-act="demoAllowCalls"]')).toHaveCount(0);
    await page.click('#modal-root [data-act="closeModal"]');
    const noConsent = s.leads.find((l: any) => l.firmId === 'F-CK' && !l.consent.whatsapp && l.email && ['Contacted', 'Qualified'].includes(l.status));
    await page.goto(`portal/#/lead/${noConsent.id}`);
    await page.click('.bp-record-actions [data-act="composeMessage"]');
    await page.selectOption('#msgChannel', 'WhatsApp');
    await expect(modal(page)).toContainText('No WhatsApp consent');
    await page.click('button:has-text("Send WhatsApp")');
    await expect(page.locator('#modal-errors')).toContainText('No WhatsApp consent');
  });
});

test.describe('P5 Pipeline and P6 Deal room', () => {
  test('a blocked drag explains exactly what is missing', async ({ page }) => {
    await signIn(page, 'U-CK-10');
    await page.goto('portal/#/pipeline');
    const s = await state(page);
    const deal = s.deals.find((d: any) => d.ownerId === 'U-CK-10' && d.stage === 'EOI');
    const card = page.locator(`[data-drag-deal="${deal.id}"]`);
    await card.dragTo(page.locator('[data-drop-stage="Booking"]'));
    await expect(modal(page)).toContainText("Can't move to Booking yet");
    await expect(modal(page)).toContainText('KYC verified by Compliance');
    await expect(modal(page)).toContainText('Booking deposit received');
    await page.click('#modal-root [data-act="closeModal"]');
    // Skipping two gates lists both stages.
    await card.locator('[data-act="openMoveDeal"]').click();
    await page.selectOption('#mvTo', 'SPA');
    await page.click('button:has-text("Move")');
    await expect(modal(page)).toContainText('To enter Booking');
    await expect(modal(page)).toContainText('To enter SPA signed');
    expect((await state(page)).deals.find((d: any) => d.id === deal.id).stage).toBe('EOI');
  });

  test('a deal cannot pass a gate until documents, KYC and payment are done', async ({ page, context }) => {
    await signIn(page, 'U-CK-10');
    const s = await state(page);
    const deal = s.deals.find((d: any) => d.ownerId === 'U-CK-10' && d.stage === 'EOI' && !d.documents.passport);
    const id = deal ? deal.id : s.deals.find((d: any) => d.ownerId === 'U-CK-10' && d.stage === 'EOI').id;
    await page.goto(`portal/#/deal/${id}/documents`);
    for (const key of ['passport', 'eid']) {
      if (await page.locator(`#doc-${key} [data-act="removeDealDoc"]`).count()) await page.click(`#doc-${key} [data-act="removeDealDoc"]`);
    }
    // Document Reader: a name mismatch is caught before anyone can confirm it.
    await page.setInputFiles('input[data-key="passport"]', { name: 'passport-mismatch.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await expect(page.locator('#doc-passport')).toContainText('Client on the deal');
    await page.click('#doc-passport button:has-text("Confirm fields")');
    await expect(page.locator('#toast-root')).toContainText('does not match');
    await page.setInputFiles('input[data-key="passport"]', { name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await page.click('#doc-passport button:has-text("Confirm fields")');
    await page.setInputFiles('input[data-key="eid"]', { name: 'eid-expired.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
    await page.click('#doc-eid button:has-text("Confirm fields")');
    await expect(page.locator('#toast-root')).toContainText('Emirates ID has expired');
    await page.setInputFiles('input[data-key="eid"]', { name: 'eid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
    await page.click('#doc-eid button:has-text("Confirm fields")');
    await expect(page.locator('#doc-eid')).toContainText('Confirmed');

    // The agent submits KYC but cannot verify it.
    await page.goto(`portal/#/deal/${id}/kyc`);
    await page.click('[data-act="submitKyc"]');
    await expect(main(page)).toContainText('Waiting for Compliance');
    await expect(page.locator('[data-act="verifyKyc"]')).toHaveCount(0);
    await page.click('.bp-gate-col [data-act="moveDealTo"]');
    await expect(modal(page)).toContainText('KYC verified by Compliance');
    await page.click('#modal-root [data-act="closeModal"]');

    // Compliance screens and verifies in another tab.
    const huda = await newTab(context, 'U-CK-6');
    await expect(huda.locator('#main')).toContainText('Waiting for Compliance');
    await huda.goto(`portal/#/deal/${id}/kyc`);
    await huda.click('[data-act="verifyKyc"]');
    await expect(huda.locator('#toast-root')).toContainText('Run the watchlist screening first');
    await huda.click('[data-act="runScreening"]');
    await huda.click('[data-act="verifyKyc"]');
    await expect(huda.locator('#toast-root')).toContainText('KYC verified');

    // Still blocked on the deposit; record it, then the move goes through.
    await page.goto(`portal/#/deal/${id}`);
    await page.click('.bp-gate-col [data-act="moveDealTo"]');
    await expect(modal(page)).toContainText('Booking deposit received');
    await expect(modal(page)).not.toContainText('KYC verified by Compliance');
    await page.click('#modal-root [data-act="closeModal"]');
    await page.goto(`portal/#/deal/${id}/payments`);
    await page.locator('form[data-submit="recordPayment"]').first().locator('select').selectOption('Bank transfer');
    await page.locator('form[data-submit="recordPayment"]').first().locator('button').click();
    await expect(page.locator('#toast-root')).toContainText('Payment recorded');
    await page.click('.bp-gate-col [data-act="moveDealTo"]');
    await expect(page.locator('#toast-root')).toContainText('Moved to Booking');
    await expect(page.locator('.slds-path__item.slds-is-current')).toContainText('Booking');
    // An agent cannot move a deal back.
    await page.click('.slds-path__item.slds-is-complete [data-act="moveDealTo"]');
    await expect(modal(page)).toContainText('Only a team leader or above can move a deal back');
  });

  test('a watchlist match blocks KYC until Compliance clears it, and cash triggers a REAR draft', async ({ page, context }) => {
    await signIn(page, 'U-CK-1');
    const s = await state(page);
    const vik = s.deals.find((d: any) => d.clientName === 'Viktor Brankovich');
    await page.goto(`portal/#/deal/${vik.id}/kyc`);
    await page.click('[data-act="runScreening"]');
    await expect(page.locator('#toast-root')).toContainText('Possible match with Viktor Brankovic');
    await expect(main(page)).toContainText('Demo sanctions list');
    await expect(main(page)).toContainText('REAR report is needed');
    const agent = await newTab(context, vik.ownerId);
    await agent.goto(`portal/#/deal/${vik.id}/kyc`);
    await expect(agent.locator('#main')).toContainText('Compliance must review this match');
    await expect(agent.locator('[data-act="clearScreeningOpen"]')).toHaveCount(0);
    const huda = await newTab(context, 'U-CK-6');
    await huda.goto(`portal/#/deal/${vik.id}/kyc`);
    await huda.click('[data-act="draftRear"]');
    await expect(huda.locator('.bp-rear')).toContainText('REAR draft for the AML officer');
    await huda.click('[data-act="clearScreeningOpen"]');
    await huda.fill('#csNote', 'short');
    await huda.click('button:has-text("Clear match")');
    await expect(huda.locator('#modal-errors')).toContainText('at least 10 characters');
    await huda.fill('#csNote', 'Different date of birth and nationality from the listed person.');
    await huda.click('button:has-text("Clear match")');
    await expect(huda.locator('#main')).toContainText('Cleared as a false positive by Huda Karim');
  });

  test('commission: finance advances it, agents cannot change terms', async ({ page, context }) => {
    await signIn(page, 'U-CK-1');
    const s = await state(page);
    const won = s.deals.find((d: any) => d.firmId === 'F-CK' && d.stage === 'Won' && d.commission.status !== 'Paid out');
    await page.goto(`portal/#/deal/${won.id}/commission`);
    await expect(main(page)).toContainText('Firm net');
    await expect(main(page)).toContainText('VAT 5%');
    await page.click('[data-act="advanceCommission"]');
    await expect(page.locator('#toast-root')).toContainText('Commission updated');
    const owner = await newTab(context, won.ownerId);
    await owner.goto(`portal/#/deal/${won.id}/commission`);
    await expect(owner.locator('[data-act="editCommissionOpen"]')).toHaveCount(0);
    await expect(owner.locator('#main')).toContainText('Commission terms are set by finance');
  });
});
