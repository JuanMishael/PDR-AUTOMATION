# PDR-AUTOMATION — Design System ("Sketchbook")

The UI uses a **hand-drawn sketchbook** theme: warm paper, soft-ink borders, solid
offset shadows, and hand-drawn headings — friendly and approachable for
non-technical testers, while keeping code/selectors perfectly readable.

> **One rule above all:** new UI must read like the rest of the app. Reach for the
> tokens and component classes below before writing custom inline styles. If you're
> hardcoding a hex color or a blurry shadow, you're probably off-theme.

Everything lives in [`src/renderer/src/index.css`](../src/renderer/src/index.css)
(tokens + component layer) and
[`src/renderer/src/components/SketchDefs.jsx`](../src/renderer/src/components/SketchDefs.jsx)
(wobble filters + icon sprite).

---

## 1. Principles

1. **Paper, not screen.** Backgrounds are warm off-white with a faint grain — never pure white, never dark.
2. **Ink, not black.** Text and borders are soft ink `#2b2b2b`, never `#000`.
3. **Solid offset shadows, no blur.** Depth comes from a hard `4px 4px 0` ink shadow, like a sticker on paper. No soft glows / `rgba(0,0,0,…)` drop-shadows.
4. **Hand fonts for chrome, clean fonts for content.** Headings, buttons, nav, and labels use the hand fonts. Body text uses the system sans. **Selectors, code, and CSS strings are always monospace** — readability is non-negotiable.
5. **One accent.** A single violet marker (`--accent`). Status colors are warm pastels. No rainbow.
6. **The wobble is decorative only.** It lives on a border pseudo-element so text and shadows stay crisp.

---

## 2. Tokens

Defined in `:root`. **Always use the token, never the raw value.**

### Paper & ink
| Token | Value | Use |
|---|---|---|
| `--paper` | `#fbf7ef` | app background |
| `--paper-sunk` | `#f1ead9` | insets, track wells |
| `--surface` | `#fffdf8` | cards / panels |
| `--surface-2` | `#f7f1e6` | secondary surface, hovered rows |
| `--ink` | `#2b2b2b` | primary text |
| `--ink-soft` | `#6f6a60` | secondary text, captions |
| `--ink-faint` | `#a59f93` | placeholders, disabled |
| `--line` | `#2b2b2b` | strong border ink (cards, buttons) |
| `--line-mid` | `rgba(43,43,43,.30)` | outline borders |
| `--line-soft` | `rgba(43,43,43,.18)` | hairlines, dashed dividers |

### Accent (single marker)
| Token | Value | Use |
|---|---|---|
| `--accent` | `#7c5cce` | primary actions, active state |
| `--accent-ink` | `#4a3692` | accent text/border on light, accent shadow |
| `--accent-soft` | `#ece5fb` | selected-row wash, active nav bg |
| `--marker` | `rgba(124,92,206,.30)` | highlighter swash behind text |

### Status (warm pastels — each has text / bg / line)
| Meaning | Text | Bg | Line |
|---|---|---|---|
| OK / pass | `--ok` | `--ok-bg` | `--ok-line` |
| Bad / fail | `--bad` | `--bad-bg` | `--bad-line` |
| Warn | `--warn` | `--warn-bg` | `--warn-line` |
| Busy / running | `--busy` | `--busy-bg` | `--busy-line` |

### Geometry & shadow
`--bw: 2px` · `--r: 10px` · `--r-sm: 7px` · `--r-lg: 14px`
`--shadow` (4/4) · `--shadow-sm` (3/3) · `--shadow-xs` (2/2) · `--shadow-accent` (accent-ink).
**Never invent a blurred shadow** — pick one of these.

### Type
| Token | Stack | Use |
|---|---|---|
| `--font-hand` | Patrick Hand → Comic Sans MS | headings, buttons, nav, labels, section eyebrows |
| `--font-marker` | Caveat → Patrick Hand | wordmark, margin notes only |
| `--font-body` | system sans | body / paragraph text |
| `--font-mono` | JetBrains Mono → Cascadia Code | **selectors, code, CSS, IDs — never restyle to a hand font** |

Fonts are bundled locally via `@fontsource/*` (imported in `main.jsx`) so the app
stays offline-safe inside Electron.

---

## 3. Component classes

Prefer these over inline styles.

| Class | What it is |
|---|---|
| `.btn` | default paper button (hand font, ink border, offset shadow, press animation) |
| `.btn-primary` | violet marker button — main action on a screen |
| `.btn-ghost` | low-emphasis, flat outline |
| `.btn-success` / `.btn-danger` | pastel status buttons |
| `.btn-sm` | compact size modifier |
| `input, select, textarea` | styled globally (2px ink border, inset shadow, accent focus ring) |
| `.input-mono` | monospace variant for selector/code fields |
| `label` | hand-font field label |
| `.card` | panel with the wobbly sketch border + offset shadow (wobble is automatic) |
| `.sketch` | add the wobbly border to any container that isn't a `.card` |
| `.sketch--rough` / `.sketch--accent` | heavier wobble / accent-tinted border |
| `.badge` + `.badge-ok/-bad/-warn/-busy` | status pills (mono text). Add a `.dot` span for a leading dot. |
| `.tag` | uppercase mono action-type tag (e.g. on step cards) |
| `.toggle` | paper switch (`.track` + `.knob`, driven by a hidden checkbox) |
| `.eyebrow` | small uppercase hand-font section label |
| `.marker-hl` | highlighter swash behind inline text |
| `.divider` | dashed hairline rule |

> Legacy aliases: old token names (`--text`, `--surface2`, `--border`, `--radius`,
> `--success`, etc.) are aliased onto the new palette at the bottom of `:root`, so
> existing inline styles stay on-theme. **Use the new token names in new code**; the
> aliases exist only so we didn't have to rewrite every screen at once.

---

## 4. Icons

Hand-drawn SVG sprite in `SketchDefs.jsx`. Render with the `Icon` component:

```jsx
import { Icon } from './components/SketchDefs'

<Icon name="builder" size={19} />      // stroked outline
<Icon name="record" size={16} fill />  // filled shape
```

Available: `dashboard, profile, builder, run, results, history, settings, health,
pick, record, plus, chev, copy`. To add one, drop a `<g id="i-name">` into the
sprite's `<defs>` using `stroke-width="2"` paths (mark solid shapes with
`className="ic-fill"`). **Don't reintroduce unicode glyph icons** (`▦ ⊡ ≡`) — they
clash with the hand-drawn set.

---

## 5. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use `var(--ink)`, `var(--accent)`, etc. | Hardcode `#fff`, `#000`, `rgba(108,99,255,…)` |
| Use `--shadow-*` offset shadows | Use blurred `0 8px 32px rgba(0,0,0,…)` glows |
| Hand font for buttons/labels/headings | Hand font on selectors, code, or data values |
| `.card` / `.sketch` for paneled surfaces | `border: 1px solid #ccc` ad-hoc boxes |
| One accent + pastel statuses | Extra brand colors |
| `<Icon name="…">` from the sprite | Emoji or unicode glyph icons for nav/actions |
