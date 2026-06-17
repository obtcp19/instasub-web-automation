import { Page, Locator } from '@playwright/test';

export class AbsenceCreationPage {
  readonly page: Page;
  readonly teacherDropdown: Locator;
  readonly leaveReasonDropdown: Locator;
  readonly dateInput: Locator;
  readonly submitButton: Locator;
  readonly confirmationNumberDisplay: Locator;
  readonly errorMessageContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.teacherDropdown = page.locator('select[data-testid="teacher-select"]');
    this.leaveReasonDropdown = page.locator('select[data-testid="leave-reason-select"]');
    this.dateInput = page.locator('input[data-testid="absence-date-input"]');
    this.submitButton = page.locator('button[data-testid="submit-absence-btn"]');
    this.confirmationNumberDisplay = page.locator('div[data-testid="confirmation-number"]');
    this.errorMessageContainer = page.locator('div[data-testid="error-message"]');
  }

  async navigateTo() {
    await this.page.goto('/absence/create');
    await this.page.waitForLoadState('networkidle');
  }

  async selectTeacher(teacherName: string) {
    await this.teacherDropdown.selectOption({ label: teacherName });
  }

  async selectLeaveReason(reason: string) {
    await this.leaveReasonDropdown.selectOption({ label: reason });
  }

  async setDate(date: string) {
    await this.dateInput.fill(date);
  }

  async submitAbsence() {
    await this.submitButton.click();
  }

  async getConfirmationNumber(): Promise<string | null> {
    await this.confirmationNumberDisplay.waitFor({ state: 'visible', timeout: 10000 });
    return await this.confirmationNumberDisplay.textContent();
  }

  async getErrorMessage(): Promise<string | null> {
    return await this.errorMessageContainer.textContent();
  }

  async isErrorDisplayed(): Promise<boolean> {
    return await this.errorMessageContainer.isVisible();
  }
}
