import { test, Page } from '@playwright/test';
import { StaffManagementPage, StaffSeedScenario } from '../pom/StaffManagementPage';

const scenarios: StaffSeedScenario[] = [
  {
    id: "TC-SEED-01",
    sourceSteps: "Login as Protected Admin: Preconditions: App is running at https://instasublogin.tcpsoftware.com Steps: Navigate to the login page Enter email: adminzx@maillinator.com Enter the admin password Click Login / Submit Verify redirect to Dashboard/Home ( /home ) Expected Result: Admin is logged in and redirected to the home dashboard without errors."
  },
  {
    id: "TC-SEED-02",
    sourceSteps: "Navigate to Staff Management Page: Preconditions: Logged in as admin Steps: Navigate to /manage/employees Verify the staff table loads with all existing staff rows Verify the protected admin ( adminzx@maillinator.com ) is visible in the list Expected Result: Staff management page loads, showing all staff members including the protected admin row."
  },
  {
    id: "TC-SEED-03",
    sourceSteps: "Delete All Non-Protected Staff (UI Flow): Preconditions: On /manage/employees Steps: For each staff row in the table: Check if the email matches adminzx@maillinator.com — if yes, skip If not protected, click the Delete icon/button on that row Wait for the confirmation dialog to appear Click Confirm / Yes in the dialog Wait for success toast / row removal Repeat until all non-protected staff are deleted Verify only the protected admin row remains Expected Result: All 6 non-protected staff members are deleted. Protected admin row is untouched and still visible."
  },
  {
    id: "TC-SEED-04",
    sourceSteps: "Protected Admin is Never Deleted: Preconditions: Script is executing the deletion loop Steps: Script evaluates each row's email against the protected list When the protected admin email is found, the delete action is skipped entirely After full deletion loop completes, confirm protected admin still appears in staff table Expected Result: Protected admin account remains intact throughout and after the full deletion loop."
  },
  {
    id: "TC-SEED-05",
    sourceSteps: "Re-create Staff via Add Staff Button (Per User): Preconditions: Non-protected staff have been deleted; on /manage/employees Steps: Click the Add Staff button on the staff management page In the Add Staff modal/form, fill in: First Name and Last Name Email Phone Location / School Role (District Admin / School Admin / Employee) Type (Teacher) Certified (Yes) Submit / Save the form Verify success toast appears Verify the new staff member row appears in the staff table Expected Result: Each of the 6 staff members is successfully re-created with all correct field values."
  },
  {
    id: "TC-SEED-06",
    sourceSteps: "Verify Full Staff State After Seeding: Preconditions: All 6 staff have been re-created Steps: Reload /manage/employees Count total staff rows — expect 7 For each expected staff member, verify: Name Email Role Location Confirm protected admin is present and unchanged Expected Result: Staff table shows exactly 7 members with all correct data matching the seed dataset."
  },
  {
    id: "TC-SEED-07",
    sourceSteps: "Idempotency — Re-run Script on Already-Seeded State: Preconditions: Script has already been run once; all 7 staff exist Steps: Run the seed script again Script detects existing non-protected users and deletes them Script re-creates all 6 staff again Verify final state is 7 staff (1 protected + 6 re-created) Expected Result: Script is idempotent — running it multiple times always results in the same clean 7-user state without errors or duplicates."
  }
];

test.describe.serial('ISE-1565: staff seeding and management', () => {
  let page: Page;
  let pageObject: StaffManagementPage;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    pageObject = new StaffManagementPage(page);
    await pageObject.navigateTo();
  });

  test.afterAll(async () => {
    await page.close();
  });

  for (const scenario of scenarios) {
    test(`${scenario.id}: staff seeding step`, async () => {
      test.setTimeout(90000);
      await pageObject.completeScenario(scenario);
      await pageObject.expectReviewVisible(scenario);
    });
  }
});
