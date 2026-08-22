import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildReplayReviewContext, runReplayReviews } from '@/lib/nim/run-replay-reviews'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/replay/[id]/review — run the 5-personality AI review of a
// completed replay session and store it in personality_reviews.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('replay_sessions')
      .select('id, pair, market, timeframes, starting_balance, balance, closed_trades, equity_curve, personality_reviews')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (session.closed_trades.length === 0) {
      return NextResponse.json({ error: 'No closed trades to review.' }, { status: 400 })
    }

    const { context } = buildReplayReviewContext(session)
    const reviews = await runReplayReviews(context)

    const { error: updateError } = await supabase
      .from('replay_sessions')
      .update({ personality_reviews: reviews })
      .eq('id', id)

    if (updateError) {
      console.error('[api/replay/review] update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save review' }, { status: 500 })
    }

    return NextResponse.json({ reviews })
  } catch (error) {
    console.error('[api/replay/review]', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
