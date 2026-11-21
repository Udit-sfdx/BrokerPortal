import { test, expect, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL = pathToFileURL(path.resolve(HERE, '..', 'dist', 'index.html')).href;

// Collects page errors so every test can assert the page stayed healthy.
let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL);
  await expect(page.locator('.bp-header')).toBeVisible();
});

test.afterEach(() => {
  expect(errors, 'no JavaScript errors').toEqual([]);
});

const ev = <T = unknown>(page: Page, js: string) => page.evaluate(js) as Promise<T>;
const guide = async (page: Page, step: number) => {
  await page.locator('[data-act="guideRun"]').nth(step - 1).click();
  await page.waitForTimeout(350);
};
const modalErrors = (page: Page) => page.locator('#modal-errors');

test.describe('Lead capture and routing', () => {
  test('portal lead is captured, routed and shown to the receiving agent', async ({ page }) => {
    await guide(page, 1);
    expect(await ev(page, 'leadById(S.recId).name')).toBe('James Whitmore');
    const owner = await ev<string>(page, 'leadById(S.recId).ownerId');
    expect(owner).toBeTruthy();
    expect(await ev(page, 'S.persona')).toBe(owner);
    await expect(page.getByText('Routing decision')).toBeVisible();
    await expect(page.locator('.bp-trace').first()).toBeVisible();
  });

  test('repeat enquiry is merged, not duplicated', async ({ page }) => {
    await guide(page, 2);
    expect(await ev(page, 'leadById(S.recId).name')).toBe('Ahmed Al Mansoori');
    expect(await ev(page, 'leadById(S.recId).attributions.length')).toBe(2);
    expect(await ev(page, "S.leads.filter(l => l.phoneN === '+971502345678').length")).toBe(1);
  });

  test('agent with an expired BRN is skipped', async ({ page }) => {
    await guide(page, 3);
    expect(await ev(page, 'leadById(S.recId).ownerId')).toBe('u_lena');
    await expect(page.locator('main')).toContainText('BRN 45402 expired');
  });

  test('lead nobody can take goes to the unassigned queue', async ({ page }) => {
    await ev(page, "S.persona = 'u_rania'; simulate('com')");
    expect(await ev(page, 'leadById(S.recId).ownerId')).toBeNull();
  });

  test('manual lead entry validates required fields', async ({ page }) => {
    await ev(page, "S.persona = 'u_rania'; go('leads')");
    await page.click('[data-act="newLead"]');
    await page.click('[data-act="saveLead"]');
    await expect(modalErrors(page)).toContainText('Name is required');
    await page.fill('#nl-name', 'Test Person');
    await page.fill('#nl-phone', '12');
    await page.click('[data-act="saveLead"]');
    await expect(modalErrors(page)).toContainText('valid international number');
  });

  test('CSV import requires a source and reports created, merged and rejected rows', async ({ page }) => {
    await ev(page, "S.persona = 'u_rania'; go('leads')");
    await page.click('[data-act="importCsv"]');
    await page.click('[data-act="runImport"]');
    await expect(modalErrors(page)).toContainText('Declare the source');
    await page.selectOption('#csv-channel', 'Referral');
    await page.click('[data-act="runImport"]');
    const result = page.locator('#csv-result');
    await expect(result).toContainText('2 created');
    await expect(result).toContainText('1 merged');
    await expect(result).toContainText('1 rejected');
  });

  test('CSV import rejects a file without the required columns', async ({ page }) => {
    await ev(page, "S.persona = 'u_rania'; go('leads')");
    await page.click('[data-act="importCsv"]');
    await page.selectOption('#csv-channel', 'Referral');
    await page.fill('#csv-text', 'name,email\nA,a@example.com');
    await page.click('[data-act="runImport"]');
    await expect(modalErrors(page)).toContainText('Missing columns: phone, line_of_business');
  });
});

test.describe('SLA and telemarketing guard', () => {
  test('SLA breach escalates, then re-assigns, then the clock slows down', async ({ page }) => {
    await guide(page, 4);
    await expect.poll(() => ev(page, 'leadById(S.story.rohit).escalated || leadById(S.story.rohit).reassignCount > 0'), { timeout: 8000 }).toBe(true);
    await expect.poll(() => ev(page, 'leadById(S.story.rohit).reassignCount'), { timeout: 15000 }).toBeGreaterThanOrEqual(1);
    expect(await ev(page, 'S.speed')).toBe(1);
  });

  test('call outside 09:00–18:00 is blocked and logged', async ({ page }) => {
    await guide(page, 5);
    await expect(page.locator('.slds-modal__title', { hasText: 'Call blocked' })).toBeVisible();
    expect(await ev(page, "leadById(S.story.chloe).activities[0].type")).toBe('block');
  });

  test('call to a DNC number is blocked during the day', async ({ page }) => {
    await ev(page, "S.persona = 'u_rania'; simulate('dnc'); jumpTo('10:30'); render()");
    expect(await ev(page, 'leadById(S.recId).dnc')).toBe(true);
    await page.click('[data-act="call"]');
    await expect(page.locator('#modal-root')).toContainText('Do Not Call');
  });

  test('call outcome is required, and a refusal blocks a second call the same day', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; jumpTo('10:30'); go('lead', S.story.rohit)");
    await page.click('[data-act="call"]');
    await page.click('[data-act="logCall"]');
    await expect(modalErrors(page)).toContainText('Choose the call outcome');
    await page.selectOption('#call-outcome', 'refused');
    await page.click('[data-act="logCall"]');
    await page.click('[data-act="call"]');
    await expect(page.locator('#modal-root')).toContainText('refused a call today');
  });
});

test.describe('Conversion and deal gates', () => {
  test('convert validates input and creates a deal with co-broking', async ({ page }) => {
    await guide(page, 6);
    await expect(page.locator('.slds-modal__title', { hasText: 'Convert' })).toBeVisible();
    await page.fill('#cv-unit', '');
    await page.click('[data-act="saveConvert"]');
    await expect(modalErrors(page)).toContainText('Unit is required');
    await page.fill('#cv-unit', 'B-2210');
    await page.click('label[for="cv-cob"]');
    await page.fill('#cv-cobfirm', 'Harbour Lane Realty');
    await page.fill('#cv-cobsplit', '120');
    await page.click('[data-act="saveConvert"]');
    await expect(modalErrors(page)).toContainText('between 1 and 99');
    await page.fill('#cv-cobsplit', '40');
    await page.click('[data-act="saveConvert"]');
    expect(await ev(page, 'S.view')).toBe('deal');
    expect(await ev(page, 'dealById(S.recId).coBroker.split')).toBe(40);
    expect(await ev(page, 'leadById(S.story.chloe).status')).toBe('Converted');
  });

  test('a lead that is not qualified cannot be converted', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; go('lead', S.story.rohit)");
    await expect(page.locator('[data-act="convert"]')).toBeDisabled();
  });

  test('pipeline drag is blocked by the document gate and stages cannot be skipped', async ({ page }) => {
    await guide(page, 7);
    const id = await ev<string>(page, 'S.story.hassanDeal');
    await page.locator(`[data-drag="${id}"]`).dragTo(page.locator('[data-drop="5"]'));
    expect(await ev(page, 'dealById(S.story.hassanDeal).stageIdx')).toBe(4);
    await page.locator(`[data-drag="${id}"]`).dragTo(page.locator('[data-drop="7"]'));
    expect(await ev(page, 'dealById(S.story.hassanDeal).stageIdx')).toBe(4);
  });

  test('upload + KYC opens the gate', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; go('deal', S.story.hassanDeal)");
    const chooser = page.waitForEvent('filechooser');
    await page.click('[data-act="uploadDoc"][data-doc="Reservation form"]');
    await (await chooser).setFiles({ name: 'reservation.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect.poll(() => ev(page, "!!dealById(S.story.hassanDeal).docs['Reservation form']")).toBe(true);
    await page.click('[data-act="advance"]');
    expect(await ev(page, 'dealById(S.story.hassanDeal).stageIdx')).toBe(4);
    for (const doc of ['Emirates ID / visa', 'Source of funds declaration']) await page.click(`label[for="kyc-${doc}"]`);
    await page.selectOption('#kyc-screen', 'Clear');
    await page.selectOption('#kyc-risk', 'Low');
    await page.click('[data-act="advance"]');
    expect(await ev(page, 'dealById(S.story.hassanDeal).stageIdx')).toBe(5);
  });

  test('payments must be recorded in order and the threshold is detected', async ({ page }) => {
    await guide(page, 8);
    await page.locator('[data-act="markPaid"]').nth(1).click();
    expect(await ev(page, 'dealById(S.story.hassanDeal).payments[2].status')).not.toBe('Paid');
    await page.locator('[data-act="markPaid"]').first().click();
    expect(await ev(page, 'paidPct(dealById(S.story.hassanDeal))')).toBe(30);
  });

  test('handover result needs evidence', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; go('deal', S.story.hassanDeal, 'handover')");
    await page.selectOption('[data-act="handoverResult"][data-idx="0"]', 'Pass');
    expect(await ev(page, 'dealById(S.story.hassanDeal).handover[0].result')).toBe('Pending');
    await page.fill('[data-act="handoverEvidence"][data-idx="0"]', 'AML-2026-118');
    await page.locator('[data-act="handoverEvidence"][data-idx="0"]').dispatchEvent('change');
    await page.selectOption('[data-act="handoverResult"][data-idx="0"]', 'Pass');
    expect(await ev(page, 'dealById(S.story.hassanDeal).handover[0].result')).toBe('Pass');
  });

  test('commission cannot be claimed before the commission stage', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; go('deal', S.story.hassanDeal, 'commission')");
    await expect(page.locator('[data-act="commNext"]')).toBeDisabled();
    await expect(page.getByText('Firm net commission')).toBeVisible();
  });
});

test.describe('Campaigns, dashboards and visibility', () => {
  test('campaign cannot go live without a valid permit', async ({ page }) => {
    await guide(page, 11);
    await page.click('[data-act="activateCampaign"]');
    expect(await ev(page, "campaignById('C-103').status")).toBe('Draft');
    await page.click('[data-act="addPermit"]');
    await page.fill('#pm-no', '12345');
    await page.click('[data-act="savePermit"]');
    await expect(modalErrors(page)).toContainText('7 digits');
    await page.fill('#pm-no', '7134002');
    await page.fill('#pm-exp', '2020-01-01');
    await page.click('[data-act="savePermit"]');
    await expect(modalErrors(page)).toContainText('must be in the future');
    await page.fill('#pm-exp', '2027-01-31');
    await page.click('[data-act="savePermit"]');
    await page.click('[data-act="activateCampaign"]');
    expect(await ev(page, "campaignById('C-103').status")).toBe('Active');
  });

  test('dashboard renders for the sales director', async ({ page }) => {
    await guide(page, 10);
    await expect(page.getByText('Speed to lead (median)')).toBeVisible();
    await expect(page.getByText('Agent leaderboard')).toBeVisible();
  });

  test('an agent cannot open another agent’s lead', async ({ page }) => {
    await ev(page, "S.persona = 'u_sara'; go('lead', S.story.ahmed)");
    await expect(page.locator('main')).toContainText('No access');
  });

  test('agents do not see Setup, Campaigns or Dashboards', async ({ page }) => {
    await expect(page.locator('[data-act="nav"][data-id="setup"]')).toHaveCount(0);
    await expect(page.locator('[data-act="nav"][data-id="campaigns"]')).toHaveCount(0);
    await expect(page.locator('[data-act="nav"][data-id="dashboard"]')).toHaveCount(0);
  });
});

test.describe('Firm admin setup', () => {
  test.beforeEach(async ({ page }) => { await guide(page, 12); });

  test('routing dry run sends commercial leads to the queue', async ({ page }) => {
    await page.selectOption('#rt-lob', 'Commercial');
    await expect(page.locator('main')).toContainText('unassigned queue');
  });

  test('the licence rule cannot be switched off', async ({ page }) => {
    await expect(page.locator('[data-act="routingToggle"][data-idx="0"]')).toBeDisabled();
  });

  test('SLA values are validated', async ({ page }) => {
    await page.click('[data-act="setupSec"][data-id="sla"]');
    await page.fill('#sla-first', '0');
    await page.click('[data-act="saveSla"]');
    await expect(modalErrors(page)).toContainText('between 1 and 240');
  });

  test('Option B switch hides and restores Campaigns', async ({ page }) => {
    await page.click('[data-act="setupSec"][data-id="packages"]');
    const toggle = page.locator('[data-act="featOptionB"]').locator('xpath=..');
    await toggle.click();
    await expect(page.locator('[data-act="nav"][data-id="campaigns"]')).toHaveCount(0);
    await page.locator('[data-act="featOptionB"]').locator('xpath=..').click();
    await expect(page.locator('[data-act="nav"][data-id="campaigns"]')).toHaveCount(1);
  });

  test('commission splits above 100% are rejected', async ({ page }) => {
    await page.click('[data-act="setupSec"][data-id="commission"]');
    await page.fill('#split-agent', '95');
    await page.locator('#split-agent').dispatchEvent('change');
    expect(await ev(page, 'S.cfg.splits.agent')).toBe(50);
  });

  test('recording a BRN renewal makes the agent routable again', async ({ page }) => {
    await page.click('[data-act="setupSec"][data-id="agents"]');
    await page.click('[data-act="renewBrn"][data-id="u_dmitri"]');
    expect(await ev(page, 'S.users.u_dmitri.brnExpiry > S.now')).toBe(true);
  });

  test('stage names must be unique and non-empty', async ({ page }) => {
    await page.click('[data-act="setupSec"][data-id="stages"]');
    const name = page.locator('[data-act="stageField"][data-idx="1"][data-key="name"]');
    await name.fill('Qualified');
    await name.dispatchEvent('change');
    expect(await ev(page, "S.cfg.stages['Off-plan'][1].name")).toBe('Project pitch');
    await name.fill('   ');
    await name.dispatchEvent('change');
    expect(await ev(page, "S.cfg.stages['Off-plan'][1].name")).toBe('Project pitch');
  });
});

test('reset restores the starting data', async ({ page }) => {
  await guide(page, 1);
  await page.click('[data-act="reset"]');
  expect(await ev(page, "S.leads.some(l => l.name === 'James Whitmore')")).toBe(false);
});
