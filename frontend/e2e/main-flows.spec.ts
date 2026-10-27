import { expect, test, type Browser, type Page } from "@playwright/test";

// The three flows a judge will try, in order, sharing one college:
// 1. load the sample → generate → "Verified: 0 clashes"
// 2. save online + publish → a student opens the share link on their own phone
// 3. a club books a hall → the admin approves → it shows on the events calendar

test.describe.configure({ mode: "serial" });

let admin: Page;
let code = "";

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  admin = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await admin?.context().close();
});

test("admin loads the sample college and generates a clash-free timetable", async () => {
  await admin.goto("/setup");
  await admin.getByRole("button", { name: "Load sample college" }).click();
  await expect(admin.getByRole("heading", { name: "College & week" })).toBeVisible();

  await admin.getByRole("navigation", { name: "Setup steps" }).getByRole("button", { name: /Check & generate/ }).click();
  await expect(admin.getByText("Everything checks out.")).toBeVisible({ timeout: 60_000 });

  await admin.getByRole("button", { name: "Generate timetable" }).click();
  await admin.waitForURL("**/timetable", { timeout: 90_000 });
  await expect(admin.getByText("Verified: 0 clashes")).toBeVisible();
  await expect(admin.getByRole("table").first()).toBeVisible();
});

test("admin publishes and a student opens it with the share link", async ({ browser }) => {
  await admin.goto("/setup");
  await admin.getByRole("button", { name: "Save online & share" }).click();
  // The Dean chooses how they'll sign in from now on.
  await expect(admin.getByText("Choose how you’ll sign in")).toBeVisible({ timeout: 30_000 });
  await admin.getByLabel("Username").fill("dean");
  await admin.getByLabel("Password (at least 6 characters)").fill("dean1234");
  await admin.getByLabel("Type the password again").fill("dean1234");
  await admin.getByRole("button", { name: "Save my sign-in" }).click();
  await expect(admin.getByText("You sign in as “dean”.")).toBeVisible({ timeout: 30_000 });
  code = (await admin.getByText(/College code [A-Z0-9]{6}/).first().textContent())?.match(/College code ([A-Z0-9]{6})/)?.[1] ?? "";
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await admin.getByRole("button", { name: "Done" }).click();

  await admin.goto("/timetable");
  await admin.getByRole("button", { name: "Publish timetable" }).click();
  await expect(admin.getByText(/Live for everyone/)).toBeVisible({ timeout: 30_000 });

  // A student's phone: a fresh browser that has never seen this college.
  const student = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await student.goto(`/c/${code}`);
  await student.waitForURL("**/my", { timeout: 30_000 });
  await expect(student.getByText(new RegExp(`college code\\s*${code}`, "i"))).toBeVisible();
  await student.getByLabel("Your section").selectOption("CSE-3A");
  await expect(student.getByRole("heading", { name: /My timetable: CSE-3A/ })).toBeVisible();
  // Students don't get the admin's pages in their menu. On a phone the links may sit behind a
  // "Menu" button: open it first, so the check isn't passing just because the links are hidden.
  const menu = student.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await expect(student.getByRole("link", { name: "My timetable" }).first()).toBeVisible();
  await expect(student.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(student.getByRole("link", { name: "Timetables", exact: true })).toHaveCount(0);
  await student.context().close();
});

test("a club books a hall, the admin approves it, and it shows on the events calendar", async ({ browser }) => {
  expect(code).not.toBe("");
  const title = `E2E coding contest ${Date.now()}`;
  const day = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // The organiser uses their own phone.
  const club = await (await browser.newContext()).newPage();
  await club.goto(`/book?college=${code}`);
  await club.locator("input[name=room]").first().check();
  await club.locator("#book-date").fill(day);
  const periods = club.getByRole("group", { name: "Periods" });
  await periods.getByRole("button", { name: /Period 3/ }).click();
  await periods.getByRole("button", { name: /Period 4/ }).click();
  await club.locator("#book-title").fill(title);
  await club.locator("#book-attendees").fill("60");
  await club.locator("#book-organiser").fill("Aman Gill");
  await club.locator("#book-club").fill("Coding Club");
  await club.locator("#book-contact").fill("98765 43210");
  await club.getByRole("button", { name: "Send booking request" }).click();
  await club.waitForURL("**/track/**", { timeout: 30_000 });
  await expect(club.getByRole("heading", { name: title })).toBeVisible();
  await expect(club.getByText(/Waiting for/).first()).toBeVisible();

  // The admin approves.
  await admin.goto("/approvals");
  const card = admin.getByRole("article").filter({ hasText: title });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText(/Decided \(1\)/)).toBeVisible();

  // Anyone sees it on the events calendar.
  await club.goto("/events");
  await expect(club.getByText(title)).toBeVisible();
  await club.context().close();
});
