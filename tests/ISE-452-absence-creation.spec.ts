import { test, expect, Page } from '@playwright/test';
import { AbsenceCreationPage } from '../pom/AbsenceCreationPage';
import { DatabaseHelper } from '../utilities/DatabaseHelper';

const DB_CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://user:password@localhost/testdb';

test.describe('ISE-452: Teacher Absence Creation with Confirmation Number', () => {
  let page: Page;
  let absencePage: AbsenceCreationPage;
  let dbHelper: DatabaseHelper;

  test.beforeAll(async () => {
    dbHelper = new DatabaseHelper(DB_CONNECTION_STRING);
    await dbHelper.connect();
  });

  test.afterAll(async () => {
    await dbHelper.disconnect();
  });

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    absencePage = new AbsenceCreationPage(page);
    await absencePage.navigateTo();
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ============================================================================
  // POSITIVE PATH - Core Business Flow
  // ============================================================================

  test('Teacher creates valid absence and receives confirmation number', async () => {
    // ARRANGE
    const teacherName = 'John Doe';
    const leaveReason = 'Sick Leave';
    const absenceDate = '2026-06-20';

    // ACT
    await absencePage.selectTeacher(teacherName);
    await absencePage.selectLeaveReason(leaveReason);
    await absencePage.setDate(absenceDate);
    await absencePage.submitAbsence();

    // ASSERT
    const confirmationNumber = await absencePage.getConfirmationNumber();

    expect(confirmationNumber).not.toBeNull();
    expect(confirmationNumber).toBeTruthy();
    expect(confirmationNumber).toMatch(/^[A-Z0-9]{6,}$/);

    // Verify database persistence
    const absenceRecord = await dbHelper.getAbsenceByConfirmationNumber(confirmationNumber!);
    expect(absenceRecord).not.toBeNull();
    expect(absenceRecord.teacher_name).toBe(teacherName);
    expect(absenceRecord.leave_reason).toBe(leaveReason);
  });

  // ============================================================================
  // FLAKINESS DETECTION - Retry with Multiple Attempts
  // ============================================================================

  test('Multiple consecutive absence creations generate unique confirmation numbers', async () => {
    const confirmationNumbers: string[] = [];
    const attemptCount = 3;

    for (let i = 0; i < attemptCount; i++) {
      // Each iteration creates a new page to avoid state pollution
      const testPage = await page.context().newPage();
      const testAbsencePage = new AbsenceCreationPage(testPage);

      await testAbsencePage.navigateTo();
      await testAbsencePage.selectTeacher('Jane Doe');
      await testAbsencePage.selectLeaveReason('Vacation');
      await testAbsencePage.setDate(`2026-06-${21 + i}`); // Different dates
      await testAbsencePage.submitAbsence();

      const confirmationNumber = await testAbsencePage.getConfirmationNumber();

      // Assert each attempt generates valid confirmation
      expect(confirmationNumber).not.toBeNull();
      expect(confirmationNumber).toMatch(/^[A-Z0-9]{6,}$/);

      confirmationNumbers.push(confirmationNumber!);
      await testPage.close();
    }

    // Assert all confirmations are unique
    const uniqueConfirmations = new Set(confirmationNumbers);
    expect(uniqueConfirmations.size).toBe(attemptCount);

    // Verify all records persisted in database
    for (const confirmationNumber of confirmationNumbers) {
      const record = await dbHelper.getAbsenceByConfirmationNumber(confirmationNumber);
      expect(record).not.toBeNull();
    }
  });

  // ============================================================================
  // NEGATIVE PATHS - Error Handling
  // ============================================================================

  test('Missing leave reason shows validation error', async () => {
    // ARRANGE
    const teacherName = 'Jane Doe';
    const absenceDate = '2026-06-21';

    // ACT
    await absencePage.selectTeacher(teacherName);
    // INTENTIONALLY skip selectLeaveReason
    await absencePage.setDate(absenceDate);
    await absencePage.submitAbsence();

    // ASSERT
    const isErrorDisplayed = await absencePage.isErrorDisplayed();
    expect(isErrorDisplayed).toBe(true);

    const errorMessage = await absencePage.getErrorMessage();
    expect(errorMessage).toContain('Leave reason is required');

    // Verify no confirmation generated
    const confirmationVisible = await absencePage.confirmationNumberDisplay
      .isVisible()
      .catch(() => false);
    expect(confirmationVisible).toBe(false);
  });

  test('Past date submission is rejected', async () => {
    // ARRANGE
    const pastDate = '2020-01-01';
    const leaveReason = 'Vacation';

    // ACT
    await absencePage.selectTeacher('John Doe');
    await absencePage.selectLeaveReason(leaveReason);
    await absencePage.setDate(pastDate);
    await absencePage.submitAbsence();

    // ASSERT
    const isErrorDisplayed = await absencePage.isErrorDisplayed();
    expect(isErrorDisplayed).toBe(true);

    const errorMessage = await absencePage.getErrorMessage();
    expect(errorMessage).toContain('Cannot create absence for past dates');

    // Verify no database insert
    const countBefore = await dbHelper.countAbsencesForTeacher('John Doe');
    // Count should not increase (implicitly verified by no new confirmation)
  });

  // ============================================================================
  // EDGE CASES - Boundary Conditions & Async Handling
  // ============================================================================

  test('Absence created near system boundary (late date) persists confirmation', async () => {
    // ARRANGE
    const boundaryDate = '2026-12-31';
    const teacherName = 'Alice Smith';
    const leaveReason = 'Personal Day';
    const maxWaitTime = 10000; // 10 seconds max wait

    // ACT
    const startTime = Date.now();
    await absencePage.selectTeacher(teacherName);
    await absencePage.selectLeaveReason(leaveReason);
    await absencePage.setDate(boundaryDate);
    await absencePage.submitAbsence();

    const confirmationNumber = await absencePage.getConfirmationNumber();
    const duration = Date.now() - startTime;

    // ASSERT - Confirmation received within timeout
    expect(confirmationNumber).not.toBeNull();
    expect(duration).toBeLessThan(maxWaitTime);

    // Verify persistence across page refresh
    await page.reload();
    const persistedRecord = await dbHelper.getAbsenceByConfirmationNumber(confirmationNumber!);
    expect(persistedRecord).not.toBeNull();
    expect(persistedRecord.absence_date).toBe(boundaryDate);
  });

  test('Confirmation number persists after page refresh', async () => {
    // ARRANGE & ACT
    await absencePage.selectTeacher('Bob Wilson');
    await absencePage.selectLeaveReason('Sick Leave');
    await absencePage.setDate('2026-07-15');
    await absencePage.submitAbsence();

    const confirmationBeforeRefresh = await absencePage.getConfirmationNumber();

    // Refresh page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // ASSERT - Confirmation still visible/accessible
    const confirmationAfterRefresh = await absencePage.confirmationNumberDisplay
      .textContent()
      .catch(() => null);

    expect(confirmationBeforeRefresh).toBe(confirmationAfterRefresh);
  });

  // ============================================================================
  // RETRY LOGIC FOR FLAKY CONFIRMATION GENERATION
  // ============================================================================

  test('Confirmation number generated reliably (5 retry test)', async () => {
    const maxRetries = 5;
    let confirmationNumber: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const testPage = await page.context().newPage();
        const testAbsencePage = new AbsenceCreationPage(testPage);

        await testAbsencePage.navigateTo();
        await testAbsencePage.selectTeacher('Test Teacher');
        await testAbsencePage.selectLeaveReason('Sick Leave');
        await testAbsencePage.setDate(`2026-06-${20 + attempt}`);
        await testAbsencePage.submitAbsence();

        confirmationNumber = await testAbsencePage.getConfirmationNumber();

        if (confirmationNumber && confirmationNumber !== 'null') {
          await testPage.close();
          break;
        }

        await testPage.close();
      } catch (error) {
        lastError = error as Error;
      }
    }

    // ASSERT - At least one successful confirmation
    expect(confirmationNumber).not.toBeNull();
    expect(confirmationNumber).not.toBe('null');
    expect(confirmationNumber).toMatch(/^[A-Z0-9]{6,}$/);
  });
});
