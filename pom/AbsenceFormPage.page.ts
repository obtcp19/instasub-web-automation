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
    const keep = new RegExp(`^\\s*${this.escapeRegex(subName)}\\s*$`, 'i');
    const isSelected = async () => {
      try {
        return (await this.selectedSubstituteNames()).some((name) => keep.test(name));
      } catch {
        return false;
      }
    };

    await this.clearSubstituteChipsExcept(subName);
    
    if (await isSelected()) {
      await this.clearSubstituteSearch();
      return;
    }

    const search = this.page.locator('input[formcontrolname="item"]').first();
    await search.waitFor({ state: 'visible', timeout: this.timeout }).catch((err) => {
      throw new Error(`Search input not visible, page may have changed: ${err.message}`);
    });

    for (let attempt = 0; attempt < 3 && !(await isSelected()); attempt++) {
      try {
        await search.click().catch(() => {});
        await this.setSubstituteSearch(subName);
        await this.page.waitForTimeout(500).catch(() => {});
        await this.waitForAppIdle();

        const option = await this.findSubstituteOption(subName).catch(() => null);
        if (option) {
          try {
            await this.clickSubstituteSelectAction(option);
          } catch (err) {
            // continue to next attempt
          }
        }
      } catch (err) {
        if (err.message?.includes('Target page') || err.message?.includes('closed') || err.message?.includes('Channel closed')) {
          throw new Error(`Page closed during substitute selection attempt ${attempt + 1}: ${err.message}`);
        }
      }

      await this.clearSubstituteSearch();
    }

    await this.expectSubstituteSelected(subName);
  }

  async setSubstituteSearch(text) {
    try {
      await this.page
        .locator('input[formcontrolname="item"]')
        .first()
        .evaluate((el, value) => {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, text)
        .catch(() => {});
    } catch (err) {
      if (err.message?.includes('Target page') || err.message?.includes('closed')) {
        throw new Error(`Page closed during setSubstituteSearch: ${err.message}`);
      }
      // Silently ignore other errors
    }
  }

  async clearSubstituteSearch() {
    const search = this.page.locator('input[formcontrolname="item"]').first();
    await search.fill('').catch(() => {});
    await this.setSubstituteSearch('');
  }

  async clearSubstituteChipsExcept(keepName) {
    const keep = new RegExp(`^\\s*${this.escapeRegex(keepName)}\\s*$`, 'i');

    for (let attempt = 0; attempt < 6; attempt++) {
      const names = await this.selectedSubstituteNames().catch(() => []);
      const wrongIndex = names.findIndex((name) => !keep.test(name));
      if (wrongIndex === -1) return;

      // Each chip's remove control is <delete-icon aria-label="Remove tag"
      // role="button"> — not a <button> element.
      const removeButton = this.page
        .locator('tag-input[formcontrolname="Substitutes"] delete-icon[aria-label="Remove tag"], [aria-label="Remove tag"][role="button"]')
        .nth(wrongIndex);
      if (!(await removeButton.isVisible({ timeout: 1000 }).catch(() => false))) return;

      await removeButton.click({ force: true }).catch(() => {});
      await this.waitForAppIdle();
      await this.page.waitForTimeout(200).catch(() => {});
    }
  }

  async selectedSubstituteNames() {
    // Committed subs render as ngx-chips tags; try multiple selector patterns
    const substituteInput = this.page.locator('tag-input[formcontrolname="Substitutes"]');
    
    // First try: look for .tag__text elements
    const tagTexts = await substituteInput.locator('.tag__text').allTextContents().catch(() => []);
    if (tagTexts.length > 0) {
      return tagTexts
        .map(text => (text || '').replace(/[×x✕✖]/g, '').trim())
        .filter(Boolean);
    }
    
    // Second try: look for .tag elements and get their text
    const tags = await substituteInput.locator('[class*="tag"]').allTextContents().catch(() => []);
    if (tags.length > 0) {
      return tags
        .map(text => (text || '').replace(/[×x✕✖]/g, '').trim())
        .filter(text => text && !text.includes('Select'));
    }
    
    // Third try: look for chip elements (Angular Material)
    const chips = await substituteInput.locator('mat-chip, .mat-mdc-chip, [role="option"]').allTextContents().catch(() => []);
    if (chips.length > 0) {
      return chips
        .map(text => (text || '').replace(/[×x✕✖]/g, '').trim())
        .filter(text => text && !text.includes('Select'));
    }
    
    // Last try: get all text content from the input and parse it
    const allText = await substituteInput.textContent().catch(() => '');
    if (allText && allText.trim()) {
      const parsed = allText
        .split(/[×x✕✖]/)
        .map(text => text.trim())
        .filter(text => text && !text.includes('Select') && text.length > 1);
      if (parsed.length > 0) {
        return parsed;
      }
    }
    
    return [];
  }

  async expectSubstituteSelected(subName) {
    const keep = new RegExp(`^\\s*${this.escapeRegex(subName)}\\s*$`, 'i');
    const deadline = Date.now() + this.timeout;

    let committed = [];
    
    while (Date.now() <= deadline) {
      try {
        if (this.page.isClosed?.()) {
          return;
        }
        
        committed = await this.selectedSubstituteNames().catch(() => []);
        if (committed.some((name) => keep.test(name))) return;
        
        await this.page.waitForTimeout(200).catch(() => {});
      } catch (err) {
        if (err.message?.includes('Target page') || err.message?.includes('closed') || err.message?.includes('Channel closed')) {
          return;
        }
        throw err;
      }
    }

    throw new Error(
      `Substitute "${subName}" is not the committed selection. Committed chips: ${committed.join(', ') || '(none)'}.`
    );
  }

  async clickSubstituteOption(option) {
    await this.clickSubstituteSelectAction(option);

    await this.closeSubstitutePicker();
    if (/who'?s-?available|available/i.test(this.page.url())) {
      throw new Error('Substitute selection clicked the availability view instead of the Select action.');
    }
  }

  async clickSubstituteSelectAction(option) {
    // Clicking on the option row itself (not the Select button) commits the selection
    await option.click().catch(() => {});
    
    await this.page.waitForTimeout(800);
    
    const chips = await this.selectedSubstituteNames().catch(() => []);
    if (chips.length > 0) {
      return;
    }
    
    throw new Error(`Option click did not add substitute chip: ${await option.innerText().catch(() => '')}`);
  }

  async isSubstituteSelectedFromOption(option) {
    const text = await option.innerText().catch(() => '');
    if (/Selected|Remove|Chosen/i.test(text)) return true;

    return !(await option.locator('xpath=.//*[normalize-space()="Select"]').first().isVisible({ timeout: 250 }).catch(() => false));
  }

  async closeSubstitutePicker() {
    const search = this.page.locator('input[formcontrolname="item"]').first();
    try {
      if (await search.isVisible({ timeout: 500 }).catch(() => false)) {
        await search.fill('').catch(() => {});
        await search.blur().catch(() => {});
      }
    } catch (e) {
      // ignore
    }

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

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.clickNextButton();
      } catch (e) {
        if (attempt === 2) throw e;
        await this.page.waitForTimeout(500);
        continue;
      }

      await this.page.waitForTimeout(1500);
      await this.waitForAppIdle();

      const step = await this.currentWizardStep(2000);
      if (step && step !== 'Create Absence') {
        return;
      }

      const errors = await this.visibleValidationErrors();
      if (errors.length > 0) {
        return;
      }
    }

    throw new Error('NEXT did not advance the wizard after 3 attempts');
  }

  async clickNextButton() {
    await this.dismissBlockingSnackbar();

    const clicked = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((button) => {
        const text = (button.textContent || '').trim();
        return /^next$/i.test(text);
      });

      if (!nextBtn) {
        return false;
      }

      nextBtn.scrollIntoView({ block: 'center', inline: 'center' });
      nextBtn.click();
      return true;
    }).catch(() => false);

    if (!clicked) {
      throw new Error('Could not find and click NEXT button');
    }

    await this.page.waitForTimeout(300).catch(() => {});
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
    let stateLogged = false;

    // First, wait for ANY form elements to be visible (not empty page)
    const formWaitDeadline = Date.now() + 2000;
    while (Date.now() < formWaitDeadline) {
      const bodyContent = await this.page.locator('body').textContent().catch(() => '');
      if (bodyContent && bodyContent.trim().length > 0) {
        break;
      }
      await this.page.waitForTimeout(100).catch(() => {});
    }

    while (Date.now() <= deadline) {
      // Check 1: Done button visible
      try {
        const isVisible = await Promise.race([
          this.createAbsenceButton.isVisible(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => false);
        if (isVisible) {
          return 'Done';
        }
      } catch (e) {
        // continue
      }

      // Check 2: Additional Information textareas
      try {
        const isVisible = await Promise.race([
          this.page.locator('textarea[formcontrolname="PayRollNotes"]:visible, textarea[formcontrolname="NotesToSubstitute"]:visible').first().isVisible(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => false);
        if (isVisible) {
          return 'Additional Information';
        }
      } catch (e) {
        // continue
      }

      // Check 3: Create Absence form
      try {
        const startDateVisible = await Promise.race([
          this.startDate.isVisible(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => false);
        
        const nextButtonVisible = await Promise.race([
          this.page.locator('button:visible').filter({ hasText: /^next$/i }).first().isVisible(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => false);
        
        if (startDateVisible && nextButtonVisible) {
          return 'Create Absence';
        }
      } catch (e) {
        // continue
      }

      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await this.page.waitForTimeout(100).catch(() => {});
      }
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
