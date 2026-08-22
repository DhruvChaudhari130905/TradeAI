import { routes, deploymentEnv, type VercelConfig } from '@vercel/config/v1';

// Configure Vercel Functions for long-running backtest workloads
export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'nextjs',
  functions: {
    // Replay candle fetching: Twelve Data API pagination (1s delay per chunk
    // for large date ranges, one request per timeframe)
    'app/api/replay/[id]/candles/route.ts': {
      maxDuration: 120,
      memory: 512,
    },
    // Replay AI endpoints (NIM calls: coach chat + 5 parallel personalities)
    'app/api/replay/[id]/chat/route.ts': {
      maxDuration: 60,
      memory: 512,
    },
    'app/api/replay/[id]/review/route.ts': {
      maxDuration: 120,
      memory: 512,
    },
    // Journal trade AI review endpoint
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