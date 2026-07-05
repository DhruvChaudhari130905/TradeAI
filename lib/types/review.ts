export interface PersonalityReview {
  entry_quality: number
  risk_management: number
  trade_psychology: number
  execution: number
  strategy_adherence: number
  overall: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  verdict: string
  strengths: string[]
  improvements: string[]
  key_mistake?: string
}

export interface TradeReview {
  trade_id: string
  prop_firm_evaluator: PersonalityReview | null
  trading_psychologist: PersonalityReview | null
  institutional_trader: PersonalityReview | null
  quantitative_analyst: PersonalityReview | null
  risk_manager: PersonalityReview | null
  composite_score: number | null
}

export const PERSONALITY_KEYS = [
  'prop_firm_evaluator',
  'trading_psychologist',
  'institutional_trader',
  'quantitative_analyst',
  'risk_manager',
] as const

export type PersonalityKey = (typeof PERSONALITY_KEYS)[number]

export const PERSONALITY_META: Record<PersonalityKey, { label: string; icon: string; color: string }> = {
  prop_firm_evaluator: {
    label: 'Prop Firm Evaluator',
    icon: '🏛️',
    color: '#8B5CF6',
  },
  trading_psychologist: {
    label: 'Trading Psychologist',
    icon: '🧠',
    color: '#3B82F6',
  },
  institutional_trader: {
    label: 'Institutional Trader',
    icon: '🏦',
    color: '#F59E0B',
  },
  quantitative_analyst: {
    label: 'Quantitative Analyst',
    icon: '📊',
    color: '#06B6D4',
  },
  risk_manager: {
    label: 'Risk Manager',
    icon: '🛡️',
    color: '#EF4444',
  },
}

export const DIMENSION_LABELS: Record<keyof Omit<PersonalityReview, 'overall' | 'grade' | 'verdict' | 'strengths' | 'improvements' | 'key_mistake'>, string> = {
  entry_quality: 'Entry Quality',
  risk_management: 'Risk Management',
  trade_psychology: 'Psychology',
  execution: 'Execution',
  strategy_adherence: 'Strategy Adherence',
}
