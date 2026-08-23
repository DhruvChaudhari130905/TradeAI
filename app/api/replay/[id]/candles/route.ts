import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchOHLCV } from '@/lib/data'
import type { Candle, Timeframe } from '@/lib/types/replay'

export const dynamic = 'force-dynamic'

/** GET /api/replay/[id]/candles?tf=15m — fetch OHLCV. With `tf`, returns just
 *  that timeframe ({ [tf]: [...] }) so the page can render the replay clock TF
 *  first and load the rest in the background; without it, returns all.
 *  Replay itself is fully client-side. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const tfParam = new URL(request.url).searchParams.get('tf')

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

    const allTimeframes = session.timeframes as Timeframe[]
    const timeframes =
      tfParam && allTimeframes.includes(tfParam as Timeframe)
        ? [tfParam as Timeframe]
        : allTimeframes
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
