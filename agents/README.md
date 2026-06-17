# 6-Layer Independent Agent Architecture

Enterprise-grade multi-agent system for automated quality engineering. Each agent independently handles one layer of the orchestration pipeline.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│          Master Orchestrator (orchestrate-all-layers.js)    │
│               Coordinates 6 independent agents              │
└─────────────────────────────────────────────────────────────┘
       │
       ├─→ [Agent 1] Requirements Parser (Jira MCP)
       ├─→ [Agent 2] Test Strategy Generator (LLM)
       ├─→ [Agent 3] Context Retrieval (Vector DB MCP)
       ├─→ [Agent 4] Test Code Generator (GitHub MCP)
       ├─→ [Agent 5] Test Execution (Playwright/Docker MCP)
       └─→ [Agent 6] Self-Healing Engineer (Xray/Logging MCP)
```

## Individual Agents

### Agent 1: Requirements Parser (`agent-layer1-requirements.js`)

**Purpose:** Parse Jira issues and extract testable requirements

**Input:** Jira ticket ID
**Output:**
- `context/layer1-requirements.json`
- `test-results/LAYER1-REQUIREMENTS.json` (legacy compatibility)

**Features:**
- Fetches issue from Jira
- Extracts acceptance criteria
- Identifies risk factors
- Lists testable items

**Usage:**
```bash
node agents/agent-layer1-requirements.js ISE-452
```

---

### Agent 2: Test Strategy Generator (`agent-layer2-strategy.js`)

**Purpose:** Generate test scenarios from requirements (Gherkin)

**Input:** `context/layer1-requirements.json` (from Agent 1; falls back to `test-results/LAYER1-REQUIREMENTS.json`)
**Output:** 
- `LAYER2-TEST-STRATEGY.feature`
- `LAYER2-RISK-MATRIX.json`
- `LAYER2-TEST-PLAN.json`
- `context/layer2-strategy-context.json`
- `context/layer2-test-plan.json`
- `context/playwright-verification.json`
- `context/explorer-context.json`

**Features:**
- Dynamic Gherkin generation
- Risk-based test planning
- Mitigation strategy suggestions
- Playwright MCP-style strategy verification using the current spec listing
- Explorer mode: launches Chromium, snapshots the login UI, indexes buttons/inputs/tables, and saves flow coverage
- Shared context handoff for Layer 3 and Layer 4
- Runtime-driven (no hardcoding)

**Usage:**
```bash
# Non-destructive verification with Playwright --list
node agents/agent-layer2-strategy.js ISE-1556

# Opt in to actually running the Playwright spec
node agents/agent-layer2-strategy.js ISE-1556 --run-playwright

# Run headed when --run-playwright is enabled
node agents/agent-layer2-strategy.js ISE-1556 --run-playwright --headed

# Capture live Explorer selectors and flow docs from the InstaSub login page
node agents/agent-layer2-strategy.js ISE-1556 --explore
```

---

### Agent 3: Context Retrieval (`agent-layer3-context.js`)

**Purpose:** Query vector DB for reusable code patterns

**Input:** Requirements or search queries
**Output:** List of matching POMs and utilities

**Features:**
- Semantic search with TF-IDF
- Keyword extraction from requirements
- Reads `context/layer2-strategy-context.json` retrieval queries when present
- Reads `context/explorer-context.json` selectors and flow docs when present
- Writes `context/layer3-retrieval-context.json` for codegen
- Code similarity matching
- Deduplication

**Usage:**
```bash
# Auto-retrieve based on requirements
node agents/agent-layer3-context.js

# Manual search
node agents/agent-layer3-context.js absence confirmation teacher
```

---

### Agent 4: Test Code Generator (`agent-layer4-codegen.js`)

**Purpose:** Generate production-ready Playwright test files

**Input:** Test strategy and requirements
**Output:** `ISE-XXX-test.spec.ts`

**Features:**
- TypeScript code generation
- POM pattern adherence
- Multi-browser support
- Explicit wait strategies
- Database verification

**Usage:**
```bash
node agents/agent-layer4-codegen.js
```

---

### Agent 5: Test Execution (`agent-layer5-execution.js`)

**Purpose:** Execute tests in isolated Docker container

**Input:** Generated test files
**Output:**
- `test-results/junit.xml`
- `test-results/results.json`
- `playwright-report/`

**Features:**
- Parallel test execution
- Multi-browser testing
- Artifact generation (video, screenshots, traces)
- CI/CD integration
- Jira workflow updates: `To Do -> In Progress -> Dev Review -> QA Review -> Release Candidate`

**Usage:**
```bash
# Default: all browsers, parallel
node agents/agent-layer5-execution.js

# Single browser
node agents/agent-layer5-execution.js --chrome

# Sequential
node agents/agent-layer5-execution.js --sequential

# Run a Jira-origin ticket through tests and workflow transitions
node agents/agent-layer5-execution.js ISE-1556

# Skip Jira workflow updates for local dry runs
node agents/agent-layer5-execution.js ISE-1556 --skip-jira

# Advance Jira workflow without rerunning tests
node agents/agent-layer5-execution.js ISE-1556 --jira-only
```

---

### Agent 6: Self-Healing Engineer (`agent-layer6-selfheal.js`)

**Purpose:** Analyze failures and generate auto-fixes

**Input:** Test results from Agent 5
**Output:**
- `LAYER6-SELF-HEALING-ANALYSIS.json`
- `LAYER6-JIRA-REPORT.json`
- `LAYER6-XRAY-REPORT.json`
- `LAYER6-PULL-REQUEST-TEMPLATE.md`

**Features:**
- Automatic failure pattern detection
- Intelligent patch generation
- PR template creation
- Jira/Xray integration

**Usage:**
```bash
node agents/agent-layer6-selfheal.js
```

---

## Master Orchestrator

### Running All Layers

```bash
# Run all 6 agents in sequence
node agents/orchestrate-all-layers.js ISE-452
```

**Output:**
```
┌──────────────────────────────────────────────────────────┐
│ ▶ LAYER 1: Requirements Parser (Jira MCP)               │
└──────────────────────────────────────────────────────────┘
[Agent output...]

┌──────────────────────────────────────────────────────────┐
│ ▶ LAYER 2: Test Strategy Generator (LLM)                │
└──────────────────────────────────────────────────────────┘
[Agent output...]

[... continues for all 6 layers ...]
```

---

## Data Flow Between Agents

```
Agent 1 Output
    ↓
LAYER1-REQUIREMENTS.json
    ↓
Agent 2 Reads + Generates
    ↓
LAYER2-TEST-STRATEGY.feature
LAYER2-RISK-MATRIX.json
LAYER2-TEST-PLAN.json
    ↓
Agent 3 Reads + Searches Vector DB
    ↓
Context Data (POMs, utilities)
    ↓
Agent 4 Reads + Generates Tests
    ↓
ISE-XXX-test.spec.ts
    ↓
Agent 5 Executes
    ↓
test-results/
    ↓
Agent 6 Analyzes + Generates Fixes
    ↓
PR template + Jira/Xray reports
```

---

## Independent Agent Execution

Agents are designed to be **independent** and can be run standalone:

### Run only Layer 1
```bash
node agents/agent-layer1-requirements.js ISE-452
```

### Run only Layer 3 (search for patterns)
```bash
node agents/agent-layer3-context.js confirmation absence
```

### Run only Layer 6 (analyze existing results)
```bash
node agents/agent-layer6-selfheal.js
```

---

## Agent Capabilities

| Agent | Input Type | Runtime Data | Output Files | Standalone |
|-------|-----------|--------------|--------------|-----------|
| 1 | Jira ID | Jira API | LAYER1-* | Yes |
| 2 | JSON | Requirements | LAYER2-* | Yes |
| 3 | Keywords | Vector DB | Context | Yes |
| 4 | JSON | Test plan | Spec file | Yes |
| 5 | Spec file | Test files | Artifacts | Yes |
| 6 | Results | Test output | Reports + PR | Yes |

---

## Environment Variables

All agents use `.env` for Jira credentials:

```bash
JIRA_DOMAIN=timeclockplus.atlassian.net
JIRA_USER_EMAIL=user@example.com
JIRA_API_TOKEN=your-token
```

---

## Usage Examples

### Complete Pipeline
```bash
# Run all layers for ISE-452
node agents/orchestrate-all-layers.js ISE-452
```

### Custom Workflow

```bash
# 1. Parse requirements only
node agents/agent-layer1-requirements.js ISE-452

# 2. Generate strategy
node agents/agent-layer2-strategy.js

# 3. Find reusable code
node agents/agent-layer3-context.js

# 4. Generate tests
node agents/agent-layer4-codegen.js

# 5. Run tests
node agents/agent-layer5-execution.js --chrome

# 6. Analyze results
node agents/agent-layer6-selfheal.js
```

### Different Tickets

```bash
# Parse ISE-123
node agents/agent-layer1-requirements.js ISE-123

# Rest of pipeline auto-adapts to requirements
node agents/agent-layer2-strategy.js
node agents/agent-layer3-context.js
# ... etc
```

---

## Agent Design Principles

✅ **Generic & Reusable**
- Each agent works with any Jira ticket
- Runtime-driven (no hardcoded test data)
- Keyword extraction from requirements
- Flexible search patterns

✅ **Independent**
- Can run standalone
- Consume previous outputs
- No tight coupling

✅ **Observable**
- Clear console output
- Status indicators
- Progress tracking

✅ **Data-Driven**
- Agents fetch requirements at runtime
- Generate strategies dynamically
- Adapt to ticket context

---

## File Structure

```
agents/
├── agent-layer1-requirements.js
├── agent-layer2-strategy.js
├── agent-layer3-context.js
├── agent-layer4-codegen.js
├── agent-layer5-execution.js
├── agent-layer6-selfheal.js
├── orchestrate-all-layers.js
└── README.md (this file)
```

---

## Integration with Master Orchestrator

Master orchestrator (`orchestrate-all-layers.js`) coordinates agents:

1. Executes Layer 1 → Layer 2 → ... → Layer 6
2. Waits for each layer to complete
3. Passes outputs between layers
4. Reports final status

---

## Extensibility

Easy to add new agents:

```javascript
// agents/agent-layerX-newfeature.js
class LayerXAgent {
  execute() {
    console.log(`\n[LAYER X] New Feature`);
    // Implementation
  }
}

// Add to master orchestrator
orchestrator.layerX_NewFeature();
```

---

## Troubleshooting

### Agent fails to find requirements
```bash
# Ensure Layer 1 ran first
node agents/agent-layer1-requirements.js ISE-452
```

### Vector DB empty
```bash
# Index POMs and utilities
npm run vector-db:index

# Then run Layer 3
node agents/agent-layer3-context.js
```

### Test execution fails
```bash
# Check test files exist
ls tests/*.spec.ts

# Run Layer 4 again
node agents/agent-layer4-codegen.js
```

---

## Summary

6 independent agents working together:
- ✅ Parse requirements from Jira
- ✅ Generate test strategies dynamically
- ✅ Search reusable code patterns
- ✅ Generate Playwright tests
- ✅ Execute tests in Docker
- ✅ Auto-detect and fix failures
- ✅ Create PRs and Jira updates

All agents are **generic, reusable, and runtime-driven** — no hardcoded data.

🚀 **Ready for production use**
