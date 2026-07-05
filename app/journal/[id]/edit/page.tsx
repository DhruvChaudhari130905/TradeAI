import { getTrade } from '@/lib/actions/trades'
import { notFound } from 'next/navigation'
import { EditTradeClient } from './EditTradeClient'

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const result = await getTrade(id)

  if (!result.success) {
    notFound()
  }

  return <EditTradeClient trade={result.data} />
}
