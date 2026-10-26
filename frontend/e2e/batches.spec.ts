import { expect, test } from "@playwright/test";

// P7 through the screens: a half-day Saturday and CSE-3A's labs in two batches.
test("lab batches and a short Saturday, set up in the wizard", async ({ page }) => {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Load sample college" }).click();

  // Week: 6 days, Saturday has only 4 periods.
  await page.getByRole("button", { name: /6-day week/ }).click();
  await page.getByText("Advanced options: more breaks").click();
  const saturday = page.locator("label", { hasText: /^Saturday/ }).getByRole("textbox");
  await saturday.fill("4");
  await saturday.blur();
  await expect(page.getByText(/Saturday: 4 periods, ends/)).toBeVisible();

  // Sections: CSE-3A in two lab batches.
  const steps = page.getByRole("navigation", { name: "Setup steps" });
  await steps.getByRole("button", { name: /Sections/ }).click();
  await page.getByRole("checkbox", { name: /Advanced options/ }).check();
  const batches = page.getByLabel("Lab batches, row 1", { exact: true });
  await batches.fill("A1:30, A2:30");
  await batches.blur();

  // Who teaches what: CSE-3A's Data Structures and DBMS labs run in batches.
  await steps.getByRole("button", { name: /Subjects/ }).click();
  await page.getByRole("checkbox", { name: /Advanced options/ }).nth(1).check();
  await page.getByLabel("Labs in batches, row 1", { exact: true }).selectOption("yes"); // CSE-3A CS201
  await page.getByLabel("Labs in batches, row 3", { exact: true }).selectOption("yes"); // CSE-3A CS203

  await steps.getByRole("button", { name: /Check & generate/ }).click();
  await expect(page.getByText("Everything checks out.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Generate timetable" }).click();
  await page.waitForURL("**/timetable", { timeout: 90_000 });
  await expect(page.getByText("Verified: 0 clashes")).toBeVisible();

  // CSE-3A's grid: batch labs are labelled, and Saturday stops after period 4.
  const grid = page.getByRole("table").first();
  await expect(grid.getByText("Lab A1").first()).toBeVisible();
  await expect(grid.getByText("Lab A2").first()).toBeVisible();
  await expect(grid.getByRole("row", { name: /Saturday/ }).getByText(/No classes after/)).toBeVisible();
  await grid.screenshot({ path: "test-results/screens/batches-grid.png" });

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem("timetable.result.v1") ?? "{}").result.entries as
    { day: string; period: number; section_id: string; batch?: string | null; kind: string }[]);
  expect(Math.max(...entries.filter((e) => e.day === "Saturday").map((e) => e.period))).toBeLessThanOrEqual(4);
  const batchLabs = entries.filter((e) => e.section_id === "CSE-3A" && e.batch);
  expect(new Set(batchLabs.map((e) => e.batch))).toEqual(new Set(["A1", "A2"]));
  expect(batchLabs).toHaveLength(8); // 2 subjects x 2 lab periods x 2 batches
});
