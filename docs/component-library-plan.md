# Studio component library — inventory and phased plan

Status: **read-only inventory + proposal**. Nothing in this document has been built. No product code changed in the
round that produced it (branch `feat/inventory`, base `main` @ `bb992b4`).

Goal (V): Claude Design output should map 1:1 to shipped code. Today the Studio is vanilla DOM in one file,
`client/index.html` (11,263,943 bytes, 38,285 lines), with no component library. This document lists what the Studio
actually uses today and proposes a phased route to a real library, with the alternative weighed honestly.

## How the numbers were taken

Everything below cites a `file:line` or a count from a command that was actually run on `bb992b4`. Estimates are
marked **ESTIMATE**. Things not measured are marked **NOT MEASURED**.

`client/index.html` regions (from `grep -n '<style\|</style>\|<script\|</script>'`):

| Region | Lines |
|---|---|
| Head, theme pre-paint script | 1–46 (`<script>` 16–30) |
| The single `<style>` block | 47–1816 |
| Static markup (`<body>`) | 1818–3093 |
| The main `<script>` | 3094–38283 |

Lines longer than 2,000 characters (`awk 'length($0)>2000'`) are the i18n packs' long lines (5987–5999, 6700–6711),
the sample-image data (14251, 14260, 14261) and one at 28618. They are left out of the JS counts.

Static counts come from `.scratch/count.sh` (git-ignored, reproduced here so anyone can run it again):

```bash
# CSS  = rule lines in <style> (47-1816) whose selector names .token
# HTML = elements in static markup (1818-3093) whose class="" carries the token
# JS   = token occurrences in script lines 3094-38283 shorter than 2000 chars
B='[^A-Za-z0-9_-]'
css=$(awk 'NR>=47 && NR<=1816' client/index.html | grep -cE "\.${tok}(${B}|$)")
html=$(awk 'NR>=1818 && NR<=3093' client/index.html | grep -oE 'class="[^"]*"' | grep -cE "(\"|${B})${tok}(\"|${B})")
js=$(awk 'NR>=3094 && NR<=38283 && length($0)<2000' client/index.html | grep -oE "(^|${B})${tok}(${B}|$)" | wc -l)
```

The JS count is a token count: it covers markup strings that JS builds (`'<button class="mini" …'`), `classList`
calls and selectors. For generic words (`switch`, `modal`, `toast`) it also picks up unrelated code (`switch`
statements, `toast(` calls), so treat it as an upper bound.

**Live DOM counts** come from a Playwright run against the static client (local-only mode, no server), Chromium
1440×900, Paper theme, Chapter Content tab, after **Load the sample story** (The Lantern Coast, 24,828 words, 15
chapters). `document.querySelectorAll(sel).length` for each selector (script: `.scratch/inv.mjs`).

**Screenshots** (not committed) are in `C:/Users/vikra/Projects/beuk-whole-project/.playwright-mcp/round5/`, named
`inventory-NN-*.png`. They are cited below by their short name, e.g. `[01-studio-paper]`.

| Shot | What it shows |
|---|---|
| 00-first-open | Empty desk on first open (Untitled Book), 1440×900 |
| 01-studio-paper | Whole studio with the sample loaded, Paper theme |
| 02-topbar | Header: brand, save pill, language pill, theme/help/support/export buttons |
| 03-lang-menu | Language dropdown open |
| 04-local-popover | Save-pill popover ("Saved on this device") |
| 05-sidebar-outline / 06-sidebar-stats-open | Outline list; statistics disclosure open with progress bars |
| 07-editor-controls | Section settings rows, switches, selects, text inputs, editor toolbar |
| 08-readaloud-popover / 09-dictation-popover | The two toolbar popovers |
| 10-toast | A toast (after Auto-Format) |
| 11-typography-top / 12-typography-ornaments-flourishes | Preset cards; ornament grid, flourish empty state, segmented control |
| 13-preview-pane | Device chips, device frame, page buttons, reading-desk list |
| 14-modal-settings / 15-modal-export / 16-modal-insights / 17-modal-goals / 18-modal-history | Modals |
| 19-zen / 20-zen-sound-popover / 21-zen-dock-index | Zen overlay controls |
| 22-studio-candlelight / 23-modal-settings-candlelight | Candlelight theme |
| 24-studio-rtl-ar | Arabic interface (RTL chrome) |
| 25-topbar-toolbar-de | German interface (long labels) |
| 26-phone / 30-phone-write | 390×844, Structure and Write panes |
| 27-help-index / 28-help-error-decoder / 29-help-guide | Help pages, rendered through the real `fillSlots()` (see §1.20) |

Baseline while taking these: `window.runBeukSelfChecks()` returned **228 checks, 227 pass, 1 fail —
`sample.spreadbleed`** (the known failure that predates this round). `BEUK_SELF_CHECKS_ASYNC` has 2 entries. No page
errors were recorded. At 390 px wide, `scrollWidth == clientWidth == 390` (no sideways scroll).

---

## 1. Inventory of UI primitives

Each entry lists: where it is defined (CSS + markup + the JS that builds it), variants and states, how many places use
it, accessibility notes, and screenshots.

### 1.1 Buttons

There is **no shared button base class.** Twelve-plus families each restate border, radius, padding and type.

| Family | CSS | Shape | Static CSS / HTML / JS | Live DOM | Variants actually styled |
|---|---|---|---|---|---|
| `.tb-btn` (main button) | `index.html:118–129` | pill (`999px`), 8×14 px, 13px/500 | 23 / 109 / 42 | 114 | `.primary` (`:127`) only |
| `.side-btn` (sidebar action) | `:245–251`, `:466` | 8px radius, 12.5px | 5 / 4 / 0 | 4 | `.sample-btn` (`:1761`) |
| `.side-tool` (dock tool, icon over label) | `:321–329` | column, 10.5px/600 | 4 / 3 / 1 | 4 (3 static + `btnBetaComments` built at `:37993`) | hover, focus-visible |
| `.tool-btn` (editor toolbar) | `:421–429`, `:557–585` | 32px tall, 7px radius | 13 / 11 / 7 | 11 | `.accent` (`:428`), `.listening` (`:432`), `.folded` (`:572`) |
| `.mini` (outline row tools) | `:267–272`, `:287–288` | 22×22, 5px radius | 5 / 0 / 4 | 104 | hover, focus-visible |
| `.page-btn` (preview Prev/Next) | `:1049–1055` | pill, 12.5px/600 | 4 / 6 / 0 | 6 | `:disabled` |
| `.dev-btn` (device chips) | `:1000–1005` | pill, 12px/600 | 3 / 10 / 3 | 10 | `.active` = inverted ink |
| `#mobileTabs button` | `:1772–1778` | 8px radius | — | 4 | `.active` = inverted ink |
| `.seg button` (segmented control) | `:964–966` | inside an 8px frame | see §1.7 | 14 | `.active` = accent fill |
| Picker cards (`.preset-card`, `.platform-btn`, `.trim-btn`, `.orn-btn`, `.cm-layout-btn`, `.img-cell`, `.cm-swatch`, `.cm-art-cell`, `.cm-photo-cell`) | `:950–975`, `:1198–1222`, `:1643–1658`, `:1496–1499` | 7–10px radius | e.g. preset 9/0/2, platform 6/0/1, trim 6/0/1, orn 5/0/2 | preset 15, orn 13, platform 11, trim 24 | `.active` = accent border + `0 0 0 3px var(--accent-soft)` ring (the same `0 0 0 3px var(--accent-soft)` declaration is used 11 times across selection and focus states) |
| Quiet text buttons (`.linkish`, `.gen-quiet`, `.hc-link`) | `:1455`, `:605–609`, `:1157–1158` | underlined text | 1/5/2, 2/0/1, 2/1/0 | linkish 5 | `.hc-link:disabled` |
| Small bordered buttons (`.si-btn`, `.a11y-jump`, `.toast-action`, `.local-backup-inline`, `.is-close`) | `:1512–1515`, `:1295–1301`, `:1552`, `:202`, `:1718–1720` | 6–7px radius | si 5/0/7, a11y-jump 3/0/3 | — | `.si-btn.on` |
| Zen pills (`#btnZenSound`, `#btnZenScenes`, `#btnZenDictate`, `#btnZenExit`) | `:750–811`, `:628–631` | pill | id-styled, one each | 4 | `.on`, `.loading`, `.failed`, `.remembered`, `.listening` |
| Dashed "add" rows (`#btnAddChapter`, `#btnAddPart`) | `:277–284` | dashed 8px | id-styled | 2 | hover |

`.tb-btn` modifier classes in use (`grep -oE 'class="tb-btn[^"]*"'`): static markup 82 plain, 22 `primary`, 3 `ra-ctl`,
1 `active`, 1 `accent`; JS-built 31 plain, 4 `primary`, 2 `fl-remove`, 2 `cal-nav`, 1 `ir-undo`, 1 `hist-del`.

**There is no `secondary` or `danger` variant.** `grep -i 'danger\|secondary'` over the CSS finds only two comment
lines (`:553`, `:1625`), and `class="[^"]*danger` matches nothing anywhere. Destructive actions (Remove cover
`:2294`, Remove scene `:2041`, delete in the outline) use a plain `.tb-btn` or `.mini` with a trash icon.
"Secondary" is just the plain `.tb-btn`.

**Defect found (OBSERVED):** `.tb-btn.accent` (`#btnTcSave`, `:2082`) and `.tb-btn.active` (`#btnCmWrapGuides`,
`:2698`, toggled by JS at `:22721`) have **no CSS rule**. Only `.tool-btn.accent` exists (`:428`). The computed-style
probe in the Playwright run gave identical `background-color` / `color` / `border-color` (`rgb(255,253,248)` /
`rgb(28,25,23)` / `rgb(207,198,180)`) for a plain `.tb-btn`, `#btnTcSave` and `#btnCmWrapGuides`. So the Save-theme
button carries no emphasis, and the Guides toggle shows its state only through `aria-pressed`. A library `Button`
should decide this explicitly. This round did not fix it (read-only unit).

Accessibility:
- `.sec-item` (§1.11) is a `div role="button" tabindex="0"` that **contains real `<button class="mini">`
  elements** (`index.html:15901–15906`): interactive controls nested inside a role=button. A library rebuild should
  split the row into a button (or link) plus separate tool buttons.
- Focus rings: `:focus-visible` outlines exist only for `.sec-item`, `.mini`, `.side-tool`, `.side-status-head`,
  `.group-toggle`, `.hc-stage`, `.cm3d-stage`, `#zenContinue` (grep `focus-visible` in the CSS). `.tb-btn`,
  `.tool-btn`, `.page-btn`, `.dev-btn` and the picker cards fall back to the browser default focus ring.
- Icon-only states: `.tool-btn.folded` hides its label with a clip pattern (`:573–576`) and keeps `title`, so the
  accessible name survives. At ≤1023px `.tb-btn .tb-label` is `display:none` (`:1788`), so those buttons rely on
  `aria-label`.

Screenshots: `[02-topbar]`, `[07-editor-controls]`, `[13-preview-pane]`, `[11-typography-top]`, `[15-modal-export]`.

### 1.2 Icon buttons and icons

Icons are **Lucide**, vendored at `client/assets/vendor/lucide.min.js` (358,106 bytes; SRI-pinned at
`index.html:45`). They are written as `<i data-lucide="name">`, and `icons()` (`index.html:3246`, calling
`lucide.createIcons()`) swaps each one for an inline `<svg class="lucide">`. That helper is called after every
re-render (for example at the end of `renderSidebar`, `:15985`).

- `data-lucide="` occurs 167 times in static markup and 53 times in JS strings. Live after the run: 311
  `svg.lucide`.
- Hand-written inline SVG: 2 `<svg` in static markup (`:1860` Export button, `:2718`), plus the zen cluster's
  SVGs built in JS (`:35462–35475`, e.g. `ZEN_SND_OFF`).
- Icon-only buttons: `.mini` (104 live, each with `title` + `aria-label` from `t()`, `:15905–15906`),
  `#btnZenScenes`, `.zn-btn` (zen prev/next, `:885–893`), `.is-close` (`:1718`), `#hcFull` (`:2240`), the
  `.cal-nav` arrows, and the theme/help/support/language pills once their labels fold (`:1629–1637`, `:1788`).

### 1.3 Pills, badges and chips

| Primitive | CSS | States | Notes |
|---|---|---|---|
| Save pill `.local-pill` (BEUK:local + BEUK:sidebar) | `:173–220` | `data-state` = checking / saving / saved / blocked / quota / error; `[data-evictable]`; `.is-failed` wrap | Built by `renderLocalPill()` `:35287–35305`. `role="status" aria-live="polite"` on the pill (`:1837`). The full sentence sits in a visually hidden `.local-full` and in the button's `aria-label`, and the `!` warning mark is copied into the name (`:35299`). 18 CSS rules; one instance. `[02-topbar]` shows "Saved · back up !" because headless Chromium does not grant persistent storage. |
| Offline pill `.net-pill` | `:156–168` | `hidden` when online | `role="status"` (`:1834`). |
| Status dots `.net-dot`, `.local-dot`, `.sync-dot` (`:1450–1452`, pulses), `#zenMark` (`:744–749`), `.zs-dot`, `.zi-dot` | — | colour = token | Six near-identical 7px dot rules. |
| Chips `.st-chip` (`:1330`), `.ir-chip` (`:1728–1731`), `.hist-auto` (`:1424`), `.dp-chip` (`:513–518`, `aria-pressed`), `.matter-lib-btn` (`:308–313`), `.font-row .fl-file` (`:986`) | — | pass/fail/warn/nc colour classes on `.st-*` (`:1333–1336`) | Five chip shapes with different padding and radius. |
| Verdict banner `.st-verdict` | `:1315–1322` | `.st-v-ready` / `.st-v-notReady` / `.st-v-cantConfirm` | The store-ready result. Honest three-state, never fake-green. |

### 1.4 Popovers

All are hand-positioned. There is no shared popover, positioning or dismissal helper.

| Popover | CSS | Built | Open/close | ARIA |
|---|---|---|---|---|
| Save popover `.local-pop` | `:203–211` | static `:1841` | `toggleLocalPop()` `:35311`; Escape `:35354` | `role="dialog"`, `aria-labelledby`; trigger has `aria-haspopup="dialog"` + `aria-expanded` |
| Read Aloud `#raPop` | `:1598–1622`, `:591–593` | static `:2019` | `hidden` toggle; repositioned by `tbPlaceRaPop` | `role="dialog"` |
| Dictation `#dictPop` | `:448–460`, `:510–520` | JS `:36829`; `dictPopOpen()` `:36835`, `dictPopClose()` `:36875` | `.open` class; Escape `:37150` | `position:fixed`, `z-index:98` |
| Zen sound `#zenScenePop` | `:766–787` | JS `:35505–35518` | `.open`; trigger `aria-expanded` | `role="menu"`, options `role="menuitemradio"` |
| Zen section index `#zenIndex` | `:903–919` | JS (zen block `:35548+`) | `.open` | — |

Each uses one of three show/hide mechanisms: the `hidden` attribute, an `.open` class, or `style.display`.
Screenshots: `[04-local-popover]`, `[08-readaloud-popover]`, `[09-dictation-popover]`, `[20-zen-sound-popover]`,
`[21-zen-dock-index]`.

### 1.5 Modals

- CSS: `.modal-back` `:1167–1171` (backdrop `rgba(18,14,8,.48)` with `backdrop-filter: blur(3px)`), `.modal`
  `:1172–1181` (560px, `.modal.wide` 920px `:1516`), size overrides `.piv-modal` `:1245`, `.ins-modal` `:1345`,
  `.ir-modal` `:1726`, `.acx-modal` `:1794`, and an entry animation `beukRise` `:1447–1448` (switched off under
  reduced motion `:1490`).
- Instances: 19 static `.modal-back` in markup (count script: html=19) and one built by JS (`modalBetaComments`,
  `:37999`). Live count 20.
- Opening: there is **no shared helper**. 24 occurrences of `classList.add("open")` (`grep -c`; modals plus a few popovers and bars) (e.g. `:14905`, `:20932`,
  `:22586`, `:27572`). Closing: each modal's own buttons. Escape is handled by one global listener
  (`:27840–27848`) that closes the topmost `.modal-back.open`, with special cases for `modalConfirm`, `modalAuth` and
  `modalShelf`.
- Stacking: each modal carries an inline `style="z-index:…"` from 65 to 80 (§2.5).
- ARIA: every modal has `role="dialog" aria-modal="true" aria-labelledby` (markup count: 21 `role="dialog"`, 19
  `aria-modal`, 20 `aria-labelledby`). Searching the whole file (`aria-selected|tabpanel|inert|focusTrap|trapFocus|
  returnFocus|lastFocus`) found **no focus-trap or focus-return helper**. The only matches were the language menu's
  `aria-selected` (`:3561`, `:3576`). That grep does not prove focus is never managed per modal (for example
  `focusEditor()` after auth/shelf, `:27847`). It does show there is no shared mechanism. A library `Dialog` must
  provide trap + return.
- Screenshots: `[14-modal-settings]`, `[15-modal-export]`, `[16-modal-insights]`, `[17-modal-goals]`,
  `[18-modal-history]`, `[23-modal-settings-candlelight]`.

### 1.6 Toasts

- `toast(msg, iconName, action)` at `index.html:15787–15802`: it builds a `div.toast` with a Lucide icon and an
  escaped message, plus an optional `.toast-action` button. It auto-dismisses after 3.4 s (6 s when there is an
  action).
- Container `#toasts` (`:3089`, `aria-live="polite"`); CSS `:1546–1553`. The toast is inverted (`--ink` background,
  `--panel` text).
- Call sites: `grep -o 'toast('` returns a token count of 526 (upper bound; it includes the definition and
  `toast(t(...` nesting).
- Note: `#toasts` (z 80) ties with `#modalConflict` (z 80, `:3030`). DOM order puts the toasts on top.
  `[10-toast]` and the toast visible inside `[14-modal-settings]` confirm toasts paint over modals.

### 1.7 Tabs and segmented controls

- Center tabs `.ctab`: CSS `:374–383`, markup `:1935–1937` (`role="tablist"`, two `role="tab"`). Switching is done by
  `setCenterTab()` at `:18428`, which toggles `.active` and `style.display` on
  `#panelContent` / `#panelType`. **No `aria-selected`, no `role="tabpanel"`, no arrow-key handling** (the grep in
  §1.5 found no `aria-selected` outside the language menu).
- Mobile pane tabs `#mobileTabs` (`:1869–1874`, CSS `:1768–1778`): `<nav>` with plain buttons and `.active` only;
  `setMobilePane()` follows `setCenterTab`.
- Segmented control `.seg` (`:964–966`): 5 instances (`segParaMode` `:2120`, `segFlourishPos` `:2182`,
  `segImgDisplay` `:2536`, `cmBgSeg` `:2629`, `.piv-zoomseg` `:3072`), plus the theme creator builds more in JS (`:18184`, `:18186`). 14 live buttons in the measured state.
  **Selection is `.active` only, with no `aria-pressed` or radio semantics** (`:2121–2122`).
- Radio-like grids: `#platformGrid` and `#trimGrid` carry `role="radiogroup"` (`:2344`, `:2424`). What roles their
  JS-built children carry was NOT MEASURED.

### 1.8 Disclosures (round-4 collapsibles and `<details>`)

- **Outline group toggles** `.group-label.group-toggle` (BEUK:sidebar), CSS `:345–356`, built in `renderSidebar()`
  `:15886–15889`: `aria-expanded`, `aria-controls`, an accessible name with the count (`side.groupCount`), and a
  chevron rotated by `aria-expanded` that mirrors under RTL (`:353`). Folded state is a per-device pref
  (`beuk.sidebar.v1`, `:15814`). 3 live.
- **Statistics disclosure** `.side-status-head` (`:332–342`, markup `:1911–1912`): `aria-expanded` and
  `aria-controls`, body `hidden`. 1 live. `[05-sidebar-outline]` vs `[06-sidebar-stats-open]`.
- **Matter library toggle** `.matter-lib-toggle` (`:298–306`, built by `renderMatterLib()` `:16865`): "Add a page" in
  `[01]`.
- **Native `<details>`**: `.acct-box` (`:1459–1460`, markup `:2995`) and `.ir-group` (`:1734–1738`, marker hidden).
  1 live in the measured state.

That is three disclosure implementations (button + `aria-expanded`, `.matter-lib-toggle`, `<details>`) with three
chevron treatments.

### 1.9 Form controls

| Control | CSS | Live | Notes |
|---|---|---|---|
| Text input / select / textarea `.txt-input` | `:386–391` | 65 `.txt-input` (27 `input[type=text]`, 30 `select`, 7 `textarea`) | Focus = accent border + 3px `--accent-soft` ring. `select.txt-input` sets `appearance:none` **but draws no chevron** (`:391`), so in `[07]` and `[14]` selects look exactly like text inputs. |
| Field label `.field-lab` | `:385` | 69 | Uppercase 10.5px/700 with `.12em` tracking. |
| Second input skin `.pm-row select`, `.pm-fields input`, `.piv-ctl select`, `.acx-grid input/select` | `:1234–1237`, `:1250`, `:1797` | — | Background `--panel` instead of `--panel-2`, 7px×9px padding, no focus ring rule. A second, inconsistent input style. |
| Number inputs | markup `:2443–2446` | 10 | Unstyled except via `.pm-fields input`. |
| Toggle `.switch` | `:405–414` | 11 | A `<button aria-pressed>` with a `::after` knob. **3 of 11** static switches (`tglJustify` `:2149`, `tglHyph` `:2155`, `tglRecto` `:2427`) have an English-only `aria-label` with no `data-i18n-aria` hook. |
| Switch row `.switch-row` | `:401–404` | 13 | Label + description + control. Restyled inline in 6+ places (`style="border:none; padding:…"`, e.g. `:2147`, `:2425`). |
| Slider `input[type=range]` | `:962–963` (`accent-color`) | 6 | Value echoed by a `.range-val` span inside the label (`:2098`). |
| Colour input `.cm-color` | `:1649` | 3 | Native picker. |
| File inputs | `:2548–2553` and others | — | Hidden (`style="display:none"`) and triggered by buttons. |

Screenshots: `[07-editor-controls]`, `[11-typography-top]`, `[12-typography-ornaments-flourishes]`,
`[14-modal-settings]`, `[17-modal-goals]`.

### 1.10 Menus and dropdowns (language)

- `.lang-wrap` / `#btnUiLang` / `.lang-menu` / `.lang-opt`: CSS `:1568–1589`, markup `:1852–1855`, built by
  `buildUiLangMenu()` and synced by `syncUiLangMenu()` (`:3555–3578`). The 13 options are listed in
  `UI_LANG_ORDER` (`:3259`).
- ARIA: the trigger has `aria-haspopup="listbox" aria-expanded`, the menu `role="listbox"`, each option
  `role="option" aria-selected`. Opening and closing are `toggleUiLangMenu()` / `closeUiLangMenu()`. Arrow-key
  navigation was NOT MEASURED.
- The menu anchors with `inset-inline-start: 0` (`:1574`), so it follows RTL.
- `[03-lang-menu]`.

### 1.11 Lists (the outline `.sec-item` and its relatives)

- `.sec-item`: CSS `:257–295` (24 rules), built in `renderSidebar()` `:15865–15986`. 29 live with the sample loaded.
- States: `.active`, `.excluded`, `.part-item`, `.in-part`, `.og-hidden`, drag states (`.dragging`, `.drop-before`,
  `.drop-after`). Row tools `.sec-tools` show on hover or `.active`.
- Accessibility: see §1.1 (role=button containing buttons). Drag-and-drop has a keyboard alternative in the up/down
  `.mini` buttons. Cross-tier moves are refused with a toast.
- Other row lists with their own CSS: `.desk-item` (reading-desk rail, `:1069–1078`, 29 live), `.insp-file`
  (`:1519–1527`), `.lang-opt`, `.zs-opt`, `.zi-row`, `.hist-row`/`.hist-sec-row` (`:1421–1436`), `.shelf-row`
  (`:1469–1473`), `.arc-row` (`:1476–1480`), `.bs-row` (`:1208–1212`), `.flourish-row` (`:977–980`), `.st-row`
  (`:1325`), `.ir-item` (`:1740`), `.check-list li` (`:1187–1189`). That is **at least 14 list-row
  implementations**.

### 1.12 Cards and panels

- Picker cards (`.preset-card` 15 live, `.platform-btn` 11, `.trim-btn` 24, `.orn-btn` 13, `.img-cell`,
  `.cm-*-cell`): see §1.1.
- Info panels that share one look (panel background, 1px line, 9px radius, 11–13px padding, 12.5px text) but have
  separate rules: `.platform-detail` `:1203`, `.print-note` `:1225`, `.val-summary` `:1285`, `.a11y-clean` `:1302`,
  `.cr-box` `:1481`, `.ir-clean` `:1732`, `.bulk-summary` `:1709`, `.st-entry` `:1307`, `.import-summary` `:1716`,
  `.auth-note` / `.auth-err` `:1458`, `:1465`. That is **11 copies of one "note box"**.
- `.auto-note` (`:595–599`) has CSS, but no element carrying that class was found (count script: html=0, js=0), and
  self-checks assert `#autoNote` is absent. It is probably dead CSS (LEAD, not confirmed).
- Section blocks: `.fmt-sec` (Export, `:1192–1195`, 11 live), `.ins-sec` (`:1346`), `.pm-block` (`:1230`), `.cm-wrap`
  (`:1661`).

### 1.13 Tooltips

**There is no tooltip component.** `grep -ci tooltip` over the CSS returns 2, and both are comments (`:188`, `:555`).
Tooltips are native `title` attributes: 15 static ` title="`, 24 in JS strings, 165 live `[title]`. 14 static
`data-i18n-title` hooks translate them. Native `title` is not reachable by keyboard or touch. A library `Tooltip`
would be new behaviour, not a port.

### 1.14 Progress bars and meters

| Bar | CSS | Live | Fill colour |
|---|---|---|---|
| Matter progress `.prog-track/.prog-fill` | `:362–366` | 3 | `--gold` |
| Goal progress `.goal-track/.goal-fill` | `:1383–1385` | (only with goals) | `--gold` |
| Word frequency `.ins-freq-track/.ins-freq-bar` | `:1354–1355` | Insights modal | `--ins-a` |
| Dialogue share `.ins-dlg-track/.ins-dlg-seg` | `:1370–1371` | Insights modal | `--ins-b` |
| Calendar day fill `.cal-fill` | `:1407` | Goals modal | `--gold` (opacity) |

That is four track heights (4, 5, 9 and 10px) and two border treatments. None carries `role="progressbar"` or
`role="meter"` in its CSS-defined markup (the numbers sit in adjacent text, e.g. `.prog-pct`). `[06]`, `[16]`,
`[17]`.

### 1.15 Empty states

Each has its own class and copy, and they share a dashed-border look:

`.flourish-empty` `:981` · `.bs-empty` `:1213` · `.shelf-empty` `:1474` · `.img-empty` `:1500` · `.piv-empty` `:1275`
· `.ins-empty` `:1351` · `.ins-none` `:1360` · `.cm-art-empty` `:1654`. That is **8 empty-state rules**.
`[12-typography-ornaments-flourishes]` shows "No flourishes yet…". `[00-first-open]` is the empty desk itself
(placeholder "Start writing…", preview "This section has no text yet").

### 1.16 Zen overlay controls

These are built by JS on first use and removed on exit (`index.html:35455–35600`; the removal list is at `:35593`).

- `#zenCluster` (`:738–743`): the presence dot `#zenMark` plus the pills `#btnZenSound` (`aria-pressed`),
  `#btnZenScenes` (`aria-haspopup`/`aria-expanded`) and `#btnZenDictate` (`aria-pressed`). Built at `:35462`.
- `#zenScenePop` (§1.4), `#zenDock` (`:869–875`) holding `#zenNav` (`role="navigation"`, `:35550`; `.zn-btn`
  prev/next and `#zenNavName`), `#zenIndex`, and `#zenPill` (static `:2818`, `role="status"`, word counts and
  `#btnZenExit`).
- Atmosphere layers (`#zenArt`, `#zenFlash`, `#zenTitle`; `:641–736`) are `aria-hidden` and `pointer-events:none`.
  Each has a `prefers-reduced-motion` branch (`:923–946`).
- Observation from `[19-zen]`: `#zenNav` rests at `opacity: .46` (`:883`) and, in this chapter, sits over the plate
  picture, so its label is low-contrast until hover or focus. That is by design ("a whisper until touched",
  `:876`). Any rebuild should keep the behaviour and check the contrast.
- `[19-zen]`, `[20-zen-sound-popover]`, `[21-zen-dock-index]`.

### 1.17 Bars and banners

`.update-bar` (`:223–229`, `role="status"`, "A new Beuk is ready"), `#sceneBar` (`:480–490`), `#langBar`
(`:497–509`, `role="status" aria-live`), `#editorWordBar` (`:474–477`, `aria-live`), and the editor toolbar
`.toolbar`/`.tool-group`/`.tool-sep`/`.tool-break`. The toolbar layout is computed by `tbLayout()` (`:36431`):
groups never split, and labels fold to icons in three steps. `[07]`, `[25-topbar-toolbar-de]`.

### 1.18 Device frames and the hardcover preview (domain components, not primitives)

`.frame-*` (10 devices, `:1009–1031`) and `#deviceFrame`/`.screen`/`.run-head`/`.run-foot`; the CSS-3D hardcover
`.hc-*` (`:1080–1163`); the print-interior spread `.piv-*` (`:1241–1282`); the cover 3D stand `.cm3d-*`
(`:1679–1698`). These hold most of the hard-coded colours (§2.4). They are **book rendering, not UI chrome**, and
belong in the "stays vanilla" column (§4).

### 1.19 Layout shell

`#app` / `#topbar` / `#panes` (3-column grid 292 / 1fr / 452, `:237`; 262 / 1fr / 400 at ≤1180px, `:1766`; one
column plus `#mobileTabs` at ≤1023px, `:1767–1792`) / `.pane`. RTL swaps the pane hairlines (`:1561–1562`).
`[01]`, `[24]`, `[26]`, `[30]`.

### 1.20 Help pages' components (`client/help/`, `client/help/warmth.css`)

There are 12 HTML pages (1,112 lines including `warmth.css` 172 and `billing-gate.js` 69). They have their **own
token set** (`warmth.css:5–13`): `--paper #faf7f2`, `--paper-deep #f3eee3`, `--ink #1c1917`, `--ink-soft #57534e`,
`--line #ddd6c8`, `--amber #92400e`, `--amber-soft #fef3c7`.

Components (class counts from `grep -o 'class="[^"]*"' client/help/*.html | sort | uniq -c`):

| Component | CSS (warmth.css) | Uses |
|---|---|---|
| `.site-head` / `.wordmark` / `.subbrand` / `.site-nav` | `:26–53` | 12 each |
| `.page` | `:55` | 12 |
| `.lede` | `:84` | 12 |
| `.site-foot` / `.foot-note` | `:159–171` | 12 each |
| `.back-link` | `:172` | 11 |
| `.trouble` (troubleshooting box) | `:116–122` | 10 |
| `.error-entry` / `.says` (decoder) | `:124–136` | 10 each |
| `.guide-list` | `:94–104` | 1 |
| `.support-block` / `.support-email` | `:106–114` | 1 each |
| `.status-line` | `:86` | 1 (`help/index.html:29`) |
| `.kofi-jar` / `.kofi-button` / `.kofi-note` | `:137–157` | Injected by the server: `kofiJarHtml()` `src/warmth/pages.ts:54–66` |
| Support nav link | — | Injected: `supportNavHtml()` `pages.ts:71–73` |
| Founders' Shelf form | **no CSS** | `help/index.html:94–125`. Inputs render with browser defaults (`[27-help-index]`). |

The help screenshots were rendered through the **real** `fillSlots()` (`src/warmth/pages.ts:82–98`) by
`.scratch/render-help.ts`. Config values were copied from the defaults in `src/config.ts:255–259`, plus a placeholder
`KOFI_URL=https://ko-fi.com/PLACEHOLDER-not-a-real-page` so the jar component renders. On the static server
`billing-gate.js` gets no `/api/billing/status` and leaves the jar visible (`display: block`, `visibility: visible`
measured), as its header comment says it should. The help pages link **no web font**: `grep -l fonts.googleapis
client/help/*` matches nothing. So `"EB Garamond"` in `warmth.css:21` renders only where it is installed locally.
`[27-help-index]`, `[28-help-error-decoder]`, `[29-help-guide]`.

---

## 2. Design tokens

### 2.1 Custom properties (`index.html:49–89`, plus `:1343–1344`)

Usage = `var(--x)` occurrences in CSS (47–1816) / static markup `style=""` / JS strings (<2000-char lines).

| Token | Paper (`:root`) | Candlelight (`:root[data-theme="candlelight"]`) | CSS / HTML / JS |
|---|---|---|---|
| `--bg` | `#ece5d8` | `#100e0c` | 2 / 0 / 0 |
| `--panel` | `#faf7f2` | `#181715` | 49 / 0 / 2 |
| `--panel-2` | `#fffdf8` | `#22201d` | 45 / 0 / 2 |
| `--panel-3` | `#f1ebdf` | `#262320` | 19 / 0 / 1 |
| `--ink` | `#1c1917` | `#faf7f2` | 81 / 0 / 0 |
| `--ink-2` | `#44403c` | `#d8d2c6` | 76 / 0 / 0 |
| `--muted` | `#78716c` | `#a39e93` | 121 / 4 / 5 |
| `--line` | `#ddd6c8` | `#38342e` | 70 / 0 / 3 |
| `--line-2` | `#cfc6b4` | `#4a453c` | 66 / 0 / 2 |
| `--accent` | `#92400e` | `#e0973b` | 83 / 1 / 4 |
| `--accent-soft` | `#f3e3d0` | `#3a2c1a` | 26 / 0 / 0 |
| `--accent-ink` | `#fff8ec` | `#201304` | 5 / 0 / 0 |
| `--gold` | `#a3802f` | `#c9a959` | 35 / 0 / 4 |
| `--good` | `#3d7a4a` | `#7fbf8f` | 9 / 0 / 0 |
| `--bad` | `#b3352b` | `#e58a7a` | 19 / 0 / 1 |
| `--shadow` | `0 10px 30px rgba(56,42,20,.16)` | `0 10px 30px rgba(0,0,0,.55)` | 22 / 0 / 0 |
| `--ui-font` | `"Karla","Inter",system-ui,…,"Noto Sans Arabic","Geeza Pro",Tahoma,sans-serif` | (same) | 4 / 0 / 0 |
| `--mono-font` | `"IBM Plex Mono",ui-monospace,monospace` | (same) | 25 / 6 / 14 |
| `--ins-a` (`:1343`) | `var(--accent)` | `var(--accent)` | 1 / 0 / 1 |
| `--ins-b` (`:1343`) | `#14665a` | `var(--gold)` | 1 / 0 / 3 |

Local, component-scoped properties: `--zao` / `--zao-lo` (`#zenArt`, `:643`, `:645`), `--zwp` (`#zenFlash`, `:679`,
`:684`, `:939`), `--tg-grow` (toolbar group grow, `:560`, set by JS), `--hc-cloth` and `--hc-front-z` (hardcover,
`:1107`, `:1127`, set by JS).

Theme switching: the pre-paint script (`:16–30`) sets `data-theme="candlelight"` only for a saved
`beuk.theme.v1 = candlelight`. `applyTheme()` (`:3616–3624`) sets or removes the attribute and persists the choice.
Paper is the default whatever `prefers-color-scheme` says (by design, comment at `:3598`). `<meta name="color-scheme"
content="light dark">` (`:6`) and per-theme `color-scheme` (`:50`, `:72`) are set.

### 2.2 Type scale (CSS 90–1816, `grep -oE 'font-size: *[0-9.]+(px|em|rem|pt)'`)

`12.5px ×73 · 12px ×48 · 11.5px ×32 · 13px ×29 · 10.5px ×20 · 11px ×13 · 13.5px ×12 · 10px ×7 · 14px ×4 · 14.5px ×4 ·
16px ×4 · 19px ×4 · 21px ×3 · 9.5px ×2 · 15px ×2 · 15.5px ×2 · 17px ×2 · 17.5px ×2 · 9px, 16.5px, 18px, 18.5px, 20px,
40px ×1 each`, plus `8.5pt`/`9.5pt` (print view) and three em sizes. Body is 14px (`:96`).

That is **22 distinct px sizes**, with nine of them between 9px and 13.5px in half-pixel steps. A library type scale
of about 6 steps (for example 10.5 / 11.5 / 12.5 / 13.5 / 16 / 21 px) would cover roughly 90% of uses, but
collapsing the half-steps is a **visual change** that needs V's sign-off.

Weights: `600 ×51 · 700 ×45 · 500 ×16` (no 400 declared except by inheritance).

Families (literal `font-family:` declarations): `var(--mono-font) ×25`, `"EB Garamond", Georgia, serif ×17` (not
tokenised: a missing `--serif-font` token), `inherit ×7`, `var(--ui-font) ×4`.

Letter-spacing: 13 distinct values (`.12em ×6`, `.08em ×4`, `.1em ×3`, `.14em ×3`, … `0.09em ×1`). Uppercase
"eyebrow" labels use `.1em`, `.12em`, `.13em` and `.14em` interchangeably (`:254`, `:385`, `:772`, `:956`, `:1387`).

### 2.3 Spacing, radius and shadow (measured frequency)

- **gap**: `8px ×35 · 10px ×22 · 7px ×20 · 6px ×17 · 4px ×13 · 9px ×10 · 14px ×10 · 12px ×8 · 5px ×4 · 3px ×2 · 2px ×2
  · 11px ×2 …` (25 distinct values). The 6 / 7 / 8 / 9px cluster is effectively one step.
- **border-radius**: `9px ×26 · 8px ×25 · 999px ×18 · 50% ×13 · 10px ×11 · 7px ×9 · 99px ×8 · 6px ×7 · 5px ×6 · 4px ×6 ·
  3px ×5 · 12px ×5 · 2px ×3 · 14px ×3 · 11px ×3 …` (about 28 distinct values including the device frames).
  Flags: **`999px` and `99px` are the same pill** (18 + 8); **8 / 9 / 10px** are three "card" radii used for the
  same role.
- **box-shadow**: `var(--shadow) ×13`; focus/selected ring `0 0 0 3px var(--accent-soft) ×11` (it should be a token,
  e.g. `--ring`); `0 0 0 2px var(--accent-soft) ×2`; the rest are one-offs (device bezels, hardcover, print page).

### 2.4 Hard-coded colours outside the tokens

CSS 90–1816 holds 36 distinct hex values, plus 86 `rgba()`/`rgb()` occurrences. Most belong to device bezels and
screens (`#0a0a0c ×4`, `#2c2c2e`, `#f6f4ee ×3`…), the hardcover and print paper (`#f3ead8`, `#e9dcc0`, `#efe5d0`,
`#f8f1e1`), and the zen art (`#241d15`, `#c9a959`). Those are **book or scene materials**, and the doc proposes
keeping them local.

Chrome-level one-offs worth tokenising:
- the modal backdrop `rgba(18,14,8,.48)` (`:1168`);
- the active-row shadow `rgba(30,24,14,.06)` (`:263`);
- the Candlelight preview gradient `#2e2416` (twice, `:368`, `:1152`);
- `--ins-b: #14665a` (`:1343`), the only teal in the system.

Near-duplicates:
- `#c9a959` is written literally (`:645`) where `--gold` (Candlelight) has the same value.
- `--panel #faf7f2` (Paper) equals `--ink` (Candlelight).
- Help pages: `--ink-soft #57534e` vs studio `--ink-2 #44403c`; `--amber-soft #fef3c7` vs studio `--accent-soft
  #f3e3d0`; `--paper-deep #f3eee3` vs `--panel-3 #f1ebdf`. **The two surfaces do not share tokens.**

### 2.5 z-index layers (every declaration, CSS and inline)

| z | What | Where |
|---|---|---|
| −1 | `#zenArt`, `#deskMeasure`, `.piv-measure` | `:642`, `:1079`, `:1276` |
| 3 / 5 | `.hc-gutter` / `.hc-leaf` (inside the hardcover) | `:1140`, `:1144` |
| 30 | `#topbar` | `:110` |
| 60 | `.modal-back` (base), `.local-pop`, `.lang-menu`, `#raPop` | `:1169`, `:204`, `:1574`, `:1599` |
| 65–68 | `modalImage` 65, `modalFootnote`/`modalAuth`/`modalShelf` 66, `modalScene` 67, `modalCoverMaker`/`modalImportReport` 68 | inline `style`, `:2523`–`:2974` |
| 70 | `modalStore`, `modalInspector`, `modalInsights`, `modalGoals`, `modalHistory`, `modalBetaComments` (JS `:37999`) | inline |
| 75 / 76 | `modalPrint` / `modalPrintView` | `:3044`, `:3058` |
| 78 | `modalConfirm` | `:3015` |
| 80 | `#toasts` **and** `modalConflict` (tie) | `:1546`, `:3030` |
| 90 / 91 | `#zenPill` / `#zenDock`; `#zenCluster` | `:623`, `:870`, `:739` |
| 95 / 96 / 97 / 98 | `#zenFlash`, `#zenTitle`, `#zenScenePop`, `#dictPop` | `:678`, `:727`, `:767`, `:449` |

Flags: the popovers share z 60 with the modal base, so they sit level with an unstacked modal. Modal order is encoded
in 16 inline styles rather than a scale. A library needs a named layer scale
(`base / sticky / popover / modal / modal-nested / toast / zen-overlay`).

---

## 3. Constraints any library must respect

### 3.1 i18n

- `t(key, params)` (`index.html:3475–3484`): named `{placeholders}`, `…Plural` keys picked when `n !== 1`, English
  fallback at runtime only.
- Static hooks re-applied by `applyUiLang()` (`:3500–3533`): `data-i18n` (404 in markup), `data-i18n-html` (1),
  `data-i18n-title` (14), `data-i18n-ph` (19), `data-i18n-aria` (29). `applyUiLang()` then calls about 20
  `…OnLangChange` re-renderers (`:3511–3532`). **Any component that renders text must re-render on a language
  change.** In React terms, the locale must be context/state, not a one-time read.
- 13 locales (`UI_LANG_ORDER`, `:3259`), measured live: **1,404 keys in every locale**. The project rule is that every
  new or changed key ships in all 13. A component library adds no strings by itself, but stories and examples must
  use real keys, not literals.
- German and other long-word locales: `[25-topbar-toolbar-de]`. The toolbar's `tbLayout()` measures real label
  widths (`:36431`), so a toolbar component must keep that measure-then-place pass.
- Number and date formatting go through `Intl` (`fmtNum` `:3245`, `fmtDateIntl` `:3485`).

### 3.2 RTL

`applyUiLang()` sets `dir="rtl"` for `ar` (`:3503`). **Only the chrome flips. The editor and book preview keep the
book's own direction** (comment `:3256–3258`; `#pageFlow` carries its own `lang`, `:2221`). The CSS mixes logical
properties (`inset-inline-*`, `margin-inline-start`, `text-align:start`) with physical ones plus RTL overrides
(`:1556–1562`, `:353`). Components must use logical properties only and must not inherit `dir` into book-rendering
surfaces. `[24-studio-rtl-ar]` shows the mirrored chrome with the manuscript still LTR.

### 3.3 Theming

There are two themes on a single attribute, `:root[data-theme="candlelight"]`, with Paper as the default (no
attribute). Pre-paint is done by an inline script before CSS (`:16–30`). Components must read tokens via `var()` only;
a hard-coded colour breaks Candlelight. Some components are theme-aware beyond tokens (logo filter `:134`, zen art
day/night `:697–699`, backdrop strengths `:841–843`). Book pages in print preview are always paper ("print is print",
`:1241–1244`).

### 3.4 CSP (enforced; Caddyfile:21–81)

`script-src 'self' 'unsafe-inline'` with **no `'unsafe-eval'`**; `style-src 'self' 'unsafe-inline'
https://fonts.googleapis.com`; `font-src 'self' data: https://fonts.gstatic.com`; `connect-src` adds only
Pexels/Openverse/Google Fonts.

Consequences:
- **No CDN script hosts.** A React and component bundle must be served from the studio's own origin (vendored under
  `client/assets/…`, like `assets/vendor/*.js` with SRI, `index.html:43–46`) or inlined.
- **No eval.** Any runtime that compiles templates or uses `new Function` at runtime is out. A production React build
  must be verified violation-free with the same method the Caddyfile comment describes (headless click-through with a
  `securitypolicyviolation` listener). That verification is NOT DONE here.
- CSS-in-JS that injects `<style>` is allowed by `'unsafe-inline'`, but plain CSS files (from `'self'`) keep the
  policy honest and need no change. **Fonts: reuse exactly the existing Google Fonts link (`:32–35`); do not widen
  the CSP.**

### 3.5 Hosting, service worker and offline

- The artifact hosting serves **only `index.html` + `assets/`** (`client/assets/sw.js` header). Any bundle must live
  under `client/assets/`.
- The shell is precached by name in `BEUK_SHELL` (`client/sw.js:32–48`, twin `client/assets/sw.js`; cache
  `beuk-shell-v4`, `:23`). A new bundle file must be added to **both** lists, and the cache bumped once, or the studio
  breaks offline. That bump is owned by whichever unit ships the files.

### 3.6 Local-first saving and state

The book lives in the global `state`, round-tripped by `serializeBook()`/`applyBookDoc()` and saved to IndexedDB, with
shelf sync using revision / `If-Match`. Saving is triggered from DOM events (a capture-phase `input` listener on
`#panes`/`#modalSettings` calls `noteBookEdited()`, `:27836–27839`). React islands with controlled inputs must still
emit real `input` events in those subtrees, or call the same `noteBookEdited()`. Otherwise edits silently stop
marking the book dirty. **This is the highest-risk integration point.**

### 3.7 Self-checks

There are 228 in-studio checks (`SELF_CHECKS`, `:28646`; async `:34704`), many asserting DOM ids, classes and
structure directly (for example the zen teardown check at `:32918` and the `#autoNote` checks). Client-only check ids
are mirrored in `tests/housekeeping.test.ts` and `src/housekeeping/registry.ts`. Any swap of a primitive must keep
every check green by fixing the product, never by loosening the assertion.

---

## 4. Phased plan: a React component library consumable by Claude Design

All effort numbers are **ESTIMATES**. They assume one experienced engineer working with Claude, the current file as
measured above, and V reviewing visuals per phase. They do **not** include building or validating the Claude Design
`/design-sync` side.

> **Assumption to confirm (not sourced):** the brief says Claude Design consumes "a dist/ the converter bundles". The
> exact package contract `/design-sync` expects (entry points, how tokens are declared, whether stories are read,
> React version) was **not available to this unit** and is **not described here**. Phase 0's first task is to get
> that contract in writing. Every phase below depends on it.

Proposed layout (new, nothing exists yet): `packages/beuk-tokens/`, `packages/beuk-ui/` (React), each building a
`dist/` (ESM + CSS). The studio consumes a **vendored, pinned copy** under `client/assets/ui/`, precached by the
service worker. No CDN, per CSP.

### Phase 0: tokens package

- **Scope:** extract §2.1 into `beuk-tokens` as data (JSON) emitting `tokens.css` (both themes on the same
  `:root[data-theme]` selectors), plus a JS/TS export for Design. Add the missing tokens the inventory found:
  `--serif-font`, `--ring` (`0 0 0 3px var(--accent-soft)`), `--backdrop`, a radius scale (pill / card / control), a
  z-index scale (§2.5), and the help-page tokens mapped onto the studio set (or kept as a declared second palette).
  The studio keeps its inline `:root` until the generated file is byte-equivalent, then switches.
- **Effort (ESTIMATE):** 2–4 days, assuming tokens stay value-identical (no visual change). Plus 1–2 days if V
  decides to collapse the type and spacing half-steps (§2.2–2.3), which is a visual change.
- **Risks:** a visual drift if any value is rounded; the help pages diverge if left out; the pre-paint script must
  still run before CSS.
- **Stays vanilla:** everything else.
- **Exit criteria:** `tokens.css` diffed equal to `index.html:49–89` values; screenshots `[01]` and `[22]` match
  before and after pixel-for-pixel (or with an approved diff); 228 self-checks unchanged (227 + the known
  `sample.spreadbleed`); the `/design-sync` contract written down.

### Phase 1: leaf primitives, with stories and usage examples

- **Scope:**
  - `Button` (variants that exist today: default, primary, plus the tool, side, mini, page and chip sizes; **decide**
    `accent` / `active` deliberately, since today they render as default, §1.1);
  - `IconButton` (required `label`);
  - `Icon` (a Lucide wrapper with the same names);
  - `Pill`/`StatusDot`, `Chip`;
  - `TextField`, `Select` (with a visible chevron, a gap today), `Textarea`, `Switch` (`aria-pressed` or
    `role="switch"`, translated label required), `Slider` (+ value), `SegmentedControl` (radio semantics, a gap
    today), `FieldLabel`;
  - `ProgressBar` (`role="progressbar"` + value text), `EmptyState`, `NoteBox` (folding the 11 copies in §1.12).

  Each gets a story or usage example showing Paper, Candlelight, `ar` RTL and `de` long labels, using real i18n keys.
- **Effort (ESTIMATE):** 2–3 weeks, for about 15 primitives at roughly 1 day each including stories and a11y tests.
- **Risks:** bundle size: React + ReactDOM + the library is a new download for every visitor and must be measured
  (**NOT MEASURED** here) against the current 11.26 MB page; CSP verification of the production build; a second
  styling system existing alongside the 1,770 lines of inline CSS during migration.
- **Stays vanilla:** all of `index.html`. Phase 1 ships only the package and its stories.
- **Exit criteria:** every primitive is rendered in both themes, LTR and RTL, keyboard-operable, with an axe-style
  check clean; its visual matches the existing vanilla counterpart's screenshot (or an approved change); `dist/`
  builds deterministically.

### Phase 2: composite components

- **Scope:**
  - `Dialog` (with focus trap, focus return and a z-layer, none of which have a shared mechanism today, §1.5);
  - `Popover` (one positioning and dismissal model for the five in §1.4);
  - `Menu`/`Listbox` (language);
  - `Tabs` (with `aria-selected` / `tabpanel`, missing today);
  - `Disclosure` (one model for the three in §1.8);
  - `Toast` + toaster (the same `toast(msg, icon, action)` contract);
  - `ListRow` (a real button row with separate tool buttons, fixing §1.11);
  - `PickerCard` grid (radio semantics);
  - `Toolbar` (porting `tbLayout()`'s measure-then-break behaviour);
  - `SavePill` (the honest-state machine from `renderLocalPill()`).
- **Effort (ESTIMATE):** 3–5 weeks. `Toolbar` and `SavePill` alone are about 1 week each because their behaviour is
  specified in detail in code comments and self-checks.
- **Risks:** behaviour regressions in honest-status UI (the save pill must never show "Saved" when it isn't);
  keyboard and focus changes breaking self-checks that assert today's DOM.
- **Stays vanilla:** the studio itself.
- **Exit criteria:** each composite reproduces its current behaviour as enumerated by the self-checks that touch it
  (the list of check ids per component to be compiled in this phase); a11y gaps from §1 closed; stories for all
  states (for the save pill: checking, saving, saved, evictable, blocked, quota, error).

### Phase 3: incremental adoption inside `index.html` (islands, no big-bang rewrite)

- **Scope:** mount library components into existing containers one region at a time. Leaf-first order, least risky
  first:
  1. toasts (`#toasts`, a pure sink);
  2. the language menu;
  3. one modal (Goals or Insights: read-mostly);
  4. the Export modal's button rows;
  5. the sidebar dock and statistics disclosure;
  6. the outline list;
  7. the save pill;
  8. the editor toolbar (last: it touches the textarea and dictation).

  For each island: the vanilla markup is removed in the same commit, `icons()`, `applyUiLang()` and `…OnLangChange`
  hooks are bridged, the bundle is added to both `BEUK_SHELL` lists with one cache bump for the round that ships it,
  and `noteBookEdited()` wiring is proven (§3.6).
- **Effort (ESTIMATE):** 6–10 weeks for the regions listed. Book-rendering surfaces are not included.
- **Risks:**
  - **the 11 MB single file** (any edit is a surgical edit in a file Claude must not read whole; the
    `SAMPLE_IMAGES` line `:14251` must never be printed);
  - the service worker serving a stale shell after a bundle change;
  - **local-first saving** (dirty-marking and IndexedDB restore timing, `html[data-local-restore="pending"]` hides
    `#panes` until restore, `:172`);
  - the 228 self-checks;
  - two render systems coexisting (React re-renders vs. code that rebuilds `innerHTML`, e.g. `renderSidebar()`
    rewrites the whole list);
  - offline first-load must still work with the bundle cached.
- **Stays vanilla:** device frames, hardcover, print view, cover maker canvas, zen atmosphere, the editor
  `<textarea>`, the EPUB/print/DOCX builders, and all of `state`.
- **Exit criteria, per island:** 228 checks with only `sample.spreadbleed` failing; offline reload works after a
  service-worker update; CSP shows zero violations in the click-through; screenshots match; the island's old CSS is
  deleted (dead-rule count goes down, not up).

### Phase 4: sync to Claude Design

- **Scope:** publish `beuk-tokens` + `beuk-ui` `dist/` in the shape `/design-sync` requires (contract from Phase 0),
  run the sync, and verify a design produced in Claude Design maps back to the same component names and props as
  shipped code. Then keep the two in step: a release of `beuk-ui` re-runs the sync.
- **Effort (ESTIMATE):** 1–2 weeks, **highly uncertain** until the contract is known.
- **Risks:** a contract mismatch; drift if the studio keeps vanilla copies of components the library also owns
  (avoided by Phase 3's delete-in-same-commit rule).
- **Exit criteria:** one round-trip demonstrated (a component designed in Claude Design → code using `beuk-ui` →
  screenshot equal to the design), and V signs off.

**Total (ESTIMATE):** about 3–5 months of focused work to reach Phase 4 with the chrome on the library and book
rendering still vanilla.

### Alternative: keep vanilla + Web Components

- **Shape:** the same Phase 0 tokens package. Primitives become custom elements (`<beuk-button>`, `<beuk-dialog>`, …)
  written in plain JS, vendored under `client/assets/`, light-DOM or shadow-DOM styled with the same tokens.
- **For:**
  - no framework runtime to download, and no second render model fighting `innerHTML` rebuilds;
  - custom elements drop straight into the existing `'<button …>'` string templates (`renderSidebar()` could emit
    `<beuk-list-row>` with no React root);
  - the islands problem largely disappears;
  - CSP is unaffected (plain `'self'` scripts);
  - `data-i18n` hooks can keep working on light-DOM children.
- **Against:**
  - Claude Design's `/design-sync` path is described in the brief as consuming a (React) `dist/`, so Web Components
    may not map 1:1 to what Design generates. That is V's actual goal, and it was **not verified** either way;
  - shadow DOM complicates the global token, RTL and theme selectors and the self-checks' DOM queries (light DOM
    avoids this);
  - there is less off-the-shelf a11y tooling.

### Recommendation

**Do Phase 0 now regardless.** Tokens are needed by either path, and the inventory found real inconsistencies
(two pill radii, three card radii, 22 font sizes, 16 inline z-indexes, an untokenised serif and focus ring, help pages
on a separate palette, two button variants with no CSS).

**Then decide the component technology on one fact this unit could not establish: what `/design-sync` actually
consumes.**
- If it requires React components, take the React path but **only as islands in leaf-first order**, keeping book
  rendering, `state` and the textarea vanilla. A rewrite of an 11 MB local-first app with 228 behaviour checks is
  where most of the risk sits, and nothing in this inventory argues for doing it all at once.
- If Design can consume Web Components, or plain HTML + CSS classes driven by tokens, prefer the
  **Web Components / class-library path**. It matches how the studio already renders (string templates + `icons()`),
  adds no runtime, cannot fight the existing re-render model, and keeps the CSP and offline story unchanged.

Either way, Phase 1's first deliverables should be the ones that fix observed gaps: `Dialog` focus management, `Tabs`
semantics, segmented-control semantics, the select chevron, the `accent`/`active` button decision, and translated
switch labels.
