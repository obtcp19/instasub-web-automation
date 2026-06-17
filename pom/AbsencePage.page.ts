import { Page, Locator, expect } from '@playwright/test';

/**
 * AbsencePage
 * Page Object for the InstaSub "Create Absence" wizard (Step 1).
 *
 * Selectors are anchored to Angular reactive-form `formcontrolname` attributes,
 * which are stable across renders — unlike the auto-generated `mat-input-*` /
 * `mat-select-*` ids. Options, radios, and buttons use user-facing roles
 * (getByRole), per the Layer 4 guard rules.
 *
 * Verified live against https://instasub-staging.tcpsoftware.com/absence/createAbsence
 */
export class AbsencePage {
  readonly page: Page;
  private readonly timeout = 10000;

  readonly startDate: Locator;
  readonly endDate: Locator;
  readonly reason: Locator;
  readonly duration: Locator;
  readonly startTime: Locator;
  readonly endTime: Locator;
  readonly substitutePreference: Locator;
  readonly notifyAllSubs: Locator;
  readonly payrollNotes: Locator;
  readonly notesToSubstitute: Locator;
  readonly nextButton: Locator;
  readonly createAbsenceButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.startDate = page.locator('input[formcontrolname="AbsenceStartDate"]');
    this.endDate = page.locator('input[formcontrolname="AbsenceEndDate"]');
    this.reason = page.locator('mat-select[formcontrolname="Reason"]');
    this.duration = page.locator('mat-select[formcontrolname="Duration"]');
    this.startTime = page.locator('input[formcontrolname="StartTime"]');
    this.endTime = page.locator('input[formcontrolname="EndTime"]');
    this.substitutePreference = page.locator('mat-select[formcontrolname="AbsenceType"]');
    this.notifyAllSubs = page.locator('mat-slide-toggle[formcontrolname="isThreshold"]');
    this.payrollNotes = page.locator('textarea[formcontrolname="PayRollNotes"]');
    this.notesToSubstitute = page.locator('textarea[formcontrolname="NotesToSubstitute"]');
    this.nextButton = page.locator('button:visible').filter({ hasText: /^NEXT$/i }).first();
    this.createAbsenceButton = page.getByRole('button', { name: 'Create Absence' });
  }

  async navigateTo(): Promise<void> {
    await this.page.goto('/absence/createAbsence');

    // Fail fast with an honest error if the app bounced us to login, rather
    // than letting a real selector time out and look like selector drift.
    const loginButton = this.page.getByRole('button', { name: 'Login' });
    const outcome = await Promise.race([
      this.startDate
        .waitFor({ state: 'visible', timeout: this.timeout })
        .then(() => 'form')
        .catch(() => 'pending'),
      loginButton
        .waitFor({ state: 'visible', timeout: this.timeout })
        .then(() => 'login')
        .catch(() => 'pending'),
    ]);

    if (outcome === 'login') {
      throw new Error(
        'AUTH_REQUIRED: redirected to the login page — storageState is missing or expired. ' +
          'Regenerate it (you perform the login):\n' +
          '  npx playwright codegen --save-storage=playwright/.auth/user.json https://instasub-staging.tcpsoftware.com'
      );
    }

    // Confirm the form is actually present before any test interacts with it.
    await this.startDate.waitFor({ state: 'visible', timeout: this.timeout });
    await this.waitForAppIdle();
  }

  /**
   * Wait out the Angular block-ui loading overlay, which otherwise intercepts
   * pointer events and makes clicks fail. No-op if the overlay isn't present.
   */
  async waitForAppIdle(): Promise<void> {
    const overlay = this.page.locator('.block-ui-wrapper.active, .block-ui-spinner').first();
    await overlay.waitFor({ state: 'hidden', timeout: this.timeout }).catch(() => {});
  }

  /** Request type: 'Self' | 'Employee' | 'Find a Sub'. */
  async selectRequestType(type: 'Self' | 'Employee' | 'Find a Sub'): Promise<void> {
    await this.waitForAppIdle();
    // Click the visible mat-radio-button host; the underlying <input> is
    // cdk-visually-hidden and its click gets intercepted by the outer circle.
    await this.page.locator('mat-radio-button', { hasText: type }).first().click();
  }

  async setStartDate(date: string): Promise<void> {
    await this.startDate.fill(date);
    await this.startDate.blur(); // commit the value to the Material datepicker
    await this.waitForAppIdle();
  }

  async setEndDate(date: string): Promise<void> {
    await this.endDate.fill(date);
    await this.endDate.blur();
    await this.waitForAppIdle();
  }

  /** Open a mat-select and choose an option by its exact visible text. */
  private async chooseOption(select: Locator, optionLabel: string): Promise<void> {
    await this.waitForAppIdle();
    await select.scrollIntoViewIfNeeded();

    const optionText = this.escapeRegex(optionLabel);
    const exactText = new RegExp(`^\\s*${optionText}\\s*$`, 'i');
    const overlay = this.page.locator('.cdk-overlay-container');
    const optionSelector = [
      'mat-option',
      '[role="option"]',
      '.mat-option',
      '.mat-mdc-option',
      '.mdc-list-item',
      '[role="menuitem"]',
    ].join(', ');
    const option = overlay.locator(optionSelector).filter({ hasText: exactText }).first();

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.openSelect(select);
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.scrollIntoViewIfNeeded();
        await option.click();
        await this.waitForAppIdle();
        return;
      }

      await this.page.keyboard.press('Escape').catch(() => {});
      await this.waitForAppIdle();
    }

    const visibleOptions = await overlay
      .locator(optionSelector)
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);

    throw new Error(
      `Could not find option "${optionLabel}" in dropdown. Visible options: ${visibleOptions.join(', ') || '(none)'}`
    );
  }

  private async openSelect(select: Locator): Promise<void> {
    const trigger = select.locator('.mat-select-trigger, .mat-mdc-select-trigger').first();
    const arrow = select.locator('.mat-select-arrow-wrapper, .mat-mdc-select-arrow-wrapper').first();

    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
    } else {
      await select.click();
    }

    const opened = await this.page
      .locator('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (opened) return;

    if (await arrow.isVisible().catch(() => false)) {
      await arrow.click({ force: true });
    }

    const openedFromArrow = await this.page
      .locator('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (openedFromArrow) return;

    await select.focus();
    await this.page.keyboard.press('Space');
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async selectReason(reason: string): Promise<void> {
    await this.chooseOption(this.reason, reason);
  }

  async selectDuration(duration: string): Promise<void> {
    await this.chooseOption(this.duration, duration);
  }

  async setStartTime(time: string): Promise<void> {
    await this.startTime.fill(time);
  }

  async setEndTime(time: string): Promise<void> {
    await this.endTime.fill(time);
  }

  async selectSubstitutePreference(preference: string): Promise<void> {
    await this.chooseOption(this.substitutePreference, preference);
  }

  async toggleNotifyAllSubs(): Promise<void> {
    await this.notifyAllSubs.click();
  }

  // Notes live on Step 2 ("Additional Information"), so wait for them to appear.
  // Element may be hidden in DOM; scroll into view to make visible.
  async fillPayrollNotes(text: string): Promise<void> {
    await this.waitForAppIdle();
    await this.waitForStep('Additional Information');
    const field = this.visibleTextarea('PayRollNotes');
    await field.waitFor({ state: 'visible', timeout: this.timeout });
    await field.scrollIntoViewIfNeeded();
    await field.fill(text);
  }

  async fillNotesToSubstitute(text: string): Promise<void> {
    await this.waitForAppIdle();
    await this.waitForStep('Additional Information');
    const field = this.visibleTextarea('NotesToSubstitute');
    await field.waitFor({ state: 'visible', timeout: this.timeout });
    await field.scrollIntoViewIfNeeded();
    await field.fill(text);
  }

  async clickNext(): Promise<void> {
    await this.waitForAppIdle();
    const nextButton = this.page.locator('button:visible').filter({ hasText: /^NEXT$/i }).first();
    await nextButton.waitFor({ state: 'visible', timeout: this.timeout });
    await nextButton.scrollIntoViewIfNeeded();
    await nextButton.click({ timeout: this.timeout }).catch(async () => {
      await this.page.waitForTimeout(500);
      await this.page.locator('button:visible').filter({ hasText: /^NEXT$/i }).first().click({ force: true });
    });
    await this.waitForAppIdle();
  }

  async clickBack(): Promise<void> {
    await this.waitForAppIdle();
    await this.page.locator('button:visible').filter({ hasText: /^Back$/ }).first().click();
    await this.waitForAppIdle();
  }

  /** Step 3 ("Done"): submit the wizard. This CREATES a real absence record. */
  async submit(): Promise<void> {
    await this.waitForAppIdle();
    await this.createAbsenceButton.click();
    await this.waitForAppIdle();
  }

  /**
   * Submit Step 3. If the app keeps us on the review screen, go back to Step 1,
   * change the date at runtime, and retry. This covers duplicate/conflicting
   * absence dates in staging without hardcoding a fresh date every run.
   */
  async submitWithRuntimeDateRetry(maxRetries = 3): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.submit();

      if (await this.submitAccepted()) {
        return;
      }

      if (attempt === maxRetries) {
        const errors = await this.visibleSubmitErrors();
        throw new Error(
          `Create Absence did not complete after ${maxRetries + 1} attempts. ` +
            `Last visible errors: ${errors.join(' | ') || '(none)'}`
        );
      }

      const retryDate = this.futureDateString(7 + attempt);
      await this.changeDatesFromReviewStep(retryDate, retryDate);
    }
  }

  async changeDatesFromReviewStep(startDate: string, endDate: string): Promise<void> {
    await this.waitForStep('Done');
    await this.clickBackFromStep('Done');
    await this.waitForStep('Additional Information');
    await this.clickBackFromStep('Additional Information');
    await this.waitForStep('Create Absence');
    await this.setStartDate(startDate);
    await this.setEndDate(endDate);
    await this.clickNext();
    await this.waitForStep('Additional Information');
    await this.clickNext();
    await this.waitForStep('Done');
    await expect(this.createAbsenceButton).toBeVisible();
  }

  async isNextEnabled(): Promise<boolean> {
    return this.nextButton.isEnabled();
  }

  private visibleTextarea(formControlName: string): Locator {
    return this.page.locator(`textarea[formcontrolname="${formControlName}"]:visible`).first();
  }

  private async waitForStep(stepName: 'Create Absence' | 'Additional Information' | 'Done'): Promise<void> {
    await this.stepPanel(stepName).waitFor({
      state: 'visible',
      timeout: this.timeout,
    });
  }

  private async clickBackFromStep(stepName: 'Additional Information' | 'Done'): Promise<void> {
    await this.waitForAppIdle();
    await this.stepPanel(stepName).getByRole('button', { name: 'Back' }).click();
    await this.waitForAppIdle();
  }

  private stepPanel(stepName: 'Create Absence' | 'Additional Information' | 'Done'): Locator {
    return this.page.getByRole('tabpanel', { name: new RegExp(stepName, 'i') });
  }

  private async submitAccepted(): Promise<boolean> {
    const currentUrl = this.page.url();
    const buttonHidden = await this.createAbsenceButton.waitFor({ state: 'hidden', timeout: 15000 }).then(
      () => true,
      () => false
    );

    if (buttonHidden) {
      return true;
    }

    return this.page.url() !== currentUrl && !(await this.createAbsenceButton.isVisible().catch(() => false));
  }

  private async visibleSubmitErrors(): Promise<string[]> {
    return this.page
      .locator('mat-error:visible, .mat-error:visible, .mat-snack-bar-container:visible, .toast:visible, [role="alert"]:visible')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean) as string[])
      .catch(() => []);
  }

  private futureDateString(daysFromToday: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  }
}
