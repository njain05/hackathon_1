import { expect, test } from "@playwright/test";

// Every screen, at desktop and phone size: nothing may scroll sideways.
// Saves <desktop|phone>-<page>.png in test-results/screens for review.
// UPDATE_SCREENSHOTS=1 npm run e2e writes the README's pictures in docs/screenshots instead.

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const SHOTS = process.env.UPDATE_SCREENSHOTS ? "../docs/screenshots" : "test-results/screens";
const README_SHOTS = ["desktop-grid", "desktop-setup", "desktop-timetable", "desktop-book", "desktop-events", "phone-department", "phone-my"];
const shot = (name: string) =>
  !process.env.UPDATE_SCREENSHOTS || README_SHOTS.includes(name) ? `${SHOTS}/${name}.png` : `test-results/screens/${name}.png`;

test("every page fits the screen", async ({ page, request }, testInfo) => {
  // A published sample college with a CSE HOD and timetable in-charge, as a real college would have.
  const data = await (await request.get(`${API}/sample`)).json();
  const college = await (await request.post(`${API}/colleges`, { data: { name: "Sample Institute of Engineering & Technology", data } })).json();
  const admin = { "X-Admin-Key": college.admin_key };
  const result = await (await request.post(`${API}/generate?time_limit=10`, { data })).json();
  expect(result.status).toBe("solved");
  const pub = await request.post(`${API}/colleges/${college.code}/publish`, { data: { data, result }, headers: admin });
  expect(pub.ok()).toBeTruthy();
  const hod = await (await request.post(`${API}/colleges/${college.code}/departments/CSE/hod`, { data: { name: "Dr. Gurdeep Kaur" }, headers: admin })).json();
  const incharge = await (
    await request.post(`${API}/colleges/${college.code}/departments/CSE/incharge`, {
      data: { name: "Prof. Rajesh Kumar", teacher_id: "RK" },
      headers: { "X-Member-Key": hod.key },
    })
  ).json();
  const me = await (await request.get(`${API}/colleges/${college.code}/me`, { headers: { "X-Member-Key": incharge.key } })).json();

  await page.addInitScript(
    ([c, d, r, m]) => {
      localStorage.setItem("timetable.admin.v1", JSON.stringify({ code: c.code, slug: c.slug, name: c.name, key: c.admin_key }));
      localStorage.setItem("timetable.setup.v1", JSON.stringify(d));
      localStorage.setItem("timetable.result.v1", JSON.stringify({ data: d, result: r, at: new Date().toISOString() }));
      localStorage.setItem("timetable.college.v1", c.code);
      localStorage.setItem("timetable.me.v1", JSON.stringify({ role: "section", id: "CSE-3A" }));
      localStorage.setItem("timetable.member.v1", JSON.stringify({ incharge: m }));
    },
    [college, data, result, { ...me, key: incharge.key }],
  );

  const size = testInfo.project.name; // "desktop" or "phone"
  const pages = ["/", "/setup", "/timetable", "/my", "/department", "/book", "/events", "/approvals", "/changes", "/people"];
  const overflowing: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    if (scroll > width + 1) overflowing.push(`${path} (${scroll}px wide on a ${width}px screen)`);
    const name = path === "/" ? "home" : path.slice(1);
    await page.screenshot({ path: shot(`${size}-${name}`), fullPage: size === "phone" });
  }
  // The README's main picture: one section's week as a grid.
  if (size === "desktop") {
    await page.goto("/timetable");
    await page.getByRole("table").first().screenshot({ path: shot("desktop-grid") });
  }
  expect(overflowing, `Pages that scroll sideways:\n${overflowing.join("\n")}`).toEqual([]);
});
