#!/usr/bin/env node

const { execSync } = require('child_process');
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

class PlaywrightTestOrchestrator {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.testResultsDir = path.join(this.projectRoot, 'test-results');
    this.reportDir = path.join(this.projectRoot, 'playwright-report');
  }

  ensureDirectories() {
    [this.testResultsDir, this.reportDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  buildDockerImage() {
    console.log('🏗️  Building Docker image...');
    try {
      execSync('docker build -t instasub-playwright:latest .', {
        cwd: this.projectRoot,
        stdio: 'inherit',
      });
      console.log('✅ Docker image built successfully\n');
    } catch (error) {
      console.error('❌ Failed to build Docker image');
      process.exit(1);
    }
  }

  runTestsInDocker(tags = '', spec = DEFAULT_SPEC) {
    console.log('🚀 Running tests in Docker container...\n');
    console.log(`🎫 Ticket: ${DEFAULT_TICKET}`);
    console.log(`📄 Spec: ${spec || '(all)'}\n`);

    const testParts = ['npx playwright test'];
    if (spec) testParts.push(spec);
    if (tags) testParts.push(`--grep "${tags}"`);
    const testCommand = testParts.join(' ');

    const dockerCmd = `docker run --rm \
      -e CI=true \
      -e BASE_URL=http://localhost:3000 \
      -e TICKET_NAME=${DEFAULT_TICKET} \
      -v ${this.testResultsDir}:/app/test-results \
      -v ${this.reportDir}:/app/playwright-report \
      instasub-playwright:latest \
      ${testCommand}`;

    try {
      execSync(dockerCmd, { stdio: 'inherit' });
    } catch (error) {
      console.error('⚠️  Tests completed with non-zero exit code');
      // Don't exit - we want to show results even if tests failed
    }
  }

  runTestsWithCompose() {
    console.log('🚀 Running tests with Docker Compose...\n');

    try {
      execSync('docker-compose up --abort-on-container-exit --exit-code-from playwright-tests', {
        cwd: this.projectRoot,
        stdio: 'inherit',
      });
    } catch (error) {
      console.log('⚠️  Tests completed with non-zero exit code');
    }

    // Cleanup
    console.log('\n🧹 Cleaning up containers...');
    execSync('docker-compose down', {
      cwd: this.projectRoot,
      stdio: 'inherit',
    });
  }

  parseResults() {
    console.log('\n📊 Parsing Test Results...\n');

    const junitPath = path.join(this.testResultsDir, 'junit.xml');
    const resultsJsonPath = path.join(this.testResultsDir, 'results.json');

    if (fs.existsSync(resultsJsonPath)) {
      try {
        const results = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
        this.printResultsSummary(results);
      } catch (error) {
        console.error('Failed to parse results.json');
      }
    }

    if (fs.existsSync(junitPath)) {
      console.log(`📄 JUnit XML: ${junitPath}`);
    }

    console.log(`📊 HTML Report: ${path.join(this.reportDir, 'index.html')}`);
  }

  printResultsSummary(results) {
    const stats = results.stats || {};
    const duration = stats.duration || 0;
    const expected = stats.expected || 0;
    const flaky = stats.flaky || 0;
    const failed = stats.failed || 0;
    const passed = stats.passed || 0;

    console.log('╔════════════════════════════════════════╗');
    console.log('║         TEST EXECUTION SUMMARY          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Total Tests:    ${String(expected).padEnd(28)}║`);
    console.log(`║ ✅ Passed:      ${String(passed).padEnd(28)}║`);
    console.log(`║ ❌ Failed:      ${String(failed).padEnd(28)}║`);
    console.log(`║ 🟡 Flaky:       ${String(flaky).padEnd(28)}║`);
    console.log(`║ ⏱️  Duration:    ${String(`${(duration / 1000).toFixed(2)}s`).padEnd(28)}║`);
    console.log('╚════════════════════════════════════════╝\n');

    if (results.suites) {
      console.log('Test Suites:');
      results.suites.forEach(suite => {
        console.log(`  📦 ${suite.title}`);
        if (suite.tests) {
          suite.tests.forEach(test => {
            const status = test.status === 'passed' ? '✅' : '❌';
            console.log(`    ${status} ${test.title}`);
            if (test.duration) {
              console.log(`       ⏱️  ${test.duration}ms`);
            }
          });
        }
      });
    }
  }

  showEnvironmentCheck() {
    console.log('🔍 Checking environment prerequisites...\n');

    const checks = [
      {
        name: 'Docker',
        cmd: 'docker --version',
      },
      {
        name: 'Docker Compose',
        cmd: 'docker-compose --version',
      },
      {
        name: 'Node.js',
        cmd: 'node --version',
      },
    ];

    checks.forEach(check => {
      try {
        const output = execSync(check.cmd, { encoding: 'utf-8' }).trim();
        console.log(`✅ ${check.name}: ${output}`);
      } catch (error) {
        console.log(`❌ ${check.name}: NOT INSTALLED`);
      }
    });

    console.log();
  }

  run(options = {}) {
    const { useCompose = false, tags = '', spec = DEFAULT_SPEC } = options;

    this.showEnvironmentCheck();
    this.ensureDirectories();

    if (useCompose) {
      this.runTestsWithCompose();
    } else {
      this.buildDockerImage();
      this.runTestsInDocker(tags, spec);
    }

    this.parseResults();
  }
}

// CLI entry point
const args = process.argv.slice(2);
const useCompose = args.includes('--compose');
const tags = args.find(arg => arg.startsWith('--tags='))?.split('=')[1] || '';
const explicitSpec = args.find(arg => arg.startsWith('--spec='))?.split('=')[1] || '';
const ticketArg = args.find(arg => /^ISE-\d+$/i.test(arg));
const ticketSpec = ticketArg ? `tests/${ticketArg.toUpperCase()}.spec.ts` : '';
const runAll = args.includes('--all');
const spec = runAll ? '' : explicitSpec || ticketSpec || DEFAULT_SPEC;

const orchestrator = new PlaywrightTestOrchestrator();
orchestrator.run({ useCompose, tags, spec });
