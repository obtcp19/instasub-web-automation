#!/usr/bin/env node

/**
 * MASTER ORCHESTRATOR: Runs all 6 layer agents in sequence
 * Coordinates data flow between agents
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class MasterOrchestrator {
  constructor(ticketId = 'ISE-452') {
    this.ticketId = ticketId;
    this.agentsDir = __dirname;
    this.results = {};
  }

  run() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   MASTER ORCHESTRATOR: 6-Layer Agent Pipeline              ║');
    console.log('║   Multi-Agent Quality Engineering Orchestration            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    this.layer1_RequirementsParser();
    this.layer2_TestStrategyGenerator();
    this.layer3_ContextRetrieval();
    this.layer4_CodeGenerator();
    this.layer5_ExecutionRunner();
    this.layer6_SelfHealing();

    this.printFinalSummary();
  }

  layer1_RequirementsParser() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 1: Requirements Parser (Jira MCP)               │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer1-requirements.js')} ${this.ticketId}`, {
        stdio: 'inherit',
      });
      this.results.layer1 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 1 skipped or failed\n');
      this.results.layer1 = '⚠️  SKIPPED';
    }
  }

  layer2_TestStrategyGenerator() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 2: Test Strategy Generator (LLM)                │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer2-strategy.js')}`, {
        stdio: 'inherit',
      });
      this.results.layer2 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 2 failed\n');
      this.results.layer2 = '❌ FAILED';
    }
  }

  layer3_ContextRetrieval() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 3: Context Retrieval (Vector DB MCP)            │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer3-context.js')}`, {
        stdio: 'inherit',
      });
      this.results.layer3 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 3 failed\n');
      this.results.layer3 = '❌ FAILED';
    }
  }

  layer4_CodeGenerator() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 4: Test Code Generator (GitHub MCP)             │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer4-codegen.js')}`, {
        stdio: 'inherit',
      });
      this.results.layer4 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 4 failed\n');
      this.results.layer4 = '❌ FAILED';
    }
  }

  layer5_ExecutionRunner() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 5: Test Execution (Playwright/Docker MCP)       │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer5-execution.js')}`, {
        stdio: 'inherit',
      });
      this.results.layer5 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 5 failed\n');
      this.results.layer5 = '❌ FAILED';
    }
  }

  layer6_SelfHealing() {
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│ ▶ LAYER 6: Self-Healing Engineer (Xray/Logging MCP)     │');
    console.log('└──────────────────────────────────────────────────────────┘\n');

    try {
      execSync(`node ${path.join(this.agentsDir, 'agent-layer6-selfheal.js')}`, {
        stdio: 'inherit',
      });
      this.results.layer6 = '✅ PASSED';
    } catch (error) {
      console.log('⚠️  Layer 6 failed\n');
      this.results.layer6 = '❌ FAILED';
    }
  }

  printFinalSummary() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ORCHESTRATION SUMMARY                   ║');
    console.log('╠════════════════════════════════════════════════════════════╣');

    console.log(`║ Layer 1 (Requirements):    ${this.results.layer1.padEnd(42)}║`);
    console.log(`║ Layer 2 (Strategy):        ${this.results.layer2.padEnd(42)}║`);
    console.log(`║ Layer 3 (Context):         ${this.results.layer3.padEnd(42)}║`);
    console.log(`║ Layer 4 (CodeGen):         ${this.results.layer4.padEnd(42)}║`);
    console.log(`║ Layer 5 (Execution):       ${this.results.layer5.padEnd(42)}║`);
    console.log(`║ Layer 6 (Self-Healing):    ${this.results.layer6.padEnd(42)}║`);

    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║                        NEXT STEPS                          ║');
    console.log('║                                                            ║');
    console.log('║ 1. Review generated artifacts in test-results/             ║');
    console.log('║ 2. Review PR template if failures detected                 ║');
    console.log('║ 3. Run tests: npm run test:ise452                          ║');
    console.log('║ 4. View report: npm run test:report                        ║');
    console.log('║ 5. Push to Jira: node agents/agent-layer6-selfheal.js     ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }
}

// CLI Entry Point
const ticketId = process.argv[2] || 'ISE-452';
const orchestrator = new MasterOrchestrator(ticketId);
orchestrator.run();
