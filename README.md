# College Timetable

Clash-free timetables and hall bookings for any college.

- **Admins** generate timetables, using Google OR-Tools CP-SAT.
- **Teachers and students** view their own schedules.
- **Organisers** book seminar halls with digital approval.

- `frontend/`: Next.js + Tailwind (Vercel)
- `backend/`: FastAPI + OR-Tools (Render)

See [CLAUDE.md](CLAUDE.md) for run commands and [context.md](context.md) for the design.

## Deploy

The backend goes on **Render** (free) and the frontend on **Vercel** (free). Order matters: Render first, because Vercel needs its URL, then back to Render to allow the Vercel URL.

### 1. Backend on Render
1. Go to <https://dashboard.render.com> and sign in with GitHub.
2. Click **New +** → **Blueprint**.
3. Under **Connect a repository**, pick `njain05/hackathon_1`. If it isn't listed (the repo is private), click **Configure account** / **Connect GitHub**, allow access to `hackathon_1`, and come back.
4. Render reads `render.yaml` and shows one service, **college-timetable-api** (free, Singapore). It asks for two values:
   - `FRONTEND_ORIGINS`: type `http://localhost:3000` for now. You'll replace it in step 3.
   - `DATABASE_URL`: your Supabase connection string. Use the **Session pooler** URI from Supabase → Project → **Connect** (Render can't reach Supabase's direct, IPv6-only address). If you don't have Supabase yet, type `sqlite:///./timetable.db` (works, but data is wiped whenever Render restarts).
5. Click **Apply**. The first build takes a few minutes (it installs OR-Tools).
6. When it says **Live**, copy the URL at the top, e.g. `https://college-timetable-api.onrender.com`.
7. Check it: open `<that URL>/health` in a browser. You should see `{"status":"ok"}`.

### 2. Frontend on Vercel
1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Under **Import Git Repository**, find `hackathon_1` and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and allow the repo.
3. **Root Directory**: click **Edit** and choose `frontend`. The framework shows **Next.js** automatically.
4. Open **Environment Variables** and add:
   - Name `NEXT_PUBLIC_API_URL`, value your Render URL from step 1.6, **without** a trailing `/`.
5. Click **Deploy**. When it finishes, copy your site URL, e.g. `https://hackathon-1-xyz.vercel.app` (shown under **Domains**).

If you forget the variable, the Vercel build stops with "NEXT_PUBLIC_API_URL is not set" on purpose. Add it under **Settings → Environment Variables**, then **Deployments → ⋯ → Redeploy**. The value is baked in at build time, so any change to it needs a redeploy.

### 3. Let the frontend talk to the backend
1. Back on Render, open **college-timetable-api** → **Environment**.
2. Edit `FRONTEND_ORIGINS` and set it to your Vercel URL from step 2.5, starting with `https://`, without a trailing `/`. To also keep local development working, use a comma: `https://hackathon-1-xyz.vercel.app,http://localhost:3000`.
3. Click **Save, rebuild, and deploy**.

### 4. Check the live site
1. Open the Vercel URL. The home page badge should say **Server connected** (the first visit may show "Waking up the server" for up to a minute).
2. **Set up your college → Load sample college → Check & generate → Generate timetable**. You should land on the timetables with **Verified: 0 clashes**.

### Good to know
- **The free Render server sleeps** after about 15 minutes without visitors. The next visit wakes it in up to a minute, and the site shows "Waking up the server, this can take up to a minute" meanwhile. Before a demo, open `<Render URL>/health` a couple of minutes early.
- **Every push to `main` redeploys both** Render and Vercel automatically.
- **Solver speed on the free plan**: Render's free server has about a tenth of a CPU, so `render.yaml` sets `SOLVER_WORKERS=2` (2 search threads beat 8 on a tiny CPU). Generating the sample takes about 20 seconds there, against about 5 on a laptop. A paid plan with more CPU is faster; then raise `SOLVER_WORKERS` to match its CPU count.
- **Vercel preview links** (from other branches) have different URLs that aren't in `FRONTEND_ORIGINS`, so they can't reach the backend. Use the production URL.
- **Troubleshooting**:
  - Browser console says *blocked by CORS policy*: `FRONTEND_ORIGINS` doesn't exactly match the site's address (check `https://` and no trailing `/`).
  - Render build fails on the Python version: change `PYTHON_VERSION` in Render → Environment to the newest `3.12.x`.
- **Secrets** (`DATABASE_URL`, later `ANTHROPIC_API_KEY`) go only in Render's Environment page, never in the code or in a `NEXT_PUBLIC_` variable.
