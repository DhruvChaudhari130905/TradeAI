'use server'

import { createClient } from '@/lib/supabase/server'
import { tradeSubmitSchema, type TradeFormData } from '@/lib/types/trade'
import type { TradeImageExtraction } from '@/lib/nim/trade-extract-types'
import { revalidatePath } from 'next/cache'

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export async function createTrade(
  formData: TradeFormData,
): Promise<ActionResult<{ id: string }>> {
  const validated = tradeSubmitSchema.safeParse(formData)
  if (!validated.success) {
    const firstError = validated.error.issues[0]
    return { success: false, error: firstError?.message || 'Invalid input' }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await supabase
      .from('trades')
      .insert({
        user_id: user.id,
        ...validated.data,
        screenshot_urls: validated.data.screenshot_urls ?? [],
      })
      .select('id')
      .single()

    if (error) {
      console.error('[createTrade]', error)
      return { success: false, error: 'Failed to create trade. Please try again.' }
    }

    revalidatePath('/journal')
    revalidatePath('/dashboard')
    return { success: true, data: { id: data.id } }
  } catch (error) {
    console.error('[createTrade]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function updateTrade(
  id: string,
  formData: TradeFormData,
): Promise<ActionResult<{ id: string }>> {
  const validated = tradeSubmitSchema.safeParse(formData)
  if (!validated.success) {
    const firstError = validated.error.issues[0]
    return { success: false, error: firstError?.message || 'Invalid input' }
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await supabase
      .from('trades')
      .update(validated.data)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
      .single()

    if (error) {
      console.error('[updateTrade]', error)
      return { success: false, error: 'Failed to update trade. Please try again.' }
    }

    if (!data) {
      return { success: false, error: 'Trade not found.' }
    }

    revalidatePath('/journal')
    revalidatePath(`/journal/${id}`)
    revalidatePath('/dashboard')
    return { success: true, data: { id: data.id } }
  } catch (error) {
    console.error('[updateTrade]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function deleteTrade(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Fetch trade first to get screenshot URLs for cleanup
    const { data: trade } = await supabase
      .from('trades')
      .select('screenshot_urls')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    // Delete screenshots from storage
    if (trade?.screenshot_urls?.length) {
      const paths = trade.screenshot_urls
        .map((url: string) => {
          const parts = url.split('/storage/v1/object/public/trade-screenshots/')
          return parts[1] || null
        })
        .filter(Boolean)

      if (paths.length > 0) {
        await supabase.storage.from('trade-screenshots').remove(paths)
      }
    }

    const { error } = await supabase
      .from('trades')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('[deleteTrade]', error)
      return { success: false, error: 'Failed to delete trade. Please try again.' }
    }

    revalidatePath('/journal')
    revalidatePath('/dashboard')
    return { success: true, data: { id } }
  } catch (error) {
    console.error('[deleteTrade]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function uploadScreenshot(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const file = formData.get('file') as File | null
    if (!file) {
      return { success: false, error: 'No file provided' }
    }

    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only image files are allowed' }
    }

    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File size must be under 5MB' }
    }

    const ext = file.name.split('.').pop() || 'png'
    const timestamp = Date.now()
    const path = `${user.id}/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('trade-screenshots')
      .upload(path, file, { contentType: file.type })

    if (uploadError) {
      console.error('[uploadScreenshot]', uploadError)
      return { success: false, error: 'Failed to upload screenshot. Please try again.' }
    }

    const { data: urlData } = supabase.storage
      .from('trade-screenshots')
      .getPublicUrl(path)

    return { success: true, data: { url: urlData.publicUrl } }
  } catch (error) {
    console.error('[uploadScreenshot]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function getTrades(filters?: {
  market?: string
  outcome?: string
  direction?: string
  pair?: string
  dateFrom?: string
  dateTo?: string
  source?: string
}) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Not authenticated' }
    }

    let query = supabase
      .from('trades')
      .select('*, trade_reviews(composite_score)')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    // Column has NOT NULL DEFAULT 'live' so a plain equality filter covers both
    if (filters?.source === 'backtest' || filters?.source === 'live') {
      query = query.eq('source', filters.source)
    }
    if (filters?.market) query = query.eq('market', filters.market)
    if (filters?.outcome) query = query.eq('outcome', filters.outcome)
    if (filters?.direction) query = query.eq('direction', filters.direction)
    if (filters?.pair) query = query.ilike('pair', `%${filters.pair}%`)
    if (filters?.dateFrom) query = query.gte('entry_time', filters.dateFrom)
    if (filters?.dateTo) query = query.lte('entry_time', filters.dateTo)

    const { data, error } = await query

    if (error) {
      console.error('[getTrades]', error)
      return { success: false as const, error: 'Failed to fetch trades.' }
    }

    return { success: true as const, data }
  } catch (error) {
    console.error('[getTrades]', error)
    return { success: false as const, error: 'Something went wrong.' }
  }
}

export async function getTrade(id: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false as const, error: 'Not authenticated' }
    }

    const { data, error } = await supabase
      .from('trades')
      .select('*, trade_reviews(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      console.error('[getTrade]', error)
      return { success: false as const, error: 'Trade not found.' }
    }

    return { success: true as const, data }
  } catch (error) {
    console.error('[getTrade]', error)
    return { success: false as const, error: 'Something went wrong.' }
  }
}

export async function extractTradeFromScreenshot(
  screenshotUrl: string,
): Promise<ActionResult<TradeImageExtraction>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { extractTradeFromImageUrl } = await import('@/lib/nim/extract-trade-from-image')
    const extraction = await extractTradeFromImageUrl(screenshotUrl)
    return { success: true, data: extraction }
  } catch (error) {
    console.error('[extractTradeFromScreenshot]', error)
    const message = error instanceof Error ? error.message : 'Something went wrong.'
    return { success: false, error: message }
  }
}

