# Nebula Insights — 10 Template Variants

Same data, ten distinct visual systems. Each template is a full reimagining
(layout + components + icons + typography + spacing + chart treatment), not just
a CSS recolor. URL-routed via `?t=1..10`. Light mode only.

| #   | Name         | Vibe                           | Core idea                                      |
| --- | ------------ | ------------------------------ | ---------------------------------------------- |
| 1   | Soft-Pop     | Neo-brutalist cream + bold ink | Hand-drawn, playful, hackathon-bold (existing) |
| 2   | Studio       | Slate professional (Geist)     | Faithful port of `./dashboard/` aesthetic      |
| 3   | Vercel       | Black & white minimal          | Geist mono + ultra-tight type, hairline rules  |
| 4   | Cloudflare   | Orange operations              | Status pills, dense tables, ops console        |
| 5   | Memphis      | Maximalist chaos               | Polka dots, terrazzo, off-axis rotations       |
| 6   | Studio Söhne | OpenAI calm                    | Generous whitespace, oversized numbers         |
| 7   | Linear       | Precise structure              | IBM Plex, command-K look, micro-shadows        |
| 8   | Editorial    | Newspaper                      | Serif headlines, multi-column, drop caps       |
| 9   | Glass        | Apple-inspired                 | Gradient mesh, frosted blur, 24px radius       |
| 10  | Bauhaus      | Geometric primary              | Red/yellow/blue, Futura, sharp shapes          |

---

## Template 1 — Soft-Pop (existing)

**Status**: shipped. Cream `#FFFBF2`, ink `#111`, 3px borders, 6×6 hard offset
shadows. Space Grotesk display, JetBrains Mono. Pulse tiles in mint/butter/
sky/rose. Tilted hover lifts. Unchanged in this round.

---

## Template 2 — Studio

**Inspiration**: the `./dashboard/` prototype committed early in the repo.

**Fonts**:

- Display: **Geist** (300/400/500/600/700) via Google Fonts
- Mono: **Geist Mono**
- 14px body, `letter-spacing: -0.005em`, `font-feature-settings: "ss01", "cv11"`

**Palette** (lifted directly from `dashboard/src/index.css`):

- bg `#F6F7F9`, surface `#FFFFFF`, surface-2 `#F1F4F8`
- rule `#E4E7ED`, rule-strong `#CBD0D8`
- ink `#0F172A`, ink-2 `#475569`, ink-3 `#94A3B8`
- cool `#2563EB`, warm `#C2410C`, positive `#15803D`, warn `#B45309`

**Layout**:

- 232px sticky sidebar (left), grid `232px / 1fr`
- Sidebar: brand mark + "CAPABILITY INTEL" eyebrow, two grouped sections, 10px
  uppercase tracked headers (`letter-spacing: 0.2em`)
- Main content: `padding 28px 36px`, max-width 1320px

**Component shape**:

- **PulseStrip → 4 hero stats with eyebrow + tabular value + delta chip** Single
  row, hairline divider rules between tiles, no per-tile background.
- **MoneyFlow** keeps sankey but with cool `#2563EB` productive / warm `#C2410C`
  wasted, link opacity 0.18/0.32
- **PeopleTable** with avatar circle + display name + small mono team line.
  Sortable headers in 10.5px uppercase tracked. Persona dot left of name.
- **GapMap** axis dashes, severity gradient cool→warm, ranked top-4 labels.
- **SpendWinScatter** w/ persona-colored dots and Geist Mono numerals.

**Icons**: **Lucide** outlined, 14px stroke 1.5.

---

## Template 3 — Vercel

**Inspiration**: vercel.com/dashboard — black/white refined, dense type.

**Fonts**:

- Display: **Geist** (the Vercel font), 500–700 only
- Mono: **Geist Mono**
- Body 13px, tracking `-0.015em`. Headings -0.025em.

**Palette**:

- bg `#FAFAFA`, surface `#FFFFFF`, ink `#000000`, ink-2 `#666666`, ink-3
  `#A1A1A1`
- rule `#EAEAEA`, rule-strong `#D4D4D4`
- accent: pure black for primary, blue `#0070F3` for links only
- semantic: success `#0070F3`, warn `#F5A623`, error `#E00`

**Layout**:

- Top header bar (60px, fixed) with breadcrumbs + actions
- No sidebar — tab nav under header (Insights · Sessions · Requests …)
- Content max-width 1200px, generous 48px gutters

**Component shape**:

- **PulseStrip → "Project metric" cards** in a 4-up grid, all white, 1px rule
  border, 20px padding. Big tabular number, tiny label, sparkline below.
- **MoneyFlow** rendered as horizontal **stacked bar** (Vercel-style spend
  meter) with hover popover, NOT a sankey. Above it: spend / waste / wins
  rolling 24h-style chips.
- **PeopleTable** is a true Vercel-style data table: 13px monospace name column
  with avatar, hover highlights row in `#F4F4F4`, "..." menu on rightmost
  column.
- **GapMap** rendered as a **scatterplot grid** (no UMAP gradient bubble), small
  black dots with name labels, severity → dot size. Very technical.
- **SpendWinScatter** uses pure black dots, no fill, just rings; only the
  selected dot is filled.

**Icons**: **Lucide** at 14px, stroke 1.25, all `#000`.

---

## Template 4 — Cloudflare

**Inspiration**: dash.cloudflare.com — operations console, orange CTA, dense
info.

**Fonts**:

- Display: **Inter** Tight 400–700
- Mono: **JetBrains Mono**
- Body 13.5px, tighter line-height 1.45

**Palette**:

- bg `#FAFBFC`, surface `#FFFFFF`, ink `#1D1F25`, ink-2 `#536471`
- rule `#E2E5EA`, rule-soft `#F0F2F4`
- brand orange `#F38020`, blue `#0051C3`, success `#00A878`, warn `#C66200`,
  error `#B83A4B`
- status pill bg: `#FFF3E5` for warn, `#E8F8F2` for ok, `#FCE9EC` for err

**Layout**:

- Two-row top bar: brand row (Cloudflare-style logo + account dropdown), utility
  row (search, notifications, help)
- Left rail nav with icons + labels (icons-only when collapsed)
- Page content with **breadcrumbs at top** and **status banner**

**Component shape**:

- **PulseStrip → 4 cards each with "status pill"** (Healthy/Watch/Critical),
  sparkline mini-chart, primary metric, secondary delta. Each card has a thin
  colored top stripe matching status.
- **MoneyFlow** is a **donut + segmented legend** (productive vs waste, with
  sub-segments). Cloudflare loves donuts.
- **PeopleTable** has filter chips above + dropdown-driven column toggles,
  status pills per row, "Last seen" relative time, dense (12px) row height.
- **GapMap** is a **heatmap matrix** (rows = capability domains, cols = severity
  buckets) — a Cloudflare-style traffic-pattern grid.
- **SpendWinScatter** keeps scatter but with **quadrant labels** ("Power · Stuck
  · Misuser · Lurker") at the four corners.

**Icons**: **Cloudflare-style outline** (Lucide as proxy) but in `#536471`,
status icons in their state color.

---

## Template 5 — Memphis

**Inspiration**: 80s Memphis Group + 90s zines + sticker-pack aesthetic.

**Fonts**:

- Display: **Bricolage Grotesque** (variable, expressive)
- Accent: **Caprasimo** (chunky display)
- Body: **DM Sans**

**Palette** (high-saturation):

- bg `#FFF7E8`, paper `#FFFFFF`
- hot pink `#FF3D7F`, lime `#D8FF36`, sky `#7BD3F7`, mango `#FFB938`, violet
  `#A78BFA`, ink `#2A1B3D`
- accent dots: terrazzo speckle on cards (pseudo-element gradients)

**Layout**:

- Asymmetric — sidebar 200px **rotated 1°** affixed to a black border strip
- Content cards each tilted ±1.5°, drop in slightly when scrolled in
- Off-axis decorative shapes (squiggles, dots, zigzags) as backgrounds

**Component shape**:

- **PulseStrip → sticker-style badges** with chunky borders + colored fills
  - tilted star icon. Numbers in Caprasimo display.
- **MoneyFlow** as a **squiggly path diagram** (custom SVG snake) with spend
  label tickers along the path, lens chips as zigzag-bordered tabs.
- **PeopleTable** as a **flashcard deck**: alternating colored row strips,
  persona pills as bubble shapes, hand-drawn underline on hover.
- **GapMap** with bubble shapes that have orbit-rings, decorative comet tails on
  top-severity clusters.
- **SpendWinScatter** with cartoon-style dots, name labels in a speech bubble.

**Icons**: **Phosphor** in Duotone/Bold, recolored to palette.

---

## Template 6 — Studio Söhne (OpenAI calm)

**Inspiration**: platform.openai.com — restrained, oversized, cinematic numbers.

**Fonts**:

- Display: **Söhne** (paid) → use **Inter Display** as proxy at high tracking
- Mono: **Inconsolata**
- Body 15px, generous line-height 1.65

**Palette**:

- bg `#F7F7F5` (very warm off-white), surface `#FFFFFF`, paper `#FAF9F6`
- ink `#202020`, ink-2 `#5C5C5C`, ink-3 `#9A9A9A`
- rule `#E7E5E0`, accent emerald `#10A37F` (the OpenAI green), coral `#E56F4A`
- charts: muted earth — sage, sand, dusty rose, slate

**Layout**:

- Centered single column, max 960px, lots of vertical breathing
- Section headers with thin horizontal rule + 14px eyebrow
- No sidebar — top nav, links underline-on-hover only

**Component shape**:

- **PulseStrip → giant 56px metric numbers** stacked, tiny labels, sparse "vs
  last period" green/red tag. Inline, no card chrome.
- **MoneyFlow** as a **single horizontal bar** (productive/wasted) above a clean
  2-column split (productive breakdown / waste breakdown), emerald/coral tones.
- **PeopleTable** with a calm 16px row height, light hover only on the name cell
  underline. No persona chip — just a small colored dot left of name.
- **GapMap** rendered as a **simple ranked list** (top 8 unresolved clusters
  with severity bar) — calm, no wow-bubbles.
- **SpendWinScatter** in a refined "x-marks-the-spot" plot with thin lines.

**Icons**: **Phosphor Light** (very thin), 16px.

---

## Template 7 — Linear

**Inspiration**: linear.app — precise, technical, quietly luxurious.

**Fonts**:

- Display: **Inter** (Variable, with `cv11`/`ss01` features)
- Mono: **IBM Plex Mono**
- Body 13px, tracking 0

**Palette**:

- bg `#FBFBFD`, surface `#FFFFFF`, surface-2 `#F4F5F8`
- ink `#08090A`, ink-2 `#5E6A7A`, ink-3 `#94A0AE`
- rule `#E6E8EC`
- accent purple `#5E6AD2` (Linear's signature), success `#26A269`, warn
  `#F2994A`
- micro-shadow: `0 1px 2px rgba(8,9,10,0.04), 0 4px 12px rgba(8,9,10,0.04)`

**Layout**:

- Slim 60px icon-only left rail (icons + tooltip)
- Content header with breadcrumb chain (`/` separated)
- Subtle hover-reveal command-K style search at top

**Component shape**:

- **PulseStrip → 4 minimal "stat" cards** with micro-shadow, 8px radius, big
  tabular numerals + 11px label, small purple % delta chip on the side.
- **MoneyFlow** as a **stacked progress bar** + breakdown legend (Linear's
  "milestone progress" feel), purple for productive, soft red for waste.
- **PeopleTable** as a Linear "Issues" list — avatar + bold name + sub metadata,
  status pill on right, hover shows "open" arrow.
- **GapMap** as a **node-edge graph** (small graph with cluster nodes connected
  by thin lines if they share users) — Linear-y graph style.
- **SpendWinScatter** with crisp 1px stroke-only dots, hover ring.

**Icons**: **Lucide** at 16px, stroke 1.5, ink-2 default.

---

## Template 8 — Editorial

**Inspiration**: The Economist + NY Times graphics + FT.com.

**Fonts**:

- Display: **Playfair Display** (700/900) for headlines
- Editorial: **Spectral** (serif body)
- Sans: **Sohne** proxy → **Inter** for captions
- Mono: **Source Code Pro**
- Body 16px serif, line-height 1.6, drop caps on first paragraph

**Palette**:

- bg `#F5F1E8` (newsprint cream), paper `#FBF7EE`
- ink `#1C1A17` (warm black), ink-2 `#5B544A`
- rule double-line `#1C1A17` 1px above 3px
- accent: deep red `#A8261C` (FT-pink would be too literal), gold `#A2822E`
- charts: monochrome with one red highlight

**Layout**:

- Multi-column (CSS columns) for the briefing intro
- Section dividers with double-rules and centered ornament glyph (✦)
- Big headline (54px Playfair) at top, byline below, dateline right-aligned

**Component shape**:

- **PulseStrip → "Today's numbers"** strip styled as a ledger/almanac line:
  number — label — delta, separated by thin vertical rules.
- **MoneyFlow** redrawn as an **infographic** — a single horizontal flow
  illustration with serif labels, small icons (coin, factory, smoke).
- **PeopleTable** styled as a **standings/leaderboard table** (think sports
  page) with rank, name, team, win-rate column, "form" sparkline.
- **GapMap** rendered as a **dotmap chart** (one dot per session, colored by
  cluster) — feels like an FT graphic.
- **SpendWinScatter** as a **proper economist chart** with axis titles and
  source line at bottom (`Source: Nebula proxy capture, May 2026`).

**Icons**: minimal — only ornaments (✦, ❡, →).

---

## Template 9 — Glass

**Inspiration**: macOS Sonoma / iOS 17 / Apple developer dashboards.

**Fonts**:

- Display: **Instrument Serif** for hero numbers (a touch of editorial)
- Body: **Inter Display**
- Mono: **JetBrains Mono**
- Body 14px, line-height 1.55

**Palette** (gradient mesh background):

- bg gradient: peach `#FFD6BA` → lavender `#D6CDF5` → mint `#C8F0DC` → sky
  `#BFE2FF` (radial-gradient blobs)
- surface: `rgba(255,255,255,0.55)` with `backdrop-filter: blur(24px)`
- ink `#1A1B1F`, ink-2 `#4A4D55`
- accent indigo `#4F46E5`, coral `#F87171`, mint-strong `#34D399`
- soft long shadow `0 24px 64px -16px rgba(31,41,55,0.18)`

**Layout**:

- Floating sidebar (rounded 24px, glass), content cards floating above the
  gradient mesh
- 24px radius on EVERYTHING, generous padding (24–32px)

**Component shape**:

- **PulseStrip → translucent floating tiles** with a tiny gradient orb in the
  corner, Instrument Serif numbers.
- **MoneyFlow** as a **liquid bar** with frosted gradient fill (animated shimmer
  on hover), pill-shaped lens chips.
- **PeopleTable** with rounded rows, frosted hover, indigo persona pills.
- **GapMap** with **soft glow bubbles** (drop-shadow filter), pulsing selected
  state.
- **SpendWinScatter** with neon-edged circles, frosted tooltip.

**Icons**: **Lucide** at 18px, stroke 1.5, ink color, with subtle drop-shadow.

---

## Template 10 — Bauhaus

**Inspiration**: Bauhaus + Swiss design + Müller-Brockmann grids.

**Fonts**:

- Display: **Bebas Neue** for big headlines (uppercase, condensed)
- Sub-display: **Archivo Black**
- Body: **Manrope** (geometric sans)
- Mono: **JetBrains Mono**
- Body 14px, generous tracking on headlines

**Palette** (primary geometric):

- bg `#F4F1E8` (warm off-white)
- primary red `#E63946`, primary yellow `#F1C453`, primary blue `#1D4E89`,
  primary black `#0E0E10`
- rule strong `#0E0E10`, rule soft `#9A968A`
- charts: red / yellow / blue plus black

**Layout**:

- Strict 12-column grid visible as faint gridlines
- Large geometric shapes (red circle, yellow square, blue triangle) as
  decorative elements bleeding off the page edges
- Section headers in Bebas Neue 36px uppercase

**Component shape**:

- **PulseStrip → 4 colored geometric "panels"** (each one a primary color block
  with white text), Bebas Neue display number.
- **MoneyFlow** as a **two-shape diagram** — circle (productive) + square
  (wasted), connected by a thick line, sub-shapes inside for breakdown.
- **PeopleTable** styled as a **classic Swiss table**: thick top + bottom rules,
  plain rows with NO row dividers (just whitespace), aligned to grid.
- **GapMap** as a **constellation of geometric shapes** (each cluster is a
  circle/square/triangle based on domain), positioned by centroid.
- **SpendWinScatter** with shapes (per-persona shape: triangle/square/
  circle/diamond/star).

**Icons**: **Geometric custom** — basic shapes (circle/square/triangle/line).

---

## Architecture

```
ui/src/templates/
├── shared/                 # cross-template helpers (data shape only)
├── t1/Insights.tsx         # existing (re-export from current)
├── t2/Insights.tsx
├── t3/Insights.tsx
├── ...
└── t10/Insights.tsx
```

Each template directory may contain its own component files. Insights (top-level
page) becomes a dispatcher that reads `useTemplate()` and renders the matching
template's `<Insights />`. The top-level `<Layout />` (sidebar) also branches by
template, since each one has a distinct nav treatment.

**Sidebar dispatch** in `ui/src/components/Layout.tsx`:

- T2/T3/T7: hairline-rule sidebar with icons
- T4: status-banner top + left rail with icons
- T5/T9: floating sidebar (tilted / glass)
- T6/T8: top nav, no sidebar
- T10: gridded sidebar with primary-color blocks

**Per-template fonts**: each template injects its own `<link rel=stylesheet>` to
Google Fonts via a `<TemplateFonts t={N} />` component mounted at the top of
`<Layout>`. Avoids loading every font when only one is in use.

**SVG palette**: extend `paletteFor(t)` in `ui/src/insights/palette.ts` for all
10 ids.

**Drawer treatment**: each template gets its own drawer chrome (frosted/
hairline/wireframe) but the drawer body (User/Cluster/Waste content) stays
shared with template-aware classes.

---

## Build order (locked)

1. T2 Studio (port from existing dashboard)
2. T3 Vercel (replaces the disliked "Terminal")
3. T4 Cloudflare
4. T5 Memphis
5. T6 Studio Söhne
6. T7 Linear
7. T8 Editorial
8. T9 Glass
9. T10 Bauhaus

T1 stays untouched. Each template ships:

- Its CSS file (or inline styled tokens)
- Its custom InsightsPage layout
- Its variants of: PulseStrip, MoneyFlow, PeopleTable, GapMap, SpendWinScatter
- Its sidebar/header treatment
- Its drawer chrome

---

## Per-template completion checklist (DO NOT SKIP)

When migrating a template, you MUST touch every file below. The Insights page is
the showcase, but the sidebar nav has 5 engineer pages (Sessions, Requests,
Tools, Users, Providers) — they reuse soft-pop primitives (`.nb-card`,
`.nb-table`, `.nb-tag`, `.nb-chip`, `.nb-input`, `.nb-btn`, `.nb-hover`,
recharts) so each template's CSS must override those primitives in scope.

### Files per template (`tN`)

1. **`ui/src/templates/tN/styles.css`** — the master stylesheet, scoped via
   `[data-template="N"]`. Must override:
   - **Token rebinds (top of file)**: re-declare `--font-display`,
     `--font-mono`, `--color-paper`, `--color-ink`, `--color-mist`,
     `--color-mint`, `--color-peach`, `--color-lavender`, `--color-butter`,
     `--color-sky`, `--color-rose`, `--color-lime`, `--color-ok`,
     `--color-warn`, `--color-err`, `--radius-soft`, `--radius-pill`. This
     silently re-themes every Tailwind utility (`font-display`,
     `bg-[var(--color-mint)]`, etc.) used across the engineer pages.
   - **App shell**: `.sidebar-app`, `.sidebar`, `.sidebar-link`,
     `.sidebar-section-label`, `.sidebar-link-bullet`, `.template-switcher`,
     `.template-chip`. (T6/T8 hide the sidebar; T4 may add a status banner.)
   - **Soft-pop primitives**: `.nb-card`, `.nb-card-flat`, `.nb-btn`,
     `.nb-chip`, `.nb-input`, `.nb-tag`, `.nb-table` (thead/td/tbody hover/
     selected), `.nb-hover` and `.nb-hover:hover`, `.nb-flash`, `.nb-pulse`,
     `.nb-slide-in`, `.scrollbar-soft`.
   - **Insights chrome** (used by `MoneyFlow` + `GapMap`): `.panel`,
     `.panel-header`, `.panel-sub`, `.panel-title`, `.panel-meta`,
     `.panel-body`, `.panel-gapmap`, `.lens-switch`, `.lens-pill`,
     `.lens-pill.active`, `.flow-wrap`, `.scatter-card`.
   - **GapMap**: `.gapmap-wrap`, `.gapmap-axes line`, `.gapmap-bubble`,
     `.gapmap-bubble.selected`, `.gapmap-label`, `.gapmap-tip`,
     `.gapmap-tip-label`, `.gapmap-tip-meta`, `.gapmap-caption`,
     `.gapmap-caption-text`, `.gapmap-legend`, `.gapmap-legend-grad`.
   - **PeopleTable / persona chips**: `.people-table` (thead th, tbody tr,
     tr.selected, td, td.right, td.mono), `.consultant-cell`,
     `.consultant-name`, `.consultant-meta`, `.trend-cell`, `.persona-chip`,
     `.persona-chip .persona-dot`, `.persona-power`, `.persona-active`,
     `.persona-stuck`, `.persona-misuser`, `.persona-lurker`.
   - **Drawer**: `.insights-drawer`, `.insights-drawer-overlay`,
     `.insights-drawer-head`, `.insights-drawer-eyebrow`,
     `.insights-drawer-title`, `.insights-drawer-subtitle`,
     `.insights-drawer-close`, `.insights-drawer-body`.
   - **Recharts**: `.recharts-text`, `.recharts-cartesian-axis-tick-value`,
     `.recharts-cartesian-axis-line`, `.recharts-cartesian-axis-tick-line`,
     `.recharts-cartesian-grid-horizontal line`,
     `.recharts-cartesian-grid-vertical line`, `.recharts-default-tooltip`.
   - **Engineer-page-specific**: `code`, `pre` (used by Providers / EmptyState
     curl blocks); persona dot colours; chip/tag colour-coding (status:
     ok/warn/err) where Providers + Tools rely on them.
   - **Bespoke `tN-*` classes** for the Insights template's custom layout.

2. **`ui/src/templates/tN/Insights.tsx`** — the showcase page. Builds the
   manager dashboard with bespoke composition (KPIs / charts / leader table /
   capability gap viz / drawer dispatch). Imports `./styles.css`. May or may not
   reuse `MoneyFlow`/`GapMap` depending on aesthetic fit. Drawer integration via
   `<Drawer>` is shared.

3. _(Optional)_ `ui/src/templates/tN/<bespoke>.tsx` — any custom chart or list
   components specific to this template.

### Shared files touched once per template (already done)

These don't need editing per template, but verify the relevant `case N:` exists:

- **`ui/src/insights/templates.ts`** — `TEMPLATES` list + `TemplateId`.
- **`ui/src/insights/fonts.tsx`** — `FONT_HREFS[N]` Google Fonts URL(s).
- **`ui/src/insights/palette.ts`** — `paletteFor(t)` `case N:` for SVG colours
  (axis text, gridline, productive/wasted, persona, gapmap).
- **`ui/src/insights/templates.css`** — switcher chip overrides.
- **`ui/src/pages/Insights.tsx`** — dispatcher `case N: return <TNInsights …>`.
- **`ui/src/components/insights/Avatar.tsx`** — `BG_BY_TEMPLATE[N]` array of 5
  hex colours (no `#`) for dicebear backgrounds, so engineer photos stop
  rendering in soft-pop pastels.

### Engineer pages (NOT rebuilt per template)

These reuse soft-pop primitives. They re-theme automatically once the token
rebinds + primitive overrides above are in place. Verify each renders cleanly by
clicking through the sidebar with the template active:

- `ui/src/pages/Sessions.tsx` — table + filter input + nb-flash row pulse.
- `ui/src/pages/Requests.tsx` — table + status nb-chip + filter + select.
- `ui/src/pages/Tools.tsx` — recharts BarChart (cells use nb-card + token
  colours) + table with expandable JSON args.
- `ui/src/pages/Users.tsx` — sortable table + wizard nb-chip + error chip.
- `ui/src/pages/Providers.tsx` — 3-column nb-card grid + curl pre block.
- `ui/src/pages/SessionDetail.tsx`, `RequestDetail.tsx`, `Search.tsx`,
  `Overview.tsx` (engineer-only deep-dive pages).
- `ui/src/components/EmptyState.tsx`, `ui/src/components/Sparkline.tsx` — shared
  widgets used by both manager and engineer pages.

### Smoke test (per template)

Click through `/insights`, `/sessions`, `/requests`, `/tools`, `/users`,
`/providers` with `?t=N` set. No element should look soft-pop unless the
template explicitly adopts that aesthetic.
