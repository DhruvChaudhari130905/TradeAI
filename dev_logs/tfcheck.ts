import dotenv from 'dotenv'; import path from 'path'; dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'
import { fetchOHLCV } from '../lib/data/index'
import { isInSession } from '../lib/backtest/rule-engine'
import type { StrategyRuleSet } from '../lib/types/backtest'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main(){
  const { data: run } = await sb.from('backtest_runs').select('*').eq('id','9edba2b0-44ff-4f67-8a28-8a7ba3cf1ae0').single()
  const rules = (run?.approved_rules ?? null) as StrategyRuleSet | null
  console.log('rules.timeframe =', JSON.stringify(rules?.timeframe), '| run.timeframe =', JSON.stringify(run.timeframe))
  console.log('session_filter =', JSON.stringify(rules?.session_filter))
  const c = await fetchOHLCV({ pair: run.pair, market: run.market, timeframe: run.timeframe, dateFrom: run.date_from??'', dateTo: run.date_to??'' })
  console.log('candles:', c.length, '| first 3 times:', c.slice(0,3).map(x=>x.time))
  const sess = rules?.session_filter?.sessions ?? []
  let inS = 0; for (let i=0;i<c.length;i++) if (isInSession(c[i], sess, rules?.timeframe ?? '15m')) inS++
  console.log('inSession (rules.timeframe):', inS, '/', c.length)
  let inS2 = 0; for (let i=0;i<c.length;i++) if (isInSession(c[i], sess, '1D')) inS2++
  console.log('inSession (run.timeframe="1D"):', inS2, '/', c.length)
  const hours: Record<number,number> = {}
  for (const k of c) { const h = new Date(k.time).getUTCHours(); hours[h] = (hours[h]??0)+1 }
  console.log('candle UTC hour distribution:', hours)
}
main().catch(console.error)
