# H/A Odds Movement Pre-Goal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Menambahkan tracking pergerakan odds Home/Away (FT 1X2) per interval 30 detik dan mengaitkannya dengan pola sebelum gol.

**Architecture:** Data H/A diekstrak dari content script, lalu di-aggregate per bucket 30 detik di background service worker. Saat gol terdeteksi, sistem menghitung ringkasan trend 90 detik terakhir dan menampilkannya di FT O/U Analysis serta mengekspor ke CSV. Pendekatan ini menjaga perhitungan ringan dan konsisten lintas UI/export.

**Tech Stack:** Chrome Extension MV3, JavaScript (`content.js`, `background.js`, `popup.js`, `popup.html`), Chrome storage local.

---

### Task 1: Add failing coverage for H/A extraction and pre-goal summarization

**Files:**
- Create: `sports-scraper-extension/tests/ha-odds-movement.test.js`
- Modify: `sports-scraper-extension/package.json` (if test script needed)

**Step 1: Write failing test for FT 1X2 H/A extraction mapping**

```js
test('maps FT 1X2 to home/away odds from event order', () => {
  const input = makeEventWithFt1x2(['1.80', '3.20', '4.50']);
  const result = extractHomeAwayOdds(input);
  expect(result.homeOdds).toBe(1.80);
  expect(result.awayOdds).toBe(4.50);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- sports-scraper-extension/tests/ha-odds-movement.test.js`

Expected: FAIL (function/module belum ada).

**Step 3: Write failing test for direction logic (`▲`,`▼`,`=`)**

```js
test('computes direction against previous bucket', () => {
  expect(getDirection(1.92, 1.88)).toBe('▲');
  expect(getDirection(1.84, 1.88)).toBe('▼');
  expect(getDirection(1.88, 1.88)).toBe('=');
});
```

**Step 4: Write failing test for 90s pre-goal dominant trend summary**

```js
test('summarizes dominant pre-goal trend from last 3 buckets', () => {
  const summary = summarizePreGoalTrend([...threeBuckets]);
  expect(summary.homeTrend90s).toBe('down_dominant');
  expect(summary.preGoalPattern).toMatch(/H▼/);
});
```

**Step 5: Commit tests (optional checkpoint)**

```bash
git add sports-scraper-extension/tests/ha-odds-movement.test.js
git commit -m "test: add failing cases for HA odds movement pre-goal"
```

### Task 2: Implement FT 1X2 H/A extraction in content pipeline

**Files:**
- Modify: `sports-scraper-extension/content.js`
- Test: `sports-scraper-extension/tests/ha-odds-movement.test.js`

**Step 1: Implement helper to derive FT H/A odds from FT 1X2 markets**

```js
extractFt1x2HomeAway(fullTimeMarkets) {
  const oneXTwo = fullTimeMarkets.filter((m) => m.category === '1x2');
  const homeOdds = Number(oneXTwo[0]?.odds);
  const awayOdds = Number(oneXTwo[2]?.odds);
  return {
    homeOdds: Number.isFinite(homeOdds) ? homeOdds : null,
    awayOdds: Number.isFinite(awayOdds) ? awayOdds : null
  };
}
```

**Step 2: Attach `homeOdds`/`awayOdds` to FT snapshot payload sent to background**

```js
snapshots.push({
  ...,
  homeOdds: ha.homeOdds,
  awayOdds: ha.awayOdds
});
```

**Step 3: Run targeted test to verify extraction logic passes**

Run: `npm test -- sports-scraper-extension/tests/ha-odds-movement.test.js -t "maps FT 1X2"`

Expected: PASS.

**Step 4: Commit extraction implementation**

```bash
git add sports-scraper-extension/content.js sports-scraper-extension/tests/ha-odds-movement.test.js
git commit -m "feat: extract FT 1X2 home away odds for movement tracking"
```

### Task 3: Implement 30-second H/A bucket tracking in background

**Files:**
- Modify: `sports-scraper-extension/background.js`
- Test: `sports-scraper-extension/tests/ha-odds-movement.test.js`

**Step 1: Add runtime state and constants**

```js
let haHistoryByKey = {};
let goalPreHaPatternByKey = {};
const HA_BUCKET_SECONDS = 30;
const PRE_GOAL_WINDOW_SECONDS = 90;
```

**Step 2: Add helper for direction and bucket keying**

```js
function getDirection(current, previous) { ... }
function getBucketAtMs(ts, bucketSeconds) { ... }
```

**Step 3: Upsert H/A bucket from each incoming snapshot**

```js
updateHaBucket(snapshot.eventIdKey, {
  timestamp: snapshot.timestamp,
  minute: snapshot.minute,
  homeOdds: snapshot.homeOdds,
  awayOdds: snapshot.awayOdds
});
```

**Step 4: Keep bounded rolling history and clear with event lifecycle**

```js
if (history.length > 40) history = history.slice(-40);
delete haHistoryByKey[key];
delete goalPreHaPatternByKey[key];
```

**Step 5: Run tests for direction + bucket behavior**

Run: `npm test -- sports-scraper-extension/tests/ha-odds-movement.test.js -t "direction|bucket"`

Expected: PASS.

### Task 4: Compute pre-goal H/A pattern at goal event

**Files:**
- Modify: `sports-scraper-extension/background.js`
- Test: `sports-scraper-extension/tests/ha-odds-movement.test.js`

**Step 1: On goal detection, collect last 90s bucket window**

```js
const rows = getHaBucketsBeforeGoal(eventIdKey, goalAtMs, PRE_GOAL_WINDOW_SECONDS);
```

**Step 2: Summarize counts and dominant trend**

```js
const summary = summarizePreGoalHaTrend(rows);
// { homeUpCount, homeDownCount, awayUpCount, awayDownCount, homeTrend90s, awayTrend90s, preGoalPattern }
```

**Step 3: Attach summary to analysis row shape**

```js
{
  homeTrend90s,
  awayTrend90s,
  preGoalPattern,
  preGoalWindowSeconds
}
```

**Step 4: Add failing then passing test for dominant trend label**

Run:
- `npm test -- sports-scraper-extension/tests/ha-odds-movement.test.js -t "summarizes dominant pre-goal trend"` (first fail)
- implement minimal logic
- run same command again (pass)

Expected: PASS after implementation.

### Task 5: Render H/A pre-goal insight in popup table

**Files:**
- Modify: `sports-scraper-extension/popup.html`
- Modify: `sports-scraper-extension/popup.js`

**Step 1: Add table headers for H/A pre-goal fields**

```html
<th>H Trend(90s)</th>
<th>A Trend(90s)</th>
<th>PreGoal Pattern</th>
```

**Step 2: Extend `colspan` empty state accordingly**

```html
<tr><td colspan="...">No FT O/U analysis yet.</td></tr>
```

**Step 3: Append new cells in `renderOuAnalysisTable()`**

```js
tr.appendChild(createPlainCell(row.homeTrend90s || '-'));
tr.appendChild(createPlainCell(row.awayTrend90s || '-'));
tr.appendChild(createPlainCell(row.preGoalPattern || '-'));
```

**Step 4: Add tiny formatting helper if needed (`mixed`, `insufficient`, `-`)**

```js
function fmtTrendLabel(value) { ... }
```

### Task 6: Export H/A pre-goal features to CSV

**Files:**
- Modify: `sports-scraper-extension/popup.js`

**Step 1: Add CSV header columns**

```js
'homeTrend90s',
'awayTrend90s',
'preGoalPattern',
'preGoalWindowSeconds',
'homeUpCount',
'homeDownCount',
'awayUpCount',
'awayDownCount'
```

**Step 2: Add row mappings in same order**

```js
row.homeTrend90s,
row.awayTrend90s,
row.preGoalPattern,
row.preGoalWindowSeconds,
row.homeUpCount,
row.homeDownCount,
row.awayUpCount,
row.awayDownCount
```

### Task 7: End-to-end verification and cleanup

**Files:**
- Modify: none

**Step 1: Syntax check all changed JS files**

Run: `node --check "sports-scraper-extension/content.js" && node --check "sports-scraper-extension/background.js" && node --check "sports-scraper-extension/popup.js"`

Expected: exit code 0.

**Step 2: Run full targeted test file**

Run: `npm test -- sports-scraper-extension/tests/ha-odds-movement.test.js`

Expected: all tests pass.

**Step 3: Manual verification in extension**

1. Reload extension.
2. Open target page + Start scraping.
3. Tunggu beberapa bucket + satu gol.
4. Cek kolom H/A trend dan pre-goal pattern terisi.
5. Export CSV dan cek field H/A baru.

Expected: tabel + CSV konsisten dan tidak merusak alur existing.

**Step 4: Final commit**

```bash
git add sports-scraper-extension/content.js sports-scraper-extension/background.js sports-scraper-extension/popup.js sports-scraper-extension/popup.html sports-scraper-extension/tests/ha-odds-movement.test.js docs/plans/2026-02-24-ha-odds-movement-design.md docs/plans/2026-02-24-ha-odds-movement-implementation.md
git commit -m "feat: track FT 1X2 HA movement and correlate pre-goal trends"
```
