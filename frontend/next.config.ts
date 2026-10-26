import type { NextConfig } from "next";

// NEXT_PUBLIC_API_URL is baked into the build. On Vercel, fail the build
// loudly instead of shipping a site that quietly calls localhost.
if (process.env.VERCEL === "1" && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is not set. In Vercel: Project > Settings > Environment Variables, add your Render URL, then redeploy.",
  );
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
