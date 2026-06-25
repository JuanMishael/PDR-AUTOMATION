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
