import { test, expect, Page } from '@playwright/test';

// Drop 1: request to join, invite sign-up with documents, operator review, owner setup, people.

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
});
test.afterEach(() => expect(errors, 'no JavaScript errors').toEqual([]));

const body = (page: Page) => page.locator('body');

async function upload(page: Page, key: string, name: string) {
  await page.setInputFiles(`input[data-doc="${key}"]`, { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
  await expect(page.locator(`#confirm-${key}`)).toBeAttached({ timeout: 5000 });
}

async function signUpMarinaGate(page: Page, licence = 'DED-1500321') {
  await page.goto('join/');
  await page.fill('#inviteCode', 'mgr7q2k');
  await page.click('text=Start sign-up');
  await expect(body(page)).toContainText('Set up your firm');
  await page.fill('#mobile', '050 771 3390');
  await page.click('text=Send code');
  await expect(page.locator('#toast-root')).toContainText('Your code is');
  const code = (await page.locator('#toast-root').innerText()).match(/(\d{6})/)![1];
  await page.fill('#mobileCode', code);
  await page.click('button:has-text("Verify")');
  await expect(body(page)).toContainText('Mobile verified');
  await page.fill('#password', 'MarinaGate2026');
  await page.fill('#confirm', 'MarinaGate2026');
  await page.click('button:has-text("Continue")');
  await page.fill('#address', 'Office 1101, Marina Gate 2');
  await page.fill('#tradeLicence', licence);
  await page.fill('#orn', '33012');
  await page.fill('#agents', '6');
  await page.click('button:has-text("Continue")');
  for (const [key, name] of [['tradeLicence', 'licence.pdf'], ['ornCertificate', 'orn.pdf'], ['ownerEid', 'eid.jpg']]) await upload(page, key, name);
  for (const key of ['tradeLicence', 'ornCertificate', 'ownerEid']) await page.click(`label[for="confirm-${key}"]`);
  await page.click('button:has-text("Continue")');
  await page.click('label[for="terms"]');
  await page.click('label[for="dpa"]');
  await page.click('button:has-text("Submit for verification")');
}

test.describe('Join page', () => {
  test('expired, used and unknown invite codes are refused', async ({ page }) => {
    await page.goto('join/');
    for (const [code, text] of [['HBV2M8D', 'expired'], ['OPP5X9M', 'already been used'], ['ZZZZZZZ', 'not valid']]) {
      await page.fill('#inviteCode', code);
      await page.click('text=Start sign-up');
      await expect(body(page)).toContainText(text);
      if (!page.url().endsWith('join/#/') && !page.url().endsWith('join/')) await page.goto('join/');
    }
  });

  test('request to join validates and lands in the sales queue', async ({ page }) => {
    await page.goto('join/#/request');
    await page.click('button:has-text("Send request")');
    await expect(body(page)).toContainText('Firm name is required');
    await page.fill('#firmName', 'Azure Coast Realty');
    await page.fill('#contactName', 'Lina Haddad');
    await page.fill('#agents', '4');
    await page.fill('#email', 'lina@azurecoast.example');
    await page.fill('#phone', '+971 50 123 4567');
    await page.click('button:has-text("Send request")');
    await expect(body(page)).toContainText('Request received');
  });

  test('sign-up checks step by step, then submits with the verification popup', async ({ page }) => {
    await page.goto('join/#/invite/MGR7Q2K');
    await page.click('button:has-text("Continue")');
    await expect(body(page)).toContainText('Enter a valid mobile number');
    await signUpMarinaGate(page);
    await expect(page.locator('#modal-root')).toContainText('need verification');
    await expect(page.locator('#modal-root')).toContainText('verified', { timeout: 5000 });
    await page.click('text=View registration status');
    await expect(body(page)).toContainText('ThinkVibes review');
  });

  test('a licence already registered fails the duplicate check', async ({ page }) => {
    await signUpMarinaGate(page, 'DED-1048572');
    await expect(body(page)).toContainText('already registered');
  });
});

test.describe('Operator console and owner setup', () => {
  test('operator approves, owner sets up the firm and invites an agent', async ({ page, context }) => {
    await signUpMarinaGate(page);
    await expect(page.locator('#modal-root')).toContainText('verified', { timeout: 5000 });

    const consolePage = await context.newPage();
    await consolePage.goto('console/');
    await consolePage.click('text=Ananya Iyer');
    await consolePage.click('a:has-text("Verification queue")');
    await consolePage.click('li:has-text("Marina Gate") >> text=Review');
    await consolePage.click('button:has-text("Approve")');
    await consolePage.click('text=Approve and create workspace');
    await expect(consolePage.locator('main')).toContainText('Trial');

    const portal = await context.newPage();
    await portal.goto('portal/');
    await portal.fill('#email', 'omar@marinagate.example');
    await portal.click('text=Send sign-in code');
    await expect(portal.locator('.bp-demo')).toContainText('would contain code');
    const code = (await portal.locator('.bp-demo').first().innerText()).match(/code (\d{6})/)![1];
    await portal.fill('#code', code);
    await portal.click('button:has-text("Sign in")');
    await expect(portal.locator('.bp-hero')).toContainText('Omar');

    await portal.goto('portal/#/onboarding');
    await portal.click('text=Save and continue');
    await portal.fill('#team-0', 'Marina sales');
    await portal.click('text=Save and continue');
    await portal.fill('#firstResponseMin', '0');
    await portal.click('text=Save and continue');
    await expect(portal.locator('main')).toContainText('1 to 240');
    await portal.fill('#firstResponseMin', '10');
    await portal.click('text=Save and continue');

    const row = portal.locator('[data-invite-row="0"]');
    await row.locator('[data-f="name"]').fill('Sara Khan');
    await row.locator('[data-f="email"]').fill('sara.khan@crescentkeyrealty.example');
    await portal.click('text=Check rows');
    await expect(portal.locator('main')).toContainText('still active at another firm');
    const row2 = portal.locator('[data-invite-row="0"]');
    await row2.locator('[data-f="name"]').fill('Nadia Rahim');
    await row2.locator('[data-f="email"]').fill('nadia@marinagate.example');
    await row2.locator('[data-f="teamId"]').selectOption({ index: 1 });
    await row2.locator('[data-f="brn"]').fill('51234');
    await row2.locator('[data-f="brnExpiry"]').fill('2027-06-30');
    await portal.click('text=Send invitations and continue');
    await expect(portal.locator('main')).toContainText('Connect your lead sources');
    await portal.click('button:has-text("Finish setup")');
    await expect(portal.locator('.bp-nav')).not.toContainText('Finish setup');
    await portal.goto('portal/#/people');
    await expect(portal.locator('main')).toContainText('Nadia Rahim');
  });
});

test.describe('Access rules', () => {
  test('a deactivated old login and a firm under review cannot sign in', async ({ page }) => {
    await page.goto('portal/');
    await page.click('text=firm under review');
    await expect(body(page)).toContainText('still being verified');
    await page.fill('#email', 'tariq.al.amiri@oasispointproperties.example');
    await page.click('text=Send sign-in code');
    await expect(body(page)).toContainText('still being verified');
  });

  test('the owner deactivates an agent, who then appears under former members', async ({ page }) => {
    await page.goto('portal/');
    await page.click('text=Khalid Mansour');
    await page.goto('portal/#/people');
    await page.locator('tr:has-text("Grace Morris") >> text=Deactivate').click();
    await page.click('[data-act="confirmDeactivate"]');
    await page.click('text=Former members');
    await expect(page.locator('main')).toContainText('Grace Morris');
  });

  test('agents do not see People or Firm settings', async ({ page }) => {
    await page.goto('portal/');
    await page.click('text=Sara Khan');
    await expect(page.locator('.bp-nav')).not.toContainText('People');
    await page.goto('portal/#/people');
    await expect(page.locator('main')).not.toContainText('Invite people');
  });
});
