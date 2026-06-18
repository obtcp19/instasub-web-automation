#!/usr/bin/env node

/**
 * AGENT LAYER 5: Test Execution Runner (Local)
 * Executes Playwright tests locally (no Docker)
 */

const { execFileSync, spawnSync } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv/config');

const DEFAULT_TICKET = (
  process.env.LAYER5_TICKET ||
  process.env.TICKET_NAME ||
  process.env.TEST_TICKET ||
  'ISE-1556'
).toUpperCase();
const DEFAULT_SPEC = process.env.LAYER5_SPEC || `tests/${DEFAULT_TICKET}.spec.ts`;
const DEFAULT_JIRA_STATUS_FLOW = (
  process.env.LAYER5_JIRA_STATUS_FLOW ||
  'To Do,In Progress,Dev Review,QA Review,Release Candidate'
)
  .split(',')
  .map(status => status.trim())
  .filter(Boolean);

class JiraWorkflowClient {
  constructor() {
    this.domain = this._normalizeDomain(process.env.JIRA_DOMAIN);
    this.email = process.env.JIRA_USER_EMAIL;
    this.token = process.env.JIRA_API_TOKEN;
    this.enabled = Boolean(this.domain && this.email && this.token);

    if (!this.enabled) return;

    this.client = axios.create({
      baseURL: `https://${this.domain}/rest/api/3`,
      auth: { username: this.email, password: this.token },
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 30000,
      proxy: false,
    });
  }

  _normalizeDomain(domain) {
    return domain?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  async transitionThrough(issueKey, targetStatuses) {
    if (!this.enabled) {
      console.log('⚪ Jira status flow skipped: missing JIRA_DOMAIN, JIRA_USER_EMAIL, or JIRA_API_TOKEN');
      return;
    }

    const currentStatus = await this.getStatus(issueKey);
    const pendingStatuses = this.pendingStatuses(currentStatus, targetStatuses);

    console.log(`🔁 Updating Jira workflow for ${issueKey}: ${targetStatuses.join(' -> ')}`);

    if (pendingStatuses.length === 0) {
      console.log(`   ✅ ${issueKey} already at or beyond requested Jira flow`);
      console.log(`   📍 ${issueKey} current Jira status: ${currentStatus}`);
      console.log();
      return;
    }

    for (const statusName of pendingStatuses) {
      try {
        await this.transitionTo(issueKey, statusName);
      } catch (error) {
        console.log(`   ⚠️  ${issueKey}: could not transition to ${statusName}: ${this.describeError(error)}`);
      }
    }

    const finalStatus = await this.getStatus(issueKey);
    console.log(`   📍 ${issueKey} current Jira status: ${finalStatus}`);
    console.log();
  }

  async transitionTo(issueKey, targetStatus) {
    const currentStatus = await this.getStatus(issueKey);
    if (this._sameStatus(currentStatus, targetStatus)) {
      console.log(`   ✅ ${issueKey} already in ${targetStatus}`);
      return;
    }

    const transitions = await this.getTransitions(issueKey);
    const transition = transitions.find(item => this._sameStatus(item.to?.name, targetStatus));

    if (!transition) {
      console.log(`   ⚠️  No Jira transition available from ${currentStatus} to ${targetStatus}`);
      return;
    }

    await this.withRetry(() => this.client.post(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transition.id },
    }));

    console.log(`   ✅ ${issueKey}: ${currentStatus} -> ${targetStatus}`);
  }

  async getStatus(issueKey) {
    const { data } = await this.withRetry(() => this.client.get(`/issue/${encodeURIComponent(issueKey)}`, {
      params: { fields: 'status' },
    }));

    return data.fields?.status?.name || 'Unknown';
  }

  async getTransitions(issueKey) {
    const { data } = await this.withRetry(() => this.client.get(`/issue/${encodeURIComponent(issueKey)}/transitions`));
    return data.transitions || [];
  }

  async withRetry(operation, retries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === retries) break;

        const delay = 500 * attempt;
        console.log(`   ↻ Jira request failed (${this.describeError(error)}), retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  isRetryable(error) {
    const status = error.response?.status;
    return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code) || status === 429 || status >= 500;
  }

  describeError(error) {
    return error.response?.data?.errorMessages?.join('; ') ||
      error.response?.data?.message ||
      error.code ||
      error.message;
  }

  pendingStatuses(currentStatus, targetStatuses) {
    const currentIndex = DEFAULT_JIRA_STATUS_FLOW.findIndex(status => this._sameStatus(status, currentStatus));
    if (currentIndex === -1) return targetStatuses;

    return targetStatuses.filter(targetStatus => {
      const targetIndex = DEFAULT_JIRA_STATUS_FLOW.findIndex(status => this._sameStatus(status, targetStatus));
      return targetIndex === -1 || targetIndex > currentIndex;
    });
  }

  _sameStatus(left, right) {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
  }
}

class Layer5Agent {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.testResultsDir = path.join(this.projectRoot, 'test-results');
    this.reportDir = path.join(this.projectRoot, 'playwright-report');
    this.jiraWorkflow = new JiraWorkflowClient();
  }

  async execute(options = {}) {
    console.log(`\n🚀 LAYER 5 AGENT: Test Execution Runner (Local)`);
    console.log(`⚙️  Executing Playwright tests locally...\n`);

    const {
      parallel = false,
      browsers = ['chromium'],
      headless = true,
      spec = DEFAULT_SPEC,
      grep = '',
      list = false,
      ticket = DEFAULT_TICKET,
      authUsernameVar = '',
      authPasswordVar = '',
      updateJira = true,
      jiraStatusFlow = DEFAULT_JIRA_STATUS_FLOW,
      jiraOnly = false,
    } = options;

    this._ensureDirectories();
    this._showEnvironmentCheck();

    console.log(`🔧 Configuration:`);
    console.log(`   Mode: Local (no Docker)`);
    console.log(`   Headless: ${headless}`);
    console.log(`   Parallelization: ${parallel ? 'Enabled' : 'Disabled'}`);
    console.log(`   Browsers: ${browsers.join(', ')}`);
    console.log(`   Ticket: ${ticket}`);
    console.log(`   Test Spec: ${spec || '(all)'}`);
    console.log(`   Jira Flow: ${updateJira ? jiraStatusFlow.join(' -> ') : 'Disabled'}`);
    if (authUsernameVar || authPasswordVar) {
      console.log(`   Auth Vars: ${authUsernameVar || 'PW_USERNAME'} / ${authPasswordVar || 'PW_PASSWORD'}`);
    }
    if (jiraOnly) console.log(`   Jira only: true`);
    if (grep) console.log(`   Grep: ${grep}`);
    if (list) console.log(`   List only: true`);
    console.log();

    if (jiraOnly) {
      await this._updateJira(ticket, jiraStatusFlow);
      return {
        totalTests: 0,
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        duration: 0,
        browsers,
        exitCode: 0,
      };
    }

    if (updateJira && !list) {
      await this._updateJira(ticket, jiraStatusFlow.slice(0, 2));
    }

    const results = this._runTests({ spec, browsers, parallel, headless, grep, list, ticket, authUsernameVar, authPasswordVar });

    if (updateJira && !list && results.exitCode === 0 && results.failed === 0) {
      await this._updateJira(ticket, jiraStatusFlow.slice(2));
    }

    return results;
  }

  async _updateJira(ticket, statuses) {
    if (!ticket || statuses.length === 0) return;

    try {
      await this.jiraWorkflow.transitionThrough(ticket, statuses);
    } catch (error) {
      const details = error.response?.data?.errorMessages?.join('; ') || error.message;
      console.log(`⚠️  Jira status flow failed for ${ticket}: ${details}`);
      console.log();
    }
  }

  _ensureDirectories() {
    [this.testResultsDir, this.reportDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  _showEnvironmentCheck() {
    console.log('🔍 Checking local execution prerequisites...\n');

    this._printCommandVersion('Node.js', 'node', ['--version']);
    this._printCommandVersion('npm', 'npm', ['--version']);
    this._printCommandVersion('Playwright', 'npx', ['playwright', '--version']);
    console.log();
  }

  _printCommandVersion(label, command, args) {
    try {
      const output = execFileSync(command, args, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      console.log(`   ✅ ${label}: ${output}`);
    } catch (error) {
      console.log(`   ❌ ${label}: unavailable`);
    }
  }

  _runTests({ spec, browsers, parallel, headless, grep, list, ticket, authUsernameVar, authPasswordVar }) {
    console.log(`📋 Running tests...\n`);

    const args = ['playwright', 'test'];

    if (spec) args.push(spec);

    if (browsers.length === 1) {
      const browserMap = {
        'chromium': 'chromium',
        'firefox': 'firefox',
        'webkit': 'webkit',
      };
      args.push(`--project=${browserMap[browsers[0]] || browsers[0]}`);
    }

    if (!parallel) args.push('--workers=1');

    if (!headless) args.push('--headed');

    if (grep) args.push('--grep', grep);
    if (list) args.push('--list');

    const startTime = Date.now();
    const printableCommand = ['npx', ...args].map(part => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
    const childEnv = this._buildPlaywrightEnv(ticket, { authUsernameVar, authPasswordVar });

    console.log(`Executing: ${printableCommand}\n`);
    const completed = spawnSync('npx', args, {
      cwd: this.projectRoot,
      stdio: 'inherit',
      env: childEnv,
    });

    const duration = Date.now() - startTime;
    const parsed = this._parseResults(duration, browsers);

    const results = {
      ...parsed,
      exitCode: completed.status ?? 1,
      error: completed.error?.message,
    };

    if (results.exitCode !== 0 && results.failed === 0) {
      results.failed = -1;
    }

    this._printSummary(results);
    return results;
  }

  _buildPlaywrightEnv(ticket, auth = {}) {
    const normalizedTicket = String(ticket || '').toUpperCase();
    const authRole = this._authRoleForTicket(normalizedTicket);
    const authUsernameVar = auth.authUsernameVar || process.env.AUTH_USERNAME_VAR || '';
    const authPasswordVar = auth.authPasswordVar || process.env.AUTH_PASSWORD_VAR || '';
    const env = {
      ...process.env,
      TEST_TICKET: normalizedTicket,
      TICKET_NAME: normalizedTicket || process.env.TICKET_NAME,
    };

    if (authUsernameVar) env.AUTH_USERNAME_VAR = authUsernameVar;
    if (authPasswordVar) env.AUTH_PASSWORD_VAR = authPasswordVar;

    if (authRole) env.AUTH_ROLE = authRole;

    if (authRole || authUsernameVar || authPasswordVar) {
      const authStateKey = (authUsernameVar || authRole || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      env.STORAGE_STATE = process.env.STORAGE_STATE ||
        process.env[`${normalizedTicket.replace(/-/g, '')}_STORAGE_STATE`] ||
        `playwright/.auth/${normalizedTicket.toLowerCase()}-${authStateKey}.json`;
    }

    return env;
  }

  _authRoleForTicket(ticket) {
    if (process.env.AUTH_ROLE) return process.env.AUTH_ROLE;
    if (process.env.TICKET_AUTH_ROLE) return process.env.TICKET_AUTH_ROLE;

    const roleMap = {
      'ISE-1559': 'Teacher',
    };

    return roleMap[ticket] || '';
  }

  _parseResults(duration, browsers) {
    const resultsPath = path.join(this.testResultsDir, 'results.json');
    const fallback = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      duration,
      browsers,
    };

    if (!fs.existsSync(resultsPath)) return fallback;

    try {
      const json = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
      const stats = json.stats || {};
      const totalTests = stats.expected ?? 0;
      const failed = stats.unexpected ?? stats.failed ?? 0;
      const flaky = stats.flaky ?? 0;
      const skipped = stats.skipped ?? 0;
      const passed = stats.passed ?? Math.max(totalTests - failed - flaky - skipped, 0);

      return {
        totalTests,
        passed,
        failed,
        flaky,
        skipped,
        duration: stats.duration ?? duration,
        browsers,
      };
    } catch (error) {
      return fallback;
    }
  }

  _printSummary(results) {
    console.log(`\n📊 Execution Summary:`);
    console.log(`   Total: ${results.totalTests}`);
    console.log(`   ✅ Passed: ${results.passed}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   🟡 Flaky: ${results.flaky}`);
    console.log(`   ⏭️  Skipped: ${results.skipped}`);
    console.log(`   ⏱️  Duration: ${(results.duration / 1000).toFixed(1)}s`);
    if (results.error) console.log(`   Error: ${results.error}`);
    console.log();
  }

  generateArtifacts() {
    const artifacts = [
      ['test-results/junit.xml', path.join(this.testResultsDir, 'junit.xml')],
      ['test-results/results.json', path.join(this.testResultsDir, 'results.json')],
      ['playwright-report/index.html', path.join(this.reportDir, 'index.html')],
    ];

    console.log(`📁 Artifacts Generated:`);
    artifacts.forEach(([label, file]) => {
      console.log(`   ${fs.existsSync(file) ? '✅' : '⚪'} ${label}`);
    });
    console.log();
  }
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2);
  const explicitSpec = valueForArg(args, '--spec');
  const explicitGrep = valueForArg(args, '--grep');
  const explicitBrowser = valueForArg(args, '--browser');
  const authUsernameVar = valueForAnyArg(args, ['--auth-username-var', '--username-var', '--username']);
  const authPasswordVar = valueForAnyArg(args, ['--auth-password-var', '--password-var', '--password']);
  const ticketArg = args.find(a => /^ISE-\d+$/i.test(a));
  const ticket = (ticketArg || DEFAULT_TICKET).toUpperCase();
  const ticketSpec = ticketArg ? `tests/${ticketArg.toUpperCase()}.spec.ts` : null;
  const runAll = args.includes('--all');
  const jiraOnly = args.includes('--jira-only');

  const spec = jiraOnly || runAll ? '' : explicitSpec || ticketSpec || DEFAULT_SPEC;

  const options = {
    parallel: args.includes('--parallel') && !args.includes('--sequential'),
    headless: !args.includes('--headed'),
    browsers: explicitBrowser
      ? [explicitBrowser]
      : args.includes('--chrome')
      ? ['chromium']
      : args.includes('--firefox')
        ? ['firefox']
        : args.includes('--webkit')
        ? ['webkit']
          : ['chromium'],
    spec,
    grep: explicitGrep || '',
    list: args.includes('--list'),
    ticket,
    authUsernameVar,
    authPasswordVar,
    updateJira: !args.includes('--skip-jira') || jiraOnly,
    jiraOnly,
  };

  if (options.spec && !fs.existsSync(path.join(__dirname, '..', options.spec))) {
    console.error(`Error: Test spec not found: ${options.spec}`);
    console.error(`Hint: set TICKET_NAME in .env, pass --spec=tests/<ticket>.spec.ts, pass a ticket like ISE-1556, or use --all.`);
    process.exit(1);
  }

  try {
    const agent = new Layer5Agent();
    const results = await agent.execute(options);
    agent.generateArtifacts();

    const status = results.exitCode === 0 && results.failed === 0 ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status} Execution complete\n`);

    process.exit(results.exitCode === 0 && results.failed === 0 ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function valueForArg(args, name) {
  const equalsValue = args.find(arg => arg.startsWith(`${name}=`));
  if (equalsValue) return equalsValue.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1];
  }

  return '';
}

function valueForAnyArg(args, names) {
  for (const name of names) {
    const value = valueForArg(args, name);
    if (value) return value;
  }

  return '';
}

main();
