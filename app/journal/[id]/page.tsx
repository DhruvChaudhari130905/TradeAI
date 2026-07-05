import { getTrade, deleteTrade } from '@/lib/actions/trades'
import { notFound } from 'next/navigation'
import { TradeDetailClient } from './TradeDetailClient'

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const result = await getTrade(id)

  if (!result.success) {
    notFound()
  }

  return <TradeDetailClient trade={result.data} />
}
