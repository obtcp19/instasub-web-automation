const { test: setup, expect } = require('@playwright/test');

/**
 * Authentication setup. Logs in with credentials from the environment and
 * saves the session so the test projects start authenticated. Runs fresh each
 * time, so sessions never go stale.
 *
 * Login selectors verified live against the InstaSub staging login page:
 *   input[formcontrolname="userName"], input[formcontrolname="password"], "Login" button.
 *
 * Credentials come ONLY from env vars — never hard-code them:
 *   export PW_USERNAME="you@example.com"
 *   export PW_PASSWORD="********"
 */
const authFile = process.env.STORAGE_STATE || 'playwright/.auth/user.json';

function currentTicket() {
  const explicitTicket = process.env.TICKET_NAME || process.env.TEST_TICKET || '';
  if (explicitTicket) return explicitTicket.toUpperCase();

  const argvTicket = process.argv.find((arg) => /ISE-\d+/i.test(arg));
  return argvTicket ? argvTicket.match(/ISE-\d+/i)[0].toUpperCase() : '';
}

function roleForTicket(ticket) {
  if (process.env.AUTH_ROLE) return process.env.AUTH_ROLE;
  if (process.env.TICKET_AUTH_ROLE) return process.env.TICKET_AUTH_ROLE;
  if (ticket === 'ISE-1559') return 'Teacher';

  return '';
}

function resolveCredentials() {
  if (process.env.AUTH_USERNAME_VAR || process.env.AUTH_PASSWORD_VAR) {
    const usernameKey = process.env.AUTH_USERNAME_VAR || 'PW_USERNAME';
    const passwordKey = process.env.AUTH_PASSWORD_VAR || 'PW_PASSWORD';

    return {
      username: process.env[usernameKey],
      password: process.env[passwordKey],
      source: `${usernameKey}/${passwordKey}`,
    };
  }

  const role = roleForTicket(currentTicket());

  if (role) {
    const usernameKey = `${role}_USERNAME`;
    const passwordKey = `${role}_PASSWORD`;

    return {
      username: process.env[usernameKey],
      password: process.env[passwordKey],
      source: `${usernameKey}/${passwordKey}`,
    };
  }

  return {
    username: process.env.PW_USERNAME,
    password: process.env.PW_PASSWORD,
    source: 'PW_USERNAME/PW_PASSWORD',
  };
}

setup('authenticate', async ({ page }) => {
  const { username, password, source } = resolveCredentials();

  if (!username || !password) {
    throw new Error(
      `${source} must be set in the environment for auth setup.`
    );
  }

  console.log(`Auth setup using ${source}: ${username}`);

  const userField = page.locator('input[formcontrolname="userName"]');
  const passField = page.locator('input[formcontrolname="password"]');

  await page.goto('/');
  await userField.waitFor({ state: 'visible' });
  // Let Angular finish hydrating; otherwise early keystrokes get dropped
  // (observed: "regsadmin@..." landing as "oadmin@...").
  await page.waitForLoadState('networkidle');

  await userField.click();
  await userField.fill('');
  await userField.fill(username);
  // Fail loudly if the value didn't take, instead of submitting a bad login.
  await expect(userField).toHaveValue(username);

  await passField.click();
  await passField.fill(password);

  await page.getByRole('button', { name: 'Login' }).click();

  // Success = we left the login page (the Login button is gone), whatever the
  // landing URL turns out to be.
  await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0, { timeout: 30000 });

  await page.context().storageState({ path: authFile });
});
