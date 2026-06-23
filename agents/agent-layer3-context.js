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
    const specs = options.spec ? [options.spec] : this.specsForVerification(ticket);
    const spec = options.spec || this.specForTicket(ticket);
    const verification = this.verifyWithPlaywrightMCP(testPlan, { ...options, ticket, spec, specs });
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
        comparedSpecs: verification.specs,
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
    const specs = Array.isArray(options.specs) && options.specs.length > 0
      ? options.specs
      : (spec ? [spec] : []);
    const runMode = runPlaywright ? 'run' : 'list';
    const verification = {
      status: 'skipped',
      mode: runMode,
      ticket,
      spec,
      specs,
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

    const existingSpecs = specs.filter((candidate) => fs.existsSync(path.join(this.projectRoot, candidate)));
    const missingSpecs = specs.filter((candidate) => !fs.existsSync(path.join(this.projectRoot, candidate)));
    if (missingSpecs.length > 0) {
      verification.notes.push(`Skipped missing spec(s): ${missingSpecs.join(', ')}`);
    }

    if (existingSpecs.length === 0) {
      verification.notes.push(`No existing spec found at ${spec || specs.join(', ') || '(not resolved)'}. Layer 4 can use captured context to generate it.`);
      return verification;
    }

    verification.specs = existingSpecs;

    const childEnv = this.buildPlaywrightEnv(ticket, options);

    const commands = !runPlaywright && existingSpecs.length > 1
      ? existingSpecs.map((candidate) => ['playwright', 'test', candidate, '--project=chromium', '--workers=1', '--list'])
      : [['playwright', 'test', ...existingSpecs, '--project=chromium', '--workers=1']];

    if (runPlaywright && headed) commands[0].push('--headed');

    verification.command = commands.map((args) => ['npx', ...args].join(' ')).join(' && ');
    console.log(`📡 Playwright MCP ${runMode}: ${verification.command}\n`);

    const outputs = [];
    let exitCode = 0;
    const discoveredTests = [];

    for (const args of commands) {
      const completed = spawnSync('npx', args, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = `${completed.stdout || ''}\n${completed.stderr || ''}`.trim();
      outputs.push(output);
      const currentExitCode = completed.status ?? 1;
      if (currentExitCode !== 0) {
        exitCode = currentExitCode;
        verification.notes.push(`${args[2]} failed to ${runMode}: ${output.slice(0, 1200)}`);
      }
      if (completed.error) verification.notes.push(completed.error.message);
      const parsedTests = this.parsePlaywrightOutput(output, runMode);
      if (parsedTests.length > 0) {
        discoveredTests.push(...parsedTests);
      } else if (!runPlaywright) {
        const sourceTests = this.extractTestsFromSpecSource(args[2]);
        if (sourceTests.length > 0) {
          discoveredTests.push(...sourceTests);
          verification.notes.push(`${args[2]} listed from source because Playwright could not load the spec.`);
        }
      }
    }

    const output = outputs.filter(Boolean).join('\n\n');
    verification.exitCode = exitCode;
    verification.discoveredTests = Array.from(new Set(discoveredTests));
    verification.matchedTestCases = this.matchPlanToDiscoveredTests(testPlan, verification.discoveredTests);
    verification.missingTestCases = testPlan
      .map((testCase) => testCase.id)
      .filter((id) => !verification.matchedTestCases.some((match) => match.id === id));
    verification.status = verification.discoveredTests.length > 0
      ? (verification.exitCode === 0 ? 'verified' : 'partial')
      : 'failed';
    verification.outputTail = output.slice(-4000);

    console.log(`✅ Playwright MCP status: ${verification.status}`);
    console.log(`✅ Discovered tests: ${verification.discoveredTests.length}\n`);

    return verification;
  }

  buildPlaywrightEnv(ticket, credentials = {}) {
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

    // CLI-provided credentials override per-ticket defaults and the .env file,
    // so any account can be driven straight from the command line. The employee
    // to create absences for defaults to the login username (self-absence flow).
    const username = credentials.username;
    const password = credentials.password;
    const employee = credentials.employee || username;

    if (username) {
      env.PW_USERNAME = username;
      env.ABSENCE_EMPLOYEE_SEARCH = employee;
      env.ABSENCE_EMPLOYEE_LABEL = employee;
    }
    if (password) env.PW_PASSWORD = password;
    if (credentials.school) {
      env.EXPLORER_SCHOOL = credentials.school;
      env.SCHOOL_NAME = credentials.school;
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
      const childEnv = this.buildPlaywrightEnv(options.ticket || '', options);

      // Handle storage state: only use if STORAGE_STATE env var is set AND file exists
      let contextOptions = {};
      if (childEnv.STORAGE_STATE) {
        const storageStatePath = path.join(this.projectRoot, childEnv.STORAGE_STATE);
        try {
          const stat = fs.statSync(storageStatePath);
          if (stat.isFile()) {
            contextOptions = { storageState: storageStatePath };
            console.log(`   📦 Using saved storage state: ${childEnv.STORAGE_STATE}`);
          }
        } catch (err) {
          console.log(`   ⚠️  Storage state not found: ${childEnv.STORAGE_STATE}`);
        }
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.ensureExplorerAuthenticated(page, childEnv);
      await this.ensureExplorerSchoolSelected(page, childEnv);

      baseContext.status = 'captured';
      baseContext.finalUrl = page.url();
      baseContext.title = await page.title().catch(() => '');
      baseContext.snapshots.accessibility = await this.safeAccessibilitySnapshot(page);
      baseContext.snapshots.elements = await this.indexUiElements(page);
      baseContext.snapshots.pages.push(await this.capturePageSnapshot(page, 'landing'));

      const wizardResult = await this.exploreAbsenceWizard(page, testPlan[0], childEnv);
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

  async ensureExplorerSchoolSelected(page, env) {
    const schoolName = env.EXPLORER_SCHOOL || env.SCHOOL_NAME || env.SCHOOL || '';
    const schoolPrompt = page.getByText(/select school|choose school|school selection|select a school/i).first();
    const hasPrompt = await schoolPrompt.isVisible({ timeout: 5000 }).catch(() => false);
    const hasSchoolSelect = await page.locator('select, mat-select, .mat-mdc-select, .ng-select').first().isVisible({ timeout: 1000 }).catch(() => false);

    if (!hasPrompt && !hasSchoolSelect) return;

    console.log(`🏫 Explorer school selection${schoolName ? ` using ${schoolName}` : ' using first available school'}\n`);

    const selected = await this.selectExplorerSchool(page, schoolName);
    if (!selected) {
      throw new Error(`Explorer reached school selection page but could not select ${schoolName || 'a school'}.`);
    }

    const continueButton = page.getByRole('button', { name: /continue|next|submit|select|go|ok/i }).first();
    if (await continueButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await continueButton.click();
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(750);
  }

  async selectExplorerSchool(page, schoolName = '') {
    const nativeSelect = page.locator('select').first();
    if (await nativeSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      const options = await nativeSelect.locator('option').evaluateAll((items) =>
        items
          .map((option) => ({ value: option.value, label: option.textContent?.trim() || '' }))
          .filter((option) => option.value || option.label)
      );
      const match = this.matchSchoolOption(options, schoolName);
      if (match) {
        await nativeSelect.selectOption(match.value ? { value: match.value } : { label: match.label });
        return true;
      }
    }

    const materialSelect = page.locator('mat-select, .mat-mdc-select, .mat-select, .ng-select').first();
    if (await materialSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (schoolName) {
        if (await this.chooseOptionByText(page, materialSelect, schoolName).catch(() => false)) return true;
      } else {
        if (await this.chooseFirstDropdownOption(page, materialSelect).catch(() => '')) return true;
      }

      await materialSelect.click();
      const option = page.getByRole('option').first();
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click({ force: true });
        return true;
      }
    }

    if (schoolName) {
      const schoolText = page.getByText(new RegExp(this.escapeRegex(schoolName), 'i')).first();
      if (await schoolText.isVisible({ timeout: 2000 }).catch(() => false)) {
        await schoolText.click();
        return true;
      }
    }

    const schoolCard = page.locator(
      '[data-testid*="school" i], [class*="school" i], [role="option"], li, mat-card'
    ).filter({ hasText: /\S/ }).first();
    if (await schoolCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await schoolCard.click();
      return true;
    }

    return false;
  }

  matchSchoolOption(options, schoolName = '') {
    const realOptions = options.filter((option) =>
      option.value &&
      !/select|choose/i.test(option.label)
    );

    if (schoolName) {
      const match = realOptions.find((option) =>
        option.label.toLowerCase().includes(schoolName.toLowerCase()) ||
        option.value.toLowerCase().includes(schoolName.toLowerCase())
      );
      if (match) return match;
    }

    return realOptions[0] || null;
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

  async exploreAbsenceWizard(page, plannedCase = {}, env = {}) {
    const pages = [];
    const actions = [];
    const notes = [];
    const scenario = this.explorerScenario(plannedCase, env);

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

  explorerScenario(plannedCase = {}, env = {}) {
    return {
      id: plannedCase.id || 'L3-EXPLORE',
      date: AbsenceDate.next(),
      reason: plannedCase.reason || 'Sick',
      duration: plannedCase.duration || 'Full Day',
      subPreference: plannedCase.subPreference || 'No sub required',
      school: env.EXPLORER_SCHOOL || env.SCHOOL_NAME || env.SCHOOL || plannedCase.school || '',
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

    await this.chooseSchoolInAbsenceForm(page, scenario, actions);
  }

  async chooseSchoolInAbsenceForm(page, scenario, actions) {
    const selectors = [
      'mat-select[formcontrolname="employeeSchool"]',
      '[role="listbox"][aria-label*="Select School" i]',
      '[role="listbox"][aria-label*="School" i]',
      'mat-select:has-text("Select School")',
    ];

    for (const selector of selectors) {
      const select = page.locator(selector).first();
      if (!(await select.isVisible({ timeout: 1500 }).catch(() => false))) continue;

      if (scenario.school && await this.chooseOptionByText(page, select, scenario.school).catch(() => false)) {
        actions.push(`Selected school "${scenario.school}" via ${selector}`);
        return scenario.school;
      }

      const fallback = await this.chooseFirstDropdownOption(page, select).catch(() => '');
      if (fallback) {
        actions.push(`Selected school "${fallback}" via ${selector}`);
        return fallback;
      }
    }

    actions.push(`Skipped school; no visible school selector found`);
    return null;
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
    const option = await this.findDropdownOption(page, optionLabel);

    if (!(await option.isVisible({ timeout: 2500 }).catch(() => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    await option.click({ force: true });
    await page.waitForTimeout(500);
    return true;
  }

  async findDropdownOption(page, optionLabel) {
    const optionScope = page.locator([
      '.cdk-overlay-container mat-option',
      '.cdk-overlay-container [role="option"]',
      '.cdk-overlay-container .mat-mdc-option',
      '.cdk-overlay-container .ng-option',
      '.cdk-overlay-container li',
    ].join(', '));
    const exact = optionScope
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegex(optionLabel)}\\s*$`, 'i') })
      .first();

    if (await exact.isVisible({ timeout: 1200 }).catch(() => false)) return exact;

    const partial = optionScope
      .filter({ hasText: new RegExp(this.escapeRegex(optionLabel), 'i') })
      .first();

    if (await partial.isVisible({ timeout: 1200 }).catch(() => false)) return partial;

    const text = page.getByText(new RegExp(this.escapeRegex(optionLabel), 'i')).first();
    if (await text.isVisible({ timeout: 1200 }).catch(() => false)) return text;

    return exact;
  }

  async chooseFirstDropdownOption(page, select) {
    await page.keyboard.press('Escape').catch(() => {});
    await select.click({ force: true });

    const options = page.locator([
      '.cdk-overlay-container mat-option',
      '.cdk-overlay-container [role="option"]',
      '.cdk-overlay-container .mat-mdc-option',
      '.cdk-overlay-container .ng-option',
      '.cdk-overlay-container li',
    ].join(', ')).filter({ hasText: /\S/ });

    const count = await options.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const option = options.nth(index);
      const text = (await option.innerText().catch(() => '')).trim();
      if (!text || /select|choose/i.test(text)) continue;

      await option.click({ force: true });
      await page.waitForTimeout(500);
      return text;
    }

    await page.keyboard.press('Escape').catch(() => {});
    return '';
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

  specsForVerification(ticket = '') {
    const testsDir = path.join(this.projectRoot, 'tests');
    const allSpecs = fs.existsSync(testsDir)
      ? fs.readdirSync(testsDir)
        .filter((fileName) => /\.spec\.ts$/i.test(fileName))
        .sort()
        .map((fileName) => `tests/${fileName}`)
      : [];

    const ticketSpec = this.specForTicket(ticket);
    if (!ticketSpec) return allSpecs;

    return Array.from(new Set([
      ticketSpec,
      ...allSpecs,
    ]));
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

  extractTestsFromSpecSource(spec) {
    const specPath = path.join(this.projectRoot, spec);
    if (!fs.existsSync(specPath)) return [];

    const content = fs.readFileSync(specPath, 'utf-8');
    const describeTitle = content.match(/test\.describe\(\s*(['"`])([^'"`]+)\1/)?.[2] || path.basename(spec);
    const titles = [];
    const literalTestPattern = /(?<!\.)\btest\(\s*(['"`])([^'"`$]+)\1\s*,/g;
    let literalMatch;

    while ((literalMatch = literalTestPattern.exec(content)) !== null) {
      titles.push(`${spec}: ${describeTitle} › ${literalMatch[2]}`);
    }

    const scenariosBlock = content.match(/const\s+scenarios(?:\s*:\s*[^=]+)?\s*=\s*\[([\s\S]*?)\];/);
    if (scenariosBlock) {
      const scenarioPattern = /\{([\s\S]*?)\}/g;
      let scenarioMatch;
      while ((scenarioMatch = scenarioPattern.exec(scenariosBlock[1])) !== null) {
        const scenario = this.extractScenarioFields(scenarioMatch[1]);
        if (!scenario.id) continue;

        const details = [
          scenario.reason ? `${scenario.reason} absence` : 'absence',
          scenario.duration ? `with ${scenario.duration}` : '',
          scenario.subPreference ? `and ${scenario.subPreference}` : '',
        ].filter(Boolean).join(' ');

        titles.push(`${spec}: ${describeTitle} › ${scenario.id}: ${details}`);
      }
    }

    return Array.from(new Set(titles));
  }

  extractScenarioFields(block) {
    const field = (name) => {
      const match = block.match(new RegExp(`${name}\\s*:\\s*(['"\`])([^'"\`]+)\\1`));
      return match?.[2] || '';
    };

    return {
      id: field('id'),
      reason: field('reason'),
      duration: field('duration'),
      subPreference: field('subPreference'),
    };
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
  const getFlagValue = (...prefixes) => {
    for (const prefix of prefixes) {
      const hit = args.find((arg) => arg.startsWith(prefix));
      if (hit) return hit.slice(prefix.length);
    }
    return undefined;
  };
  const usernameArg = getFlagValue('--username=', '--user=');
  const passwordArg = getFlagValue('--password=', '--pass=');
  const employeeArg = getFlagValue('--employee=');
  const schoolArg = getFlagValue('--school=', '--school-name=');
  const searchArgs = args.filter((arg) =>
    !flagArgs.has(arg) &&
    !arg.startsWith('--') &&
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

    if (args.includes('--manual-mcp') || args.includes('--mcp') || args.includes('--explore')) {
      await agent.runManualMCP({
        ticket: ticketArg,
        spec: specArg,
        explorerUrl: explorerUrlArg,
        username: usernameArg,
        password: passwordArg,
        employee: employeeArg,
        school: schoolArg,
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
