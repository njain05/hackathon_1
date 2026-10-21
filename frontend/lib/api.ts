// Base URL of the FastAPI backend. Set NEXT_PUBLIC_API_URL in .env.local
// (local) or in Vercel project settings (production).
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
