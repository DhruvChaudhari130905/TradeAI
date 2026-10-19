import { Landmark, Brain, Building2, Sigma, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { PersonalityKey } from '@/lib/types/review'

const ICONS: Record<PersonalityKey, LucideIcon> = {
  prop_firm_evaluator: Landmark,
  trading_psychologist: Brain,
  institutional_trader: Building2,
  quantitative_analyst: Sigma,
  risk_manager: ShieldAlert,
}

export function PersonalityIcon({ personality, className }: { personality: PersonalityKey; className?: string }) {
  const Icon = ICONS[personality]
  return <Icon className={className} aria-hidden />
}
