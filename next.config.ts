import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve under a sub-path such as /jevgpt. Inlined at build time, so rebuild after changing it.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
};

export default nextConfig;
