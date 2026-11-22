import { test, expect, Page, BrowserContext } from '@playwright/test';

// Drops 3 and 4: Inventory, Campaign studio, Team performance, Commission, Compliance centre, Firm settings,
// Copilot, command palette, phone layout, operator health. One test per acceptance line plus negatives.

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/copilot\.php/.test(m.text())) errors.push(`console: ${m.text()}`); });
});
test.afterEach(() => expect(errors, 'no JavaScript errors').toEqual([]));

async function signIn(page: Page, userId: string) {
  await page.goto('portal/');
  await page.waitForSelector('#email');
  await page.click(`[data-act="demoUser"][data-id="${userId}"]`);
  await expect(page.locator('.bp-shell')).toBeVisible();
}
async function newTab(context: BrowserContext, userId: string) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(`pageerror (tab 2): ${e.message}`));
  await signIn(p, userId);
  return p;
}
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bp.state')!));
const main = (page: Page) => page.locator('#main');
const modal = (page: Page) => page.locator('#modal-root');
const toastBox = (page: Page) => page.locator('#toast-root');

test('P7 an agent sends a matching unit to a client in two clicks', async ({ page }) => {
  await signIn(page, 'U-CK-10');
  await page.goto('portal/#/inventory');
  const options = await page.locator('#inv-lead option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
  let found = false;
  for (const id of options) {
    await page.selectOption('#inv-lead', id);
    if (await page.locator('[data-act="sendUnit"]').count()) { found = true; break; }
  }
  expect(found, 'at least one of Sara\'s leads has a matching unit').toBe(true);
  await expect(page.locator('.bp-match-why').first()).toContainText(/as asked|budget|In /);
  // Click 1: Send. Click 2: Send WhatsApp (or email when there is no WhatsApp consent).
  await page.locator('[data-act="sendUnit"]').first().click();
  await expect(page.locator('#msgText')).toHaveValue(/AED/);
  const sendBtn = modal(page).locator('button[type="submit"]');
  const label = await sendBtn.innerText();
  if (/WhatsApp/.test(label) && await modal(page).locator('text=No WhatsApp consent').count()) {
    await page.selectOption('#msgChannel', 'Email');
  }
  await modal(page).locator('button[type="submit"]').click();
  await expect(toastBox(page)).toContainText(/sent/);
  // Other firms' stock never shows.
  const s = await state(page);
  const rows = await page.locator('.bp-unit-table tbody tr').count();
  expect(rows).toBeGreaterThan(0);
  expect(s.units.filter((u: any) => u.firmId !== 'F-CK').length).toBeGreaterThan(0);
  await expect(main(page)).toContainText('120 units and listings');
});

test('P8 a campaign cannot go live without a valid permit and an approved creative', async ({ page, context }) => {
  await signIn(page, 'U-CK-5');
  const s = await state(page);
  const harbor = s.campaigns.find((c: any) => c.name === 'Harbor Lights Q4');
  await page.goto(`portal/#/campaigns/${harbor.id}`);
  await expect(main(page)).toContainText("Can't go live yet");
  await page.click('[data-act="campaignStatus"][data-status="Live"]');
  await expect(toastBox(page)).toContainText('Add the DLD ad permit');
  await page.click('[data-act="permitOpen"]');
  await page.fill('#pmNo', '12');
  await page.click('button:has-text("Save permit")');
  await expect(page.locator('#modal-errors')).toContainText('6 to 10 digits');
  await page.fill('#pmNo', '7104452');
  await page.click('button:has-text("Save permit")');
  await expect(page.locator('#modal-errors')).toContainText('already used');
  await page.fill('#pmNo', '7200099');
  await page.click('button:has-text("Save permit")');
  await page.click('[data-act="campaignStatus"][data-status="Live"]');
  await expect(toastBox(page)).toContainText('approved by the owner or a director');
  // Marketing Analyst drafts Arabic copy carrying the permit number; marketing cannot approve it.
  await page.click('[data-act="creativeOpen"][data-lang="Arabic"]');
  await expect(page.locator('#crBody')).toHaveValue(/7200099/);
  await page.click('button:has-text("Save draft")');
  await expect(page.locator('[data-act="approveCreative"]')).toHaveCount(0);
  const owner = await newTab(context, 'U-CK-1');
  await owner.goto(`portal/#/campaigns/${harbor.id}`);
  await owner.locator('[data-act="approveCreative"]').first().click();
  await expect(owner.locator('#toast-root')).toContainText('Creative approved');
  await page.reload();
  await page.click('[data-act="campaignStatus"][data-status="Live"]');
  await expect(toastBox(page)).toContainText('Harbor Lights Q4: Live');
  // Option A firms have no campaigns.
  const pa = await newTab(context, 'U-PA-1');
  await expect(pa.locator('.bp-nav')).not.toContainText('Campaigns');
});

test('P9 a team leader re-assigns a stalled lead from Team performance; agents have no access', async ({ page, context }) => {
  await signIn(page, 'U-CK-3');
  await page.goto('portal/#/team');
  await expect(main(page)).toContainText('Leaderboard');
  await expect(main(page)).not.toContainText('Priya Nair');
  const form = page.locator('form[data-submit="queueAssign"]').first();
  await expect(form).toBeVisible();
  const leadId = await form.locator('input[name="leadId"]').inputValue();
  const to = await form.locator('select option').nth(1).getAttribute('value');
  await form.locator('select').selectOption(to!);
  await form.locator('button').click();
  await expect(toastBox(page)).toContainText('Lead re-assigned');
  expect((await state(page)).leads.find((l: any) => l.id === leadId).ownerId).toBe(to);
  // Coaching note with the AI suggestion pre-filled.
  await page.locator('[data-act="coachOpen"]').first().click();
  await expect(page.locator('#coachText')).not.toHaveValue('');
  await page.click('button:has-text("Save and notify")');
  await expect(toastBox(page)).toContainText('Coaching note saved');
  const agent = await newTab(context, 'U-CK-10');
  await expect(agent.locator('.bp-nav')).not.toContainText('Team performance');
  await agent.goto('portal/#/team');
  await expect(agent.locator('#main')).toContainText('Your next 3 actions');
});

test('P10 every AED of commission traces to its deal and campaign', async ({ page, context }) => {
  await signIn(page, 'U-CK-1');
  await page.goto('portal/#/commission');
  await expect(main(page)).toContainText('Who owes us');
  const campaignLinks = page.locator('.bp-ledger a[href*="#/campaigns/"]');
  expect(await campaignLinks.count()).toBeGreaterThan(0);
  const rows = page.locator('.bp-ledger tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) await expect(rows.nth(i).locator('a[href*="#/deal/"]')).toHaveCount(1);
  await page.selectOption('#ledger-status', 'Invoiced');
  if (await page.locator('[data-act="chaseInvoice"]').count()) {
    await page.locator('[data-act="chaseInvoice"]').first().click();
    await expect(toastBox(page)).toContainText('Reminder sent');
  }
  const agent = await newTab(context, 'U-CK-10');
  await agent.goto('portal/#/commission');
  await expect(agent.locator('#main')).not.toContainText('Who owes us');
});

test('P11 expiring licences and permits show 30 days ahead, and the privacy check blocks all 10 attempts', async ({ page }) => {
  await signIn(page, 'U-CK-6');
  await page.goto('portal/#/compliance');
  await expect(main(page)).toContainText('Expiring in the next 30 days');
  await expect(main(page)).toContainText('Palmyra Gardens VIP preview (7109918)');
  await expect(main(page)).toContainText('Dmitri Volkov');
  await expect(main(page)).toContainText('KYC to review');
  await page.fill('#scrName', 'Marta Kolesnik');
  await page.click('button:has-text("Screen")');
  await expect(main(page)).toContainText('Possible match');
  await page.click('[data-act="runPrivacyCheck"]');
  await expect(modal(page)).toContainText('Privacy check: 10 of 10 blocked');
  await expect(modal(page)).not.toContainText('NOT blocked');
});

test('P12 every rule changes behaviour without code', async ({ page, context }) => {
  await signIn(page, 'U-CK-1');
  await page.goto('portal/#/settings/general');
  await page.fill('#setSla', '30');
  await page.click('form[data-submit="saveSla"] button');
  await expect(toastBox(page)).toContainText('SLAs saved');
  await page.goto('portal/#/leads/all');
  await page.click('[data-act="simulateLead"]');
  const s = await state(page);
  const newest = s.leads[s.leads.length - 1];
  expect(newest.slaDueAt - newest.createdAt).toBe(30 * 60_000);
  // Gate: KYC and screening are locked; the booking deposit can be dropped from the Booking gate.
  await page.goto('portal/#/settings/pipelines/Off-plan');
  const booking = page.locator('form[data-submit="saveGate"]').filter({ hasText: 'To enter Booking' });
  await expect(booking.locator('input[name="g:kyc"]')).toBeDisabled();
  await booking.locator('label[for="g-Booking-pay:booking"]').click();
  await booking.locator('button[type="submit"]').click();
  await expect(toastBox(page)).toContainText('Gate saved');
  const deal = (await state(page)).deals.find((d: any) => d.type === 'Off-plan' && d.stage === 'EOI' && d.firmId === 'F-CK');
  await page.goto(`portal/#/deal/${deal.id}`);
  await expect(page.locator('.bp-gate-list')).not.toContainText('Booking deposit');
  await expect(page.locator('.bp-gate-list')).toContainText('KYC verified');
  // Templates reject unknown placeholders.
  await page.goto('portal/#/settings/templates');
  const intro = page.locator('form[data-submit="saveTemplate"]').first();
  await intro.locator('textarea[name="en"]').fill('Hi {name}');
  await intro.locator('button[type="submit"]').click();
  await expect(toastBox(page)).toContainText('unknown placeholder');
  // Only the owner sees settings.
  const dir = await newTab(context, 'U-CK-2');
  await expect(dir.locator('.bp-nav')).not.toContainText('Firm settings');
});

test('P13 the Copilot answers from own data, refuses other firms, and asks before re-assigning', async ({ page }) => {
  await signIn(page, 'U-CK-3');
  await page.click('.bp-copilot-btn');
  await page.fill('#copilot-q', 'How many leads does Palm Arc have?');
  await page.press('#copilot-q', 'Enter');
  await expect(page.locator('.bp-msg-bot.refused')).toContainText("I can't help with Palm Arc Properties");
  await page.fill('#copilot-q', 'Which deals are at risk?');
  await page.press('#copilot-q', 'Enter');
  await expect(page.locator('.bp-msg-bot').last()).toContainText(/at risk|on track/);
  const s = await state(page);
  const rania = s.users.find((u: any) => u.id === 'U-CK-3');
  const lead = s.leads.find((l: any) => ['New', 'Contacted', 'Qualified'].includes(l.status) && l.ownerId && l.ownerId !== 'U-CK-11' && s.users.find((u: any) => u.id === l.ownerId).teamId === rania.teamId);
  await page.fill('#copilot-q', `re-assign ${lead.name} to Omar`);
  await page.press('#copilot-q', 'Enter');
  expect((await state(page)).leads.find((l: any) => l.id === lead.id).ownerId, 'nothing changes before confirming').toBe(lead.ownerId);
  await page.click('[data-act="copilotConfirm"]');
  await expect(toastBox(page)).toContainText('Logged with your approval');
  const after = await state(page);
  expect(after.leads.find((l: any) => l.id === lead.id).ownerId).toBe('U-CK-11');
  expect(after.audit.some((a: any) => a.action === 'Copilot action')).toBe(true);
});

test('P14 Ctrl+K understands phrases and never returns another firm\'s records', async ({ page }) => {
  await signIn(page, 'U-CK-1');
  await page.keyboard.press('Control+k');
  await page.fill('#cmdk-q', '2BR leads from Meta this month');
  await expect(page.locator('#cmdk-results')).toContainText('Understood: 2BR · Meta ads · this month');
  await page.fill('#cmdk-q', 'pipeline');
  await page.press('#cmdk-q', 'Enter');
  await expect(page).toHaveURL(/#\/pipeline/);
  const s = await state(page);
  const paPhone = s.leads.find((l: any) => l.firmId === 'F-PA' && !l.crossFirmTwin).phone;
  await page.keyboard.press('Control+k');
  await page.fill('#cmdk-q', paPhone);
  await expect(page.locator('#cmdk-results')).toContainText('Nothing found in Crescent Key Realty');
});

test('phone: bottom bar, floating quick capture and no sideways scrolling at 390 px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await signIn(page, 'U-CK-10');
  await expect(page.locator('.bp-bottom')).toBeVisible();
  await expect(page.locator('.bp-side')).not.toBeInViewport();
  for (const route of ['#/', '#/leads', '#/pipeline']) {
    await page.goto(`portal/${route}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scroll on ${route}`).toBeLessThanOrEqual(391);
  }
  await page.click('.bp-fab');
  await expect(page.locator('#qcName')).toBeVisible();
  await page.click('#modal-root [data-act="closeModal"]');
  await page.click('.bp-menu-btn');
  await expect(page.locator('.bp-side')).toBeInViewport();
  await ctx.close();
});

test('operator sees health and churn risk from counts only', async ({ page }) => {
  await page.goto('console/');
  await page.click('text=Ananya Iyer');
  await page.goto('console/#/firm/F-CK');
  await expect(main(page)).toContainText('Health and churn risk');
  await expect(main(page)).toContainText('Summary from counts only');
  const s = await state(page);
  const someLead = s.leads.find((l: any) => l.firmId === 'F-CK');
  await expect(main(page)).not.toContainText(someLead.name);
});
