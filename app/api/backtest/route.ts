import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'
import { extractStrategyRules } from '@/lib/nim/extract-strategy-rules'
import { PDFParse } from 'pdf-parse'

export async function POST(request: Request) {
  try {
    // ── Auth verification ──────────────────────────────────────────────────
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { strategyDocUrl, strategyName, market, pair, timeframe, dateFrom, dateTo, startingCapital, mode, approvedRules, executionConfig } = body

    // Validate required fields
    if (!market || !pair || !timeframe || !dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'Missing required fields: market, pair, timeframe, dateFrom, dateTo' },
        { status: 400 },
      )
    }

    if (!['forex', 'crypto'].includes(market)) {
      return NextResponse.json({ error: 'market must be "forex" or "crypto"' }, { status: 400 })
    }

    const capital = Number(startingCapital) || 10000
    if (capital <= 0) {
      return NextResponse.json({ error: 'startingCapital must be positive' }, { status: 400 })
    }

    const userId = user.id

    const serviceClient = createServiceClient()

    if (mode === 'manual') {
      // Manual mode: rules provided directly, skip extraction
      if (!approvedRules) {
        return NextResponse.json({ error: 'approvedRules required for manual mode' }, { status: 400 })
      }

      const { data: run, error: insertError } = await serviceClient
        .from('backtest_runs')
        .insert({
          user_id: userId,
          strategy_name: strategyName || 'Manual Strategy',
          strategy_doc_url: null,
          market,
          pair,
          timeframe,
          date_from: dateFrom,
          date_to: dateTo,
          starting_capital: capital,
          status: 'approved',
          approved_rules: approvedRules as unknown as Record<string, unknown>,
          extracted_rules: approvedRules as unknown as Record<string, unknown>,
          execution_config: executionConfig as unknown as Record<string, unknown> ?? null,
        })
        .select()
        .single()

      if (insertError || !run) {
        console.error('[api/backtest] manual insert failed:', insertError)
        return NextResponse.json({ error: 'Failed to create backtest run' }, { status: 500 })
      }

      return NextResponse.json({ backtestId: run.id }, { status: 202 })
    }

    // Doc-upload mode (default)
    if (!strategyDocUrl) {
      return NextResponse.json(
        { error: 'Missing required field: strategyDocUrl' },
        { status: 400 },
      )
    }

    // Insert a pending backtest run with status 'extracting'
    const { data: run, error: insertError } = await serviceClient
      .from('backtest_runs')
      .insert({
        user_id: userId,
        strategy_name: strategyName || 'Untitled Strategy',
        strategy_doc_url: strategyDocUrl,
        market,
        pair,
        timeframe,
        date_from: dateFrom,
        date_to: dateTo,
        starting_capital: capital,
        status: 'extracting',
      })
      .select()
      .single()

    if (insertError || !run) {
      console.error('[api/backtest] insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to create backtest run' }, { status: 500 })
    }

    // Process extraction in background
    processExtraction(run.id, {
      userId,
      strategyDocUrl,
      strategyName: strategyName || 'Untitled Strategy',
      market,
      pair,
      timeframe,
      dateFrom,
      dateTo,
      startingCapital: capital,
    }).catch((err) => {
      console.error('[api/backtest] background extraction failed:', err)
    })

    // Return the run ID immediately — client will redirect to review page
    return NextResponse.json({ backtestId: run.id }, { status: 202 })
  } catch (error) {
    console.error('[api/backtest]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}

async function processExtraction(
  runId: string,
  params: {
    userId: string
    strategyDocUrl: string
    strategyName: string
    market: 'forex' | 'crypto'
    pair: string
    timeframe: string
    dateFrom: string
    dateTo: string
    startingCapital: number
  },
) {
  const supabase = createServiceClient()

  const markError = async (msg: string) => {
    await supabase
      .from('backtest_runs')
      .update({ status: 'error', ai_report: msg })
      .eq('id', runId)
  }

  try {
    // 1. Fetch strategy doc text from Supabase Storage
    const docPath = params.strategyDocUrl.replace(/^strategy-docs\//, '')
    if (!docPath.startsWith(params.userId + '/')) {
      await markError('Access denied: strategy document does not belong to this user.')
      return
    }

    const { data: docData, error: docError } = await supabase.storage
      .from('strategy-docs')
      .download(docPath)

    if (docError || !docData) {
      await markError('Failed to download strategy document from storage.')
      return
    }

    // Extract text: PDFs need proper parsing, .txt files can use .text() directly
    const isPdf = docPath.toLowerCase().endsWith('.pdf')
    let docText: string

    if (isPdf) {
      try {
        const arrayBuffer = await docData.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const pdfParser = new PDFParse({ data: buffer })
        const pdfData = await pdfParser.getText()
        docText = pdfData.text
        await pdfParser.destroy()

        if (!docText || docText.trim().length < 10) {
          await markError('Failed to extract text from PDF. The document may be scanned or contain no readable text.')
          return
        }
      } catch (pdfError) {
        console.error('[api/backtest] PDF extraction failed:', pdfError)
        await markError('Failed to parse PDF document. Please upload a .txt file instead.')
        return
      }
    } else {
      docText = await docData.text()
    }

    // 2. Extract strategy rules via NIM → StrategyRuleSet
    const extractedRules = await extractStrategyRules(docText)

    // 3. Store extracted rules and mark as 'extracted'
    const { error: updateError } = await supabase
      .from('backtest_runs')
      .update({
        status: 'extracted',
        extracted_rules: extractedRules as unknown as Record<string, unknown>,
      })
      .eq('id', runId)
      .eq('user_id', params.userId)

    if (updateError) {
      console.error('[api/backtest] extraction update failed:', updateError)
      await markError('Failed to save extracted rules.')
    }
  } catch (error) {
    console.error('[api/backtest] processExtraction error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error during rule extraction'
    await markError(msg)
  }
}
