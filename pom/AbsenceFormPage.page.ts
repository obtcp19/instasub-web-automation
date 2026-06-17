const { expect } = require('@playwright/test');

/**
 * Page object for the live InstaSub Employee absence wizard.
 *
 * The Employee flow is Angular Material based: select options render in the
 * CDK overlay, the employee field is an autocomplete, and Step 2/3 panels stay
 * attached while hidden. Methods here target visible controls only.
 */
class AbsenceFormPage {
  constructor(page) {
    this.page = page;
    this.timeout = 10000;
    this.employeeSearch = page.locator('input[formcontrolname="EmployeeId"]');
    this.startDate = page.locator('input[formcontrolname="AbsenceStartDate"]');
    this.endDate = page.locator('input[formcontrolname="AbsenceEndDate"]');
    this.reason = page.locator('mat-select[formcontrolname="Reason"]');
    this.duration = page.locator('mat-select[formcontrolname="Duration"]');
    this.standardStartTime = page.locator('input[formcontrolname="StartTime"]');
    this.standardEndTime = page.locator('input[formcontrolname="EndTime"]');
    this.substitutePreference = page.locator('mat-select[formcontrolname="AbsenceType"]');
    this.createAbsenceButton = page.getByRole('button', { name: /Create Absence|Create And Assign/i });
  }

  async navigateTo() {
    await this.page.goto('/absence/createAbsence');
    await this.startDate.waitFor({ state: 'visible', timeout: this.timeout });
    await this.waitForAppIdle();
  }

  async completeScenario(scenario, options = {}) {
    await this.prepareRequestType(options.requestType || 'Employee');
    scenario.date = await this.setDates(scenario.date, scenario.date);
    await this.selectReason(scenario.reason);
    await this.setDuration(scenario.duration);
    await this.selectSubstitutePreference(scenario.subPreference);

    if (this.requiresSpecificSub(scenario.subPreference)) {
      await this.selectSubstitute(scenario.subSelected || 'Sub 2');
    }

    const nextStep = await this.advanceFromCreateAbsence(scenario);
    if (nextStep === 'Additional Information') {
      await this.fillVisibleTextarea('PayRollNotes', `ISE-1556 ${scenario.id}`);
      await this.fillVisibleTextarea('NotesToSubstitute', `ISE-1556 ${scenario.id} coverage`);
      await this.clickNext();
      await this.waitForStep('Done');
    }
  }

  async prepareRequestType(requestType) {
    if (requestType === 'Employee') {
      await this.selectEmployeeForAbsence();
      return;
    }

    const radio = this.page.getByRole('radio', { name: requestType });
    if (!(await radio.isChecked().catch(() => false))) {
      await this.selectRequestType(requestType);
    }
  }

  async selectEmployeeForAbsence() {
    const employeeSearchText = process.env.ABSENCE_EMPLOYEE_SEARCH || 'user third';
    const employeeLabel = process.env.ABSENCE_EMPLOYEE_LABEL || employeeSearchText;

    await this.selectRequestType('Employee');
    await this.selectEmployee(employeeSearchText, employeeLabel);
  }

  async getLeaveBalanceSnapshot() {
    await this.waitForAppIdle();

    const selector = process.env.ABSENCE_LEAVE_BALANCE_SELECTOR;
    const text = selector
      ? await this.page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join('\n'))
      : await this.page.locator('body').innerText();

    const balances = this.parseLeaveBalances(text);
    if (balances.length === 0) {
      throw new Error(
        'Could not read leave balance from the page. ' +
          'Set ABSENCE_LEAVE_BALANCE_SELECTOR to the balance container selector if the label is not visible text.'
      );
    }

    const total = balances.reduce((sum, balance) => sum + balance.value, 0);
    return { total, balances };
  }

  async expectReviewVisible(scenario) {
    const reviewPanel = this.page.getByRole('tabpanel', { name: /Done/i });
    await expect(this.createAbsenceButton).toBeVisible();
    await expect(reviewPanel.getByText(scenario.reason, { exact: true })).toBeVisible();
    await expect(reviewPanel.getByText(this.reviewDateText(scenario.date)).first()).toBeVisible();
  }

  async submitAbsence() {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.trySubmitAbsence();
      if (result.created) {
        return;
      }

      if (attempt === maxRetries) {
        throw new Error(
          `Create Absence did not complete after ${maxRetries + 1} attempts. ` +
            `Last visible errors: ${result.errors.join(' | ') || '(none)'}`
        );
      }

      const retryDate = AbsenceFormPage.nextRetryDate();
      await this.changeDatesFromReviewStep(retryDate, retryDate);
    }
  }

  async trySubmitAbsence() {
    await this.waitForAppIdle();
    await this.createAbsenceButton.scrollIntoViewIfNeeded();

    const submitResponse = this.page
      .waitForResponse((response) => {
        const request = response.request();
        return request.method() !== 'GET' && /absence/i.test(response.url());
      }, { timeout: 30000 })
      .catch(() => null);

    await this.createAbsenceButton.click({ force: true });
    await this.waitForAppIdle();

    const response = await submitResponse;
    if (response?.ok()) {
      const errors = await this.visibleSubmitErrors();
      if (!this.hasDuplicateAbsenceError(errors)) {
        return { created: true, errors };
      }
      return { created: false, errors };
    }

    const errors = await this.visibleSubmitErrors();
    if (response) {
      return {
        created: false,
        errors: [
          `Create Absence request failed with ${response.status()} ${response.statusText()}`,
          ...errors,
        ],
      };
    }

    if (await this.submitAccepted()) {
      return { created: true, errors };
    }

    return { created: false, errors };
  }

  async selectRequestType(type) {
    await this.waitForAppIdle();
    const radio = this.page.getByRole('radio', { name: type });
    const radioContainer = this.page.locator('mat-radio-button', { hasText: type }).first();

    for (let attempt = 0; attempt < 4; attempt++) {
      if (await radio.isChecked().catch(() => false)) break;

      await radioContainer.click({ force: true }).catch(async () => {
        await radio.check({ force: true });
      });
      await this.page.waitForTimeout(250);

      if (await radio.isChecked().catch(() => false)) break;

      await radio.check({ force: true }).catch(() => {});
      await this.page.waitForTimeout(250);
    }

    await expect(radio, `Request type "${type}" should be selected`).toBeChecked({ timeout: this.timeout });
    await this.waitForAppIdle();
    if (type === 'Employee') {
      await this.employeeSearch.waitFor({ state: 'visible', timeout: this.timeout });
      await this.page.waitForTimeout(800);
    }
  }

  async selectEmployee(searchText, employeeLabel) {
    const queries = this.uniqueValues(['third', searchText, 'user third']);
    const labels = this.uniqueValues([employeeLabel, searchText, 'THIRDSCHOOL Kips Employee']);

    for (const query of queries) {
      await this.searchEmployee(query);
      await this.page.locator('[role="option"]').first().waitFor({ state: 'attached', timeout: this.timeout }).catch(() => {});

      for (const label of labels) {
        const option = this.employeeOption(label);
        if ((await option.count()) > 0) {
          await this.employeeSearch.press('ArrowDown').catch(() => {});
          await this.employeeSearch.press('Enter').catch(() => {});
          if (!(await this.employeeSearchHasSelectedValue(labels))) {
            await option.click({ force: true });
          }
          await expect(this.employeeSearch).toHaveValue(new RegExp(labels.map((value) => this.escapeRegex(value)).join('|'), 'i'), {
            timeout: this.timeout,
          });
          await expect(this.page.getByRole('radio', { name: 'Employee' })).toBeChecked({ timeout: this.timeout });
          await this.waitForAppIdle();
          return;
        }
      }
    }

    const visibleOptions = await this.page
      .locator('[role="option"], .cdk-overlay-container *')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
    throw new Error(`Could not select employee "${employeeLabel}". Visible options: ${visibleOptions.join(', ') || '(none)'}`);
  }

  employeeOption(label) {
    return this.page.locator('[role="option"]').filter({ hasText: label }).first();
  }

  async searchEmployee(searchText) {
    await this.employeeSearch.click();
    await this.employeeSearch.fill('');
    await this.page.keyboard.type(searchText, { delay: 100 });
    await this.page.waitForTimeout(1500);
  }

  async setDates(startDate, endDate) {
    await this.fillDateRange(startDate, endDate);

    const startValue = await this.startDate.inputValue().catch(() => '');
    const endValue = await this.endDate.inputValue().catch(() => '');
    if (startValue && endValue) return startDate;

    const retryDate = AbsenceFormPage.nextRetryDate();
    await this.fillDateRange(retryDate, retryDate);
    return retryDate;
  }

  async fillDateRange(startDate, endDate) {
    await this.startDate.fill(startDate);
    await this.startDate.blur();
    await this.waitForAppIdle();
    await this.endDate.fill(endDate);
    await this.endDate.blur();
    await this.waitForAppIdle();
  }

  async selectReason(reason) {
    await this.chooseOption(this.reason, reason);
  }

  async setDuration(duration) {
    const classTime = this.parseTimeRange(duration);
    if (classTime && !duration.includes('Enter Time Manually')) {
      await this.addClassTime(classTime.start, classTime.end);
      return;
    }

    if (duration.includes('Enter Time Manually')) {
      await this.chooseOption(this.duration, 'Enter Time Manually');
      const manualTime = this.parseTimeRange(duration) || { start: '10:00', end: '15:00' };
      await this.fillStandardTimes(manualTime.start, manualTime.end);
      return;
    }

    await this.chooseOption(this.duration, duration);
  }

  async selectSubstitutePreference(preference) {
    await this.chooseOption(this.substitutePreference, preference);
    await this.dismissPreferenceAlert();
  }

  async dismissPreferenceAlert() {
    const alertButton = this.page.locator('button:has-text("dismiss"):visible, button[aria-label*="dismiss" i]:visible').first();
    if (await alertButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await alertButton.click().catch(() => {});
      await this.waitForAppIdle();
    }
  }

  async selectSubstitute(subName) {
    const optionSelector = '[role="option"], mat-option, .mat-option, .mat-mdc-option';
    const options = this.page.locator(optionSelector);
    const requestedOption = options
      .filter({ hasText: new RegExp(this.escapeRegex(subName), 'i') })
      .filter({ hasText: /Available/i })
      .first();
    const availableOption = options.filter({ hasText: /Available/i }).first();

    let option = requestedOption;
    if (!(await option.isVisible({ timeout: this.timeout }).catch(() => false))) {
      option = availableOption;
    }

    await option.waitFor({ state: 'visible', timeout: this.timeout });
    const availableButton = option.getByRole('button', { name: 'Available' });
    if (await availableButton.isVisible().catch(() => false)) {
      await availableButton.click();
    } else {
      await option.click({ force: true });
    }
    await this.waitForAppIdle();
  }

  async advanceFromCreateAbsence(scenario) {
    const maxAttempts = 3;
    let lastErrors = [];
    let lastStep = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.clickNext();
      } catch (clickError) {
        lastErrors.push(`Attempt ${attempt + 1}: ${clickError.message}`);
        if (attempt === maxAttempts - 1) throw clickError;
        continue;
      }

      const step = await this.currentWizardStep(5000);
      lastStep = step;
      if (step === 'Additional Information' || step === 'Done') return step;

      lastErrors = await this.visibleValidationErrors();
      if (!(await this.startDate.isVisible().catch(() => false))) {
        throw new Error(
          `Could not advance from Create Absence and date fields are not visible. ` +
            `Current wizard step: ${step || '(unknown)'}. ` +
            `Visible validation errors: ${lastErrors.join(' | ') || '(none)'}`
        );
      }

      if (attempt < maxAttempts - 1) {
        const retryDate = AbsenceFormPage.nextRetryDate();
        scenario.date = await this.setDates(retryDate, retryDate);

        if (this.requiresSpecificSub(scenario.subPreference)) {
          await this.selectSubstitutePreference(scenario.subPreference);
          await this.selectSubstitute(scenario.subSelected || 'Sub 2');
        }
      }
    }

    throw new Error(
      `Could not advance from Create Absence after ${maxAttempts} attempts. ` +
        `Final step: ${lastStep || '(unknown)'}. ` +
        `Visible validation errors: ${lastErrors.join(' | ') || '(none)'}`
    );
  }

  async clickNext() {
    await this.waitForAppIdle();
    const nextButton = () => this.page.locator('button:visible').filter({ hasText: /^NEXT$/i }).first();
    await nextButton().waitFor({ state: 'visible', timeout: this.timeout });

    const isDisabled = await nextButton().evaluate((btn) => btn.disabled || btn.hasAttribute('disabled')).catch(() => false);
    if (isDisabled) {
      const formState = await this.captureFormState();
      throw new Error(`Next button is disabled. Form state: ${JSON.stringify(formState)}`);
    }

    const currentStep = await this.currentWizardStep(500);
    const stepChangePromise = this.waitForStepChange(currentStep, 10000);

    await nextButton().click({ timeout: this.timeout }).catch(async () => {
      await this.page.waitForTimeout(500);
      await nextButton().click({ force: true, timeout: 5000 }).catch(async () => {
        await nextButton().evaluate((button) => button.click());
      });
    });

    await Promise.race([
      stepChangePromise,
      this.waitForAppIdle(),
    ]).catch(() => {});

    await this.page.waitForTimeout(200);
  }

  async waitForStepChange(currentStep, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      const newStep = await this.currentWizardStep(200);
      if (newStep && newStep !== currentStep) {
        return newStep;
      }
      await this.page.waitForTimeout(250);
    }
    return null;
  }

  async captureFormState() {
    return {
      startDate: await this.startDate.inputValue().catch(() => null),
      endDate: await this.endDate.inputValue().catch(() => null),
      reason: await this.reason.textContent().then(t => t?.trim()).catch(() => null),
      duration: await this.duration.textContent().then(t => t?.trim()).catch(() => null),
      substitutePreference: await this.substitutePreference.textContent().then(t => t?.trim()).catch(() => null),
      validationErrors: await this.visibleValidationErrors(),
    };
  }

  async waitForAppIdle() {
    const overlay = this.page.locator('.block-ui-wrapper.active, .block-ui-spinner').first();
    await overlay.waitFor({ state: 'hidden', timeout: this.timeout }).catch(() => {});
  }

  async addClassTime(start, end) {
    await this.page.locator('button:visible').filter({ hasText: /Add Class/i }).click();
    await this.waitForAppIdle();

    const classStart = this.page.locator('input[type="time"]:visible').nth(0);
    const classEnd = this.page.locator('input[type="time"]:visible').nth(1);
    await classStart.waitFor({ state: 'visible', timeout: this.timeout });
    await classStart.fill(start);
    await classEnd.fill(end);
  }

  async fillStandardTimes(start, end) {
    await this.standardStartTime.waitFor({ state: 'visible', timeout: this.timeout });
    await this.standardStartTime.fill(start);
    await this.standardEndTime.fill(end);
  }

  async fillVisibleTextarea(formControlName, text) {
    const field = this.page.locator(`textarea[formcontrolname="${formControlName}"]:visible`).first();
    await field.waitFor({ state: 'visible', timeout: this.timeout });
    await field.fill(text);
  }

  async chooseOption(select, optionLabel) {
    await this.waitForAppIdle();
    await select.scrollIntoViewIfNeeded();

    const selectedText = (await select.textContent().catch(() => ''))?.trim();
    if (selectedText === optionLabel) {
      return;
    }

    const overlay = this.page.locator('.cdk-overlay-container');
    const optionSelector = 'mat-option, [role="option"], .mat-option, .mat-mdc-option, .mdc-list-item, [role="menuitem"]';
    const option = overlay
      .locator(optionSelector)
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegex(optionLabel)}\\s*$`, 'i') })
      .first();

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.openSelect(select);
      } catch (e) {
        if (attempt === 3) throw e;
        await this.page.keyboard.press('Escape').catch(() => {});
        continue;
      }

      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click({ timeout: this.timeout }).catch(async () => {
          await option.click({ force: true });
        });
        await this.waitForAppIdle();
        return;
      }
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(300);
    }

    const visibleOptions = await overlay
      .locator(optionSelector)
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
    throw new Error(`Could not find option "${optionLabel}". Visible options: ${visibleOptions.join(', ') || '(none)'}`);
  }

  async openSelect(select) {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(200);

    const trigger = select.locator('.mat-select-trigger, .mat-mdc-select-trigger').first();
    const arrow = select.locator('.mat-select-arrow-wrapper, .mat-mdc-select-arrow-wrapper').first();

    for (let attempt = 0; attempt < 3; attempt++) {
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
      } else {
        await select.click();
      }

      if (await this.hasOpenOptions()) return;

      if (await arrow.isVisible().catch(() => false)) {
        await arrow.click({ force: true });
      }

      if (await this.hasOpenOptions()) return;

      await select.focus();
      await this.page.keyboard.press('Space');
      await this.page.waitForTimeout(300);

      if (await this.hasOpenOptions()) return;
    }

    throw new Error('Could not open select dropdown after 3 attempts');
  }

  async hasOpenOptions() {
    return this.page
      .locator('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
  }

  async waitForStep(stepName) {
    await this.page.getByRole('tabpanel', { name: new RegExp(stepName, 'i') }).waitFor({
      state: 'visible',
      timeout: this.timeout,
    });
  }

  async isStepVisible(stepName, timeout = 1000) {
    return this.page
      .getByRole('tabpanel', { name: new RegExp(stepName, 'i') })
      .isVisible({ timeout })
      .catch(() => false);
  }

  async currentWizardStep(timeout = 1000) {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
      const selectedTabText = await this.page
        .locator('[role="tab"][aria-selected="true"], .mat-tab-label-active, .mdc-tab--active')
        .evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join(' '))
        .catch(() => '');

      if (/done/i.test(selectedTabText)) return 'Done';
      if (/additional information/i.test(selectedTabText)) return 'Additional Information';
      if (/create absence/i.test(selectedTabText)) return 'Create Absence';

      if (await this.createAbsenceButton.isVisible().catch(() => false)) return 'Done';
      if (await this.page.locator('textarea[formcontrolname="PayRollNotes"]:visible, textarea[formcontrolname="NotesToSubstitute"]:visible').first().isVisible().catch(() => false)) {
        return 'Additional Information';
      }
      if (await this.isStepVisible('Done', 250)) return 'Done';
      if (await this.isStepVisible('Additional Information', 250)) return 'Additional Information';
      if (await this.isStepVisible('Create Absence', 250)) return 'Create Absence';

      await this.page.waitForTimeout(250);
    }

    return null;
  }

  async changeDatesFromReviewStep(startDate, endDate) {
    await this.waitForStep('Done');
    await this.clickBackFromStep('Done');
    await this.waitForStep('Additional Information');
    await this.clickBackFromStep('Additional Information');
    await this.waitForStep('Create Absence');
    await this.setDates(startDate, endDate);
    await this.clickNext();
    await this.waitForStep('Additional Information');
    await this.clickNext();
    await this.waitForStep('Done');
    await expect(this.createAbsenceButton).toBeVisible();
  }

  async clickBackFromStep(stepName) {
    await this.waitForAppIdle();
    await this.page
      .getByRole('tabpanel', { name: new RegExp(stepName, 'i') })
      .getByRole('button', { name: 'Back' })
      .click();
    await this.waitForAppIdle();
  }

  async submitAccepted() {
    const currentUrl = this.page.url();
    const buttonHidden = await this.createAbsenceButton.waitFor({ state: 'hidden', timeout: 5000 }).then(
      () => true,
      () => false
    );

    if (buttonHidden) return true;

    return this.page.url() !== currentUrl && !(await this.createAbsenceButton.isVisible().catch(() => false));
  }

  async visibleSubmitErrors() {
    return this.page
      .locator('mat-error:visible, .mat-error:visible, .mat-snack-bar-container:visible, .toast:visible, [role="alert"]:visible')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
  }

  async visibleValidationErrors() {
    return this.page
      .locator('mat-error:visible, .mat-error:visible, [role="alert"]:visible, .validation-error:visible')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
  }

  hasDuplicateAbsenceError(errors) {
    return errors.some((error) => /already|duplicate|exists|conflict|overlap|created/i.test(error));
  }

  static nextRetryDate() {
    const date = new Date();
    const offset = 90 + AbsenceFormPage.retryDateOffset;
    AbsenceFormPage.retryDateOffset += 1;
    date.setDate(date.getDate() + offset);

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  }

  requiresSpecificSub(preference) {
    return ['Notify 1 Sub', 'Assign a specific sub'].includes(preference);
  }

  parseTimeRange(value) {
    const match = value.match(/(\d{2}:\d{2})[–-](\d{2}:\d{2})/);
    return match ? { start: match[1], end: match[2] } : null;
  }

  reviewDateText(date) {
    const [month, day, year] = date.split('/').map((part) => Number(part));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
  }

  async employeeSearchHasSelectedValue(labels) {
    const value = await this.employeeSearch.inputValue().catch(() => '');
    return labels.some((label) => new RegExp(`^\\s*${this.escapeRegex(label)}\\s*$`, 'i').test(value));
  }

  parseLeaveBalances(text) {
    const directBalances = text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => /(leave\s*)?balance|available|remaining/i.test(line))
      .map((line) => {
        const numbers = line.match(/-?\d+(?:\.\d+)?/g) || [];
        if (numbers.length === 0) return null;

        return {
          label: line,
          value: Number(numbers[numbers.length - 1]),
        };
      })
      .filter((balance) => balance && Number.isFinite(balance.value));

    if (directBalances.length > 0) return directBalances;

    const lines = text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const startIndex = lines.findIndex((line) => /^leave balance$/i.test(line));
    if (startIndex === -1) return [];

    const sectionLines = [];
    for (const line of lines.slice(startIndex + 1)) {
      if (/^(create absence|schedule absence|upcoming absences|past absences|internal coverage)$/i.test(line)) break;
      if (/^as of\b/i.test(line)) continue;
      sectionLines.push(line);
    }

    const balances = [];
    for (let index = 0; index < sectionLines.length - 1; index += 1) {
      const label = sectionLines[index];
      const valueLine = sectionLines[index + 1];
      const match = valueLine.match(/^(-?\d+(?:\.\d+)?)\s*(?:days?|hours?)?\b/i);

      if (!match || /^-?\d/.test(label)) continue;

      balances.push({
        label,
        value: Number(match[1]),
      });
      index += 1;
    }

    return balances;
  }
}

module.exports = { AbsenceFormPage };

AbsenceFormPage.retryDateOffset = 0;
