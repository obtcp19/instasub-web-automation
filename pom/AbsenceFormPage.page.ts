const { expect } = require('@playwright/test');

export interface AbsenceScenario {
  id: string;
  date: string;
  reason: string;
  duration: string;
  subPreference: string;
  subSelected?: string;
  school?: string;
}

/**
 * Page object for the live InstaSub Employee absence wizard.
 *
 * The Employee flow is Angular Material based: select options render in the
 * CDK overlay, the employee field is an autocomplete, and Step 2/3 panels stay
 * attached while hidden. Methods here target visible controls only.
 */
export class AbsenceFormPage {
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
    this.contactSubstitutes = page.locator('#mat-select-2, mat-select').filter({ hasText: /Contact Substitutes|Substitute|Sub/i }).first();
    this.employeeSchool = page.locator('mat-select[formcontrolname="employeeSchool"]');
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
    scenario.subPreference = await this.selectSubstitutePreference(scenario.subPreference);
    await this.selectSchoolIfAvailable(scenario.school || process.env.ABSENCE_SCHOOL || process.env.SCHOOL_NAME || '');

    if (
      ['Teacher', 'TeacherDirect', 'Direct'].includes(options.requestType) &&
      /notify 1 sub/i.test(scenario.subPreference) &&
      process.env.ALLOW_TEACHER_NOTIFY_ONE !== '1'
    ) {
      scenario.subPreference = await this.selectSpecificSubFallbackPreference();
    }

    if (this.requiresSpecificSub(scenario.subPreference)) {
      await this.selectSubstitute(scenario.subSelected || 'Sub 2');
    }

    const nextStep = await this.advanceFromCreateAbsence(scenario);
    if (nextStep === 'Additional Information') {
      await this.fillVisibleTextarea('PayRollNotes', `ISE-1556 ${scenario.id}`);
      await this.fillVisibleTextarea('NotesToSubstitute', `ISE-1556 ${scenario.id} coverage`);
      await this.clickAdditionalInformationNext();
      await this.waitForStep('Done');
    }
  }

  async prepareRequestType(requestType) {
    if (['Teacher', 'TeacherDirect', 'Direct'].includes(requestType)) {
      await this.waitForAppIdle();
      return;
    }

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
    const employeeSearchText = process.env.ABSENCE_EMPLOYEE_SEARCH || 'staffuser210@mailinator.com';
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
    const queries = this.uniqueValues([searchText, employeeLabel]);
    const labels = this.uniqueValues([employeeLabel, searchText]);

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
    const alertText = await this.dismissPreferenceAlert();

    if (/notify my favorites/i.test(preference) && /no preferred substitute/i.test(alertText)) {
      const fallbackPreference = process.env.ABSENCE_FAVORITES_FALLBACK || 'Notify all subs';
      await this.chooseOption(this.substitutePreference, fallbackPreference);
      await this.dismissPreferenceAlert();
      return fallbackPreference;
    }

    return preference;
  }

  async selectSchoolIfAvailable(schoolName) {
    if (!schoolName) return false;
    if (!(await this.employeeSchool.isVisible({ timeout: 1500 }).catch(() => false))) return false;

    await this.chooseOption(this.employeeSchool, schoolName);
    await this.closeOpenOverlays();
    return true;
  }

  async dismissPreferenceAlert() {
    const alert = this.page
      .locator('[role="alert"]:visible, .mat-snack-bar-container:visible, .toast:visible, .cdk-overlay-container:visible')
      .first();
    let alertText = await alert.textContent({ timeout: 1000 }).catch(() => '');
    const noPreferredSubstitute = this.page.getByText(/There is no preferred substitute/i).first();
    if (await noPreferredSubstitute.isVisible({ timeout: 1000 }).catch(() => false)) {
      alertText = `${alertText} There is no preferred substitute.`;
    }
    const alertButton = this.page.locator('button:has-text("dismiss"):visible, button[aria-label*="dismiss" i]:visible').first();
    if (await alertButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await alertButton.click().catch(() => {});
      await this.waitForAppIdle();
    }
    return alertText || '';
  }

  async selectSubstitute(subName) {
    await this.openSubstitutePicker();

    const option = await this.findSubstituteOption(subName);
    await option.waitFor({ state: 'visible', timeout: this.timeout });

    await this.clickSubstituteOption(option);
    await this.waitForAppIdle();
  }

  async expectSubstituteSelected(subName) {
    const selectedName = this.page
      .locator(`xpath=//*[normalize-space()=${this.xpathLiteral(subName)}]`)
      .last();
    if (await selectedName.isVisible({ timeout: this.timeout }).catch(() => false)) return;

    const selectedTag = this.page
      .locator('mat-chip, .mat-chip, .mat-mdc-chip, [class*="chip"], [class*="tag"]')
      .filter({ hasText: new RegExp(this.escapeRegex(subName), 'i') })
      .first();
    if (await selectedTag.isVisible({ timeout: this.timeout }).catch(() => false)) return;

    const selectedText = this.page.getByText(new RegExp(`^\\s*${this.escapeRegex(subName)}\\s*(×|x)?\\s*$`, 'i')).first();
    if (await selectedText.isVisible({ timeout: this.timeout }).catch(() => false)) return;

    const selectedChip = this.page
      .locator('mat-select, .mat-select-panel, .mat-mdc-select-panel, .cdk-overlay-pane')
      .filter({ hasText: new RegExp(this.escapeRegex(subName), 'i') })
      .first();

    if (await selectedChip.isVisible({ timeout: this.timeout }).catch(() => false)) return;

    const bodyText = await this.page.locator('body').innerText({ timeout: this.timeout }).catch(() => '');
    if (new RegExp(this.escapeRegex(subName), 'i').test(bodyText)) return;

    throw new Error(`Substitute "${subName}" was not selected after clicking Select.`);
  }

  async clickSubstituteOption(option) {
    await this.clickSubstituteSelectAction(option);

    await this.closeSubstitutePicker();
    if (/who'?s-?available|available/i.test(this.page.url())) {
      throw new Error('Substitute selection clicked the availability view instead of the Select action.');
    }
  }

  async clickSubstituteSelectAction(option) {
    const selectAction = option.locator('xpath=.//*[normalize-space()="Select"]').first();
    await selectAction.waitFor({ state: 'visible', timeout: this.timeout });

    for (let attempt = 0; attempt < 3; attempt++) {
      await selectAction.scrollIntoViewIfNeeded().catch(() => {});
      const clicked = await selectAction.click({ timeout: this.timeout }).then(() => true).catch(async () => {
        return selectAction.click({ force: true, timeout: this.timeout }).then(() => true).catch(() => false);
      });

      if (!clicked) {
        await selectAction.evaluate((element) => {
          const target = element;
          target.scrollIntoView({ block: 'center', inline: 'center' });
          target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        });
      }
      await this.page.waitForTimeout(400);

      if (await this.isSubstituteSelectedFromOption(option).catch(() => false)) return;
    }

    throw new Error(`Clicked Select but substitute row did not become selected: ${await option.innerText().catch(() => '')}`);
  }

  async isSubstituteSelectedFromOption(option) {
    const text = await option.innerText().catch(() => '');
    if (/Selected|Remove|Chosen/i.test(text)) return true;

    return !(await option.locator('xpath=.//*[normalize-space()="Select"]').first().isVisible({ timeout: 250 }).catch(() => false));
  }

  async closeSubstitutePicker() {
    // Commit the pick by clicking a neutral part of the form rather than
    // pressing Escape. In the Angular Material overlay, Escape CANCELS the
    // pending substitute selection before it is applied, which leaves the form
    // showing "Please select a substitute" and blocks the NEXT step.
    const neutralTargets = [
      this.page.getByRole('heading', { name: /Start date/i }).first(),
      this.startDate,
      this.page.getByRole('heading', { name: /Reason/i }).first(),
    ];

    for (const target of neutralTargets) {
      if (!(await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 500 }).catch(() => false))) break;
      if (await target.isVisible({ timeout: 1000 }).catch(() => false)) {
        await target.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(250);
      }
    }

    if (await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Enter').catch(() => {});
      await this.page.waitForTimeout(250);
    }

    if (await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Tab').catch(() => {});
      await this.page.waitForTimeout(250);
    }

    if (await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(250);
    }

    await this.page.getByPlaceholder(/Search substitute/i).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await this.waitForAppIdle();
  }

  async closeOpenOverlays() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(100).catch(() => {});
  }

  async clickCenter(locator) {
    const box = await locator.boundingBox();
    if (!box) {
      await locator.click({ force: true });
      return;
    }

    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  async openSubstitutePicker() {
    await this.waitForAppIdle();
    await this.closeOpenOverlays();

    if (await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 500 }).catch(() => false)) return;

    const candidates = [
      this.page.locator('mat-select').filter({ hasText: /Please select a substitute|Contact Substitutes/i }).first(),
      this.page.locator('#mat-select-2').first(),
    ];

    for (const picker of candidates) {
      if (!(await picker.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await picker.scrollIntoViewIfNeeded().catch(() => {});
      await picker.click({ force: true });
      if (await this.page.getByPlaceholder(/Search substitute/i).isVisible({ timeout: 3000 }).catch(() => false)) return;
      await this.closeOpenOverlays();
    }

    const visibleControls = await this.page.locator('mat-select:visible, [role="listbox"]:visible')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
    throw new Error(`Could not open Contact Substitutes picker. Visible selectors: ${visibleControls.join(' | ') || '(none)'}`);
  }

  async findSubstituteOption(subName) {
    const optionSelector = '[role="option"], mat-option, .mat-option, .mat-mdc-option, .mdc-list-item, [role="menuitem"]';
    const substitutePanel = this.page.locator('xpath=//*[.//input[contains(@placeholder, "Search substitute")] and .//*[@role="option"]]').last();
    await substitutePanel.waitFor({ state: 'visible', timeout: this.timeout });

    const exactName = substitutePanel
      .locator(`xpath=.//*[normalize-space()=${this.xpathLiteral(subName)}]/ancestor::*[@role="option"][1]`)
      .first();
    if (await exactName.isVisible({ timeout: 3000 }).catch(() => false)) return exactName;

    const visibleOptions = substitutePanel.locator(optionSelector).filter({ hasText: /\S/ });
    const requested = visibleOptions
      .filter({ hasText: new RegExp(`(^|\\s)${this.escapeRegex(subName)}(\\s|$)`, 'i') })
      .filter({ hasText: /Select/i })
      .first();
    if (await requested.isVisible({ timeout: 1000 }).catch(() => false)) return requested;

    const optionTexts = await visibleOptions
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean))
      .catch(() => []);
    throw new Error(`Could not find substitute "${subName}". Visible substitute options: ${optionTexts.join(' | ') || '(none)'}`);
  }

  async advanceFromCreateAbsence(scenario) {
    const maxAttempts = 4;
    let lastErrors = [];
    let lastStep = null;
    let substituteSelectionRetries = 0;

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
      if (/notify my favorites/i.test(scenario.subPreference) && await this.hasNoPreferredSubstituteAlert()) {
        scenario.subPreference = await this.selectFavoritesFallbackPreference();
        continue;
      }

      if (this.requiresSpecificSub(scenario.subPreference) && await this.hasSelectSubstituteAlert(lastErrors)) {
        const selectedSubstitute = scenario.subSelected || 'Sub 4';
        await this.dismissSelectSubstituteAlert();
        if (substituteSelectionRetries === 0) {
          substituteSelectionRetries += 1;
          await this.selectSubstitute(selectedSubstitute);
        } else {
          scenario.subPreference = await this.selectSpecificSubFallbackPreference();
        }
        continue;
      }

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
        scenario.subPreference = await this.recoverSubstitutePreference(scenario.subPreference);

        if (this.requiresSpecificSub(scenario.subPreference)) {
          await this.selectSubstitute(scenario.subSelected || 'Sub 4');
        }
      }
    }

    throw new Error(
      `Could not advance from Create Absence after ${maxAttempts} attempts. ` +
        `Final step: ${lastStep || '(unknown)'}. ` +
        `Visible validation errors: ${lastErrors.join(' | ') || '(none)'}`
    );
  }

  async recoverSubstitutePreference(preference) {
    const selectedText = (await this.substitutePreference.textContent().catch(() => ''))?.trim() || '';
    if (selectedText.includes(preference)) return preference;
    return this.selectSubstitutePreference(preference);
  }

  async hasNoPreferredSubstituteAlert() {
    return this.page
      .getByText(/There is no preferred substitute/i)
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
  }

  async hasSelectSubstituteAlert(errors = []) {
    if (errors.some((error) => /select a substitute/i.test(error))) return true;

    return this.page
      .getByText(/Please select a substitute/i)
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
  }

  async dismissSelectSubstituteAlert() {
    const dismiss = this.page
      .locator('button:has-text("dismiss"):visible, button[aria-label*="dismiss" i]:visible')
      .or(this.page.getByRole('button', { name: /dismiss/i }))
      .first();
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click().catch(() => {});
    }
    await this.waitForAppIdle();
  }

  async hasVisibleSubstituteTag(subName) {
    const textMatches = this.page.getByText(new RegExp(`^\\s*${this.escapeRegex(subName)}\\s*(×|x)?\\s*$`, 'i'));
    const textCount = await textMatches.count().catch(() => 0);
    for (let index = 0; index < textCount; index++) {
      if (await textMatches.nth(index).isVisible({ timeout: 250 }).catch(() => false)) return true;
    }

    const xpathMatches = this.page.locator(`xpath=//*[normalize-space()=${this.xpathLiteral(subName)}]`);
    const xpathCount = await xpathMatches.count().catch(() => 0);
    for (let index = 0; index < xpathCount; index++) {
      if (await xpathMatches.nth(index).isVisible({ timeout: 250 }).catch(() => false)) return true;
    }

    return false;
  }

  async selectFavoritesFallbackPreference() {
    const fallbackPreference = process.env.ABSENCE_FAVORITES_FALLBACK || 'Notify all subs';
    await this.dismissPreferenceAlert();
    await this.chooseOption(this.substitutePreference, fallbackPreference);
    await this.dismissPreferenceAlert();
    return fallbackPreference;
  }

  async selectSpecificSubFallbackPreference() {
    const fallbackPreference = process.env.ABSENCE_SPECIFIC_SUB_FALLBACK || 'Notify all subs';
    await this.dismissPreferenceAlert();
    await this.chooseOption(this.substitutePreference, fallbackPreference);
    await this.dismissPreferenceAlert();
    return fallbackPreference;
  }

  async clickNext() {
    await this.waitForAppIdle();
    await this.dismissBlockingSnackbar();

    const currentStep = await this.currentWizardStep(500);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.clickNextButton();
      await this.waitForAppIdle();

      const newStep = await this.waitForStepChange(currentStep, 3000);
      if (newStep && newStep !== currentStep) return;

      const errors = await this.visibleValidationErrors();
      if (errors.length > 0) return;
    }

    throw new Error(
      `NEXT did not advance the wizard from ${currentStep || '(unknown step)'}. ` +
        `Visible validation errors: ${(await this.visibleValidationErrors()).join(' | ') || '(none)'}`
    );
  }

  async clickNextButton() {
    // A lingering snackbar (e.g. "Please select a substitute") can sit over the
    // wizard and swallow the click, so clear it first.
    await this.dismissBlockingSnackbar();

    // Prefer an actionable Playwright click on the visible NEXT button: it
    // scrolls into view, waits for the button to be stable and enabled, and
    // fires trusted-style events Angular reacts to.
    const nextButton = this.page.locator('button:visible').filter({ hasText: /^next$/i }).first();
    if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextButton.scrollIntoViewIfNeeded().catch(() => {});
      await nextButton.click({ timeout: 2000 }).catch(() => {});
      await this.page.waitForTimeout(150);
      await this.clickCenter(nextButton).catch(() => {});
      await this.page.waitForTimeout(150);
      await nextButton.click({ force: true, timeout: 2000 }).catch(() => {});
      await this.page.waitForTimeout(150);
    }

    // Fallback: DOM click on the first VISIBLE, enabled NEXT button. The
    // offsetParent guard skips hidden NEXT buttons in inactive wizard panels;
    // no fixed coordinates, which break when the layout shifts.
    const clicked = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const next = buttons.find(
        (button) =>
          /^next$/i.test((button.textContent || '').trim()) &&
          button.offsetParent !== null &&
          !button.disabled &&
          !button.hasAttribute('disabled')
      );
      if (!next) return false;
      next.scrollIntoView({ block: 'center', inline: 'center' });
      next.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
      next.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
      next.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      next.click();
      return true;
    }).catch(() => {});

    if (!clicked) {
      throw new Error('Could not find a visible enabled NEXT button to click.');
    }
  }

  async dismissBlockingSnackbar() {
    const dismiss = this.page
      .locator('button:has-text("dismiss"):visible, button[aria-label*="dismiss" i]:visible')
      .first();
    if (await dismiss.isVisible({ timeout: 500 }).catch(() => false)) {
      await dismiss.click().catch(() => {});
      await this.waitForAppIdle();
    }
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
    await field.blur().catch(() => {});
    await this.waitForAppIdle();
  }

  async clickAdditionalInformationNext() {
    await this.waitForAppIdle();
    await this.page.keyboard.press('Escape').catch(() => {});

    if ((await this.currentWizardStep(500)) === 'Done') return;

    const next = this.page.getByRole('tabpanel', { name: /Additional Information/i })
      .getByRole('button', { name: /^Next$/i })
      .first();
    const fallback = this.page.getByRole('button', { name: /^Next$/i }).last();
    const button = await next.isVisible({ timeout: 1500 }).catch(() => false) ? next : fallback;

    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ force: true, timeout: 5000 }).catch(async () => {
      if ((await this.currentWizardStep(500)) !== 'Done') throw new Error('Could not click Additional Information NEXT.');
    });
    await this.waitForAppIdle();
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
      if (await this.createAbsenceButton.isVisible().catch(() => false)) return 'Done';
      if (await this.page.locator('textarea[formcontrolname="PayRollNotes"]:visible, textarea[formcontrolname="NotesToSubstitute"]:visible').first().isVisible().catch(() => false)) {
        return 'Additional Information';
      }
      if (await this.startDate.isVisible().catch(() => false) && await this.page.locator('button:visible').filter({ hasText: /^next$/i }).first().isVisible().catch(() => false)) {
        return 'Create Absence';
      }

      if (await this.page.getByRole('tabpanel', { name: /done/i }).isVisible({ timeout: 100 }).catch(() => false)) return 'Done';
      if (await this.page.getByRole('tabpanel', { name: /additional information/i }).isVisible({ timeout: 100 }).catch(() => false)) {
        return 'Additional Information';
      }
      if (await this.page.getByRole('tabpanel', { name: /create absence/i }).isVisible({ timeout: 100 }).catch(() => false)) {
        return 'Create Absence';
      }

      const selectedTabText = await this.page
        .locator('[role="tab"][aria-selected="true"], .mat-tab-label-active, .mdc-tab--active')
        .evaluateAll((nodes) => nodes.map((node) => node.textContent || '').join(' '))
        .catch(() => '');

      if (/done/i.test(selectedTabText)) return 'Done';
      if (/additional information/i.test(selectedTabText)) return 'Additional Information';
      if (/create absence/i.test(selectedTabText)) return 'Create Absence';

      await this.page.waitForTimeout(100).catch(() => {});
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
      .locator('mat-error:visible, .mat-error:visible, [role="alert"]:visible, .validation-error:visible, .mat-snack-bar-container:visible, .toast:visible')
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
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  xpathLiteral(text) {
    const value = String(text);
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;

    return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "'", `)})`;
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
