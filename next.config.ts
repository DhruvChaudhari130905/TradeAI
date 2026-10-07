import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js dev requires unsafe-inline/eval; tighten in production
      "style-src 'self' 'unsafe-inline'",                  // Tailwind CSS requires unsafe-inline
      "img-src 'self' data: blob: https:",                  // Avatars & screenshots from Supabase storage
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://integrate.api.nvidia.com https://api.twelvedata.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['172.20.10.3'],
  // saveSessionCandles ships cached OHLCV (multi-timeframe) through a
  // Server Action — well past the 1MB default.
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // pdfjs-dist must NOT be bundled — it loads a worker file via a
  // relative path that only resolves correctly in node_modules.
  serverExternalPackages: ['pdfjs-dist', 'pdf-parse-fork'],
  // Browser calls to the C++ API go through the same origin (no CORS); see lib/api/client.ts.
  async rewrites() {
    const cppApiUrl = process.env.CPP_API_URL
    return cppApiUrl ? [{ source: '/cpp-api/:path*', destination: `${cppApiUrl}/:path*` }] : []
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
