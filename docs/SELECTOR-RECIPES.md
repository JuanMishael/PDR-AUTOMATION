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

---

## Sometimes-present elements (cookie banner, "new feature" popup)

**Symptom:** An element shows up *some* runs but not others — a cookie consent bar, a
"what's new" modal, an interstitial. A plain **Click** on it fails hard the runs it isn't there,
and you can't just delete the step because it *is* there sometimes.

Use an **If block** (Flow category) so the click only runs when the thing is actually present:

```
🔀 IF ( visible: .cookie-banner )
      Click   .cookie-banner button:has-text("Accept")
⎇ END IF
Fill  #user-name = {{Login.user-name}}
```

- The condition is evaluated **live** at run time — a missing element is simply *false*, never an
  error, so the body is skipped cleanly and the run continues.
- Add **⎇ Else** only if you need the other branch (e.g. a different path when a trial banner shows).
- For an element that renders a beat late, set the condition's **wait-for (ms)** so it polls briefly
  before deciding, instead of checking the instant the page loads.
- It's **binary** on purpose — one condition, run/skip. Nest If-blocks for compound logic rather than
  reaching for a third branch.

---

## Brittle selectors that drift between builds → self-healing

**Symptom:** A selector that worked last sprint stops matching after a front-end change — a
class got renamed, a wrapper `div` was added, an `id` changed — even though the element is
visibly right there.

When you capture a selector with **🎯 Pick**, the tool now also stores a few *validated*
alternative selectors for the same element (a `🩹 N self-healing fallbacks` badge shows under
the field). At run time the primary is tried **alongside** those fallbacks, so if the primary
drifts, an alternative (by id / test-id / name / aria / text / structure) still finds the element.
It applies to clicks **and** fill/type/select.

- Nothing to configure — just **Pick** rather than hand-typing, and the chain is captured for you.
- You can still add a manual **Alt Selector** on click steps; it's tried first, ahead of the auto chain.
- Prefer the **✎ edit-data** popover on a `{{token}}` value to change *what a step types*; self-healing
  is about *finding the element*, not the data.
- Caveat: healing recovers silently. If a step only passes because a fallback caught it, the primary
  is quietly rotting — worth re-**Pick**ing occasionally so your primary stays current.

---

## Values the app generates for you (order #, reference, computed total)

**Symptom:** The app creates a value you can't know in advance — a reference number on the
confirmation screen — and a later step (or a search, or an assertion) needs *that* value.
There's nothing to hard-code and nothing in Test Data that can hold it.

Use **📌 Capture Value** (Variables category), then use the variable like any token:

```
Click        button:has-text("Submit")
📌 Capture   orderId  ←  text of  .confirmation .ref-no
Navigate     /orders
Fill         #search = {{var.orderId}}
Assert Text  .order-header = {{var.orderId}}
```

- **Take the**: `text` (element text), `value` (what's in an input), `attribute` (+ attribute name),
  `url`, or `js` for an expression. Whitespace is trimmed — page text arrives full of layout newlines.
- The run log shows `📌 {{var.orderId}} = ORD-1234`, so you can see what was captured, not guess.
- Works in **If conditions** too — capture a value, then branch on whether the page still shows it.
- A typo'd `{{var.ordreId}}` is left **visible** in the field rather than silently blanking, which is
  how you spot it in the log instead of debugging an empty search box.
- Variables live for **one run**. That's deliberate: a value scraped off the UI is only true right
  now, and a saved-and-stale one would let a broken test pass. (The API profile's variable store *is*
  persistent — different job: tokens outlive a request.)

If the value needs real computing — string surgery, arithmetic across two elements — use
**⚡ Custom Code** and write to the same store:

```js
const total = await page.locator('.grand-total').innerText()
vars.total = String(Number(total.replace(/[^0-9.]/g, '')) * 100)
```

Keep that rare. A **Capture Value** card is readable by a tester who doesn't write code; a code block
is only readable by whoever wrote it — and a syntax error in one fails the whole run, not just its step.
