import { routes, deploymentEnv, type VercelConfig } from '@vercel/config/v1';

// Configure Vercel Functions for long-running backtest workloads
export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'nextjs',
  functions: {
    // Backtest API routes need extended timeout for:
    // - Twelve Data API pagination (1s delay per chunk for large date ranges)
    // - Backtest engine bar-by-bar simulation (CPU intensive)
    // - Parallel NIM API calls (report + 5 personalities = 6 concurrent calls)
    'app/api/backtest/**': {
      maxDuration: 300, // 5 minutes max (Hobby limit), up to 800s on Pro/Enterprise
      memory: 1024,     // 1GB memory for backtest engine arrays
    },
    // Rule extraction also needs time for NIM calls (up to 3 attempts)
    'app/api/backtest/route.ts': {
      maxDuration: 120,
      memory: 512,
    },
    // AI review endpoints
    'app/api/review/**': {
      maxDuration: 60,
      memory: 512,
    },
  },
  // Enable Fluid Compute for better concurrency and background processing
  fluid: true,
  // Cron for daily Twelve Data rate limit reset (if needed)
  crons: [
    {
      path: '/api/cron/daily-reset',
      schedule: '0 0 * * *',
    },
  ],
};