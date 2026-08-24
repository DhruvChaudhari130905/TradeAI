---
target: replay/backtest trading surface
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-08-24T07-07-05Z
slug: app-backtest-page-tsx
---
# Critique: Replay/Backtest Trading Surface

Method: dual-agent (A: aceb3a03ef10ac665 · B: a69349436b2f222af)
Target: app/backtest/page.tsx + components/replay/
Date: 2026-08-24

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Autosave invisible; failure surfaces only as vague warning after End Session |
| 2 | Match System / Real World | 3 | Authentic trading vocabulary; reverse/resim rewind unusual but labeled |
| 3 | User Control and Freedom | 3 | Rewind + eraser exist; position close instant/irreversible; Escape hotkey declared but never wired |
| 4 | Consistency and Standards | 3 | Green/red semantics never violated; 3 segmented-control idioms; amber/sky accent drift |
| 5 | Error Prevention | 2 | Great form validation undermined by single-keypress B/S orders and C close-all, no confirm |
| 6 | Recognition Rather Than Recall | 2 | Hotkeys (Space, arrows, B, S, C) appear nowhere in UI, title-hover only |
| 7 | Flexibility and Efficiency | 3 | Hotkeys, speed presets, multi-TF, chart-drag SL/TP — fast once found |
| 8 | Aesthetic and Minimalist Design | 3 | Dense terminal aesthetic holds; DrawToolbar 21-button rail at the limit |
| 9 | Error Recovery | 2 | Errors toast, but autosave failure is console.warn only — user trades an hour unaware nothing persists |
| 10 | Help and Documentation | 1 | Zero help: no hotkey legend, no first-session guidance, resim model unexplained |
| **Total** | | **25/40** | Acceptable |

## Anti-Patterns Verdict

LLM assessment: Reads authored by a daily TradingView user. SL/TP drag overlay with live pip/$-risk readout, R:R labels, strict green/red token discipline = fluent product register. Register breaks at: native window.confirm/prompt chrome (ReplayWorkspace.tsx:176,319; DrawingOverlay.tsx:517), unexplained decorative glyphs ◌/⤺ (TradingPanel.tsx:114/119, SlTpOverlay.tsx:126), three different segmented-control implementations. No gradients, glassmorphism, side-stripes, hero metrics, or card grids anywhere.

Deterministic scan: exit 0, ZERO findings across app/backtest/page.tsx and components/replay/. Detector and LLM agree — no slop families present.

Browser visualization: skipped — no browser automation tool exposed this session. No user-visible overlay available; static code review only.

## Overall Impression

Strong interaction craft buried under missing safety rails and invisible power features. Biggest opportunity: make the keyboard layer visible and armed-by-default-off — one fix addresses error prevention, recognition, and help simultaneously.

## What's Working

1. SlTpOverlay craft — edge-clamped pinning, grip-dot knobs, drag preview weight change, dashed-vs-solid draft/live distinction, capture-phase listeners preserving pan. TradingView-tier.
2. Order form error prevention — direction-aware SL/TP sanity checks, risk-% refuses without SL, ATR backfill with explicit toast (ReplayWorkspace.tsx:101).
3. Token discipline — every hex maps to globals.css palette; font-mono everywhere numbers appear incl. canvas labels; green/red never repurposed.

## Priority Issues

1. **[P1] Unarmed destructive hotkeys, zero visibility** — B/S fire market orders, C closes ALL positions, no confirm, no legend, C's label contradicts behavior (use-replay-hotkeys.ts, ReplayWorkspace.tsx:157-166). Practice tool where accidental orders corrupt training data. Fix: persistent hotkey strip or ? overlay; arm/disarm toggle persisted; C matches a visible Close All affordance. (/impeccable harden)
2. **[P1] Pointer-only SL/TP drag, weak SR story** — canvas pixels, no keyboard nudge, no aria-live on notice ticker (ReplayControls.tsx:125-131), icon-only X buttons rely on title alone (PositionsPanel.tsx:64,125), color-only equity health and trail state. Fix: role="status" ticker, aria-labels, arrow-key nudge of selected level, aria-pressed on toggles. (/impeccable audit)
3. **[P2] Native browser chrome at emotional peaks** — window.confirm End Session/Clear All, window.prompt Text tool (ReplayWorkspace.tsx:176,319; DrawingOverlay.tsx:517). Fix: shadcn AlertDialog; floating editor for Text annotation. (/impeccable polish)
4. **[P2] Touch targets far below 44px** — PositionRow actions h-6 (24px), toolbar h-7 (28px), speed ~22px. CLAUDE.md declares mobile first-class; mobile sheet PositionsPanel unusable by thumb. Fix: ≥44px targets in sheet context, larger HIT_RADIUS for touch pointers. (/impeccable adapt)
5. **[P2] DrawToolbar IA** — 21 flat undifferentiated tools in one column (DrawToolbar.tsx:39-57), overflows short viewports. Fix: 3-4 flyouts (Position plans / Lines & zones / Measurement / Annotations) cutting visible choices from 21 to ~5. (/impeccable distill)

Cognitive load: 3 checklist failures (>4-option decision points: toolbar 21, position row 5, speed selector 5) — moderate load. Emotional journey: trade-placement peak well defended; betrayed by hotkey path (fill before reassurance); autosave anxiety ambient; end-session low point mishandled ("may not have saved" AFTER irreversible action).

## Persona Red Flags

Alex (power user): hotkeys invisible — mouses everything for a week; dead Escape wiring; whole keyboard live whenever focus leaves inputs; duplicate close-all logic already drifted (hotkey path silently skips empty-list toast).

Sam (accessibility): hover-dependent icon names; visual-only notice ticker (no aria-live); color-only equity/trail state; canvas layers opaque to SR except manual ModifyDialog. Positive: ToolButton/IndicatorMenu carry aria-label; visible focus rings.

## Minor Observations

- ◌/⤺ glyphs unexplained; placeholder text already does that job
- formatPrice DrawingOverlay.tsx:771 hardcodes .toFixed(5), ignores JPY 3-digit rule — fib labels wrong precision on JPY pairs
- Notice ticker renders only latest of up to 4 stored notices
- No way to abandon/delete stale active session from Past Sessions list
- Fresh session lands paused with zero guidance about replay-clock model
- Amber/sky are undeclared third/fourth accents, absent from tokens
- SPREAD_PRESETS duplicates server defaults in app/backtest/page.tsx — drift risk
- Loading spinner has no text during potentially long Twelve Data fetches despite progressive TF loading architecture

## Questions to Consider

1. Should any single keypress move capital — even simulated — in a tool whose purpose is building discipline? If power users want it, why is arm-switch not the persisted default?
2. When rewind passes a closed trade, resim skips journal recording (use-replay-session.ts:213). From the trader's seat, what do they believe happened to that trade — and is that belief ever corrected?
3. AI Coach sits adjacent to order ticket at highest suggestibility. Coaching feature, or crutch the experience should friction-ize?
