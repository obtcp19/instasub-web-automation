# Layer 6: Self-Healing Engineer - Complete Guide

## Architecture Overview

Layer 6 is the final layer in the 6-layer Quality Engineering Multi-Agent Orchestrator. It automatically analyzes test failures, generates fixes, and creates pull requests.

```
Layer 5 Test Execution Results
         │
         ↓
┌────────────────────────────────────┐
│   Layer 6: Self-Healing Engineer   │
├────────────────────────────────────┤
│ 1. Failure Analysis                │
│ 2. Patch Generation                │
│ 3. Report Generation               │
│ 4. PR Creation                     │
│ 5. Jira/Xray Integration           │
└────────────────────────────────────┘
         │
         ├─→ LAYER6-SELF-HEALING-ANALYSIS.json
         ├─→ LAYER6-JIRA-REPORT.json
         ├─→ LAYER6-XRAY-REPORT.json
         └─→ LAYER6-PULL-REQUEST-TEMPLATE.md
```

## Components

### 1. Self-Healing Analyzer (`self-healing-analyzer.js`)

Analyzes test results and detects failure patterns:

**Input:** `test-results/results.json` (from Layer 5)

**Detection Patterns:**
- **Broken Selectors**: Elements not found, locator timeouts
- **Async Issues**: Null values, race conditions, promise rejections
- **Timeout Problems**: Wait timeouts, slow operations
- **Flakiness**: Tests that pass/fail intermittently

**Output:**
```json
{
  "totalTests": 7,
  "passedTests": 6,
  "failedTests": 1,
  "flakyTests": [{"name": "...", "retries": 2}],
  "brokenSelectors": [{"test": "...", "error": "..."}],
  "timeoutIssues": [{"test": "...", "severity": "MEDIUM"}],
  "recommendations": [...],
  "patches": [...]
}
```

### 2. Orchestrator (`orchestrator.js`)

Main entry point that orchestrates the self-healing workflow:

```bash
node layer6/orchestrator.js
```

**Workflow:**
1. Parse Layer 5 test results
2. Detect failure patterns
3. Generate recommendations
4. Create self-healing patches
5. Generate Jira/Xray reports
6. Create PR template if needed

### 3. Jira/Xray Reporter (`jira-reporter.js`)

Pushes results back to Jira and Xray test management:

```bash
# Report to Jira issue
node layer6/jira-reporter.js report ISE-452

# Create Xray test execution
node layer6/jira-reporter.js xray
```

**Capabilities:**
- Add comments to Jira issues
- Update issue fields/status
- Create Xray test executions
- Attach evidence (HTML reports, videos, traces)

## Generated Artifacts

### 1. Self-Healing Analysis (`LAYER6-SELF-HEALING-ANALYSIS.json`)

Complete analysis of all failures and recommendations:

```json
{
  "analysis": {
    "totalTests": 7,
    "passedTests": 6,
    "failedTests": 1,
    "flakyTests": ["test-name"]
  },
  "recommendations": [
    {
      "priority": 1,
      "category": "CRITICAL",
      "action": "Fix broken selectors",
      "items": [{"test": "...", "error": "..."}]
    }
  ],
  "patches": [
    {
      "type": "SELECTOR_FIX",
      "test": "Past date submission is rejected",
      "file": "pom/AbsenceCreationPage.ts"
    }
  ]
}
```

### 2. Jira Report (`LAYER6-JIRA-REPORT.json`)

Structured format for Jira integration:

```json
{
  "ticket": "ISE-452",
  "executionStatus": "FAILED",
  "testSummary": {
    "total": 7,
    "passed": 6,
    "failed": 1,
    "flaky": 1
  },
  "issues": {
    "brokenSelectors": 1,
    "timeouts": 1,
    "flakyTests": 1
  },
  "actions": {
    "autoHealed": 2,
    "manualReview": 1
  }
}
```

### 3. Xray Report (`LAYER6-XRAY-REPORT.json`)

Test execution report for Xray integration:

```json
{
  "testExecutionName": "ISE-452 Absence Creation - 06/15/2026",
  "testPlan": "ISE-452-ABSENCE-FLOW",
  "results": [
    {
      "testKey": "ISE-452-TC-01",
      "status": "PASSED",
      "duration": 3200
    }
  ],
  "summary": {
    "passPercentage": 86,
    "totalTime": 37700
  }
}
```

### 4. Pull Request Template (`LAYER6-PULL-REQUEST-TEMPLATE.md`)

Auto-generated PR for fixes:

```markdown
# 🔧 Auto-heal test failures: 2 issue(s) detected

## Issues Fixed
- ❌ Broken selector in "Past date submission is rejected"
- ⏱️ Timeout in "Past date submission is rejected"

## Changes
- Updated selectors in `pom/AbsenceCreationPage.ts`
- Increased timeouts in test spec files

### Branch
self-heal/ise-452-1781526012759

### Commits
- fix: Update broken selectors in AbsenceCreationPage
- fix: Increase test timeouts for flaky waits
```

## Failure Detection Patterns

### Pattern 1: Broken Selectors
**Detected by:** Error messages containing "locator", "selector", "not found"
**Auto-fix:** Update POM locator definitions
**Example:**
```
Error: locator.waitFor: Timeout 10000ms exceeded waiting for locator('[data-testid="error-message"]')
→ Generate new selector or query updated DOM
```

### Pattern 2: Timeout Issues
**Detected by:** Error messages containing "timeout", "Timeout", "TimeoutError"
**Auto-fix:** Increase wait timeout in test
**Example:**
```
Error: Timeout 10000ms exceeded
→ Increase from 10000ms to 30000ms
```

### Pattern 3: Async/Race Conditions
**Detected by:** Null values, undefined, "state changed", "element detached"
**Manual fix needed:** Add explicit wait strategies
**Example:**
```
Error: Element state changed between actions
→ Add waitForElementState('stable') before action
```

### Pattern 4: Flaky Tests
**Detected by:** Tests with retries > 0
**Recommendation:** Reduce parallelization, add waits
**Analysis:**
```
Test: "Absence created near system boundary persists confirmation"
Flakiness: 50% (1 failed attempt, 1 passed)
→ Recommend adding retry logic with delays
```

## Integration with Jira/Xray

### Push to Jira

```bash
# Add comment with test summary
node layer6/jira-reporter.js report ISE-452

# Example comment posted to issue:
# 🤖 Automated Test Execution Report
# Total Tests: 7
# Passed: 6
# Failed: 1
# Status: ❌ FAILED
```

### Create Xray Execution

```bash
# Create test execution record
node layer6/jira-reporter.js xray

# Result: New test execution created in Xray with:
# - Test results per test case
# - Automated execution evidence
# - Playback URL to HTML report
```

## Self-Healing Workflow

### When Tests Pass (No Action)
```
Layer 5: All tests passed ✅
    ↓
Layer 6: No issues detected
    ↓
Action: Report success to Jira
    ↓
Jira Comment: "✅ All tests passed - ISE-452 ready for release"
Xray: Create test execution with PASSED status
```

### When Tests Fail (Auto-Heal)
```
Layer 5: 1 failed, 1 flaky ❌
    ↓
Layer 6: Analyze failures
    ├─ Detect: Broken selector (timeout)
    ├─ Detect: Flaky test (intermittent)
    └─ Generate: 2 patches
    ↓
Output:
├─ PR Template: Fix selector + increase timeout
├─ Jira Report: Issue details + evidence
├─ Xray Report: Execution status + metrics
└─ Analysis JSON: Complete failure breakdown
```

## Usage Examples

### Run Self-Healing Analysis

```bash
# Automatic analysis of Layer 5 results
node layer6/orchestrator.js

# Output:
# ✅ Analyzed 7 tests
# ❌ Found 1 failure, 1 flaky
# 🔧 Generated 2 patches
# 📝 PR template ready
```

### Report to Jira

```bash
# Add test summary comment to ISE-452
node layer6/jira-reporter.js report ISE-452

# Output:
# ✅ Comment added to ISE-452
# ✅ Issue status updated
```

### Create Xray Execution

```bash
# Push test results to Xray
node layer6/jira-reporter.js xray

# Output:
# ✅ Xray test execution created: EXEC-12345
# 📊 6 tests recorded
# 📹 Evidence linked
```

## Key Capabilities

✅ **Automatic Failure Detection**
- Selector issues
- Timeout problems
- Async/race conditions
- Flakiness patterns

✅ **Intelligent Patching**
- Update broken selectors
- Increase wait timeouts
- Add retry logic
- Suggest parallelization changes

✅ **Multi-Format Reporting**
- JSON (programmatic)
- Markdown (PR template)
- Jira comments (tracking)
- Xray execution records (test management)

✅ **Jira/Xray Integration**
- Post comments to issues
- Update issue status
- Create test executions
- Attach evidence

✅ **No-Fluff Output**
- Clear problem identification
- Actionable recommendations
- Ready-to-merge PR templates
- Minimal false positives

## Limitations & Manual Review

**Auto-Fixable:**
- ✅ Broken selectors (update locator)
- ✅ Timeout issues (increase wait)
- ✅ Clear error patterns

**Requires Manual Review:**
- ⚠️ Flaky tests (root cause analysis needed)
- ⚠️ Logic errors (test logic may be wrong)
- ⚠️ Environmental issues (network, DB, etc.)

## Next Steps After Layer 6

1. **If all tests pass:**
   ```bash
   # Mark ticket as resolved in Jira
   # Archive test artifacts
   # Complete feature release
   ```

2. **If failures detected:**
   ```bash
   # Review LAYER6-PULL-REQUEST-TEMPLATE.md
   # Create PR with suggested fixes
   # Re-run tests after merge
   # Verify all tests pass (go back to Layer 5)
   ```

3. **If flakiness detected:**
   ```bash
   # Review flaky test logs in detail
   # Add explicit wait strategies
   # Reduce parallelization if needed
   # Re-run with stability fixes
   ```

## Architecture Summary: All 6 Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: Requirements Analyst                                 │
│ (Jira MCP) → ISE-452 details + acceptance criteria           │
└─────────────────────────┬──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: Test Strategist                                      │
│ (LLM) → Gherkin scenarios + risk matrix                      │
└─────────────────────────┬──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 3: Context Retrieval                                    │
│ (Vector DB MCP) → POMs + utilities + reusable patterns       │
└─────────────────────────┬──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 4: Playwright Engineer                                  │
│ (GitHub MCP) → .spec.ts + .page.ts test files               │
└─────────────────────────┬──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 5: QA Execution                                         │
│ (Playwright/Docker MCP) → Test results + artifacts           │
└─────────────────────────┬──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 6: Self-Healing Engineer ✨                             │
│ (Xray/Logging MCP) → Auto-fixes + PR + Jira updates         │
└──────────────────────────────────────────────────────────────┘
```

---

**Status:** Layer 6 Complete ✅
**All 6 Layers:** Fully Operational 🚀
