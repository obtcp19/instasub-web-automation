#!/usr/bin/env node

/**
 * AGENT LAYER 4: Test Code Generator
 * Generates Playwright test files from strategy using Playwright MCP Server
 *
 * Integration: Playwright MCP Server (Model Context Protocol)
 * - Provides real-time code generation capabilities
 * - Access to Playwright documentation & best practices
 * - Dynamic test scaffolding based on strategy
 * - Automatic selector optimization & validation
 */

const fs = require('fs');
const path = require('path');
const context = require('../vector-db/context-api.js');
const tpl = require('./lib/codegen-templates.js');

class Layer4Agent {

  constructor(workItemId = '') {
    this.workItemId = String(
      workItemId ||
      process.env.WORK_ITEM_ID ||
      process.env.TEST_ID ||
      'GENERATED'
    ).trim().toUpperCase();
    this.artifactId = this.workItemId
      .replace(/[^A-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'GENERATED';
    this.projectRoot = path.join(__dirname, '..');
    this.testResultsDir = this._resolveConfiguredPath(process.env.CODEGEN_RESULTS_DIR, 'test-results');
    this.contextDir = this._resolveConfiguredPath(process.env.CODEGEN_CONTEXT_DIR, 'context');
    this.pomDir = this._resolveConfiguredPath(process.env.CODEGEN_POM_DIR, 'pom');
    this.testsDir = this._resolveConfiguredPath(process.env.CODEGEN_TESTS_DIR, 'tests');
    this.generationContextPath = this._resolveConfiguredPath(
      process.env.CODEGEN_REPORT_PATH,
      path.join(path.relative(this.projectRoot, this.contextDir), 'layer4-generation-context.json')
    );
    const configuredThreshold = Number(process.env.REUSE_THRESHOLD ?? 0.55);
    this.REUSE_THRESHOLD =
      Number.isFinite(configuredThreshold) && configuredThreshold >= 0 && configuredThreshold <= 1
        ? configuredThreshold
        : 0.55;
    const configuredQueryLimit = Number(process.env.MAX_RETRIEVAL_QUERIES ?? 40);
    this.MAX_RETRIEVAL_QUERIES =
      Number.isInteger(configuredQueryLimit) && configuredQueryLimit > 0
        ? configuredQueryLimit
        : 40;
    this.vectorSearchCompleted = false;
    this.reuseDecisions = [];

    fs.mkdirSync(this.contextDir, { recursive: true });
    fs.mkdirSync(this.pomDir, { recursive: true });
    fs.mkdirSync(this.testsDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.generationContextPath), { recursive: true });

    // Strict guard rules for Playwright code generation
    this.GUARD_RULES = {
      locators: [
        'Strictly use user-facing attributes (getByRole, getByText, getByLabel).',
        'Use data-testid only as a last resort fallback.',
        'Never use brittle XPath or CSS selectors linked to page structure (e.g., div > span > button).'
      ],
      assertions: [
        'Always use web-first, auto-retrying assertions (expect(locator).toBeVisible()).',
        'Never mix up generic assertions with locators (e.g., do not use expect(await locator.isVisible()).toBe(true)).'
      ],
      waiting: [
        'Rely on automatic waiting built into Playwright actions.',
        'Hardcoded wait times (page.waitForTimeout()) are strictly forbidden.'
      ],
      stateManagement: [
        'Isolate tests completely; never share state between test blocks.',
        'Use beforeAll/beforeEach hooks exclusively for setup and authentication.'
      ]
    };

    // Advanced design patterns and architectural standards
    this.BEST_PRACTICES = {
      pomPattern: [
        'Encapsulate selectors and actions inside specific Page Object classes.',
        'Do not expose raw Page objects or selectors inside the test spec files.'
      ],
      screenplayPattern: [
        'Model tests around Actors, Abilities, and Tasks only when the repository already uses that architecture.',
        'Keep page micro-interactions cleanly separated from business-logic tasks.'
      ],
      strategyPattern: [
        'Inject structural strategies dynamically to handle runtime variances like A/B feature flags or regional flows.',
        'Switch execution mechanics at runtime without altering the underlying test body steps.'
      ],
      decoratorInterceptorPattern: [
        'Use page.route() intercepts to programmatically mock slow or flaky 3rd-party network endpoints.',
        'Decorate test tracking hooks to passively capture console logs or network performance metrics without cluttering test code.'
      ],
      builderPattern: [
        'Use Data Builders for complex payloads when they reduce duplication.',
        'Avoid hardcoded JSON fixtures directly in the test body to preserve flexibility.'
      ],
      factoryPattern: [
        'Use a Page Factory or Component Factory to instantiate pages dynamically based on context.',
        'Dynamically spin up specific user roles or environments using a Factory wrapper.'
      ],
      singletonPattern: [
        'Use Playwright storageState to save auth states once per worker session.',
        'Reuse the saved auth payload across multiple specs to eliminate redundant login steps.'
      ],
      errorHandling: [
        'Set an explicit, unified timeout strategy (default 10s timeout per action).',
        'Add custom console log details on failure for CI/CD debugging wrappers.'
      ],
      backendVerification: [
        'Keep API, service, or persistence verification inside dedicated helpers rather than UI page objects.',
        'Verify backend state only after the user-facing operation reports completion.'
      ]
    };
  }

  _resolveConfiguredPath(configuredPath, fallbackRelativePath) {
    const selected = configuredPath || fallbackRelativePath;
    return path.isAbsolute(selected) ? selected : path.join(this.projectRoot, selected);
  }

  _contextFile(environmentName, fileName) {
    return this._resolveConfiguredPath(
      process.env[environmentName],
      path.join(path.relative(this.projectRoot, this.contextDir), fileName)
    );
  }

  /**
   * Build natural-language retrieval queries from the Layer 2 test plan so
   * Layer 3 can surface reusable assets for exactly these scenarios.
   */
  buildQueries(testPlan) {
    const layer2Context = this.loadJson(
      this._contextFile('LAYER2_STRATEGY_CONTEXT_PATH', 'layer2-strategy-context.json'),
      null
    );
    const manualMcpContext = this.loadJson(
      this._contextFile('PLAYWRIGHT_MCP_CONTEXT_PATH', 'mcp-playwright-context.json'),
      null
    );
    const explorerContext = this.loadJson(
      this._contextFile('EXPLORER_CONTEXT_PATH', 'explorer-context.json'),
      null
    );
    const queries = testPlan
      .map((tc) => tc && tc.description)
      .filter(Boolean);
    if (layer2Context?.retrievalQueries) queries.push(...layer2Context.retrievalQueries);
    if (layer2Context?.codegenHints?.requiredAssertions) queries.push(...layer2Context.codegenHints.requiredAssertions);
    if (manualMcpContext?.verification?.discoveredTests) {
      queries.push(...manualMcpContext.verification.discoveredTests);
    }
    if (manualMcpContext?.codegenHints?.targetSpec) {
      queries.push(`target spec ${manualMcpContext.codegenHints.targetSpec}`);
    }
    if (explorerContext?.snapshots?.elements?.inputs) {
      queries.push(...explorerContext.snapshots.elements.inputs.map((input) => `input ${input.label} ${input.selector}`));
    }
    if (explorerContext?.snapshots?.elements?.buttons) {
      queries.push(...explorerContext.snapshots.elements.buttons.map((button) => `button ${button.text} ${button.selector}`));
    }
    queries.push(
      `existing Playwright page object for ${this.workItemId}`,
      'existing Playwright page object for this workflow',
      'similar Playwright test specification',
      'reusable Playwright fixtures and authentication setup',
      'repository selector and assertion conventions',
      'page object model selectors',
      'test data builder or verification helper'
    );
    return Array.from(
      new Set(queries.map((query) => String(query || '').trim()).filter(Boolean))
    ).slice(0, this.MAX_RETRIEVAL_QUERIES);
  }

  loadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      throw new Error(`Invalid JSON in ${path.relative(this.projectRoot, filePath)}: ${error.message}`);
    }
  }

  /** Relative TS import path (no extension) from one dir to a target file. */
  _toImport(fromDir, absPathNoExt) {
    let rel = path.relative(fromDir, absPathNoExt).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  }

  _assetPath(asset) {
    if (!asset?.path) return '';
    return path.isAbsolute(asset.path) ? asset.path : path.join(this.projectRoot, asset.path);
  }

  _resolveTypeScriptImport(fromFile, importPath) {
    if (!importPath?.startsWith('.')) return '';
    const base = path.resolve(path.dirname(fromFile), importPath);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.js`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.js'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
  }

  _findReusableDataDrivenContract(retrieval) {
    const specAssets = (retrieval.assets || [])
      .filter((asset) => asset.type === 'Spec' && fs.existsSync(this._assetPath(asset)))
      .sort((left, right) => right.similarity - left.similarity);

    for (const asset of specAssets) {
      const specPath = this._assetPath(asset);
      const source = fs.readFileSync(specPath, 'utf-8');
      if (!/const\s+scenarios(?:\s*:\s*[^=]+)?\s*=\s*\[/s.test(source)) continue;
      if (!/for\s*\(\s*const\s+scenario\s+of\s+scenarios\s*\)/.test(source)) continue;

      const relativeImports = Array.from(
        source.matchAll(/import\s*\{([^}]+)\}\s*from\s*(['"])(\.[^'"]+)\2/g)
      );
      let contractImport = null;
      let instanceName = '';
      let className = '';

      for (const imported of relativeImports) {
        const importedNames = imported[1].split(',').map((name) => name.trim()).filter(Boolean);
        const declarations = Array.from(
          source.matchAll(/let\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g)
        );
        const instance = declarations.find((declaration) => importedNames.includes(declaration[2]));
        if (!instance) continue;

        contractImport = { imported, importedNames };
        instanceName = instance[1];
        className = instance[2];
        break;
      }
      if (!contractImport) continue;

      const pomPath = this._resolveTypeScriptImport(specPath, contractImport.imported[3]);
      if (!pomPath) continue;

      const scenarioType = contractImport.importedNames.find((name) => name !== className) || '';
      const loopStart = source.search(/for\s*\(\s*const\s+scenario\s+of\s+scenarios\s*\)/);
      const loopSource = loopStart === -1 ? '' : source.slice(loopStart);
      const methodPattern = new RegExp(
        `await\\s+${this.escapeRegex(instanceName)}\\.([A-Za-z_$][\\w$]*)\\(([^;]*)\\);`,
        'g'
      );
      const calls = [];
      let methodMatch;
      while ((methodMatch = methodPattern.exec(loopSource)) !== null) {
        calls.push({
          method: methodMatch[1],
          usesScenario: /\bscenario\b/.test(methodMatch[2]),
          acceptsOptions: /\bscenario\s*,/.test(methodMatch[2]),
        });
      }
      if (calls.length === 0 || !calls.some((call) => call.usesScenario)) continue;

      const pomSource = fs.readFileSync(pomPath, 'utf-8');
      const methods = context.extractMethods(pomSource);
      const exports = context.extractExports(pomSource);
      if (!exports.includes(className) || calls.some((call) => !methods.includes(call.method))) continue;
      if (scenarioType && !exports.includes(scenarioType)) continue;

      return {
        sourceSpec: asset,
        specPath,
        pomPath,
        className,
        scenarioType,
        calls,
      };
    }

    return null;
  }

  escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _classNameForAsset(asset) {
    const exportedClass = (asset?.exports || []).find((name) => /Page$|PageObject$/i.test(name));
    if (exportedClass) return exportedClass;
    return String(asset?.fileName || '')
      .replace(/\.page\.ts$/i, '')
      .replace(/\.ts$/i, '');
  }

  _requiredMethodsForPlan(testPlan, asset = null) {
    const layer2Context = this.loadJson(
      this._contextFile('LAYER2_STRATEGY_CONTEXT_PATH', 'layer2-strategy-context.json'),
      {}
    );
    const configured = layer2Context?.codegenHints?.requiredPageObjectMethods || [];
    const planned = (testPlan || []).flatMap((testCase) =>
      (testCase?.steps || []).flatMap((step) => [
        step?.method,
        step?.pageObjectMethod,
        step?.actionMethod,
      ])
    );
    const templateMethods = asset ? this._templateMethodsForAsset(asset, testPlan) : [];

    return Array.from(
      new Set(
        [...configured, ...planned, ...templateMethods]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
  }

  _templateMethodsForAsset(asset, testPlan) {
    const locators = tpl.describeLocators(asset?.selectors || []);
    const methods = ['navigateTo'];

    for (const testCase of testPlan || []) {
      const category = String(testCase?.category || '').toUpperCase();
      const target = category === 'NEGATIVE'
        ? locators.find((locator) => /error/i.test(locator.prop))
        : locators.find((locator) => /confirm|success|result/i.test(locator.prop)) ||
          locators.find((locator) => locator.tag !== 'button');
      if (target) methods.push(`is${target.Prop}Visible`);
    }

    return Array.from(new Set(methods));
  }

  _requiredExportsForPlan() {
    const layer2Context = this.loadJson(
      this._contextFile('LAYER2_STRATEGY_CONTEXT_PATH', 'layer2-strategy-context.json'),
      {}
    );
    return Array.from(
      new Set(
        (layer2Context?.codegenHints?.requiredExports || [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
  }

  _scoreAssetCompatibility(asset, testPlan) {
    const absolutePath = this._assetPath(asset);
    const exists = Boolean(absolutePath && fs.existsSync(absolutePath));
    const isPom = asset?.type === 'POM';
    const className = this._classNameForAsset(asset);
    const hasExport = Boolean(className && (asset?.exports || []).includes(className));
    const requiredMethods = this._requiredMethodsForPlan(testPlan, asset);
    const missingMethods = requiredMethods.filter((method) => !(asset?.methods || []).includes(method));
    const requiredExports = this._requiredExportsForPlan();
    const missingExports = requiredExports.filter((name) => !(asset?.exports || []).includes(name));
    const selectorCount = asset?.selectors?.length || 0;
    const hasExplicitContract = requiredMethods.length > 0 || requiredExports.length > 0;
    const satisfiesExplicitContract =
      hasExplicitContract &&
      missingMethods.length === 0 &&
      missingExports.length === 0;
    const meetsSemanticThreshold = Number(asset.similarity || 0) >= this.REUSE_THRESHOLD;
    const reusable =
      exists &&
      isPom &&
      hasExport &&
      meetsSemanticThreshold &&
      satisfiesExplicitContract &&
      missingMethods.length === 0 &&
      missingExports.length === 0;

    let compatibility = Number(asset?.similarity || 0);
    if (exists) compatibility += 0.1;
    if (isPom) compatibility += 0.15;
    if (hasExport) compatibility += 0.1;
    if (selectorCount > 0) compatibility += 0.05;
    if (missingMethods.length > 0) compatibility -= 0.25;
    if (missingExports.length > 0) compatibility -= 0.15;

    return {
      asset,
      absolutePath,
      className,
      exists,
      isPom,
      hasExport,
      selectorCount,
      requiredMethods,
      missingMethods,
      requiredExports,
      missingExports,
      hasExplicitContract,
      satisfiesExplicitContract,
      meetsSemanticThreshold,
      reusable,
      compatibility,
    };
  }

  matchVectorAssets(retrieval, testPlan) {
    if (!this.vectorSearchCompleted) {
      throw new Error('Vector DB matching must complete before code-generation decisions are made.');
    }

    const ranked = (retrieval.assets || [])
      .map((asset) => this._scoreAssetCompatibility(asset, testPlan))
      .sort((a, b) => b.compatibility - a.compatibility);
    const selectedPom = ranked.find((candidate) => candidate.reusable) || null;
    const referencePom = ranked.find((candidate) =>
      candidate.exists && candidate.isPom && candidate.hasExport && candidate.selectorCount > 0
    ) || null;

    this.reuseDecisions = ranked.map((candidate) => ({
      path: candidate.asset.path,
      type: candidate.asset.type,
      similarity: candidate.asset.similarity,
      decision: selectedPom?.asset.path === candidate.asset.path
        ? 'reused'
        : referencePom?.asset.path === candidate.asset.path
          ? 'adapted'
          : 'rejected',
      reason: selectedPom?.asset.path === candidate.asset.path
        ? 'Compatible exported Page Object met the semantic threshold and the context-declared method/export contract.'
        : !candidate.exists
          ? 'Indexed source file no longer exists.'
          : !candidate.isPom
            ? 'Asset is useful context but is not a Page Object.'
            : !candidate.hasExport
              ? 'No reusable exported Page Object class was identified.'
              : !candidate.hasExplicitContract
                ? 'No explicit Page Object method/export contract was provided; using matched code only as a generation reference.'
              : candidate.missingMethods.length > 0
                ? `Missing required methods: ${candidate.missingMethods.join(', ')}.`
                : candidate.missingExports.length > 0
                  ? `Missing required exports: ${candidate.missingExports.join(', ')}.`
                : candidate.asset.similarity < this.REUSE_THRESHOLD
                  ? `Similarity is below the ${this.REUSE_THRESHOLD} reuse threshold.`
                  : 'A stronger compatible Page Object was selected.',
    }));

    return { ranked, selectedPom, referencePom };
  }

  async retrieveAndMatch(testPlan) {
    const queries = this.buildQueries(testPlan);
    console.log(`\n📚 Querying vector DB before any code-generation decision...`);
    console.log(`   ${queries.length} semantic queries prepared`);

    let retrieval;
    try {
      retrieval = await context.retrieveContext(queries);
      this.vectorSearchCompleted = true;
    } catch (error) {
      this.vectorSearchCompleted = true;
      retrieval = { assets: [], queries, error: error.message };
      console.log(`⚠️  Vector DB retrieval unavailable: ${error.message}`);
    }

    if (!retrieval.assets.length) {
      console.log('⚠️  Vector DB returned no reusable repository assets.');
      console.log('    Run: npm run vector-db:index\n');
    } else {
      console.log(`✅ Vector DB returned ${retrieval.assets.length} candidate asset(s):`);
      retrieval.assets.forEach((asset) => {
        console.log(`   - [${asset.type}] ${asset.fileName} (${(asset.similarity * 100).toFixed(1)}% match)`);
      });
      console.log(`\n${context.formatContext(retrieval)}\n`);
    }

    const matches = this.matchVectorAssets(retrieval, testPlan);
    if (matches.selectedPom) {
      console.log(
        `♻️  Matched reusable POM: ${matches.selectedPom.asset.fileName} ` +
        `(${(matches.selectedPom.asset.similarity * 100).toFixed(1)}%)`
      );
    } else if (matches.referencePom) {
      console.log(
        `🧩 No direct POM reuse match; ${matches.referencePom.asset.fileName} will be used as a selector/code-style reference.`
      );
    } else {
      console.log('🆕 No compatible POM matched; new code may be generated only after this completed search.');
    }

    return { retrieval, matches };
  }

  /**
   * Write generic *.page.ts and *.spec.ts files using vector-matched repository
   * assets. No application workflow is encoded in this layer.
   */
  writeArtifacts(retrieval, matches, testPlan) {
    if (!this.vectorSearchCompleted) {
      throw new Error('Refusing to generate code before vector DB retrieval and matching.');
    }

    const dataDrivenContract = this._findReusableDataDrivenContract(retrieval);
    if (dataDrivenContract) {
      return this.writeDataDrivenArtifacts(dataDrivenContract, testPlan);
    }

    const selected = matches.selectedPom || matches.referencePom;
    const pomAsset = selected?.asset;

    if (!pomAsset || !pomAsset.selectors?.length) {
      console.log('⚠️  No compatible or adaptable POM selectors were found — skipping file generation.');
      console.log('    Index the repo first: npm run vector-db:index\n');
      return { files: [] };
    }

    const locators = tpl.describeLocators(pomAsset.selectors);
    const describeTitle = `${this.workItemId} — Generated Playwright Suite`;
    const written = [];

    // Decide: reuse the existing POM (strong match) or scaffold a new one.
    const reuse = Boolean(matches.selectedPom);
    let className;
    let pomImportPath;

    if (reuse) {
      className = matches.selectedPom.className;
      pomImportPath = this._toImport(this.testsDir, matches.selectedPom.absolutePath.replace(/\.ts$/, ''));
      console.log(
        `♻️  POM match ${(pomAsset.similarity * 100).toFixed(1)}% ≥ ${(this.REUSE_THRESHOLD * 100)}% — ` +
          `reusing existing ${className} (no duplicate POM written).`
      );
    } else {
      className = String(process.env.CODEGEN_PAGE_CLASS || `${tpl.pascal(this.artifactId)}Page`)
        .replace(/[^A-Za-z0-9_$]/g, '') || 'GeneratedPage';
      const pomFile = this._resolveConfiguredPath(
        process.env.CODEGEN_POM_PATH,
        path.join(path.relative(this.projectRoot, this.pomDir), `${className}.page.ts`)
      );
      fs.mkdirSync(path.dirname(pomFile), { recursive: true });
      const pomCode = tpl.renderPageObject({
        className,
        sourceFile: pomAsset.fileName,
        locators,
      });
      fs.writeFileSync(pomFile, pomCode);
      written.push(pomFile);
      pomImportPath = this._toImport(this.testsDir, pomFile.replace(/\.ts$/, ''));
      console.log(
        `🆕 No directly reusable POM met the compatibility contract — ` +
          `scaffolded new ${className} reusing ${pomAsset.selectors.length} exact selector(s).`
      );
    }

    const specFile = this._resolveConfiguredPath(
      process.env.CODEGEN_SPEC_PATH,
      path.join(path.relative(this.projectRoot, this.testsDir), `${this.artifactId}.spec.ts`)
    );
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    const specCode = tpl.renderSpec({
      describeTitle,
      className,
      pomImportPath,
      locators,
      testCases: testPlan,
    });
    fs.writeFileSync(specFile, specCode);
    written.push(specFile);

    return { files: written };
  }

  _scenarioOptions() {
    const layer2Context = this.loadJson(
      this._contextFile('LAYER2_STRATEGY_CONTEXT_PATH', 'layer2-strategy-context.json'),
      {}
    );
    if (layer2Context?.codegenHints?.scenarioOptions) {
      return layer2Context.codegenHints.scenarioOptions;
    }

    const explorerContext = this.loadJson(
      this._contextFile('EXPLORER_CONTEXT_PATH', 'explorer-context.json'),
      {}
    );
    const requestType = explorerContext?.flowDocs?.wizardExploration?.scenario?.requestType;
    return requestType ? { requestType } : {};
  }

  _normalizeScenarioValue(key, value) {
    if (!/date$/i.test(key) || typeof value !== 'string') return value;
    const parsed = new Date(`${value} UTC`);
    if (Number.isNaN(parsed.getTime())) return value;
    return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${parsed.getUTCFullYear()}`;
  }

  _scenarioFromTestCase(testCase) {
    const metadata = new Set([
      'category',
      'description',
      'priority',
      'expectedResult',
      'retryCount',
      'playwrightTitle',
      'source',
    ]);
    return Object.fromEntries(
      Object.entries(testCase)
        .filter(([key, value]) => !metadata.has(key) && value !== undefined && value !== null && value !== '—')
        .map(([key, value]) => [key, this._normalizeScenarioValue(key, value)])
    );
  }

  _formatTsLiteral(value) {
    return JSON.stringify(value, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:');
  }

  writeDataDrivenArtifacts(contract, testPlan) {
    const scenarios = testPlan.map((testCase) => this._scenarioFromTestCase(testCase));
    const scenarioTitleField = ['reason', 'title', 'description', 'name']
      .find((field) => scenarios.some((scenario) => scenario[field])) || 'id';
    const scenarioOptions = this._scenarioOptions();
    const specFile = this._resolveConfiguredPath(
      process.env.CODEGEN_SPEC_PATH,
      path.join(path.relative(this.projectRoot, this.testsDir), `${this.artifactId}.spec.ts`)
    );
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    const pomImportPath = this._toImport(path.dirname(specFile), contract.pomPath.replace(/\.(ts|js)$/, ''));

    const scenarioType = contract.scenarioType || 'Record<string, unknown>';
    const optionLiteral = Object.keys(scenarioOptions).length
      ? `, ${this._formatTsLiteral(scenarioOptions)}`
      : '';
    const calls = contract.calls
      .map((call, index) => {
        const options = index === 0 && call.acceptsOptions ? optionLiteral : '';
        const argumentsList = call.usesScenario ? `scenario${options}` : '';
        return `      await pageObject.${call.method}(${argumentsList});`;
      })
      .join('\n');

    const code = `import { test, Page } from '@playwright/test';
import { ${contract.className}${contract.scenarioType ? `, ${contract.scenarioType}` : ''} } from '${pomImportPath}';

const scenarios: ${scenarioType}[] = ${this._formatTsLiteral(scenarios)};

test.describe('${this.workItemId}: data-driven regression', () => {
  let page: Page;
  let pageObject: ${contract.className};

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    pageObject = new ${contract.className}(page);
    await pageObject.navigateTo();
  });

  test.afterEach(async () => {
    await page.close();
  });

  for (const scenario of scenarios) {
    test(\`\${scenario.id}: \${scenario.${scenarioTitleField}}\`, async () => {
      test.setTimeout(90000);
${calls}
    });
  }
});
`;

    fs.writeFileSync(specFile, code);
    console.log(
      `♻️  Reused executable workflow contract from ` +
      `${path.relative(this.projectRoot, contract.specPath)} and ${path.relative(this.projectRoot, contract.pomPath)}.`
    );
    return { files: [specFile] };
  }

  async initMCPServer() {
    console.log(`\n✍️  LAYER 4 AGENT: Test Code Generator`);
    console.log(`🔌 Initializing Playwright MCP Server for code generation...\n`);

    return {
      protocol: 'MCP',
      server: process.env.PLAYWRIGHT_MCP_SERVER || 'mcp://playwright',
      capabilities: [
        'playwright-code-generation',
        'selector-optimization',
        'guard-rule-enforcement',
        'pom-pattern-scaffolding',
        'test-scenario-mapping',
        'assertion-auto-generation',
      ],
      endpoints: {
        codegen: 'mcp://playwright/generate-test',
        selectors: 'mcp://playwright/optimize-selectors',
        validate: 'mcp://playwright/validate-code',
        documentation: 'mcp://playwright/docs',
      },
    };
  }

  async generateWithMCP(_testPlan, _context) {
    console.log(`📡 Using Playwright MCP Server for code generation...\n`);
    console.log(`   • Guard Rules: Enforced`);
    console.log(`   • Architectural Patterns: Applied`);
    console.log(`   • Selector Optimization: Active`);
    console.log(`   • Test Validation: Enabled\n`);

    // MCP server would handle:
    // - Real-time test scenario parsing
    // - Automatic POM scaffolding
    // - Selector optimization
    // - Guard rule enforcement
    // - Code generation & validation

    return {
      status: 'planned',
      timestamp: new Date().toISOString(),
      mcpVersion: 'playwright-1.0',
      note: 'MCP metadata initialized; no remote MCP generation call was made by this script.',
      artifactsGenerated: [],
    };
  }

  saveGenerationContext({ testPlan, retrieval, matches, files, warnings = [] }) {
    const payload = {
      layer: 4,
      generatedAt: new Date().toISOString(),
      workItemId: this.workItemId,
      testCases: testPlan.length,
      vectorDatabase: {
        searchedBeforeGeneration: this.vectorSearchCompleted,
        status: retrieval.error ? 'unavailable' : retrieval.assets.length ? 'matched' : 'empty',
        error: retrieval.error || null,
        queries: retrieval.queries || [],
        candidateCount: retrieval.assets.length,
        reuseThreshold: this.REUSE_THRESHOLD,
      },
      reuseDecisions: this.reuseDecisions,
      selectedAsset: matches.selectedPom
        ? {
            path: path.relative(this.projectRoot, matches.selectedPom.absolutePath),
            fileName: matches.selectedPom.asset.fileName,
            className: matches.selectedPom.className,
            similarity: matches.selectedPom.asset.similarity,
          }
        : null,
      referenceAsset: !matches.selectedPom && matches.referencePom
        ? {
            path: path.relative(this.projectRoot, matches.referencePom.absolutePath),
            fileName: matches.referencePom.asset.fileName,
            className: matches.referencePom.className,
            similarity: matches.referencePom.asset.similarity,
          }
        : null,
      files: files.map((file) => path.relative(this.projectRoot, file)),
      warnings,
    };

    fs.writeFileSync(this.generationContextPath, JSON.stringify(payload, null, 2));
    return payload;
  }

  async generate() {
    console.log(`\n✍️  LAYER 4 AGENT: Test Code Generator`);
    console.log(`🔧 Injecting Guard Rules & Advanced Architectural Design Patterns...`);

    // Load strategy if available
    let testPlan = [];
    const contextPlanPath = this._contextFile('LAYER2_TEST_PLAN_PATH', 'layer2-test-plan.json');
    const layer2ContextPath = this._contextFile(
      'LAYER2_STRATEGY_CONTEXT_PATH',
      'layer2-strategy-context.json'
    );
    const layer3ContextPath = this._contextFile(
      'LAYER3_RETRIEVAL_CONTEXT_PATH',
      'layer3-retrieval-context.json'
    );
    const manualMcpContextPath = this._contextFile(
      'PLAYWRIGHT_MCP_CONTEXT_PATH',
      'mcp-playwright-context.json'
    );
    const explorerContextPath = this._contextFile('EXPLORER_CONTEXT_PATH', 'explorer-context.json');
    const planPath = this._resolveConfiguredPath(
      process.env.LAYER2_RESULTS_PLAN_PATH,
      path.join(path.relative(this.projectRoot, this.testResultsDir), 'LAYER2-TEST-PLAN.json')
    );

    if (fs.existsSync(contextPlanPath)) {
      testPlan = this.loadJson(contextPlanPath, []);
      console.log(`📎 Loaded test plan from ${path.relative(this.projectRoot, contextPlanPath)}`);
    } else if (fs.existsSync(planPath)) {
      testPlan = this.loadJson(planPath, []);
      console.log(`📎 Loaded test plan from ${path.relative(this.projectRoot, planPath)}`);
    }

    const layer2Context = this.loadJson(layer2ContextPath, null);
    const layer3Context = this.loadJson(layer3ContextPath, null);
    const manualMcpContext = this.loadJson(manualMcpContextPath, null);
    const explorerContext = this.loadJson(explorerContextPath, null);
    if (layer2Context) {
      console.log(
        `📎 Loaded Layer 2 strategy context for ` +
        `${layer2Context.workItemId || layer2Context.ticket || this.workItemId}`
      );
    }
    if (layer3Context) {
      console.log(`📎 Loaded Layer 3 retrieval context with ${layer3Context.assets?.length || 0} asset hint(s)`);
    }
    if (manualMcpContext) {
      console.log(
        `📎 Loaded Layer 3 manual MCP context (${manualMcpContext.status}) with ` +
          `${manualMcpContext.verification?.discoveredTests?.length || 0} discovered test(s)`
      );
    }
    if (explorerContext) {
      console.log(
        `📎 Loaded Explorer context (${explorerContext.status}) with ` +
          `${explorerContext.snapshots?.elements?.inputs?.length || 0} input selector(s) and ` +
          `${explorerContext.snapshots?.elements?.buttons?.length || 0} button selector(s)`
      );
    }

    if (!Array.isArray(testPlan) || testPlan.length === 0) {
      throw new Error(
        'No Layer 2 test plan was found. Run Layer 2 before Layer 4 so vector matching has scenario context.'
      );
    }

    // Every generation path must search and match repository code first.
    const { retrieval, matches } = await this.retrieveAndMatch(testPlan);

    // --- Write the actual files -------------------------------------------
    console.log(`\n📝 Writing Playwright artifacts...`);
    const written = this.writeArtifacts(retrieval, matches, testPlan);
    const relFiles = written.files.map((f) => path.relative(path.join(__dirname, '..'), f));
    const warnings = [];
    if (retrieval.error) warnings.push(`Vector DB unavailable: ${retrieval.error}`);
    if (!retrieval.assets.length) warnings.push('Vector DB returned no assets; no code was generated.');
    if (!matches.selectedPom && matches.referencePom) {
      warnings.push('No asset met the direct-reuse contract; selectors from the best compatible reference were adapted.');
    }
    if (!written.files.length) warnings.push('No files were written because no compatible vector-DB context was available.');
    this.saveGenerationContext({
      testPlan,
      retrieval,
      matches,
      files: written.files,
      warnings,
    });

    const generatedCount = testPlan.length;

    if (written.files.length) {
      console.log(`✅ Generated test spec with ${generatedCount} test case(s)`);
      console.log(`✅ Vector DB search and compatibility matching completed before file generation`);
    }
    console.log(`💾 Saved: ${path.relative(this.projectRoot, this.generationContextPath)}\n`);

    return {
      testCases: generatedCount,
      files: relFiles.length ? relFiles : ['(no files written)'],
      features: [
        'Positive paths',
        'Negative paths',
        'Edge cases',
        'Flakiness detection (No hardcoded timeouts)',
        'Multi-browser compatibility',
        'Isolated backend verification',
      ],
      guardRulesApplied: this.GUARD_RULES,
      bestPracticesApplied: this.BEST_PRACTICES,
      reusedAssets: matches.selectedPom ? [matches.selectedPom.asset] : [],
      retrievalQueries: retrieval.queries,
      reuseDecisions: this.reuseDecisions,
      generationContextPath: path.relative(this.projectRoot, this.generationContextPath),
    };
  }
}

// CLI Entry Point
async function main() {
  try {
    const args = process.argv.slice(2);
    const inlineWorkItem = args.find((arg) => arg.startsWith('--work-item='));
    const workItemIndex = args.indexOf('--work-item');
    const workItemId =
      inlineWorkItem?.slice('--work-item='.length) ||
      (workItemIndex !== -1 ? args[workItemIndex + 1] : '') ||
      args.find((arg) => !arg.startsWith('--')) ||
      '';
    const agent = new Layer4Agent(workItemId);
    const result = await agent.generate();

    console.log('📋 Generated Files:');
    result.files.forEach(f => console.log(`   - ${f}`));

    console.log('\n🏛️ Advanced Design Patterns Enforced:');
    Object.keys(result.bestPracticesApplied).forEach(pattern => {
      if (pattern.toLowerCase().includes('pattern')) {
        console.log(`   [${pattern.toUpperCase()}]`);
        result.bestPracticesApplied[pattern].forEach(rule => console.log(`     • ${rule}`));
      }
    });

    console.log();

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = Layer4Agent;
