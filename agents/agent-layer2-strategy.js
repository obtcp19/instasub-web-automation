#!/usr/bin/env node

/**
 * AGENT LAYER 2: Test Strategy Generator
 * Dynamically generates test scenarios from requirements
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('@playwright/test');

class Layer2Agent {
  constructor(ticketId = '') {
    this.projectRoot = path.join(__dirname, '..');
    this.testResultsDir = path.join(this.projectRoot, 'test-results');
    this.contextDir = path.join(this.projectRoot, 'context');
    this.requirementsPath = this._resolveRequirementsPath();
    this.ticketId = ticketId;
  }

  _resolveRequirementsPath() {
    const contextPath = path.join(this.contextDir, 'layer1-requirements.json');
    if (fs.existsSync(contextPath)) return contextPath;

    return path.join(this.testResultsDir, 'LAYER1-REQUIREMENTS.json');
  }

  async generate(options = {}) {
    console.log(`\n🧠 LAYER 2 AGENT: Test Strategy Generator`);
    console.log(`📝 Generating test scenarios from requirements...\n`);

    const foundRequirements = fs.existsSync(this.requirementsPath);
    let requirements = { testableItems: [], acceptanceCriteria: [], riskFactors: [] };
    if (foundRequirements) {
      requirements = JSON.parse(fs.readFileSync(this.requirementsPath, 'utf-8'));
    }
    if (this.ticketId && !requirements.ticket) requirements.ticket = this.ticketId;

    let gherkin = this._generateGherkinFromRequirements(requirements);
    const riskMatrix = this._generateRiskMatrixFromRequirements(requirements);
    let testPlan = this._generateTestPlan(requirements);
    const mcp = this.initPlaywrightMCPServer();
    let playwrightVerification = this.verifyWithPlaywrightMCP(testPlan, requirements, options);

    if (!foundRequirements && playwrightVerification.discoveredTests.length > 0) {
      requirements = {
        ...requirements,
        ticket: this._ticketFrom(requirements),
        title: `${this._ticketFrom(requirements)} existing Playwright strategy`,
        testableItems: playwrightVerification.discoveredTests,
        generatedFromPlaywrightSpec: true,
      };
      testPlan = this._generateTestPlanFromDiscoveredTests(playwrightVerification.discoveredTests);
      gherkin = this._generateGherkinFromTestPlan(requirements, testPlan);
      playwrightVerification = this._refreshVerificationCoverage(playwrightVerification, testPlan);
    }

    const explorerContext = await this.runExplorer(testPlan, requirements, playwrightVerification, options);

    const strategyContext = this._buildStrategyContext({
      requirements,
      gherkin,
      riskMatrix,
      testPlan,
      mcp,
      playwrightVerification,
      explorerContext,
    });

    console.log(`✅ Playwright MCP coverage: ${playwrightVerification.matchedTestCases.length}/${testPlan.length}`);
    if (playwrightVerification.missingTestCases.length > 0) {
      console.log(`⚠️  Missing strategy cases in current spec: ${playwrightVerification.missingTestCases.join(', ')}`);
    }
    console.log();

    this._saveOutputs(gherkin, riskMatrix, testPlan, strategyContext, playwrightVerification, explorerContext);

    console.log(`✅ Generated: ${(gherkin.match(/Scenario:/g) || []).length} test scenarios`);
    console.log(`✅ Risk matrix: ${riskMatrix.length} items`);
    console.log(`✅ Test plan: ${testPlan.length} test cases\n`);

    return { gherkin, riskMatrix, testPlan, strategyContext, playwrightVerification, explorerContext };
  }

  initPlaywrightMCPServer() {
    console.log(`🔌 Initializing Playwright MCP strategy verification contract...\n`);

    return {
      protocol: 'MCP',
      server: process.env.PLAYWRIGHT_MCP_SERVER || 'mcp://playwright',
      capabilities: [
        'manual-playwright-verification',
        'explorer-browser-discovery',
        'accessibility-tree-snapshot',
        'ui-element-indexing',
        'test-case-discovery',
        'strategy-to-spec-mapping',
        'selector-readiness-review',
        'non-destructive-list-mode',
      ],
      endpoints: {
        explore: 'mcp://playwright/explore',
        listTests: 'mcp://playwright/list-tests',
        runTests: 'mcp://playwright/run-tests',
        validateStrategy: 'mcp://playwright/validate-strategy',
      },
    };
  }

  verifyWithPlaywrightMCP(testPlan, requirements, options = {}) {
    const ticket = this._ticketFrom(requirements);
    const spec = options.spec || this._specForTicket(ticket);
    const specPath = path.join(this.projectRoot, spec);
    const runMode = options.runPlaywright ? 'run' : 'list';

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
      notes: [],
      verifiedAt: new Date().toISOString(),
    };

    if (!ticket) {
      verification.notes.push('No ticket key was available from Layer 1 or CLI args.');
      return verification;
    }

    if (!fs.existsSync(specPath)) {
      verification.notes.push(`No existing spec found at ${spec}; generated strategy context for downstream codegen.`);
      return verification;
    }

    const args = ['playwright', 'test', spec, '--project=chromium', '--workers=1'];
    if (!options.runPlaywright) args.push('--list');
    if (options.headed && options.runPlaywright) args.push('--headed');

    verification.command = ['npx', ...args].join(' ');
    console.log(`📡 Playwright MCP ${runMode} verification: ${verification.command}\n`);

    const completed = spawnSync('npx', args, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const output = `${completed.stdout || ''}\n${completed.stderr || ''}`;
    verification.exitCode = completed.status ?? 1;
    verification.status = verification.exitCode === 0 ? 'verified' : 'failed';
    verification.discoveredTests = this._parsePlaywrightList(output);
    verification.matchedTestCases = this._matchPlanToDiscoveredTests(testPlan, verification.discoveredTests);
    verification.missingTestCases = testPlan
      .map((testCase) => testCase.id)
      .filter((id) => !verification.matchedTestCases.some((match) => match.id === id));

    if (verification.missingTestCases.length > 0) {
      verification.notes.push(
        `Strategy cases missing from current spec listing: ${verification.missingTestCases.join(', ')}`
      );
    }

    if (completed.error) verification.notes.push(completed.error.message);
    if (verification.exitCode !== 0 && output.trim()) verification.notes.push(output.trim().slice(0, 2000));

    console.log(`✅ Playwright MCP verification status: ${verification.status}`);
    console.log(`✅ Discovered tests: ${verification.discoveredTests.length}`);
    console.log();

    return verification;
  }

  async runExplorer(testPlan, requirements, playwrightVerification, options = {}) {
    const url = options.explorerUrl || process.env.EXPLORER_URL || 'https://instasublogin.tcpsoftware.com/';
    const ticket = this._ticketFrom(requirements);
    const baseContext = {
      layer: 'Explorer',
      status: options.explore ? 'pending' : 'skipped',
      mode: options.explore ? 'browser' : 'planned',
      url,
      ticket,
      generatedAt: new Date().toISOString(),
      mcp: {
        protocol: 'MCP',
        server: process.env.PLAYWRIGHT_MCP_SERVER || 'mcp://playwright',
        endpoint: 'mcp://playwright/explore',
      },
      why: 'Generates authoritative selectors and flow docs for downstream Layer 3 context retrieval and Layer 4 codegen.',
      coverage: this._explorerCoverage(testPlan, playwrightVerification),
      snapshots: {
        accessibility: null,
        elements: { buttons: [], inputs: [], tables: [] },
      },
      flowVerification: {
        mode: options.runPlaywright ? 'executed-by-playwright' : 'mapped-from-current-spec',
        command: playwrightVerification.command,
        status: playwrightVerification.status,
        matchedTestCases: playwrightVerification.matchedTestCases,
        missingTestCases: playwrightVerification.missingTestCases,
      },
      notes: [],
    };

    if (!options.explore) {
      baseContext.notes.push('Explorer browser launch skipped. Run Layer 2 with --explore to capture live UI selectors.');
      return baseContext;
    }

    console.log(`🧭 Explorer: launching Chromium and opening ${url}\n`);

    let browser;
    try {
      browser = await chromium.launch({ headless: !options.explorerHeaded });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      baseContext.status = 'captured';
      baseContext.finalUrl = page.url();
      baseContext.title = await page.title().catch(() => '');
      baseContext.snapshots.accessibility = await this._safeAccessibilitySnapshot(page);
      baseContext.snapshots.elements = await this._indexUiElements(page);
      baseContext.flowDocs = this._buildExplorerFlowDocs(testPlan, baseContext.snapshots.elements);

      console.log(
        `✅ Explorer captured ${baseContext.snapshots.elements.buttons.length} buttons, ` +
          `${baseContext.snapshots.elements.inputs.length} inputs, ` +
          `${baseContext.snapshots.elements.tables.length} tables\n`
      );
    } catch (error) {
      baseContext.status = 'failed';
      baseContext.notes.push(error.message);
      console.log(`⚠️  Explorer failed: ${error.message}\n`);
    } finally {
      if (browser) await browser.close();
    }

    return baseContext;
  }

  async _safeAccessibilitySnapshot(page) {
    if (page.accessibility?.snapshot) {
      return page.accessibility.snapshot({ interestingOnly: false }).catch(() => null);
    }

    return page.locator('body').evaluate((body) => ({
      role: 'document',
      name: document.title,
      textPreview: body.innerText.slice(0, 4000),
    })).catch(() => null);
  }

  async _indexUiElements(page) {
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

  _explorerCoverage(testPlan, playwrightVerification) {
    const matchedIds = new Set((playwrightVerification.matchedTestCases || []).map((match) => match.id));
    return {
      plannedCases: testPlan.length,
      coveredCases: testPlan.filter((testCase) => matchedIds.has(testCase.id)).length,
      missingCases: testPlan.map((testCase) => testCase.id).filter((id) => !matchedIds.has(id)),
      coveredByOtherLayer: {
        layer2PlaywrightVerification: matchedIds.size,
        layer5Execution: 'covered when agent-layer5-execution.js runs the generated/current spec',
      },
    };
  }

  _buildExplorerFlowDocs(testPlan, elements) {
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
      generatedCases: testPlan.map((testCase) => ({
        id: testCase.id,
        title: testCase.description,
        verification: testCase.playwrightTitle ? 'mapped-to-current-playwright-spec' : 'requires-codegen-or-manual-exploration',
      })),
    };
  }

  _generateGherkinFromRequirements(requirements) {
    const title = requirements.title || 'Feature Test';
    let gherkin = `Feature: ${title}\n`;
    gherkin += `  Ticket: ${requirements.ticket}\n`;
    gherkin += `  Priority: ${requirements.priority}\n\n`;

    if (requirements.pairwiseScenarios && requirements.pairwiseScenarios.length > 0) {
      gherkin += `  Background:\n`;
      gherkin += `    Given the administrator is on the Employee absence creation flow\n`;
      gherkin += `    And the target employee is selected\n\n`;

      requirements.pairwiseScenarios.forEach(scenario => {
        gherkin += `  Scenario: ${scenario.id} - Employee absence ${scenario.reason} / ${scenario.duration} / ${scenario.subPreference}\n`;
        gherkin += `    Given the absence date is "${scenario.date}"\n`;
        gherkin += `    And the absence reason is "${scenario.reason}"\n`;
        gherkin += `    And the duration is "${scenario.duration}"\n`;
        gherkin += `    And the substitute preference is "${scenario.subPreference}"\n`;
        if (scenario.subSelected && scenario.subSelected !== '—') {
          gherkin += `    And the substitute selected is "${scenario.subSelected}"\n`;
        }
        gherkin += `    When the employee absence is submitted\n`;
        gherkin += `    Then the test result should be "${scenario.result}"\n\n`;
      });

      return gherkin;
    }

    // Generate scenarios from testable items
    if (requirements.testableItems && requirements.testableItems.length > 0) {
      gherkin += `  Background:\n    Given system is initialized\n\n`;

      requirements.testableItems.forEach((item, idx) => {
        gherkin += `  Scenario: Test case ${idx + 1} - ${item}\n`;
        gherkin += `    When test executes\n`;
        gherkin += `    Then result is recorded\n\n`;
      });
    }

    // Add acceptance criteria as scenarios
    if (requirements.acceptanceCriteria && requirements.acceptanceCriteria.length > 0) {
      requirements.acceptanceCriteria.forEach((ac, idx) => {
        gherkin += `  Scenario: Acceptance criteria ${idx + 1}\n`;
        gherkin += `    ${ac}\n\n`;
      });
    }

    return gherkin;
  }

  _generateGherkinFromTestPlan(requirements, testPlan) {
    const title = requirements.title || 'Feature Test';
    let gherkin = `Feature: ${title}\n`;
    gherkin += `  Ticket: ${requirements.ticket || 'UNKNOWN'}\n`;
    gherkin += `  Source: Existing Playwright spec listing\n\n`;
    gherkin += `  Background:\n`;
    gherkin += `    Given the current Playwright spec is available\n\n`;

    testPlan.forEach((testCase) => {
      gherkin += `  Scenario: ${testCase.id} - ${testCase.description}\n`;
      gherkin += `    When the existing Playwright test is listed or executed\n`;
      gherkin += `    Then the strategy case should map to "${testCase.playwrightTitle}"\n\n`;
    });

    return gherkin;
  }

  _generateRiskMatrixFromRequirements(requirements) {
    const riskMatrix = [];

    if (requirements.riskFactors && requirements.riskFactors.length > 0) {
      requirements.riskFactors.forEach(risk => {
        riskMatrix.push({
          risk: risk.factor,
          severity: risk.severity,
          likelihood: risk.likelihood,
          testStrategy: this._suggestTestStrategy(risk),
          mitigation: this._suggestMitigation(risk),
        });
      });
    }

    return riskMatrix;
  }

  _suggestTestStrategy(risk) {
    if (risk.factor.includes('null') || risk.factor.includes('flaky')) {
      return 'Retry test 5 times, verify consistency';
    }
    if (risk.factor.includes('race') || risk.factor.includes('async')) {
      return 'Add explicit waits, test parallelization';
    }
    if (risk.factor.includes('timeout')) {
      return 'Increase wait timeout, measure duration';
    }
    return 'Standard test with error handling';
  }

  _suggestMitigation(risk) {
    if (risk.severity === 'HIGH') {
      return 'Add retry logic, increase wait times';
    }
    if (risk.severity === 'MEDIUM') {
      return 'Add explicit waits, reduce parallelization';
    }
    return 'Standard error handling';
  }

  _generateTestPlan(requirements) {
    const testPlan = [];

    if (requirements.pairwiseScenarios && requirements.pairwiseScenarios.length > 0) {
      return requirements.pairwiseScenarios.map((scenario, idx) => ({
        id: scenario.id || `TC-${String(idx + 1).padStart(2, '0')}`,
        category: 'PAIRWISE-REGRESSION',
        description: `${scenario.reason} absence with ${scenario.duration} and ${scenario.subPreference}`,
        priority: 'HIGH',
        date: scenario.date,
        reason: scenario.reason,
        duration: scenario.duration,
        subPreference: scenario.subPreference,
        subSelected: scenario.subSelected,
        expectedResult: scenario.result,
      }));
    }

    const namedTestCases = (requirements.testableItems || [])
      .map((item) => {
        const match = String(item || '').match(/^(TC-[A-Z0-9-]+)\s*[—:-]\s*([^:]+)(?::\s*(.*))?$/i);
        if (!match) return null;
        return {
          id: match[1].toUpperCase(),
          category: 'REQUIREMENT',
          description: match[2].trim(),
          priority: 'HIGH',
          sourceSteps: match[3]?.trim() || '',
        };
      })
      .filter(Boolean);
    if (namedTestCases.length > 0) return namedTestCases;

    // Positive path tests
    testPlan.push({
      id: 'TC-01',
      category: 'POSITIVE',
      description: 'Execute main workflow successfully',
      priority: 'CRITICAL',
    });

    // Negative path tests (from acceptance criteria)
    if (requirements.acceptanceCriteria && requirements.acceptanceCriteria.length > 0) {
      requirements.acceptanceCriteria.forEach((ac, idx) => {
        testPlan.push({
          id: `TC-${idx + 2}`,
          category: 'NEGATIVE',
          description: ac,
          priority: 'HIGH',
        });
      });
    }

    // Risk-based tests
    if (requirements.riskFactors && requirements.riskFactors.length > 0) {
      requirements.riskFactors.forEach((risk, idx) => {
        testPlan.push({
          id: `TC-${testPlan.length + 1}`,
          category: 'RISK-MITIGATION',
          description: `Test for: ${risk.factor}`,
          priority: 'CRITICAL',
          retryCount: 5,
        });
      });
    }

    return testPlan;
  }

  _generateTestPlanFromDiscoveredTests(discoveredTests) {
    return discoveredTests
      .filter((title) => !/auth\.setup|authenticate/i.test(title))
      .map((title, idx) => {
        const id = title.match(/\b(T\d+|TC-\d+)\b/i)?.[1] || `TC-${String(idx + 1).padStart(2, '0')}`;
        const description = title.split('›').pop()?.trim() || title;

        return {
          id,
          category: 'EXISTING-PLAYWRIGHT',
          description,
          priority: 'HIGH',
          playwrightTitle: title,
          source: 'playwright-list',
        };
      });
  }

  _buildStrategyContext({ requirements, gherkin, riskMatrix, testPlan, mcp, playwrightVerification, explorerContext }) {
    const ticket = this._ticketFrom(requirements);
    const retrievalQueries = this._buildRetrievalQueries(requirements, testPlan);

    return {
      layer: 2,
      ticket,
      generatedAt: new Date().toISOString(),
      sourceRequirements: {
        path: path.relative(this.projectRoot, this.requirementsPath),
        found: fs.existsSync(this.requirementsPath),
        title: requirements.title || null,
        priority: requirements.priority || null,
        acceptanceCriteriaCount: requirements.acceptanceCriteria?.length || 0,
        testableItemsCount: requirements.testableItems?.length || 0,
      },
      artifacts: {
        gherkin: 'test-results/LAYER2-TEST-STRATEGY.feature',
        riskMatrix: 'test-results/LAYER2-RISK-MATRIX.json',
        testPlan: 'test-results/LAYER2-TEST-PLAN.json',
        requirements: 'context/layer1-requirements.json',
        contextTestPlan: 'context/layer2-test-plan.json',
        playwrightVerification: 'context/playwright-verification.json',
        explorerContext: 'context/explorer-context.json',
      },
      mcp,
      retrievalQueries,
      codegenHints: this._buildCodegenHints(requirements, testPlan, playwrightVerification),
      gherkinPreview: gherkin.split('\n').slice(0, 40).join('\n'),
      riskMatrix,
      testPlan,
      playwrightVerification,
      explorerContext,
    };
  }

  _saveOutputs(gherkin, riskMatrix, testPlan, strategyContext, playwrightVerification, explorerContext) {
    fs.mkdirSync(this.testResultsDir, { recursive: true });
    fs.mkdirSync(this.contextDir, { recursive: true });

    const gherkinPath = path.join(this.testResultsDir, 'LAYER2-TEST-STRATEGY.feature');
    const riskPath = path.join(this.testResultsDir, 'LAYER2-RISK-MATRIX.json');
    const planPath = path.join(this.testResultsDir, 'LAYER2-TEST-PLAN.json');
    const contextPath = path.join(this.contextDir, 'layer2-strategy-context.json');
    const contextPlanPath = path.join(this.contextDir, 'layer2-test-plan.json');
    const verificationPath = path.join(this.contextDir, 'playwright-verification.json');
    const explorerPath = path.join(this.contextDir, 'explorer-context.json');
    const readmePath = path.join(this.contextDir, 'README.md');

    fs.writeFileSync(gherkinPath, gherkin);
    fs.writeFileSync(riskPath, JSON.stringify(riskMatrix, null, 2));
    fs.writeFileSync(planPath, JSON.stringify(testPlan, null, 2));
    fs.writeFileSync(contextPath, JSON.stringify(strategyContext, null, 2));
    fs.writeFileSync(contextPlanPath, JSON.stringify(testPlan, null, 2));
    fs.writeFileSync(verificationPath, JSON.stringify(playwrightVerification, null, 2));
    fs.writeFileSync(explorerPath, JSON.stringify(explorerContext, null, 2));
    fs.writeFileSync(readmePath, this._contextReadme());

    console.log(`💾 Saved: LAYER2-TEST-STRATEGY.feature`);
    console.log(`💾 Saved: LAYER2-RISK-MATRIX.json`);
    console.log(`💾 Saved: LAYER2-TEST-PLAN.json\n`);
    console.log(`💾 Saved: context/layer2-strategy-context.json`);
    console.log(`💾 Saved: context/layer2-test-plan.json`);
    console.log(`💾 Saved: context/playwright-verification.json\n`);
    console.log(`💾 Saved: context/explorer-context.json\n`);
  }

  _ticketFrom(requirements) {
    return (this.ticketId || requirements.ticket || process.env.TICKET_NAME || process.env.LAYER5_TICKET || '').toUpperCase();
  }

  _specForTicket(ticket) {
    if (!ticket) return '';
    const direct = `tests/${ticket}.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, direct))) return direct;

    const legacy = `tests/${ticket}-absence-creation.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, legacy))) return legacy;

    return direct;
  }

  _parsePlaywrightList(output) {
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('[') && line.includes('›'))
      .map((line) => line.replace(/^\[[^\]]+\]\s*›\s*/, '').trim());
  }

  _matchPlanToDiscoveredTests(testPlan, discoveredTests) {
    return testPlan
      .map((testCase) => {
        const match = discoveredTests.find((title) => title.includes(testCase.id));
        return match ? { id: testCase.id, title: match } : null;
      })
      .filter(Boolean);
  }

  _refreshVerificationCoverage(verification, testPlan) {
    const matchedTestCases = this._matchPlanToDiscoveredTests(testPlan, verification.discoveredTests);

    return {
      ...verification,
      matchedTestCases,
      missingTestCases: testPlan
        .map((testCase) => testCase.id)
        .filter((id) => !matchedTestCases.some((match) => match.id === id)),
    };
  }

  _buildRetrievalQueries(requirements, testPlan) {
    const queries = [
      requirements.title,
      'playwright page object model selectors',
      'explorer accessibility snapshot buttons inputs tables',
      'login username password button selectors',
      'existing Playwright workflow implementation',
      'reusable form table dialog and notification helpers',
      ...(requirements.acceptanceCriteria || []),
      ...testPlan.map((testCase) => testCase.description),
    ];

    return Array.from(new Set(queries.filter(Boolean))).slice(0, 30);
  }

  _buildCodegenHints(requirements, testPlan, playwrightVerification) {
    const mutatesSharedState = /seed|delete|reset|re-create|idempotent/i.test([
      requirements.title,
      ...(requirements.testableItems || []),
    ].filter(Boolean).join(' '));
    return {
      targetSpec: this._specForTicket(this._ticketFrom(requirements)),
      preferExistingPom: true,
      requiredAssertions: (requirements.acceptanceCriteria || []).slice(0, 10),
      executionMode: mutatesSharedState
        ? 'serial because the workflow mutates shared application state'
        : 'independent tests unless the workflow context requires serialization',
      strategyCoverage: {
        planned: testPlan.length,
        matchedInCurrentSpec: playwrightVerification.matchedTestCases.length,
        missingInCurrentSpec: playwrightVerification.missingTestCases,
      },
    };
  }

  _contextReadme() {
    return `# Agent Context Handoff

This folder is generated by Layers 1-3 and consumed by Layer 4.

- layer1-requirements.json: Jira requirements extracted by Layer 1.
- layer2-strategy-context.json: strategy, MCP verification, retrieval queries, and codegen hints.
- layer2-test-plan.json: normalized test cases for code generation.
- playwright-verification.json: current Playwright listing/run result used to compare strategy coverage.
- mcp-playwright-context.json: manual Playwright MCP execution/listing context captured by Layer 3.
- explorer-context.json: browser-discovered a11y snapshot, UI elements, selectors, and flow coverage captured by Layer 3.
- layer3-retrieval-context.json: reusable assets discovered by Layer 3.

Layer 3 manual MCP uses non-destructive Playwright listing by default:

\`\`\`bash
node agents/agent-layer3-context.js ISE-1556 --manual-mcp
\`\`\`

Actual Playwright execution and browser discovery are opt-in:

\`\`\`bash
node agents/agent-layer3-context.js ISE-1556 --manual-mcp --run-playwright
node agents/agent-layer3-context.js ISE-1556 --manual-mcp --explore
\`\`\`
`;
  }
}

// CLI Entry Point
async function main() {
  try {
    const args = process.argv.slice(2);
    const ticketArg = args.find((arg) => /^[A-Z]+-\d+$/i.test(arg));
    const agent = new Layer2Agent(ticketArg || '');
    await agent.generate({
      runPlaywright: args.includes('--run-playwright'),
      headed: args.includes('--headed'),
      explore: args.includes('--explore'),
      explorerHeaded: args.includes('--explorer-headed') || args.includes('--headed'),
      explorerUrl: valueForArg(args, '--explorer-url'),
      spec: valueForArg(args, '--spec'),
    });
    process.exit(0);
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

main();
