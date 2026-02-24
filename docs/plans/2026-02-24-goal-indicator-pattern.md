# GOAL Indicator Pattern Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rekam kapan label GOAL muncul (minute + timestamp), lalu ukur seberapa cepat odds O/U berubah setelah gol dengan dua metrik: perubahan pertama dan perubahan mencapai threshold.

**Architecture:** Tambahkan state reaksi gol per event di background worker, set baseline odds saat gol terdeteksi, dan update metrik pada snapshot berikutnya. Surface metrik ini ke `ouAnalysisLatest` agar popup table dan export CSV bisa langsung pakai field yang sama. UI menambah kolom insight GOAL agar pola respons odds terlihat tanpa perlu post-processing manual.

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript, Chrome storage, popup HTML table rendering.

---

### Task 1: Track GOAL reaction state in background pipeline

**Files:**
- Modify: `sports-scraper-extension/background.js`

**Step 1: Define runtime state and threshold constant**

```js
let goalReactionByKey = {};
const GOAL_ODDS_THRESHOLD = 0.03;
```

**Step 2: Create baseline when goal detected**

```js
goalReactionByKey[eventIdKey] = {
  goalAt,
  goalAtMs,
  goalMinute,
  baselineOver,
  baselineUnder,
  firstChangeSeconds: null,
  thresholdChangeSeconds: null,
  threshold: GOAL_ODDS_THRESHOLD
};
```

**Step 3: Update reaction metrics on each new snapshot**

```js
if (reaction.firstChangeSeconds === null && maxAbs > 0) {
  reaction.firstChangeSeconds = secondsSinceGoal;
}
if (reaction.thresholdChangeSeconds === null && maxAbs >= reaction.threshold) {
  reaction.thresholdChangeSeconds = secondsSinceGoal;
}
```

**Step 4: Expose reaction fields into analysis row output**

```js
{
  goalMinute,
  firstChangeSeconds,
  thresholdChangeSeconds,
  goalThreshold,
  overChangeFromGoal,
  underChangeFromGoal
}
```

**Step 5: Clear reaction state when event is removed/finished**

```js
delete goalReactionByKey[key];
```

### Task 2: Render GOAL speed metrics in FT O/U table

**Files:**
- Modify: `sports-scraper-extension/popup.html`
- Modify: `sports-scraper-extension/popup.js`

**Step 1: Add table headers for GOAL metrics**

```html
<th>GOAL Min</th>
<th>FirstΔ(s)</th>
<th>Δ0.03(s)</th>
```

**Step 2: Extend empty-state colspan from 10 to 13**

```html
<tr><td colspan="13">No FT O/U analysis yet.</td></tr>
```

**Step 3: Append 3 new cells in analysis row rendering**

```js
tr.appendChild(createPlainCell(fmtGoalMinute(row.goalMinute)));
tr.appendChild(createPlainCell(fmtSeconds(row.firstChangeSeconds)));
tr.appendChild(createPlainCell(fmtThresholdSeconds(row.thresholdChangeSeconds, row.goalThreshold)));
```

**Step 4: Add display formatters with safe fallbacks**

```js
function fmtGoalMinute(value) { ... }
function fmtSeconds(value) { ... }
function fmtThresholdSeconds(value, threshold) { ... }
```

### Task 3: Add GOAL reaction metrics to exported CSV

**Files:**
- Modify: `sports-scraper-extension/popup.js`

**Step 1: Add export header fields**

```js
'goalMinute',
'firstChangeSeconds',
'thresholdChangeSeconds',
'goalThreshold',
'overChangeFromGoal',
'underChangeFromGoal'
```

**Step 2: Add row value mapping in same order**

```js
row.goalMinute,
row.firstChangeSeconds,
row.thresholdChangeSeconds,
row.goalThreshold,
row.overChangeFromGoal,
row.underChangeFromGoal
```

### Task 4: Verify implementation

**Files:**
- Modify: none

**Step 1: Syntax check updated JS files**

Run: `node --check "sports-scraper-extension/background.js" && node --check "sports-scraper-extension/popup.js"`

Expected: exit code 0, no syntax errors.

**Step 2: Manual runtime verification in extension popup**

Run flow:
1. Load extension unpacked.
2. Start scrape on supported page.
3. Wait for a goal event.
4. Confirm `GOAL Min`, `FirstΔ(s)`, `Δ0.03(s)` terisi sesuai perubahan odds.
5. Export FT O/U CSV dan cek field baru ada.

Expected: metrik muncul di table dan CSV konsisten.
