import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sin esto Turbopack sube buscando lockfiles y encuentra uno suelto en
  // C:\Users\alexi, fuera del repo, infiriendo mal la raiz del proyecto.
  turbopack: { root: __dirname },
};

export default nextConfig;
