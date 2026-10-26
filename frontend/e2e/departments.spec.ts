import { expect, test, type Page } from "@playwright/test";

// Departments: the in-charge sends CSE's data to the HOD, the HOD sends it back
// with a note, the in-charge sends it again, the HOD approves, and the Dean's
// Generate waits for ECE's HOD too (or "Generate anyway").
// Run: npx playwright test e2e/departments.spec.ts --project=desktop

const API = process.env.E2E_API_URL ?? "http://localhost:8000";

test.describe.configure({ mode: "serial" });

let code = "";
let adminKey = "";
let hodKey = "";
let inchargeKey = "";
let incharge: Page;
let hod: Page;

test.beforeAll(async ({ browser, playwright }) => {
  const api = await playwright.request.newContext();
  const data = await (await api.get(`${API}/sample`)).json();
  const college = await (await api.post(`${API}/colleges`, { data: { name: "Departments Test College", data } })).json();
  code = college.code;
  adminKey = college.admin_key;
  const asDean = { "X-Admin-Key": adminKey };
  // HODs are appointed for departments of the published timetable.
  const result = await (await api.post(`${API}/generate?time_limit=10`, { data })).json();
  expect((await api.post(`${API}/colleges/${code}/publish`, { data: { data, result }, headers: asDean })).ok()).toBeTruthy();
  const heads: Record<string, string> = {};
  for (const [dept, name] of [["CSE", "Dr. CSE Head"], ["ECE", "Dr. ECE Head"]]) {
    const res = await api.post(`${API}/colleges/${code}/departments/${dept}/hod`, { data: { name }, headers: asDean });
    expect(res.ok()).toBeTruthy();
    heads[dept] = (await res.json()).key;
  }
  hodKey = heads.CSE;
  const made = await api.post(`${API}/colleges/${code}/departments/CSE/incharge`, {
    data: { name: "Prof. Rajesh Kumar", teacher_id: "RK" },
    headers: { "X-Member-Key": hodKey },
  });
  inchargeKey = (await made.json()).key;
  await api.dispose();

  incharge = await (await browser.newContext()).newPage();
  hod = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await incharge?.context().close();
  await hod?.context().close();
});

const reviewTab = (page: Page, name: string) => page.getByRole("navigation", { name: "Department setup steps" }).getByRole("button", { name });

test("the in-charge sends the department's data to the HOD", async () => {
  await incharge.goto(`/department#college=${code}&key=${inchargeKey}`);
  await expect(incharge.getByText("Being prepared").first()).toBeVisible();
  await reviewTab(incharge, "Check & send to HOD").click();
  await incharge.getByRole("button", { name: "Send to the HOD for approval" }).click();
  await expect(incharge.getByText("Waiting for the HOD").first()).toBeVisible();
});

test("the HOD sends it back with a note, and sees only their own department's people", async () => {
  await hod.goto(`/hod#college=${code}&key=${hodKey}`);
  await hod.waitForFunction(() => (localStorage.getItem("timetable.member.v1") ?? "").includes('"hod"'));
  await hod.goto("/department");
  await reviewTab(hod, "Check & approve").click();
  await hod.getByRole("button", { name: "Send back with a note" }).click();
  await hod.getByLabel("What should the in-charge fix?").fill("Add the CS301 lab");
  await hod.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(hod.getByText("Sent back by the HOD").first()).toBeVisible();

  // Other departments' progress shows, but not who runs them.
  await expect(hod.getByText("HOD: Dr. CSE Head.")).toBeVisible();
  await expect(hod.getByText("Dr. ECE Head")).toHaveCount(0);
});

test("the in-charge sees the note, sends it again, and the HOD approves", async () => {
  await incharge.reload();
  await expect(incharge.getByText("“Add the CS301 lab”").first()).toBeVisible();
  await incharge.getByRole("button", { name: "Send it again" }).click();
  await incharge.getByRole("button", { name: "Send to the HOD again" }).click();
  await expect(incharge.getByText("Waiting for the HOD").first()).toBeVisible();

  await hod.reload();
  await reviewTab(hod, "Check & approve").click();
  await hod.getByRole("button", { name: /^Approve .*data$/ }).click();
  await expect(hod.getByText("Approved. The Dean can now include")).toBeVisible();
});

test("the Dean's Generate waits for every department with an HOD, unless they generate anyway", async ({ browser }) => {
  const dean = await (await browser.newContext()).newPage();
  await dean.goto(`/setup#college=${code}&key=${adminKey}`);
  await dean.getByRole("navigation", { name: "Setup steps" }).getByRole("button", { name: /Check & generate/ }).click();
  await expect(dean.getByText("Everything checks out.")).toBeVisible({ timeout: 60_000 });

  await expect(dean.getByText("Waiting for 1 department to be approved by the HOD")).toBeVisible();
  await expect(dean.getByText("approved by the HOD (HOD: Dr. CSE Head)")).toBeVisible();
  const generate = dean.getByRole("button", { name: "Generate timetable" });
  await expect(generate).toBeDisabled();
  await dean.getByLabel(/Generate anyway/).check();
  await expect(generate).toBeEnabled();
  await dean.context().close();
});
