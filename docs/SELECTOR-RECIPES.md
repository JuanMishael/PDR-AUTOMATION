# Selector & Interaction Recipes

Practical patterns for tricky elements that come up in real apps (eBIMS and friends).
Reach for these when the **Pick** tool grabs something brittle, or when a plain
Click/Fill doesn't behave.

---

## jQuery UI autocomplete (suggestion dropdowns)

**Symptom:** You type into a search box, a dropdown of suggestions appears, and the
item you want has an `id` like `ui-id-73`. That id is **auto-generated and changes on
every search**, so never target it — and don't use **Pick** here, because Pick will
capture the dead id.

```html
<ul id="ui-id-1" class="ui-menu ui-autocomplete ...">
  <li class="ui-menu-item">
    <div id="ui-id-73" class="ui-menu-item-wrapper">TAGAYTAY CITY CAVITE</div>
  </li>
  ...
</ul>
```

**Anchor on the visible text instead** — that's the only stable thing:

```
.ui-autocomplete .ui-menu-item-wrapper:text-is("TAGAYTAY CITY CAVITE")
```

- `:text-is(...)` is an **exact** match. Use it (not plain `text=` "contains") because
  the label you want is often a substring of longer rows
  (e.g. `BGY KAYBAGAL EAST TAGAYTAY CITY CAVITE`). Exact match lands on the standalone row only.
- Scoping to `.ui-autocomplete` keeps the match inside the dropdown.
- Simpler unscoped equivalent: `text="TAGAYTAY CITY CAVITE"` (quotes = exact in Playwright).

**Recommended step sequence** (the dropdown is `display:none` and populated async):

```
When  →  Fill Input         #searchBox = "TAGAYTAY CITY CAVITE"
When  →  Wait for Selector  .ui-autocomplete .ui-menu-item-wrapper:text-is("TAGAYTAY CITY CAVITE")
When  →  Click              .ui-autocomplete .ui-menu-item-wrapper:text-is("TAGAYTAY CITY CAVITE")
```

The middle **Wait for Selector** step matters — it waits for that exact row to render
before clicking, instead of clicking into an empty/loading dropdown.

**Gotchas:**
- The menu **closes on blur** — don't put anything that moves focus between the Fill and the Click.
- If a plain Click doesn't register, turn on **Dispatch DOM event** on the Click step
  (jQuery UI menus sometimes need the raw DOM event), or use **Hover → Click**.

---

## Checkboxes that must be ON before the flow continues

**Symptom:** A checkbox is sometimes already checked, sometimes not, and the workflow
breaks if it's off. You don't want to verify it — you want to *guarantee* it.

Use the **Set Checkbox** action (Interaction category), not an assertion and not a raw
Click. It maps to Playwright's idempotent `setChecked()`: it only toggles if the box
isn't already in the desired state, then no-ops — so the flow continues regardless of
starting state.

```
When  →  Set Checkbox  #pchild425  → Should end up checked? ✅
```

- Use **Assert Checked** only when you want to *prove* state (it's allowed to fail);
  use **Set Checkbox** when you want to *ensure* state (flow-safe, never fails on state).
- It has a **Wait before (ms)** field for boxes that render a beat late or sit behind a modal animation.

---

## Asserting a transient toast / confirmation modal

**Symptom:** A success message ("Successfully created!") flashes in a modal after a Save,
then auto-dismisses. **Assert Text** fails even though you saw the message — either it
times out, or it reports a received value like `" × "` (just the modal's close button).

**Why it's tricky** — two timing walls, on a message that only lives ~2 seconds:

```js
// shown deep inside nested AJAX success callbacks, then auto-hidden:
$('#CONFIRMATIONMODALMESSAGE').append('<strong><center>' + LABEL + '</center></strong>');
setTimeout(function () { $('#CONFIRMATIONMODALMESSAGE').empty(); ... }, 2000);
```

- **Calm playback ON** → the assert first waits for the *whole* network chain to go quiet.
  By the time it looks, the 2s timer already emptied the message → miss.
- **Calm playback ON, default 5s wait** → if the network chain is slow (e.g. two sequential
  round-trips before the toast shows), the toast appears *after* the assert's 5s window → miss,
  reported as `" × "` (the message node was empty the whole time).

**Recipe** — make the assert poll across the chain and latch on the first match:

```
When  →  Click        (Save)
When  →  Assert Text   #CONFIRMATIONMODALMESSAGE  contains "Successfully created!"
                       ☑ Skip calm-playback wait on this step   (_noSettle)
                       Max wait (ms): 15000
```

- **Tick "Skip calm-playback wait" (`_noSettle`)** on the *assert* step so it starts polling the
  instant Save is clicked — not after the network settles past the toast's life.
- **Set Max wait** above the default 5000 (try 15000) so the poll window spans "slow chain →
  toast appears → 2s life". The assert passes the moment the text shows, even though it vanishes after.
- **Target the message node's own id** (`#CONFIRMATIONMODALMESSAGE`), not a deep
  `div:nth-of-type(2) > p > strong > center` path — the chain breaks on any Bootstrap reflow,
  and `#MODALCONFIRMATION` (the parent) drags in the `×` close button.

**Still failing at a generous Max wait (e.g. 20000)?** Then it's *not* timing — the toast
genuinely never showed. Many of these messages are hardcoded on a success branch
(`if (FEATID != "") { ... show toast ... }`) with inner errors swallowed, so the toast can be
skipped while everything returns 200. In that case assert the **network response** in the
per-step network trace instead of the toast — it's the real signal.
