# Selector Fix Guide - ISE-1551 Dropdown Issue

## Problem
Dropdown options not being found:
```
Error: locator('.mat-mdc-option, mat-option, [role="option"]').first() timed out
```

## Root Cause Analysis

Material Select uses a **portal** - the dropdown panel renders OUTSIDE the select control in the DOM.

### Current Selectors Tried
❌ `mat-option` - May not exist or wrong version
❌ `.mat-mdc-option` - Newer Material, not found
❌ `[role="option"]` - Not present

### Solution

Check actual DOM to find correct selector:

1. **Open browser DevTools** (F12)
2. **Navigate to** https://instasub-staging.tcpsoftware.com/absence/createAbsence
3. **Click the "Reason" dropdown**
4. **Inspect the dropdown panel** (right-click on option)
5. **Look for:**
   - Class names: `.mat-menu-item`, `.mat-option`, `.select-option`, etc.
   - Role: `role="option"` or `role="menuitem"`
   - Data attributes: `data-testid`, `formvalue`, etc.

### Likely Selectors (in order of probability)

```typescript
// Material v12+
page.locator('.mat-menu-content .mat-menu-item')

// Material v14+ (MDC)
page.locator('.mdc-list__item')

// Custom implementation
page.locator('[role="option"]') or page.locator('[role="menuitem"]')

// With visible state
page.locator('.mat-select-panel [role="option"]')
```

## Fix Steps

1. **Find correct selector** using DevTools
2. **Update POM** at `pom/AbsencePage.page.ts` line ~111:
   ```typescript
   const anyOption = this.page.locator('YOUR_CORRECT_SELECTOR').first();
   ```
3. **Update filter** at line ~123:
   ```typescript
   const targetOption = this.page
     .locator('YOUR_CORRECT_SELECTOR')
     .filter({ hasText: ... })
   ```
4. **Re-run test:**
   ```bash
   npx playwright test tests/ISE-1551.spec.ts --project=chromium
   ```

## Debug Command

To inspect live dropdown:
```bash
npx playwright codegen --save-storage=playwright/.auth/user.json \
  https://instasub-staging.tcpsoftware.com/absence/createAbsence
```

Then manually:
1. Fill in required fields to get to dropdown
2. Click dropdown
3. Inspect the open panel in DevTools
4. Note the exact selector

## Code Pattern (Once Selector Found)

```typescript
async chooseOption(select: Locator, optionLabel: string): Promise<void> {
  await select.click();
  await this.page.waitForTimeout(300);
  
  const anyOption = this.page.locator('FOUND_SELECTOR').first();
  await anyOption.waitFor({ state: 'attached', timeout: 5000 });

  const targetOption = this.page
    .locator('FOUND_SELECTOR')
    .filter({ hasText: new RegExp(`^\\s*${optionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
    .first();
  
  await targetOption.scrollIntoViewIfNeeded();
  await targetOption.click();
}
```

---

**Priority**: HIGH - Dropdown selection blocks all tests
**Assignee**: Frontend team or QA lead
**Blocker**: Cannot run ISE-1551 tests without fixing dropdown selector
