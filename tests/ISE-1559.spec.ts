import { test, Page } from '@playwright/test';
import { AbsenceFormPage, AbsenceScenario } from '../pom/AbsenceFormPage.page';


const EXPECTED_USERNAME = 'staffuser210@mailinator.com';

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
    subPreference: "Notify 1 Sub",
    subSelected: "Sub 2"
  },
  {
    id: "T3",
    date: "1/3/2027",
    reason: "Vacation",
    duration: "Full Day",
    subPreference: "Notify my favorites"
  },
  {
    id: "T4",
    date: "1/4/2027",
    reason: "Illness-Family Member",
    duration: "Full Day",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 2"
  },
  {
    id: "T5",
    date: "1/5/2027",
    reason: "Educational Leave",
    duration: "Full Day",
    subPreference: "No sub required"
  },
  {
    id: "T6",
    date: "1/6/2027",
    reason: "Professional Development",
    duration: "Half Day AM",
    subPreference: "Notify all subs"
  },
  {
    id: "T7",
    date: "1/7/2027",
    reason: "Sick",
    duration: "Half Day AM",
    subPreference: "Notify 1 Sub",
    subSelected: "Sub 2"
  },
  {
    id: "T8",
    date: "1/8/2027",
    reason: "Personal",
    duration: "Half Day AM",
    subPreference: "Notify my favorites"
  },
  {
    id: "T9",
    date: "1/9/2027",
    reason: "Vacation",
    duration: "Half Day AM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 2"
  },
  {
    id: "T10",
    date: "1/10/2027",
    reason: "Illness-Family Member",
    duration: "Half Day AM",
    subPreference: "No sub required"
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
    subPreference: "Notify 1 Sub",
    subSelected: "Sub 2"
  },
  {
    id: "T13",
    date: "1/13/2027",
    reason: "Sick",
    duration: "Half Day PM",
    subPreference: "Notify my favorites"
  },
  {
    id: "T14",
    date: "1/14/2027",
    reason: "Personal",
    duration: "Half Day PM",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 2"
  },
  {
    id: "T15",
    date: "1/15/2027",
    reason: "Vacation",
    duration: "Half Day PM",
    subPreference: "No sub required"
  },
  {
    id: "T16",
    date: "1/18/2027",
    reason: "Illness-Family Member",
    duration: "Enter Time Manually (10:00-15:00)",
    subPreference: "Notify all subs"
  },
  {
    id: "T17",
    date: "1/19/2027",
    reason: "Educational Leave",
    duration: "Enter Time Manually (10:00-15:00)",
    subPreference: "Notify 1 Sub",
    subSelected: "Sub 2"
  },
  {
    id: "T18",
    date: "1/20/2027",
    reason: "Professional Development",
    duration: "Enter Time Manually (10:00-15:00)",
    subPreference: "Notify my favorites"
  },
  {
    id: "T19",
    date: "1/21/2027",
    reason: "Sick",
    duration: "Enter Time Manually (10:00-15:00)",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 2"
  },
  {
    id: "T20",
    date: "1/22/2027",
    reason: "Personal",
    duration: "Enter Time Manually (10:00-15:00)",
    subPreference: "No sub required"
  },
  {
    id: "T21",
    date: "1/25/2027",
    reason: "Vacation",
    duration: "08:00-12:00",
    subPreference: "Notify all subs"
  },
  {
    id: "T22",
    date: "1/26/2027",
    reason: "Illness-Family Member",
    duration: "10:00-14:00",
    subPreference: "Notify 1 Sub",
    subSelected: "Sub 2"
  },
  {
    id: "T23",
    date: "1/27/2027",
    reason: "Educational Leave",
    duration: "09:00-11:00",
    subPreference: "Notify my favorites"
  },
  {
    id: "T24",
    date: "2/8/2027",
    reason: "Professional Development",
    duration: "12:00-16:00",
    subPreference: "Assign a specific sub",
    subSelected: "Sub 2"
  },
  {
    id: "T25",
    date: "2/9/2027",
    reason: "Sick",
    duration: "08:00-10:00",
    subPreference: "No sub required"
  },
  {
    id: "T26",
    date: "2/10/2027",
    reason: "Personal",
    duration: "13:00-17:00",
    subPreference: "Notify all subs"
  }
];

test.describe('ISE-1559: Teacher absence pairwise regression', () => {
  let page: Page;
  let absencePage: AbsenceFormPage;


  test.beforeAll(() => {
    if (process.env.Teacher_USERNAME !== EXPECTED_USERNAME) {
      throw new Error(`ISE-1559 must use Teacher_USERNAME=${EXPECTED_USERNAME}. Current Teacher_USERNAME=${process.env.Teacher_USERNAME || '(unset)'}`);
    }
  });

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    absencePage = new AbsenceFormPage(page);
    await absencePage.navigateTo();
  });

  test.afterEach(async () => {
    await page.close();
  });

  for (const scenario of scenarios) {
    test(`${scenario.id}: ${scenario.reason} absence with ${scenario.duration} and ${scenario.subPreference}`, async () => {
      test.setTimeout(90000);

      await absencePage.completeScenario(scenario, { requestType: 'Teacher' });
      await absencePage.expectReviewVisible(scenario);
      await absencePage.submitAbsence();
    });
  }
});
