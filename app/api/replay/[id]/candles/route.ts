import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchOHLCV } from '@/lib/data'
import type { Candle, Timeframe } from '@/lib/types/replay'

export const dynamic = 'force-dynamic'

/** GET /api/replay/[id]/candles — fetch OHLCV for every session timeframe.
 *  Called once at session start / resume; replay itself is fully client-side. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('replay_sessions')
      .select('pair, market, timeframes, date_from, date_to')
      .eq('id', id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const timeframes = session.timeframes as Timeframe[]
    const candlesByTf: Record<string, Candle[]> = {}

    // Sequential — the shared rate limiter paces these; parallel calls would queue anyway
    for (const tf of timeframes) {
      const candles = await fetchOHLCV({
        pair: session.pair,
        market: session.market as 'forex' | 'crypto',
        timeframe: tf,
        dateFrom: session.date_from,
        dateTo: session.date_to,
      })
      candlesByTf[tf] = candles
    }

    return NextResponse.json({ pair: session.pair, market: session.market, candles: candlesByTf })
  } catch (error) {
    console.error('[replay-candles]', error)
    const message =
      error instanceof Error ? error.message : 'Failed to fetch candle data.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
