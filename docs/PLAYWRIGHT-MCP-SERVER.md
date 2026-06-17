# Playwright MCP Server Integration

**Layer 4 (Test Code Generator) now integrates with Playwright MCP Server** for intelligent test code generation.

## Overview

Playwright MCP Server provides Model Context Protocol interface for dynamic test generation, selector optimization, and guard rule enforcement.

```
Layer 4 Agent
    ↓
Playwright MCP Server
    ├─ Generate test code from strategy
    ├─ Optimize selectors (user-facing > brittle CSS/XPath)
    ├─ Enforce guard rules (web-first assertions, automatic waiting)
    ├─ Scaffold POM pattern
    └─ Validate generated code
    ↓
Production-ready Playwright code
```

## MCP Server Capabilities

### 1. Code Generation
```
Endpoint: mcp://playwright/generate-test

Input:
- Test strategy (from Layer 2)
- Test scenarios (Gherkin)
- Context (POMs, utilities)

Output:
- *.spec.ts (test spec)
- *.page.ts (Page Object Model)
- TypeScript typing
```

### 2. Selector Optimization
```
Endpoint: mcp://playwright/optimize-selectors

Priorities:
1. getByRole() - most accessible
2. getByText() - user-facing
3. getByLabel() - form labels
4. data-testid - last resort fallback
❌ XPath, CSS selectors (brittle)
```

### 3. Guard Rule Enforcement
```
Endpoint: mcp://playwright/validate-code

Rules checked:
- Web-first assertions (auto-retry)
- No hardcoded waits
- No state sharing between tests
- Proper test isolation
- Error handling patterns
```

### 4. POM Pattern Scaffolding
```
Endpoint: mcp://playwright/scaffold-pom

Generates:
- Page class with encapsulated selectors
- Action methods
- Wait strategies
- Error handling
```

### 5. Documentation Access
```
Endpoint: mcp://playwright/docs

Provides:
- Playwright best practices
- Selector patterns
- Assertion guides
- Troubleshooting
```

## Layer 4 Agent Usage

### Initialize MCP Server
```javascript
const agent = new Layer4Agent('ISE-452');
const mcp = await agent.initMCPServer();

console.log(mcp.capabilities);
// [
//   'playwright-code-generation',
//   'selector-optimization',
//   'guard-rule-enforcement',
//   'pom-pattern-scaffolding',
//   'test-scenario-mapping'
// ]
```

### Generate Tests via MCP
```javascript
const testPlan = await loadTestPlan();
const result = await agent.generateWithMCP(testPlan, context);

// Returns:
// {
//   status: 'generated-via-mcp',
//   mcpVersion: 'playwright-1.0',
//   artifactsGenerated: [
//     '*.page.ts (POM with optimized selectors)',
//     '*.spec.ts (test spec with guard rules)',
//     'assertions (auto-generated web-first)',
//     'error-handling (built-in retry logic)'
//   ]
// }
```

## Guard Rules Enforced by MCP

### Locators
✅ `page.getByRole('button', { name: 'Submit' })`
✅ `page.getByText('Submit')`
✅ `page.getByLabel('Email')`
⚠️ `page.locator('[data-testid="submit"]')` (fallback only)
❌ `page.locator('div > button:nth-child(2)')` (brittle)
❌ XPath selectors

### Assertions
✅ `expect(locator).toBeVisible()` (auto-retry)
✅ `expect(locator).toHaveText('text')` (web-first)
❌ `expect(await locator.isVisible()).toBe(true)` (no retry)
❌ Manual assertion without locator

### Waiting
✅ Automatic waiting in Playwright actions
✅ `page.waitForLoadState('networkidle')`
❌ `page.waitForTimeout(5000)` (hardcoded)
❌ Manual sleep/delay

### Test Isolation
✅ Each test independent
✅ `beforeEach()` for setup
✅ `afterEach()` for cleanup
❌ Shared state between tests
❌ Sequential test dependencies

## Generated Code Example

### Input (from Layer 2 Strategy)
```gherkin
Scenario: Teacher creates valid absence
  When teacher selects teacher "John Doe"
  And teacher selects leave reason "Sick Leave"
  Then system displays confirmation number
```

### Output (via MCP)

**Page Object Model (generated)**
```typescript
// pom/AbsenceCreationPage.ts
export class AbsenceCreationPage {
  constructor(page: Page) {
    this.page = page;
    // MCP optimized selectors (user-facing first)
    this.teacherSelect = page.getByLabel('Teacher');
    this.leaveReasonSelect = page.getByLabel('Leave Reason');
    this.confirmationNumber = page.locator('[data-testid="confirmation"]');
  }

  async selectTeacher(name: string) {
    await this.teacherSelect.selectOption({ label: name });
  }

  async getConfirmationNumber() {
    await this.confirmationNumber.waitFor({ state: 'visible' });
    return this.confirmationNumber.textContent();
  }
}
```

**Test Spec (generated)**
```typescript
// tests/ISE-452.spec.ts
test('Teacher creates valid absence', async ({ page }) => {
  // MCP enforced: web-first, auto-retry, no hardcoded waits
  const absencePage = new AbsenceCreationPage(page);

  await absencePage.selectTeacher('John Doe');
  await absencePage.selectLeaveReason('Sick Leave');

  // MCP assertion: web-first, auto-retry
  const confirmation = await absencePage.getConfirmationNumber();
  expect(confirmation).toBeTruthy();
  expect(confirmation).toMatch(/^[A-Z0-9]{6,}$/);
});
```

## MCP Server Configuration

### Connect to MCP Server
```bash
# Layer 4 automatically detects and connects to:
export PLAYWRIGHT_MCP_SERVER=localhost:8080
export PLAYWRIGHT_MCP_API_KEY=your-key

# Or configure in .env
PLAYWRIGHT_MCP_SERVER=mcp://playwright
PLAYWRIGHT_MCP_TIMEOUT=30000
```

### Verify Connection
```javascript
const agent = new Layer4Agent('ISE-452');
const status = await agent.verifyMCPConnection();
console.log(status.connected); // true
console.log(status.version);   // playwright-1.0
```

## Benefits of MCP Integration

✅ **Consistency**
- All generated code follows guard rules
- Standardized patterns across tests

✅ **Quality**
- Web-first assertions (never brittle)
- Automatic waiting (no flakiness)
- Proper isolation (reliable tests)

✅ **Maintainability**
- Generated from strategy (traceable)
- Self-documenting code
- Easy to update selectors

✅ **Scalability**
- Works with any ticket
- Handles complex scenarios
- Dynamic POM generation

✅ **Performance**
- Real-time code generation
- Optimized selectors
- Minimal test runtime

## Troubleshooting

### MCP Server not responding
```bash
# Check connection
node agents/agent-layer4-codegen.js --check-mcp

# Verify credentials
echo $PLAYWRIGHT_MCP_SERVER
echo $PLAYWRIGHT_MCP_API_KEY
```

### Generated code has brittle selectors
```bash
# Force re-optimization
node agents/agent-layer4-codegen.js --optimize-selectors

# Check guard rules
node agents/agent-layer4-codegen.js --validate-rules
```

### Code generation failing
```bash
# Enable verbose logging
DEBUG=playwright-mcp node agents/agent-layer4-codegen.js

# Check MCP version compatibility
node agents/agent-layer4-codegen.js --version
```

## Next Steps

1. **Setup**: Configure MCP Server endpoint in `.env`
2. **Test**: Run Layer 4 agent with `--verify-mcp`
3. **Generate**: Run full pipeline with MCP enabled
4. **Validate**: Check generated code follows all guard rules
5. **Execute**: Layer 5 runs generated tests

---

**Status:** Playwright MCP Server integration complete ✅
**Enabled:** Layer 4 (Test Code Generator)
