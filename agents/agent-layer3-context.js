#!/usr/bin/env node

/**
 * AGENT LAYER 3: Context Retrieval + Manual Playwright MCP
 * Queries vector DB for reusable code patterns and can capture Playwright MCP context for Layer 4 codegen.
 */

const VectorDB = require('../vector-db/index.js');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('@playwright/test');
require('dotenv/config');

class AbsenceDate {
  static next() {
    const date = new Date();
    date.setDate(date.getDate() + 120);

    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }
}

class Layer3Agent {
  constructor() {
    this.db = new VectorDB();
    this.projectRoot = path.join(__dirname, '..');
    this.contextDir = path.join(this.projectRoot, 'context');
    this.layer1ContextPath = path.join(this.contextDir, 'layer1-requirements.json');
    this.layer2ContextPath = path.join(this.contextDir, 'layer2-strategy-context.json');
    this.layer2TestPlanPath = path.join(this.contextDir, 'layer2-test-plan.json');
    this.explorerContextPath = path.join(this.contextDir, 'explorer-context.json');
    this.manualMcpContextPath = path.join(this.contextDir, 'mcp-playwright-context.json');
  }

  async retrieve(searchQueries, layer1Data = null) {
    console.log(`\n📚 LAYER 3 AGENT: Context Retrieval`);
    console.log(`🔍 Searching code repository...\n`);

    await this.db.load();

    if (this.db.documents.length === 0) {
      console.log('⚠️  Vector DB empty. Run: npm run vector-db:index\n');
      return { results: [], indexed: 0 };
    }

    const allResults = [];

    // Search for each query
    const queries = Array.isArray(searchQueries) ? searchQueries : [searchQueries];
    for (const query of queries) {
      const results = await this.db.query(query, 3);
      allResults.push(...results);
    }

    // Deduplicate by path
    const unique = Array.from(
      new Map(allResults.map(r => [r.path, r])).values()
    );

    console.log(`✅ Found: ${unique.length} code files\n`);

    unique.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.type}] ${result.fileName}`);
      console.log(`   Match: ${(result.similarity * 100).toFixed(1)}%`);
    });

    console.log();

    this.saveRetrievalContext(unique, queries, this.db.documents.length, layer1Data);

    return { results: unique, indexed: this.db.documents.length };
  }

  async extractKeywords(requirementsData) {
    console.log(`\n📚 LAYER 3 AGENT: Context Retrieval`);
    console.log(`🔍 Extracting keywords from requirements...\n`);

    const keywords = [];

    if (requirementsData.title) {
      // Parse title for keywords
      const words = requirementsData.title.toLowerCase().split(/\s+/);
      keywords.push(...words.slice(0, 3));
    }

    // Extract from pairwise scenarios if available (26 test cases)
    if (requirementsData.pairwiseScenarios && requirementsData.pairwiseScenarios.length > 0) {
      console.log(`📊 Found ${requirementsData.pairwiseScenarios.length} pairwise scenarios\n`);

      // Extract unique reasons, durations, and preferences from scenarios
      const reasons = [...new Set(requirementsData.pairwiseScenarios.map(s => s.reason).filter(Boolean))];
      const durations = [...new Set(requirementsData.pairwiseScenarios.map(s => s.duration).filter(Boolean))];
      const preferences = [...new Set(requirementsData.pairwiseScenarios.map(s => s.subPreference).filter(Boolean))];

      console.log(`   Reasons: ${reasons.slice(0, 3).join(', ')}`);
      console.log(`   Durations: ${durations.join(', ')}`);
      console.log(`   Sub Preferences: ${preferences.join(', ')}\n`);

      keywords.push(...reasons.slice(0, 3), ...durations, ...preferences);
    }

    // Fallback: Extract from testable items
    if (keywords.length === 0 && requirementsData.testableItems) {
      requirementsData.testableItems.forEach(item => {
        const words = item.toLowerCase().split(/\s+/);
        keywords.push(words[0], words[words.length - 1]);
      });
    }

    // Deduplicate
    const unique = [...new Set(keywords)].filter(k => k.length > 2).slice(0, 10);

    console.log(`✅ Keywords (${unique.length}): ${unique.join(', ')}\n`);

    // Query with keywords, passing layer1 data for context
    return await this.retrieve(unique, requirementsData);
  }

  loadLayer2Context() {
    if (!fs.existsSync(this.layer2ContextPath)) return null;
    return JSON.parse(fs.readFileSync(this.layer2ContextPath, 'utf-8'));
  }

  loadExplorerContext() {
    if (!fs.existsSync(this.explorerContextPath)) return null;
    return JSON.parse(fs.readFileSync(this.explorerContextPath, 'utf-8'));
  }

  loadTestPlan() {
    if (fs.existsSync(this.layer2TestPlanPath)) {
      return JSON.parse(fs.readFileSync(this.layer2TestPlanPath, 'utf-8'));
    }

    const legacyPlanPath = path.join(this.projectRoot, 'test-results', 'LAYER2-TEST-PLAN.json');
    if (fs.existsSync(legacyPlanPath)) {
      return JSON.parse(fs.readFileSync(legacyPlanPath, 'utf-8'));
    }

    return [];
  }

  initManualMCPServer() {
    return {
      protocol: 'MCP',
      server: process.env.PLAYWRIGHT_MCP_SERVER || 'mcp://playwright',
      capabilities: [
        'manual-playwright-execution',
        'manual-playwright-listing',
        'browser-selector-capture',
        'accessibility-tree-snapshot',
        'ui-element-indexing',
        'layer4-codegen-context-handoff',
      ],
      endpoints: {
        listTests: 'mcp://playwright/list-tests',
        runTests: 'mcp://playwright/run-tests',
        explore: 'mcp://playwright/explore',
      },
    };
  }

  async runManualMCP(options = {}) {
    console.log(`\n🎛️  LAYER 3 AGENT: Manual Playwright MCP Context Capture`);
    console.log(`📡 Capturing execution/browser context for Layer 4 codegen...\n`);

    const testPlan = options.testPlan || this.loadTestPlan();
    const ticket = this.ticketFrom(options.layer1Data, options.layer2Context, options.ticket);
    const spec = options.spec || this.specForTicket(ticket);
    const verification = this.verifyWithPlaywrightMCP(testPlan, { ...options, ticket, spec });
    const explorerContext = await this.captureExplorerContext(testPlan, verification, { ...options, ticket });

    const payload = {
      layer: 3,
      generatedAt: new Date().toISOString(),
      status: verification.status === 'failed' || explorerContext.status === 'failed' ? 'partial' : 'captured',
      purpose: 'Manual Playwright MCP context handoff for Layer 4 code generation.',
      ticket,
      mcp: this.initManualMCPServer(),
      artifacts: {
        manualMcpContext: 'context/mcp-playwright-context.json',
        explorerContext: 'context/explorer-context.json',
        layer3RetrievalContext: 'context/layer3-retrieval-context.json',
      },
      testPlan: {
        source: fs.existsSync(this.layer2TestPlanPath) ? 'context/layer2-test-plan.json' : 'test-results/LAYER2-TEST-PLAN.json',
        cases: testPlan.length,
      },
      verification,
      explorerContext,
      codegenHints: {
        consumeInLayer4: true,
        preferExplorerSelectors: explorerContext.status === 'captured',
        preferExecutedSpecTitles: verification.status === 'verified' && verification.mode === 'run',
        targetSpec: spec,
      },
    };

    fs.mkdirSync(this.contextDir, { recursive: true });
    fs.writeFileSync(this.manualMcpContextPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(this.explorerContextPath, JSON.stringify(explorerContext, null, 2));

    console.log(`💾 Saved: context/mcp-playwright-context.json`);
    console.log(`💾 Saved: context/explorer-context.json\n`);

    return payload;
  }

  queriesFromLayer2Context(layer2Context, explorerContext = null) {
    if (!layer2Context && !explorerContext) return [];

    const queries = [
      ...(layer2Context?.retrievalQueries || []),
      ...(layer2Context?.codegenHints?.requiredAssertions || []),
      layer2Context?.codegenHints?.executionMode,
      ...(explorerContext?.snapshots?.elements?.buttons || []).map((button) => `button ${button.text} ${button.selector}`),
      ...(explorerContext?.snapshots?.elements?.inputs || []).map((input) => `input ${input.label} ${input.selector}`),
      ...(explorerContext?.snapshots?.elements?.tables || []).map((table) => `table ${table.label} ${table.selector}`),
      ...(explorerContext?.flowDocs?.generatedCases || []).map((testCase) => testCase.title),
    ];

    return Array.from(new Set(queries.filter(Boolean)));
  }

  saveRetrievalContext(results, queries, indexed, layer1Data = null) {
    fs.mkdirSync(this.contextDir, { recursive: true });

    const payload = {
      layer: 3,
      generatedAt: new Date().toISOString(),
      source: fs.existsSync(this.layer2ContextPath)
        ? 'context/layer2-strategy-context.json'
        : 'manual/default queries',
      explorerCovered: fs.existsSync(this.explorerContextPath),
      explorerContext: fs.existsSync(this.explorerContextPath) ? 'context/explorer-context.json' : null,
      manualMcpContext: fs.existsSync(this.manualMcpContextPath) ? 'context/mcp-playwright-context.json' : null,
      indexed,
      queries,
      testScenarios: layer1Data?.pairwiseScenarios?.length || 0,
      assets: results.map((result) => ({
        path: path.relative(this.projectRoot, result.path),
        fileName: result.fileName,
        type: result.type,
        similarity: result.similarity,
      })),
    };

    fs.writeFileSync(
      path.join(this.contextDir, 'layer3-retrieval-context.json'),
      JSON.stringify(payload, null, 2)
    );
    console.log('💾 Saved: context/layer3-retrieval-context.json\n');
  }

  verifyWithPlaywrightMCP(testPlan, options = {}) {
    const { runPlaywright = false, headed = false, ticket = '', spec = '' } = options;
    const specPath = spec ? path.join(this.projectRoot, spec) : '';
    const runMode = runPlaywright ? 'run' : 'list';
    const verification = {
      status: 'skipped',
      mode: runMode,
      ticket,
      spec,
      command: null,
      discoveredTests: [],
      matchedTestCases: [],
      missingTestCases: testPlan.map((testCase) => testCase.id),
      exitCode: null,
      outputTail: '',
      notes: [],
      verifiedAt: new Date().toISOString(),
    };

    if (!ticket) {
      verification.notes.push('No ticket key available from Layer 1, Layer 2, CLI args, or environment.');
      return verification;
    }

    if (!spec || !fs.existsSync(specPath)) {
      verification.notes.push(`No existing spec found at ${spec || '(not resolved)'}. Layer 4 can use captured context to generate it.`);
      return verification;
    }

    const args = ['playwright', 'test', spec, '--project=chromium', '--workers=1'];
    if (!runPlaywright) args.push('--list');
    if (headed && runPlaywright) args.push('--headed');

    verification.command = ['npx', ...args].join(' ');
    console.log(`📡 Playwright MCP ${runMode}: ${verification.command}\n`);

    const childEnv = this.buildPlaywrightEnv(ticket);
    const completed = spawnSync('npx', args, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = `${completed.stdout || ''}\n${completed.stderr || ''}`.trim();
    verification.exitCode = completed.status ?? 1;
    verification.status = verification.exitCode === 0 ? 'verified' : 'failed';
    verification.discoveredTests = this.parsePlaywrightOutput(output, runMode);
    verification.matchedTestCases = this.matchPlanToDiscoveredTests(testPlan, verification.discoveredTests);
    verification.missingTestCases = testPlan
      .map((testCase) => testCase.id)
      .filter((id) => !verification.matchedTestCases.some((match) => match.id === id));
    verification.outputTail = output.slice(-4000);

    if (completed.error) verification.notes.push(completed.error.message);
    if (verification.exitCode !== 0 && output) verification.notes.push(output.slice(0, 2000));

    console.log(`✅ Playwright MCP status: ${verification.status}`);
    console.log(`✅ Discovered tests: ${verification.discoveredTests.length}\n`);

    return verification;
  }

  buildPlaywrightEnv(ticket) {
    const env = {
      ...process.env,
      TEST_TICKET: ticket,
      TICKET_NAME: ticket || process.env.TICKET_NAME,
    };

    if (ticket === 'ISE-1559') {
      const teacherUsername = process.env.Teacher_USERNAME || 'staffuser210@mailinator.com';
      const teacherPassword = process.env.Teacher_PASSWORD;

      env.PW_USERNAME = teacherUsername;
      if (teacherPassword) env.PW_PASSWORD = teacherPassword;
      env.ABSENCE_EMPLOYEE_SEARCH = teacherUsername;
      env.ABSENCE_EMPLOYEE_LABEL = teacherUsername;
      env.STORAGE_STATE = process.env.ISE1559_STORAGE_STATE || 'playwright/.auth/ise-1559-teacher.json';
    }

    return env;
  }

  async captureExplorerContext(testPlan, verification, options = {}) {
    const url = options.explorerUrl || process.env.EXPLORER_URL || 'https://instasublogin.tcpsoftware.com/';
    const baseContext = {
      layer: 3,
      source: 'manual-playwright-mcp',
      status: options.explore ? 'pending' : 'skipped',
      mode: options.explore ? 'browser' : 'planned',
      url,
      ticket: options.ticket || '',
      generatedAt: new Date().toISOString(),
      mcp: {
        protocol: 'MCP',
        server: process.env.PLAYWRIGHT_MCP_SERVER || 'mcp://playwright',
        endpoint: 'mcp://playwright/explore',
      },
      why: 'Layer 3 captures authoritative selectors and flow docs for downstream Layer 4 codegen.',
      coverage: this.explorerCoverage(testPlan, verification),
      snapshots: {
        accessibility: null,
        elements: { buttons: [], inputs: [], tables: [] },
        pages: [],
      },
      flowVerification: {
        mode: verification.mode === 'run' ? 'executed-by-playwright' : 'mapped-from-current-spec',
        command: verification.command,
        status: verification.status,
        matchedTestCases: verification.matchedTestCases,
        missingTestCases: verification.missingTestCases,
      },
      notes: [],
    };

    if (!options.explore) {
      baseContext.notes.push('Browser launch skipped. Run Layer 3 with --manual-mcp --explore to capture live UI selectors.');
      return baseContext;
    }

    console.log(`🧭 Manual MCP explorer: launching Chromium and opening ${url}\n`);

    let browser;
    try {
      browser = await chromium.launch({ headless: !options.explorerHeaded && !options.headed });
      const childEnv = this.buildPlaywrightEnv(options.ticket || '');
      const storageStatePath = path.join(this.projectRoot, childEnv.STORAGE_STATE || '');
      const contextOptions = fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : {};
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.ensureExplorerAuthenticated(page, childEnv);

      baseContext.status = 'captured';
      baseContext.finalUrl = page.url();
      baseContext.title = await page.title().catch(() => '');
      baseContext.snapshots.accessibility = await this.safeAccessibilitySnapshot(page);
      baseContext.snapshots.elements = await this.indexUiElements(page);
      baseContext.snapshots.pages.push(await this.capturePageSnapshot(page, 'landing'));

      const wizardResult = await this.exploreAbsenceWizard(page, testPlan[0]);
      baseContext.snapshots.pages.push(...wizardResult.pages);
      baseContext.flowDocs = this.buildExplorerFlowDocs(testPlan, baseContext.snapshots.elements, wizardResult);
      baseContext.explorerActions = wizardResult.actions;
      baseContext.notes.push(...wizardResult.notes);

      console.log(
        `✅ Explorer captured ${baseContext.snapshots.elements.buttons.length} buttons, ` +
          `${baseContext.snapshots.elements.inputs.length} inputs, ` +
          `${baseContext.snapshots.elements.tables.length} tables, ` +
          `${baseContext.snapshots.pages.length} page snapshot(s)\n`
      );
    } catch (error) {
      baseContext.status = 'failed';
      baseContext.notes.push(error.message);
      console.log(`⚠️  Manual MCP explorer failed: ${error.message}\n`);
    } finally {
      if (browser) await browser.close();
    }

    return baseContext;
  }

  async ensureExplorerAuthenticated(page, env) {
    const loginButton = page.getByRole('button', { name: /^Login$/i });
    if (!(await loginButton.isVisible({ timeout: 3000 }).catch(() => false))) return;

    const username = env.PW_USERNAME || env.Teacher_USERNAME;
    const password = env.PW_PASSWORD || env.Teacher_PASSWORD;
    if (!username || !password) {
      throw new Error('Explorer reached login page but no Playwright credentials were available.');
    }

    console.log(`🔐 Explorer login using ${username}\n`);

    const userField = page.locator('input[formcontrolname="userName"], #email').first();
    const passField = page.locator('input[formcontrolname="password"], #pwd').first();
    await userField.waitFor({ state: 'visible', timeout: 15000 });
    await userField.fill(username);
    await passField.fill(password);
    await loginButton.click();
    await loginButton.waitFor({ state: 'hidden', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async capturePageSnapshot(page, label) {
    return {
      label,
      url: page.url(),
      title: await page.title().catch(() => ''),
      activeStep: await this.currentWizardStep(page),
      elements: await this.indexUiElements(page),
    };
  }

  async exploreAbsenceWizard(page, plannedCase = {}) {
    const pages = [];
    const actions = [];
    const notes = [];
    const scenario = this.explorerScenario(plannedCase);

    try {
      const createUrl = new URL('/absence/createAbsence', page.url()).toString();
      await page.goto(createUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.waitForExplorerFormReady(page);
      pages.push(await this.capturePageSnapshot(page, 'create-absence-empty'));

      await this.fillAbsenceCreateStep(page, scenario, actions);
      pages.push(await this.capturePageSnapshot(page, 'create-absence-filled'));

      const firstAdvance = await this.clickWizardNext(page, actions);
      await page.waitForTimeout(1000);
      pages.push(await this.capturePageSnapshot(page, `after-first-next-${firstAdvance || 'unknown-step'}`));

      if (/additional information/i.test(await this.currentWizardStep(page) || '')) {
        await this.fillAdditionalInformation(page, scenario, actions);
        pages.push(await this.capturePageSnapshot(page, 'additional-information-filled'));

        const secondAdvance = await this.clickWizardNext(page, actions);
        await page.waitForTimeout(1000);
        pages.push(await this.capturePageSnapshot(page, `after-second-next-${secondAdvance || 'unknown-step'}`));
      }

      if (await page.getByRole('button', { name: /Create Absence|Create And Assign/i }).isVisible({ timeout: 3000 }).catch(() => false)) {
        pages.push(await this.capturePageSnapshot(page, 'done-review'));
      }
    } catch (error) {
      notes.push(`Wizard exploration stopped early: ${error.message}`);
    }

    return { scenario, pages, actions, notes };
  }

  async waitForExplorerFormReady(page) {
    const readyLocator = page.locator([
      'input[formcontrolname="AbsenceStartDate"]',
      'input[placeholder="Start Date"]',
      'mat-select[formcontrolname="Reason"]',
      '[role="tab"]',
    ].join(', ')).first();

    await readyLocator.waitFor({ state: 'attached', timeout: 20000 });
    await page
      .locator('.block-ui-wrapper.active, .block-ui-spinner')
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(750);
  }

  explorerScenario(plannedCase = {}) {
    return {
      id: plannedCase.id || 'L3-EXPLORE',
      date: AbsenceDate.next(),
      reason: plannedCase.reason || 'Sick',
      duration: plannedCase.duration || 'Full Day',
      subPreference: plannedCase.subPreference || 'No sub required',
      notes: 'Layer 3 MCP selector exploration only',
    };
  }

  async fillAbsenceCreateStep(page, scenario, actions) {
    await this.fillFirstVisible(page, [
      'input[formcontrolname="AbsenceStartDate"]',
      'input[placeholder="Start Date"]',
      'input[aria-label*="Start Date" i]',
    ], scenario.date, actions, 'start date');

    await this.fillFirstVisible(page, [
      'input[formcontrolname="AbsenceEndDate"]',
      'input[placeholder="End Date"]',
      'input[aria-label*="End Date" i]',
    ], scenario.date, actions, 'end date');

    await this.chooseFirstAvailableOption(page, [
      'mat-select[formcontrolname="Reason"]',
      '[role="listbox"][aria-label*="Reason" i]',
    ], [scenario.reason, 'Sick', 'Personal', 'Vacation'], actions, 'reason');

    await this.chooseFirstAvailableOption(page, [
      'mat-select[formcontrolname="Duration"]',
      '[role="listbox"][aria-label*="Duration" i]',
    ], [scenario.duration, 'Full Day', 'Half Day AM'], actions, 'duration');

    await this.chooseFirstAvailableOption(page, [
      'mat-select[formcontrolname="AbsenceType"]',
      '[role="listbox"][aria-label*="Substitute Preference" i]',
      '[role="listbox"][aria-label*="Select Substitute Preference" i]',
    ], [scenario.subPreference, 'No sub required', 'Notify all subs'], actions, 'substitute preference');
  }

  async fillAdditionalInformation(page, scenario, actions) {
    const textareas = page.locator('textarea:visible');
    const count = await textareas.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      await textareas.nth(index).fill(`${scenario.notes} ${scenario.id}`).catch(() => {});
    }
    if (count > 0) actions.push(`Filled ${count} additional information textarea(s)`);
  }

  async fillFirstVisible(page, selectors, value, actions, label) {
    for (const selector of selectors) {
      const field = page.locator(selector).first();
      if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
        await field.fill(value);
        await field.blur().catch(() => {});
        actions.push(`Filled ${label} via ${selector}`);
        await page.waitForTimeout(300);
        return true;
      }
    }
    actions.push(`Skipped ${label}; no visible field found`);
    return false;
  }

  async chooseFirstAvailableOption(page, selectors, optionLabels, actions, label) {
    for (const selector of selectors) {
      const select = page.locator(selector).first();
      if (!(await select.isVisible({ timeout: 1500 }).catch(() => false))) continue;

      for (const optionLabel of optionLabels) {
        if (await this.chooseOptionByText(page, select, optionLabel).catch(() => false)) {
          actions.push(`Selected ${label} "${optionLabel}" via ${selector}`);
          return optionLabel;
        }
      }
    }

    actions.push(`Skipped ${label}; no requested option was selectable`);
    return null;
  }

  async chooseOptionByText(page, select, optionLabel) {
    await page.keyboard.press('Escape').catch(() => {});
    await select.click({ force: true });
    const option = page
      .locator('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"], .cdk-overlay-container .mat-mdc-option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegex(optionLabel)}\\s*$`, 'i') })
      .first();

    if (!(await option.isVisible({ timeout: 2500 }).catch(() => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    await option.click({ force: true });
    await page.waitForTimeout(500);
    return true;
  }

  async clickWizardNext(page, actions) {
    const before = await this.currentWizardStep(page);
    const next = page.locator('button:visible').filter({ hasText: /^NEXT$/i }).first();
    if (!(await next.isVisible({ timeout: 3000 }).catch(() => false))) {
      actions.push('Skipped NEXT; button not visible');
      return before;
    }

    await next.click({ force: true });
    await page.waitForTimeout(1000);
    const after = await this.currentWizardStep(page);
    actions.push(`Clicked NEXT from ${before || '(unknown)'} to ${after || '(unknown)'}`);
    return after;
  }

  async currentWizardStep(page) {
    const selectedTabText = await page
      .locator('[role="tab"][aria-selected="true"], .mat-tab-label-active, .mdc-tab--active')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join(' '))
      .catch(() => '');

    if (/done/i.test(selectedTabText)) return 'Done';
    if (/additional information/i.test(selectedTabText)) return 'Additional Information';
    if (/create absence/i.test(selectedTabText)) return 'Create Absence';
    return selectedTabText.trim() || null;
  }

  async safeAccessibilitySnapshot(page) {
    if (page.accessibility?.snapshot) {
      return page.accessibility.snapshot({ interestingOnly: false }).catch(() => null);
    }

    return page.locator('body').evaluate((body) => ({
      role: 'document',
      name: document.title,
      textPreview: body.innerText.slice(0, 4000),
    })).catch(() => null);
  }

  async indexUiElements(page) {
    return page.evaluate(() => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const cssPath = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testId = element.getAttribute('data-testid');
        if (testId) return `[data-testid="${testId}"]`;
        const formControl = element.getAttribute('formcontrolname');
        if (formControl) return `${element.tagName.toLowerCase()}[formcontrolname="${formControl}"]`;
        const name = element.getAttribute('name');
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        const tag = element.tagName.toLowerCase();
        const siblings = Array.from(element.parentElement?.children || []).filter((node) => node.tagName === element.tagName);
        if (siblings.length > 1) return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
        return tag;
      };
      const ariaName = (element) =>
        clean(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.innerText || element.value);

      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
        .map((element) => ({
          text: ariaName(element),
          role: element.getAttribute('role') || 'button',
          selector: cssPath(element),
          recommendedLocator: ariaName(element) ? `getByRole('button', { name: ${JSON.stringify(ariaName(element))} })` : cssPath(element),
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        }))
        .filter((item) => item.text || item.selector);

      const inputs = Array.from(document.querySelectorAll('input, textarea, select, mat-select, [role="textbox"], [role="combobox"]'))
        .map((element) => ({
          label: ariaName(element),
          type: element.getAttribute('type') || element.getAttribute('role') || element.tagName.toLowerCase(),
          selector: cssPath(element),
          recommendedLocator: cssPath(element),
          formControlName: element.getAttribute('formcontrolname') || null,
          required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
        }))
        .filter((item) => item.label || item.selector);

      const tables = Array.from(document.querySelectorAll('table, [role="table"], mat-table'))
        .map((element) => ({
          label: ariaName(element),
          selector: cssPath(element),
          rows: element.querySelectorAll('tr, [role="row"]').length,
          columns: element.querySelector('tr, [role="row"]')?.querySelectorAll('th, td, [role="columnheader"], [role="cell"]').length || 0,
        }));

      return { buttons, inputs, tables };
    });
  }

  explorerCoverage(testPlan, verification) {
    const matchedIds = new Set((verification.matchedTestCases || []).map((match) => match.id));
    return {
      plannedCases: testPlan.length,
      coveredCases: testPlan.filter((testCase) => matchedIds.has(testCase.id)).length,
      missingCases: testPlan.map((testCase) => testCase.id).filter((id) => !matchedIds.has(id)),
      coveredByOtherLayer: {
        layer3PlaywrightMcp: matchedIds.size,
        layer5Execution: 'covered when agent-layer5-execution.js runs the generated/current spec',
      },
    };
  }

  buildExplorerFlowDocs(testPlan, elements, wizardResult = null) {
    const loginSelectors = {
      username: elements.inputs.find((input) => input.formControlName === 'userName')?.selector || 'input[formcontrolname="userName"]',
      password: elements.inputs.find((input) => input.formControlName === 'password')?.selector || 'input[formcontrolname="password"]',
      loginButton: elements.buttons.find((button) => /login/i.test(button.text))?.recommendedLocator || 'getByRole("button", { name: "Login" })',
    };

    return {
      login: {
        url: 'https://instasublogin.tcpsoftware.com/',
        selectors: loginSelectors,
        steps: [
          'Open login URL',
          'Fill username',
          'Fill password',
          'Click Login',
          'Verify Login button disappears or app navigates away',
        ],
      },
      wizardExploration: wizardResult ? {
        scenario: wizardResult.scenario,
        actions: wizardResult.actions,
        capturedPages: wizardResult.pages.map((page) => ({
          label: page.label,
          activeStep: page.activeStep,
          url: page.url,
          buttons: page.elements.buttons.length,
          inputs: page.elements.inputs.length,
          tables: page.elements.tables.length,
        })),
      } : null,
      generatedCases: testPlan.map((testCase) => ({
        id: testCase.id,
        title: testCase.description,
        verification: testCase.playwrightTitle ? 'mapped-to-current-playwright-spec' : 'requires-codegen-or-manual-exploration',
      })),
    };
  }

  escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  ticketFrom(layer1Data, layer2Context, ticketArg = '') {
    return (
      ticketArg ||
      layer2Context?.ticket ||
      layer1Data?.ticket ||
      process.env.TICKET_NAME ||
      process.env.LAYER5_TICKET ||
      ''
    ).toUpperCase();
  }

  specForTicket(ticket) {
    if (!ticket) return '';
    const direct = `tests/${ticket}.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, direct))) return direct;

    const legacy = `tests/${ticket}-absence-creation.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, legacy))) return legacy;

    return direct;
  }

  parsePlaywrightOutput(output, mode = 'list') {
    const progressLine = /^\[\d+\/\d+\]\s+/;
    const listLine = /^\[[^\]]+\]\s*›\s*/;

    const tests = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line.includes('›')) return false;
        return mode === 'run' ? progressLine.test(line) : listLine.test(line);
      })
      .map((line) => line.replace(progressLine, '').replace(listLine, '').trim());

    return Array.from(new Set(tests));
  }

  matchPlanToDiscoveredTests(testPlan, discoveredTests) {
    return testPlan
      .map((testCase) => {
        const match = discoveredTests.find((title) => title.includes(testCase.id));
        return match ? { id: testCase.id, title: match } : null;
      })
      .filter(Boolean);
  }
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2);
  const flagArgs = new Set([
    '--manual-mcp',
    '--mcp',
    '--run-playwright',
    '--headed',
    '--explore',
    '--explorer-headed',
  ]);
  const ticketArg = args.find((arg) => /^[A-Z]+-\d+$/i.test(arg));
  const specArg = args.find((arg) => arg.startsWith('--spec='))?.replace('--spec=', '');
  const explorerUrlArg = args.find((arg) => arg.startsWith('--url='))?.replace('--url=', '') ||
    args.find((arg) => arg.startsWith('--explorer-url='))?.replace('--explorer-url=', '');
  const searchArgs = args.filter((arg) =>
    !flagArgs.has(arg) &&
    !arg.startsWith('--spec=') &&
    !arg.startsWith('--url=') &&
    !arg.startsWith('--explorer-url=') &&
    !/^[A-Z]+-\d+$/i.test(arg)
  );

  try {
    const agent = new Layer3Agent();

    // Load requirements if available
    const legacyRequirementsPath = path.join(__dirname, '..', 'test-results', 'LAYER1-REQUIREMENTS.json');
    const requirementsPath = fs.existsSync(agent.layer1ContextPath)
      ? agent.layer1ContextPath
      : legacyRequirementsPath;

    const layer2Context = agent.loadLayer2Context();
    const explorerContext = agent.loadExplorerContext();
    let layer1Data = null;

    if (fs.existsSync(requirementsPath)) {
      layer1Data = JSON.parse(fs.readFileSync(requirementsPath, 'utf-8'));
    }

    if (args.includes('--manual-mcp') || args.includes('--mcp')) {
      await agent.runManualMCP({
        ticket: ticketArg,
        spec: specArg,
        explorerUrl: explorerUrlArg,
        runPlaywright: args.includes('--run-playwright'),
        headed: args.includes('--headed'),
        explore: args.includes('--explore'),
        explorerHeaded: args.includes('--explorer-headed'),
        testPlan: agent.loadTestPlan(),
        layer1Data,
        layer2Context,
      });
    }

    const refreshedExplorerContext = agent.loadExplorerContext();
    const layer2Queries = agent.queriesFromLayer2Context(layer2Context, explorerContext);
    const refreshedLayer2Queries = agent.queriesFromLayer2Context(layer2Context, refreshedExplorerContext);
    const activeLayer2Queries = refreshedLayer2Queries.length > 0 ? refreshedLayer2Queries : layer2Queries;

    if (activeLayer2Queries.length > 0) {
      console.log(`📎 Using Layer 2/Explorer context queries from context/\n`);
      await agent.retrieve(activeLayer2Queries, layer1Data);
    } else if (layer1Data) {
      await agent.extractKeywords(layer1Data);
    } else if (searchArgs.length > 0) {
      // Manual search from command line
      await agent.retrieve(searchArgs);
    } else {
      // Default search
      await agent.retrieve(['absence', 'confirmation', 'teacher']);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
