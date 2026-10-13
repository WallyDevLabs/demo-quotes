---
name: CraftLedger
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#464555'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#703a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#934e00'
  on-tertiary-container: '#ffd2b1'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.025em
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  mono-metric-xl:
    fontFamily: JetBrains Mono
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.03em
  mono-metric-xl-mobile:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  mono-metric-lg:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  mono-body:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  mono-caption:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system targets technical freelancers, solo consultants, and boutique software agencies who require rigorous, transparent financial intelligence. The identity balances the engineering precision of an IDE with the elevated credibility of modern institutional fintech. The emotional tone evokes complete fiscal command, analytical rigor, and effortless professional stature.

The design movement blends **Corporate / Modern SaaS** with deliberate **Tactile Utility**:
- Precise structural hierarchy governed by crisp 1px borders and distinct surface tiers.
- High-density data tables juxtaposed against balanced white space in editorial summary modules.
- Monospaced numerical readouts communicating exactness across invoices, rates, margins, and quotes.
- Focused semantic color coding that conveys economic reality at a glance without visual noise.

## Colors

The palette establishes a hierarchy separating interactive workflows from fiscal indicators.

- **Primary (`#4F46E5` Indigo):** Dedicated strictly to interactive controls, key navigation anchors, focus rings, and primary actions. It drives progression through creation and invoicing funnels.
- **Secondary (`#0D9488` Deep Teal):** Financial surplus, realized margins, approved payments, and positive profit deltas. Used for high-trust value displays.
- **Tertiary (`#D97706` Warm Amber):** Contingency buffers, pending status states, scope risk warnings, and working drafts.
- **Cost / Expense (`#E11D48` Soft Rose):** Dedicated to cost items, subcontractor fees, overhead deductions, overdue payments, and structural deficits.
- **Neutrals & Surfaces:**
  - Base canvas: `#F8FAFC` (Slate 50).
  - Raised cards & modal sheets: `#FFFFFF` (Pure White).
  - Recessed inputs & metric bays: `#F1F5F9` (Slate 100).
  - Structural hairline borders: `#E2E8F0` (Slate 200).
  - Secondary text & metadata: `#64748B` (Slate 500).
  - Primary text, headings, and high-emphasis slate: `#0F172A` (Slate 900).

## Typography

The type system deploys **Plus Jakarta Sans** for interfaces, hierarchy, and editorial text, coupled with **JetBrains Mono** for numerical values, financial ledger calculations, invoice IDs, and currency displays.

- All financial ledgers, rates, estimates, and currency symbols (`R`, `$`, `€`) must consume `JetBrains Mono` with `font-variant-numeric: tabular-nums` enforced to guarantee vertical tabular alignment.
- Headings maintain tight negative tracking to deliver an authoritative, polished SaaS finish.
- Metadata and table headers use `label-caps` styled in uppercase with intentional positive tracking for fast field scanning.

## Layout & Spacing

The layout is built on a structured 12-column desktop grid with a persistent 280px left navigation shell and an adaptive main workspace.

- **Desktop (>= 1280px):** 12-column grid, 2rem margins, 1.5rem gutters. Heavy quote builders use an 8-column editor with a fixed 4-column sticky summary rail.
- **Tablet (768px - 1279px):** 8-column layout. Sticky calculation docks transition to collapsible bottom flyout drawers.
- **Mobile (< 768px):** 4-column layout, 1rem margins, 1rem gutters. All ledger rows stack vertically into distinct grouped item cards.
- **Sticky Calculation Dock:** Quotation totals and margin calculators stay fixed to the bottom or right sidebar, preserving persistent financial visibility regardless of line-item scroll depth.

## Elevation & Depth

Visual depth is achieved through layered neutral surfaces defined by low-contrast slate outlines and soft ambient shadows.

- **Surface Tiers:**
  - `Layer 0 (Canvas):` `#F8FAFC` base application background.
  - `Layer 1 (Card/Container):` Pure `#FFFFFF` framed by a 1px solid `#E2E8F0` border.
  - `Layer 2 (Raised/Dropdown/Flyout):` Pure `#FFFFFF` with `0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.04)`.
  - `Layer 3 (Modal/Sticky Calculation Dock):` Pure `#FFFFFF` with `0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)` and top border `1px solid #E2E8F0`.
- **Recessed Areas:** Data tables, calculation bays, and nested line items sit on `#F1F5F9` surfaces with no shadow and an inset `1px solid #E2E8F0` border.

## Shapes

The system relies on compact, disciplined corner radiuses (`roundedness: 1`) to preserve an engineering-oriented aesthetic.

- Base inputs, buttons, segmented controls, and badges use `0.25rem` (4px).
- Cards, calculation bays, sticky summary rails, and modals use `0.5rem` (8px).
- Floating preview surfaces and large modal windows use `0.75rem` (12px).
- Status pill tags and quick-filter chips use fully rounded pill geometries (`9999px`) to immediately distinguish contextual status elements from clickable structural buttons.

## Components

### Buttons
- **Primary:** Background `#4F46E5`, foreground `#FFFFFF`, font-weight `600`, radius `0.25rem`. Hover `#4338CA`. Subtle inset top highlight `rgba(255, 255, 255, 0.15)`.
- **Secondary:** Surface `#FFFFFF`, border `1px solid #E2E8F0`, foreground `#0F172A`. Hover background `#F8FAFC`, border `#CBD5E1`.
- **Destructive:** Border `1px solid #FECDD3`, background `#FFF1F2`, text `#E11D48`. Hover background `#FFE4E6`.

### Inputs & Tabular Form Fields
- Surface `#FFFFFF` (or `#F8FAFC` within active ledger tables), border `1px solid #CBD5E1`, text `#0F172A`.
- Focus: Border `#4F46E5`, box-shadow `0 0 0 3px rgba(79, 70, 229, 0.15)`.
- Currency and Rate Inputs: Monospaced numeric alignment with hardcoded prefix indicators (e.g., `R` or `$`) in `#64748B`.

### Badges & Status Pills
- Compact padding (`0.125rem 0.5rem`), font `mono-caption`, full pill radius.
- **Paid / Healthy Margin:** Background `#CCFBF1`, text `#0F766E`, border `1px solid #99F6E4`.
- **Draft / In Review:** Background `#FEF3C7`, text `#B45309`, border `1px solid #FDE68A`.
- **Overdue / Deficit:** Background `#FFE4E6`, text `#BE123C`, border `1px solid #FECDD3`.

### Cards & Collapsible Quote Sections
- Surface `#FFFFFF`, border `1px solid #E2E8F0`, radius `0.5rem`.
- Collapsible section header contains section total tally formatted in `mono-body` alongside chevron control, allowing high-level budget reviews when collapsed.

### Segmented Controls (Billing Type & Term Switchers)
- Housing: Background `#F1F5F9`, border `1px solid #E2E8F0`, padding `0.25rem`, radius `0.375rem`.
- Active Item: Background `#FFFFFF`, text `#0F172A`, shadow `0 1px 3px rgba(15, 23, 42, 0.08)`.
- Inactive Item: Background transparent, text `#64748B`.

### Sticky Calculation Dock
- Fixed bottom or dedicated right panel anchored to the viewport.
- Surface `#FFFFFF` with Layer 3 shadow, top hairline border `#E2E8F0`.
- Split into three visible readouts: Base Cost, Contingency Buffer (`#D97706`), and Final Net Margin (`#0D9488`).