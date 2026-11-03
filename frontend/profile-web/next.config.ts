import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // El servicio de perfiles admite avatares de hasta 5 MB.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
