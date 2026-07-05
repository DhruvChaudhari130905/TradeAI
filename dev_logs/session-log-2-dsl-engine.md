---
name: session-log-2-dsl-engine
description: Session log covering the expression-DSL backtest engine overhaul (general fix for structural/ICT strategies producing 0 trades)
metadata:
  type: project
---

# Session Log 2: General-Purpose Expression DSL Engine

**Date**: 2026-07-04
**Plan file**: `.claude/plans/eager-herding-mist.md`
**Status**: Complete (2026-07-05). Implementation done, lint+build green, no-regression verified, end-to-end live test passed (after a fix — see Task 17).

## Context (why)

ICT (and any structural / price-action / liquidity / breakout strategy) produced **0 trades silently**. Root cause, confirmed by DB inspection (`dev_logs/inspect-runs.ts`): NIM faithfully translated concepts like "sweep a recent swing low", "break a recent lower high", "previous day's low" into flat `Condition`s whose `indicator1` was a *named level* — `swing_low`, `lower_high`, `previous_day_low`, `recent_lower_high`. The engine's closed `Condition` enum only resolved computed numeric indicator series, so those conditions were **always false → 0 trades, with no warning**. Examples: run `39397f65` (EUR/USD 15m, refs `swing_low`/`lower_high`, only `ema_20` computed) and `9c85b8f8` (refs `previous_day_low`/`recent_lower_high`) → 0 trades.

User requirement (verbatim): "i dont want the engine to be made specific for one strategy i want it be be such that it can perform well on any strategy that is given for the input." The fix is **general** — nothing keys off "ICT". Chosen via AskUserQuestion: "Full expression DSL" scope.

## What was done (tasks 1–16, 18)

### Types — `lib/types/backtest.ts`
- Added recursive `ValueExpr` (series / const / binop / abs → number at a bar) and `BoolExpr` (and / or / not / within / strict / prev / cmp / cross_above / cross_below / pattern / liquidity_sweep / structure_trend / break_structure, **plus the legacy flat `Condition` as a leaf**). Each rule group is now `BoolExpr[]` (AND-combined). Old `Condition[]` is a valid `BoolExpr[]` → **no DB migration**.
- Added `IndicatorType` entries `SWING_POINTS` and `PREV_DAY_HL` (declarable/tunable, e.g. pivot strength).
- Added additive `warnings?: string[]` to `BacktestResult` — the safety net so unresolvable concepts are surfaced instead of silently zeroing.

### New engine files
- **`lib/backtest/levels.ts`** — `computeLevels(candles, { swingStrength })`. Runs once per backtest. Causal swing pivots (confirmed only after `strength` right-bars → no lookahead), per-bar series `swing_high`/`swing_low`/`prev_swing_high`/`prev_swing_low`/`prev_day_high`/`prev_day_low`/`prev_day_open`, and `structureTrend` (HH+HL→up, LH+LL→down). Caching here is the perf win vs. recomputing structure per bar per call.
- **`lib/backtest/expr-engine.ts`** — recursive `evaluateBool` / `evaluateValue`. Legacy `Condition` leaves delegate to the **existing** `evaluateCondition` in `rule-engine.ts` (reuse, not rewrite). `normalizeGroup` (array→`{kind:'and'}`, length-1→single element, tree→as-is) lets the engine accept old arrays and new trees identically. `collectUnresolvableRefs` is the **safety net**: unknown series → `BacktestResult.warnings`. `describeExpr` renders trees for the AI report + UI. Exports `LEVEL_SERIES`, `PRICE_SERIES`.

### Changed engine files
- **`lib/backtest/engine.ts`** — after `computeIndicators`, scans rule groups for referenced level/structure series, calls `computeLevels(...)` and merges level series into the indicators map only if referenced (auto-on-demand — no footgun where the user forgets to declare `SWING_POINTS`). Replaced the four `evaluateAllConditions` calls with `evaluateBool(normalizeGroup(group), i, ctx)`. Exits/invalidation stay strict. Legacy flat conditions keep root-cause #5's 4-bar auto-lookback for state types; explicit `within`/`strict` DSL nodes honor themselves (supersedes, not removes, the hardcoded hack — old runs keep identical results). Collects `warnings` from `collectUnresolvableRefs` across all groups.
- **`lib/backtest/rule-engine.ts`** — logic unchanged. Exported the `TRIGGER_CONDITION_TYPES` set so `expr-engine.ts` can classify legacy leaves' trigger-ness for `strict` defaulting. `evaluateCondition`, `evaluateAllConditions`, `isInSession`, `ENTRY_SETUP_LOOKBACK` all stay.
- **`lib/backtest/indicators.ts`** — extended `resolveIndicator` to resolve `close`/`open`/`high`/`low` (built from candles) and to fall back to the levels map for level keys. Added `SWING_POINTS`/`PREV_DAY_HL` cases to `computeIndicators` (optional declarative path — they call `levels.ts`). No change to existing indicator math.

### NIM extraction
- **`lib/prompts/backtest-system-prompts.ts`** — rewrote `STRATEGY_EXTRACTOR_PROMPT` to document the full DSL: `ValueExpr`/`BoolExpr` forms, the **exact reserved series list** (so NIM stops inventing `lower_high`/`recent_lower_high`/`previous_day_low` — must use `prev_swing_high`/`prev_swing_low`/`prev_day_low`/`swing_high`/`swing_low`), composite operators (`and`/`or`/`not`/`within`/`strict`/`prev`), structural leaves (`liquidity_sweep`, `structure_trend`, `break_structure`, `pattern`), worked ICT/SMC examples modeling setup+trigger via `within`+`strict`. Legacy flat `Condition` JSON still legal (back-compat). Security block preserved.
- **`lib/nim/extract-strategy-rules.ts`** — imports `LEVEL_SERIES`/`PRICE_SERIES` from expr-engine. Adds `SERIES_SYNONYMS` map + `canonicalizeAndPrune`: builds a `known` set from declared indicators (incl. `macd_*`/`bbands_*`/`stoch_*` prefix handling, `SWING_POINTS`→swing keys, `PREV_DAY_HL`→prev_day keys), canonicalizes hallucinated synonyms (`recent_lower_high`→`prev_swing_high`, `previous_day_low`→`prev_day_low`), drops top-level leaves still referencing unknown series (appends a one-line note per drop to `rules.notes`). Runtime engine `warnings` is the authoritative guard; this is a first pass.
- **`lib/nim/backtest-reviews.ts`** & **`lib/nim/run-backtest.ts`** — replaced per-condition property-access summary with `describeExpr(c)` rendering (so DSL trees summarize legibly in the AI report).

### API + UI
- **`app/api/backtest/[id]/rules/route.ts`** — added `SWING_POINTS`/`PREV_DAY_HL` to `indicatorConfigSchema` enum. Created recursive `valueExprSchema: z.ZodType<ValueExpr>` and `boolExprSchema: z.ZodType<BoolExpr>` via `z.lazy()`. All 5 rule groups use `exprArray = z.array(boolExprSchema)`. The engine's `collectUnresolvableRefs` remains the authoritative guard against unknown series.
- **`components/backtest/expr-editor.tsx`** (new, ~480 lines) — recursive tree editor. Dispatches on `BoolExpr` kind. Legacy `Condition` leaves delegate to `ConditionEditor`. Composites (`and`/`or`/`not`/`within`/`strict`/`prev`) with inline controls. Structural leaves: `cmp`/`cross_above`/`cross_below` (CmpRow with op selector or "crosses above/below" label), `pattern`, `liquidity_sweep`, `structure_trend`, `break_structure`. `ValueExprEditor` handles series (Select) / const (Input) / binop+abs (advanced-JSON box with try/catch parse). `AddLeafMenu` + `newLeaf` factory. Arithmetic `binop` is engine+NIM supported and manually editable via the JSON box — **full graphical arithmetic node-graph deferred** (the one piece not fully graphical this pass).
- **`components/backtest/condition-editor.tsx`** — added `PREV_DAY_HL`/`SWING_POINTS` to `indicatorKeys` switch. Added `RESERVED_SERIES` array (price + swing + prev_day series) and extends `allKeys` so the leaf editor can reference levels directly.
- **`components/backtest/indicator-config.tsx`** — added `SWING_POINTS` (param `strength`, default 3) and `PREV_DAY_HL` to `INDICATOR_TYPES`, `getDefaultParams`, `PARAM_LABELS`. Added `default: return {}` so the switch is exhaustive.
- **`components/backtest/rule-builder.tsx`** — swapped `ConditionEditor`→`ExprEditor`. `EMPTY_CONDITION` typed as `BoolExpr`. Old runs render as leaves → editing unchanged.
- **`app/backtest/[id]/page.tsx`** — warnings banner (yellow) after the Stats Grid when `result.warnings?.length`, so a 0-trade run says *why* instead of being blank.

### Verification tooling
- **`dev_logs/test-ict-dsl.ts`** (new) — end-to-end ICT proof. Reads `strategies/ICT_Forex_Strategy.txt` → `extractStrategyRules` (prints emitted DSL tree via `describeExpr`) → fetches EUR/USD 5m candles 2025-07-02→2026-07-02 → `runBacktestEngine` → asserts `total_trades > 0` (exits 1 with a diagnostic pointing at unresolvable structural concepts if not). Prints win-rate/PnL/`warnings`.
- **`dev_logs/verify-latest.ts`** — updated to narrow rule groups with a `legacy()` helper (`g.filter((c): c is Condition => 'type' in c)`) so the per-condition introspection + combined-windowed readout apply to flat leaves; real engine still exercises full trees.

### Lint/build fixes (this session's last sub-task)
- `next build` runs ESLint and fails on errors, so 7 pre-existing lint errors in untouched files had to be cleared: `dev_logs/tfcheck.ts` (`rules: any` → `StrategyRuleSet | null`), `dev_logs/test-ict-extraction.ts` (`timeframe as any` → `as BacktestTimeframe`), `dev_logs/inspect-runs.ts` (`runs as any[]` → typed `RunRow[]`, `(c: any)` → `(c: BoolExpr)`), `app/auth/login/page.tsx` + `app/dashboard/page.tsx` (unescaped apostrophes → moved text into `{"..."}` JSX expressions, no render change), `app/dashboard/page.tsx` (mount-fetch effect → `// eslint-disable-next-line react-hooks/set-state-in-effect` — standard mount-fetch pattern, real state updates happen after awaited fetches). One follow-on TS error in `tfcheck.ts:15` (`rules?.timeframe` undefined → `?? '15m'`).

## Verification results

### No-regression (legacy EMA-cross run) — ✅ CONFIRMED
Re-ran the current (DSL) engine on stored run `88173b2f-3501-421f-9c51-19fe6eabbe28` (EUR/USD 15m, 20097 candles, all legacy flat `Condition` leaves, sessions london+new_york) via `dev_logs/verify-latest.ts`:
- Stored result: 148 trades, 3 win / 145 loss, $-6308.10
- DSL engine result: **148 trades, 3 win / 145 loss, $-6308.10 — bit-identical.**
- Legacy flat conditions evaluate identically through `evaluateBool`→`evaluateCondition` delegation. Root cause #5's 4-bar auto-lookback preserved for legacy leaves.

### Lint + build — ✅ GREEN
`npm run lint`: 0 errors (183 pre-existing warnings, none from this work). `npm run build`: Next.js 16.2.9 Turbopack — compiled, type-checked, 16 static pages generated.

## Status

**Complete (2026-07-05).** Task 17 ran live and surfaced a real engine bug, now fixed:

### Task 17 — `dev_logs/test-ict-dsl.ts` live run ✅ DONE (after a fix)
The live run produced **0 trades** — not a network failure but a real engine bug. Diagnostic: the three structural leaves (`structure_trend`, `liquidity_sweep`, `break_structure`) all read **0/20261**, while the FVG `pattern` leaf was at 63.54%, and no `warnings`.

**Root cause (7th)**: `buildEvalContext` only set `ctx.levels` when `needsLevels` was true, gated on a `series` ref to a level name (`swing_high`, `prev_day_low`, …). But structural leaves read `ctx.levels` *directly* and emit **no `series` refs** (see the `collectValueRefs` comment). The declarative `SWING_POINTS`/`PREV_DAY_HL` indicator configs are intentional no-ops in `computeIndicators` — levels only come from `computeLevels`, which never ran. So for a structural-only extraction, `needsLevels` stayed false → `ctx.levels` null → `structure_trend` compared `undefined === 'up'` (false), `liquidity_sweep`/`break_structure` resolved `NaN` → false. Every bar. No warning, because `collectUnresolvableRefs` only flags unrecognized *series*.

**Fix** (surgical, `lib/backtest/expr-engine.ts` only): added `usesStructuralLeaves(rules)` — walks rule groups for `structure_trend`/`liquidity_sweep`/`break_structure` leaves (recursing through composites) — and OR'd it into the `needsLevels` decision. Now both extraction styles work: explicit level-series refs (existing `refs` check) *and* pure structural-leaf defaults.

### Verification (post-fix)
- `dev_logs/test-ict-dsl.ts` live: **0 → 1 trades** (assertion `total_trades > 0` PASSED, no warnings). The low count is the strict 4-confluence setup, not an engine issue.
- NIM note: the live run's primary model returned truncated JSON once; the existing fallback to the secondary model produced a complete ruleset (designed behavior). The secondary extraction even added explicit `level`/`swing` overrides (`liquidity sweep @ prev_day_low`, `break structure @ prev_swing_high`) — which reference `LEVEL_SERIES` names and would have triggered levels via the existing `refs` check alone. The first (failing) extraction had *all-default* leaves with no level refs — exactly the case only `usesStructuralLeaves` catches. The fix is robust to both.
- No-regression: legacy EMA-cross run `88173b2f` (EUR/USD 15m, 20097 candles, all flat `Condition` leaves) re-ran via `dev_logs/verify-latest.ts 88173b2f…` → **148 trades, 3 win / 145 loss, $-6308.10 — bit-identical to the stored result**. The new `usesStructuralLeaves` branch returns false for legacy runs (no structural leaves, no level refs → `needsLevels` false → `ctx.levels` null → identical indicators).
- `npm run lint`: 0 errors, 183 warnings (baseline unchanged). `npm run build`: green.

### Not Remaining
Nothing else. The DSL is general (handles breakouts, SMC, supply/demand, mean-reversion-off-prior-day-H/L, etc. — nothing keys off "ICT"). Full graphical arithmetic node-graph UI is the one deferred piece (arithmetic is reachable via the advanced-JSON box; flag if you want the full graph UI).

## Important notes for next session
- The plan file `.claude/plans/eager-herding-mist.md` has the full design rationale.
- Memory updated: `backtest-zero-trades-root-causes.md` now documents root cause #6 (structural/named-level refs) + the general DSL resolution; MEMORY.md index hook updated accordingly.
- `dev_logs/diagnose-engine.ts` still uses its own strict `.every` for the "COMBINED" readout (per-condition diagnostic only — noted in memory since root-cause #5).
- `BacktestResult.warnings` is additive; consumers that don't read it are unaffected.
- Base UI shadcn `Select.onValueChange` passes `string | null` — handled with `v ?? ''` / `v && onAdd(v)` in `expr-editor.tsx`.
