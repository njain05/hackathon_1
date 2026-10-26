import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: a real browser clicks through the app like a person.
// Run: npm run e2e (starts the backend and frontend if they aren't running).
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000, // generating a timetable takes a few seconds
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // Phones only run the screen check (every page fits, screenshots).
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /screens\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "cd ../backend && .venv/bin/python -m uvicorn app.main:app --port 8000",
          url: "http://localhost:8000/health",
          reuseExistingServer: true,
          timeout: 60_000,
        },
        { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
      ],
});
