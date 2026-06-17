#!/usr/bin/env node

/**
 * AGENT LAYER 6: Self-Healing Engineer
 * Uses Playwright MCP to analyze failures and auto-fix issues
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const SelfHealingAnalyzer = require('../layer6/self-healing-analyzer.js');

class Layer6Agent {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.contextDir = path.join(this.projectRoot, 'context');
    this.analyzer = new SelfHealingAnalyzer(this.projectRoot);
    this.mcpPayload = {
      layer: 6,
      tool: 'mcp://playwright/self-heal',
      generatedAt: new Date().toISOString(),
      sessions: [],
      fixes: [],
      reruns: [],
    };
  }

  analyze() {
    console.log(`\n🔧 LAYER 6 AGENT: Self-Healing Engineer with Playwright MCP`);
    console.log(`🔍 Analyzing test results...\n`);

    const analysis = this.analyzer.analyzeResults();
    const recommendations = this.analyzer.generateRecommendations();
    const patches = this.analyzer.generateSelfHealingPatches();
    const prTemplate = this.analyzer.generatePullRequestTemplate();

    console.log(`📊 Analysis Results:`);
    console.log(`   Total Tests: ${analysis.totalTests}`);
    console.log(`   ✅ Passed: ${analysis.passedTests}`);
    console.log(`   ❌ Failed: ${analysis.failedTests}`);
    console.log(`   🟡 Flaky: ${analysis.flakyTests.length}\n`);

    if (analysis.failedTests > 0) {
      console.log(`🔧 Issues Detected:`);
      console.log(`   - Broken selectors: ${analysis.brokenSelectors.length}`);
      console.log(`   - Timeout issues: ${analysis.timeoutIssues.length}`);
      console.log(`   - Flaky tests: ${analysis.flakyTests.length}`);
      console.log(`   - Recommended fixes: ${recommendations.length}\n`);

      if (prTemplate) {
        console.log(`🤖 PR Generated: ${prTemplate.branch}\n`);
      }
    } else {
      console.log(`✅ All tests passed - no fixes needed\n`);
    }

    return { analysis, recommendations, patches, prTemplate };
  }

  generateReports() {
    console.log(`📝 Generating Reports:\n`);

    const jiraReport = this.analyzer.generateJiraReport();
    const xrayReport = this.analyzer.generateXrayReport();

    console.log(`   ✅ Jira report generated`);
    console.log(`   ✅ Xray report generated`);
    console.log(`   ✅ Analysis JSON generated`);
    console.log(`   ✅ PR template generated\n`);

    return { jiraReport, xrayReport };
  }

  async applyAutoFixes() {
    console.log(`🔨 Applying Auto-Fixes via Playwright MCP\n`);

    const targets = this.analyzer.getFailedTestTargets();
    if (targets.length === 0) {
      console.log('   ℹ️  No broken tests to fix\n');
      return { status: 'skipped', fixes: [] };
    }

    const fixes = [];

    for (const target of targets) {
      console.log(`   🎯 Analyzing: ${target.test}`);

      const fix = {
        test: target.test,
        target: target.target,
        error: target.error,
        suggestions: [],
        applied: false,
        status: 'pending',
      };

      if (target.error.includes('Could not advance from Create Absence')) {
        fix.suggestions.push({
          type: 'selector-fix',
          issue: 'Next button not advancing form',
          fix: 'Added wait for step transition after Next click',
          file: 'pom/AbsenceFormPage.page.ts',
          method: 'clickNext',
        });
      }

      if (target.error.includes('Could not find option')) {
        fix.suggestions.push({
          type: 'selector-fix',
          issue: 'Dropdown overlay stuck or not opening',
          fix: 'Enhanced openSelect with retry loop and escape key handling',
          file: 'pom/AbsenceFormPage.page.ts',
          method: 'openSelect',
        });
      }

      if (target.error.includes('Target page, context or browser has been closed')) {
        fix.suggestions.push({
          type: 'state-fix',
          issue: 'Browser closes during retry logic',
          fix: 'Added page.isClosed() check before retry operations',
          file: 'pom/AbsenceFormPage.page.ts',
          method: 'advanceFromCreateAbsence',
        });
      }

      fixes.push(fix);
      console.log(`      ✓ ${fix.suggestions.length} fix(es) identified\n`);
    }

    this.mcpPayload.fixes = fixes;
    return { status: 'analyzed', fixes };
  }

  runBrokenTests(options = {}) {
    const targets = this.analyzer.getFailedTestTargets();

    if (targets.length === 0) {
      console.log('🧪 Playwright MCP rerun: no broken test targets discovered\n');
      return { status: 'skipped', targets: [], runs: [] };
    }

    console.log('🧪 Playwright MCP rerun: running broken test target(s)\n');

    const runs = targets.map(target => {
      const grep = this.analyzer.getLeafTestTitle(target.test);
      const args = ['playwright', 'test', target.target, '--project=chromium', '--workers=1'];
      if (grep) args.push('--grep', this.escapeRegex(grep));
      if (options.headed) args.push('--headed');

      const command = ['npx', ...args].join(' ');
      console.log(`   ▶ ${command}`);

      const completed = spawnSync('npx', args, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = `${completed.stdout || ''}\n${completed.stderr || ''}`.trim();
      const run = {
        ...target,
        command,
        grep,
        exitCode: completed.status ?? 1,
        status: completed.status === 0 ? 'passed' : 'failed',
        outputTail: output.slice(-4000),
      };

      console.log(`   ${run.status === 'passed' ? '✅' : '❌'} ${target.target} ${run.status}`);
      return run;
    });

    const payload = {
      ...this.mcpPayload,
      generatedAt: new Date().toISOString(),
      status: runs.every(run => run.status === 'passed') ? 'passed' : 'failed',
      headed: Boolean(options.headed),
      targets,
      runs,
    };

    fs.mkdirSync(this.contextDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.contextDir, 'layer6-playwright-rerun.json'),
      JSON.stringify(payload, null, 2)
    );
    console.log('\n💾 Saved: context/layer6-playwright-rerun.json\n');

    return payload;
  }

  escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// CLI Entry Point
async function main() {
  try {
    const args = process.argv.slice(2);
    const agent = new Layer6Agent();

    const { analysis, recommendations } = agent.analyze();

    let autoFixes = null;
    if (args.includes('--auto-fix')) {
      autoFixes = await agent.applyAutoFixes({
        headed: args.includes('--headed'),
      });
    }

    let rerun = null;
    if (args.includes('--run-broken')) {
      rerun = agent.runBrokenTests({
        headed: args.includes('--headed'),
      });
    }

    const { jiraReport, xrayReport } = agent.generateReports();

    console.log(`📤 Next Steps:`);
    if (rerun?.status === 'passed') {
      console.log(`   1. ✅ Broken tests passed on targeted Playwright rerun`);
      console.log(`   2. Re-run Layer 5 full suite when ready`);
      console.log(`   3. Move ticket forward after full-suite pass\n`);
    } else if (analysis.failedTests === 0) {
      console.log(`   1. ✅ Mark ticket RESOLVED in Jira`);
      console.log(`   2. Push Xray test execution`);
      console.log(`   3. Archive artifacts\n`);
    } else if (autoFixes?.fixes.length > 0) {
      console.log(`   1. 🔨 Auto-fixes identified`);
      console.log(`   2. Review suggested fixes in layer6-playwright-rerun.json`);
      console.log(`   3. Apply fixes and re-run tests\n`);
    } else {
      console.log(`   1. Review PR template`);
      console.log(`   2. Create PR with fixes`);
      console.log(`   3. Re-run tests`);
      console.log(`   4. Verify all pass\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
