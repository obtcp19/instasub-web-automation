import { test, Page } from '@playwright/test';
import { AbsenceFormPage, AbsenceScenario } from '../pom/AbsenceFormPage.page';

const scenarios: AbsenceScenario[] = [
  {
    id: "T1",
    date: "1/1/2027",
    reason: "Sick",
    duration: "Full Day",
    subPreference: "Notify all subs"
  },
  {
    id: "T2",
    date: "1/2/2027",
    reason: "Personal",
    duration: "Full Day",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T3",
    date: "1/3/2027",
    reason: "Vacation",
    duration: "Full Day",
    subPreference: "Notify all subs"
  },
  {
    id: "T4",
    date: "1/4/2027",
    reason: "Illness-Family Member",
    duration: "Full Day",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T5",
    date: "1/5/2027",
    reason: "Educational Leave",
    duration: "Half Day AM",
    subPreference: "Notify all subs"
  },
  {
    id: "T6",
    date: "1/6/2027",
    reason: "Professional Development",
    duration: "Half Day AM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T7",
    date: "1/7/2027",
    reason: "Sick",
    duration: "Half Day AM",
    subPreference: "Notify all subs"
  },
  {
    id: "T8",
    date: "1/8/2027",
    reason: "Personal",
    duration: "Half Day AM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T9",
    date: "1/9/2027",
    reason: "Vacation",
    duration: "Half Day PM",
    subPreference: "Notify all subs"
  },
  {
    id: "T10",
    date: "1/10/2027",
    reason: "Illness-Family Member",
    duration: "Half Day PM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T11",
    date: "1/11/2027",
    reason: "Educational Leave",
    duration: "Half Day PM",
    subPreference: "Notify all subs"
  },
  {
    id: "T12",
    date: "1/12/2027",
    reason: "Professional Development",
    duration: "Half Day PM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T13",
    date: "1/13/2027",
    reason: "Sick",
    duration: "Enter Time Manually (09:00–15:00)",
    subPreference: "Notify all subs"
  },
  {
    id: "T14",
    date: "1/14/2027",
    reason: "Personal",
    duration: "Enter Time Manually (09:00–15:00)",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T15",
    date: "1/15/2027",
    reason: "Vacation",
    duration: "Enter Time Manually (09:00–15:00)",
    subPreference: "Notify all subs"
  },
  {
    id: "T16",
    date: "1/18/2027",
    reason: "Illness-Family Member",
    duration: "Enter Time Manually (09:00–15:00)",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T17",
    date: "1/25/2027",
    reason: "Educational Leave",
    duration: "08:00–12:00",
    subPreference: "Notify all subs"
  },
  {
    id: "T18",
    date: "1/26/2027",
    reason: "Professional Development",
    duration: "10:00–14:00",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T19",
    date: "1/27/2027",
    reason: "Sick",
    duration: "09:00–11:00",
    subPreference: "Notify all subs"
  },
  {
    id: "T20",
    date: "2/8/2027",
    reason: "Personal",
    duration: "12:00–16:00",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  },
  {
    id: "T21",
    date: "2/9/2027",
    reason: "Vacation",
    duration: "08:00–10:00",
    subPreference: "Notify all subs"
  },
  {
    id: "T22",
    date: "2/10/2027",
    reason: "Illness-Family Member",
    duration: "13:00–17:00",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 1"
  }
];

test.describe('ISE-1564: data-driven regression', () => {
  let page: Page;
  let pageObject: AbsenceFormPage;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    pageObject = new AbsenceFormPage(page);
    await pageObject.navigateTo();
  });

  test.afterEach(async () => {
    await page.close();
  });

  for (const scenario of scenarios) {
    test(`${scenario.id}: ${scenario.reason}`, async () => {
      test.setTimeout(90000);
      await pageObject.completeScenario(scenario, {
  requestType: "Find a Sub"
});
      await pageObject.expectReviewVisible(scenario);
      await pageObject.submitAbsence();
    });
  }
});
