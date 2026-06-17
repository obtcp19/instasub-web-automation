#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const SelfHealingAnalyzer = require('./self-healing-analyzer.js');

class Layer6Orchestrator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.analyzer = new SelfHealingAnalyzer(projectRoot);
    this.reportDir = path.join(projectRoot, 'test-results');
    this.layer6Dir = path.join(projectRoot, 'layer6');
  }

  run() {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║        LAYER 6: SELF-HEALING ENGINEER - ORCHESTRATOR            ║');
    console.log('║        Automated Test Analysis & Code Generation                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    // Step 1: Analyze test results
    console.log('🔍 Step 1: Analyzing Layer 5 test results...\n');
    const analysis = this.analyzer.analyzeResults();
    console.log(`   Total Tests: ${analysis.totalTests}`);
    console.log(`   ✅ Passed: ${analysis.passedTests}`);
    console.log(`   ❌ Failed: ${analysis.failedTests}`);
    console.log(`   🟡 Flaky: ${analysis.flakyTests.length}\n`);

    // Step 2: Generate recommendations
    console.log('💡 Step 2: Generating recommendations...\n');
    const recommendations = this.analyzer.generateRecommendations();
    this._printRecommendations(recommendations);

    // Step 3: Generate self-healing patches
    console.log('🔧 Step 3: Generating self-healing patches...\n');
    const patches = this.analyzer.generateSelfHealingPatches();
    this._printPatches(patches);

    // Step 4: Generate PR if needed
    console.log('📝 Step 4: Generating reports...\n');
    const prTemplate = this.analyzer.generatePullRequestTemplate();
    const jiraReport = this.analyzer.generateJiraReport();
    const xrayReport = this.analyzer.generateXrayReport();

    // Step 5: Save reports
    console.log('💾 Step 5: Saving reports...\n');
    this._saveReports(prTemplate, jiraReport, xrayReport);

    // Step 6: Summary
    this._printSummary(analysis, prTemplate);
  }

  _printRecommendations(recommendations) {
    if (recommendations.length === 0) {
      console.log('   ✅ No issues detected. All tests passed!\n');
      return;
    }

    recommendations.forEach((rec, idx) => {
      console.log(`   ${idx + 1}. [${rec.category}] ${rec.action}`);
      if (rec.items && rec.items.length > 0) {
        rec.items.forEach(item => {
          const testName = item.test || item.name || 'unknown';
          console.log(`      - ${testName}`);
        });
      }
      if (rec.suggestions) {
        console.log('      Suggestions:');
        rec.suggestions.forEach(s => console.log(`        • ${s}`));
      }
      console.log();
    });
  }

  _printPatches(patches) {
    if (patches.length === 0) {
      console.log('   ✅ No patches needed. All tests passed!\n');
      return;
    }

    patches.forEach((patch, idx) => {
      console.log(`   ${idx + 1}. ${patch.type}`);
      console.log(`      Test: ${patch.test}`);
      console.log(`      File: ${patch.patch.file}`);
      console.log(`      Action: ${patch.patch.operation}\n`);
    });
  }

  _saveReports(prTemplate, jiraReport, xrayReport) {
    // Save self-healing analysis
    const analysisJson = {
      analysis: this.analyzer.analysis,
      recommendations: this.analyzer.analysis.recommendations || [],
      patches: this.analyzer.analysis.patches || [],
      timestamp: new Date().toISOString(),
    };

    const analysisPath = path.join(
      this.reportDir,
      'LAYER6-SELF-HEALING-ANALYSIS.json'
    );
    fs.writeFileSync(analysisPath, JSON.stringify(analysisJson, null, 2));
    console.log(`   ✅ Analysis saved: ${path.basename(analysisPath)}`);

    // Save Jira report
    const jiraPath = path.join(this.reportDir, 'LAYER6-JIRA-REPORT.json');
    fs.writeFileSync(jiraPath, JSON.stringify(jiraReport, null, 2));
    console.log(`   ✅ Jira report saved: ${path.basename(jiraPath)}`);

    // Save Xray report
    const xrayPath = path.join(this.reportDir, 'LAYER6-XRAY-REPORT.json');
    fs.writeFileSync(xrayPath, JSON.stringify(xrayReport, null, 2));
    console.log(`   ✅ Xray report saved: ${path.basename(xrayPath)}`);

    // Save PR template if needed
    if (prTemplate) {
      const prPath = path.join(this.reportDir, 'LAYER6-PULL-REQUEST-TEMPLATE.md');
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
      fs.writeFileSync(prPath, prMarkdown);
      console.log(`   ✅ PR template saved: ${path.basename(prPath)}`);
    }

    console.log();
  }

  _printSummary(analysis, prTemplate) {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    LAYER 6 SUMMARY                             ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');

    const status =
      analysis.failedTests === 0 ? '✅ HEALTHY' : '❌ REQUIRES ACTION';
    console.log(`║ Status: ${status.padEnd(57)}║`);

    console.log(`║ Tests Executed: ${String(analysis.totalTests).padEnd(47)}║`);
    console.log(`║ ✅ Passed: ${String(analysis.passedTests).padEnd(51)}║`);
    console.log(`║ ❌ Failed: ${String(analysis.failedTests).padEnd(51)}║`);
    console.log(`║ 🟡 Flaky: ${String(analysis.flakyTests.length).padEnd(51)}║`);

    if (prTemplate) {
      console.log(
        `║ 🤖 Auto-Healing: ${String('PR GENERATED').padEnd(45)}║`
      );
    } else {
      console.log(
        `║ 🤖 Auto-Healing: ${String('NOT NEEDED').padEnd(45)}║`
      );
    }

    console.log('╠════════════════════════════════════════════════════════════════╣');

    if (analysis.failedTests === 0) {
      console.log('║ NEXT STEPS:                                                    ║');
      console.log('║ ✅ Mark ISE-452 as RESOLVED in Jira                            ║');
      console.log('║ ✅ Push Xray test execution report                             ║');
      console.log('║ ✅ Archive test artifacts                                      ║');
    } else {
      console.log('║ NEXT STEPS:                                                    ║');
      console.log('║ 1. Review LAYER6-PULL-REQUEST-TEMPLATE.md                      ║');
      console.log('║ 2. Create PR with auto-generated fixes                         ║');
      console.log('║ 3. Re-run tests after merge                                    ║');
      console.log('║ 4. Verify all tests pass                                       ║');
    }

    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log(
      '📄 Reports generated in: test-results/\n'
    );
  }
}

// Main execution
const projectRoot = path.join(__dirname, '..');
const orchestrator = new Layer6Orchestrator(projectRoot);
orchestrator.run();
