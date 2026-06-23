#!/usr/bin/env node

/**
 * AGENT LAYER 6: Self-Healing Engineer
 * Uses Playwright MCP to analyze failures and auto-fix issues
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv/config');
const SelfHealingAnalyzer = require('../layer6/self-healing-analyzer.js');

class Layer6Agent {
  constructor(ticket = '') {
    this.projectRoot = path.join(__dirname, '..');
    this.contextDir = path.join(this.projectRoot, 'context');
    this.ticket = (ticket || process.env.LAYER6_TICKET || process.env.TICKET_NAME || process.env.TEST_TICKET || 'ISE-1556').toUpperCase();
    this.spec = this.specForTicket(this.ticket);
    this.analyzer = new SelfHealingAnalyzer(this.projectRoot, { ticket: this.ticket });
    this.mcpPayload = {
      layer: 6,
      tool: 'mcp://playwright/self-heal',
      ticket: this.ticket,
      spec: this.spec,
      generatedAt: new Date().toISOString(),
      sessions: [],
      fixes: [],
      reruns: [],
    };
  }

  specForTicket(ticket) {
    if (!ticket) return '';

    const direct = `tests/${ticket}.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, direct))) return direct;

    const legacy = `tests/${ticket}-absence-creation.spec.ts`;
    if (fs.existsSync(path.join(this.projectRoot, legacy))) return legacy;

    return direct;
  }

  runTicketSpec(options = {}) {
    if (!this.spec || !fs.existsSync(path.join(this.projectRoot, this.spec))) {
      throw new Error(`Could not find Playwright spec for ${this.ticket}: ${this.spec}`);
    }

    console.log(`🧪 Playwright MCP run: ${this.ticket}`);
    console.log(`   Spec: ${this.spec}`);

    const args = ['playwright', 'test', this.spec, '--project=chromium', '--workers=1'];
    if (options.headed) args.push('--headed');
    if (options.grep) args.push('--grep', options.grep);

    const command = ['npx', ...args].join(' ');
    console.log(`   ▶ ${command}\n`);

    const completed = spawnSync('npx', args, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      stdio: 'inherit',
      env: this.buildPlaywrightEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const run = {
      ticket: this.ticket,
      spec: this.spec,
      command,
      exitCode: completed.status ?? 1,
      status: completed.status === 0 ? 'passed' : 'failed',
      error: completed.error?.message,
    };

    this.mcpPayload.sessions.push(run);
    console.log(`\n   ${run.status === 'passed' ? '✅' : '❌'} Playwright run ${run.status}\n`);
    return run;
  }

  buildPlaywrightEnv() {
    const env = {
      ...process.env,
      TICKET_NAME: this.ticket,
      TEST_TICKET: this.ticket,
      STORAGE_STATE: process.env.STORAGE_STATE || `playwright/.auth/${this.ticket.toLowerCase()}-user.json`,
    };

    const roleMap = {
      'ISE-1559': 'Teacher',
      'ISE-1562': 'School_Teacher',
    };
    const role = process.env.AUTH_ROLE || roleMap[this.ticket] || '';
    if (role) {
      env.AUTH_ROLE = role;
      env.STORAGE_STATE = process.env.STORAGE_STATE || `playwright/.auth/${this.ticket.toLowerCase()}-${role.toLowerCase()}.json`;
    }

    return env;
  }

  analyze() {
    console.log(`\n🔧 LAYER 6 AGENT: Self-Healing Engineer with Playwright MCP`);
    console.log(`🎫 Ticket: ${this.ticket}`);
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
    const prTemplate = this.analyzer.generatePullRequestTemplate();
    const analysisJson = {
      ticket: this.ticket,
      spec: this.spec,
      analysis: this.analyzer.analysis,
      recommendations: this.analyzer.analysis.recommendations || [],
      patches: this.analyzer.analysis.patches || [],
      mcp: this.mcpPayload,
      timestamp: new Date().toISOString(),
    };

    const files = {
      analysis: path.join(this.projectRoot, 'LAYER6-SELF-HEALING-ANALYSIS.json'),
      jira: path.join(this.projectRoot, 'LAYER6-JIRA-REPORT.json'),
      xray: path.join(this.projectRoot, 'LAYER6-XRAY-REPORT.json'),
      pr: path.join(this.projectRoot, 'LAYER6-PULL-REQUEST-TEMPLATE.md'),
    };

    fs.writeFileSync(files.analysis, JSON.stringify(analysisJson, null, 2));
    fs.writeFileSync(files.jira, JSON.stringify(jiraReport, null, 2));
    fs.writeFileSync(files.xray, JSON.stringify(xrayReport, null, 2));

    if (prTemplate) {
      const prMarkdown = `# ${prTemplate.title}

## Description

${prTemplate.body}

### Branch
\`\`\`
${prTemplate.branch}
\`\`\`

### Commits
${prTemplate.commits.map(c => `- \`${c.message}\`\n  Files: ${c.files.join(', ')}`).join('\n')}
`;
      fs.writeFileSync(files.pr, prMarkdown);
    } else if (fs.existsSync(files.pr)) {
      fs.unlinkSync(files.pr);
    }

    console.log(`   ✅ Jira report generated: ${path.basename(files.jira)}`);
    console.log(`   ✅ Xray report generated: ${path.basename(files.xray)}`);
    console.log(`   ✅ Analysis JSON generated: ${path.basename(files.analysis)}`);
    console.log(`   ${prTemplate ? '✅' : '⚪'} PR template ${prTemplate ? 'generated' : 'not needed'}${prTemplate ? `: ${path.basename(files.pr)}` : ''}\n`);

    return { jiraReport, xrayReport, prTemplate };
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
        env: this.buildPlaywrightEnv(),
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
    const ticketArg = args.find(arg => /^[A-Z]+-\d+$/i.test(arg));
    const agent = new Layer6Agent(ticketArg);
    const grep = valueForArg(args, '--grep');

    if (!args.includes('--no-run')) {
      agent.runTicketSpec({
        headed: args.includes('--headed'),
        grep,
      });
    }

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
