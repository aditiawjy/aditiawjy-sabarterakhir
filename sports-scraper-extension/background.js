// Background Script for Sports Data Scraper
let latestData = null;
let dataHistory = [];
let ftOuHistoryByKey = {};
let goalStateByKey = {};
let goalReactionByKey = {};
let minute60SnapshotByKey = {};
let missingCyclesByKey = {};
let ouMinute60History = [];
let lastMinute60CsvSignature = '';
const LOCAL_CSV_WRITE_URL = 'http://127.0.0.1:8765/write-minute60-csv';
let isHydrated = false;
let isHydrating = false;
let pendingHydrationCallbacks = [];

const FT_OU_MAX_HISTORY = 300;
const FT_OU_VOL_WINDOW = 10;
const FT_OU_DELTA_WINDOW = 5;
const FT_OU_BREAKOUT_THRESHOLD = 0.12;
const FT_OU_OVER_DELTA5_THRESHOLD = -0.08;
const FT_OU_OVER_VOL_MAX = 0.14;
const FT_OU_OVER_MINUTE_MIN = 40;
const FT_OU_OVER_MINUTE_MAX = 82;
const GOAL_FLASH_WINDOW_MS = 2500;
const GOAL_ODDS_THRESHOLD = 0.03;
const MAX_MISSING_CYCLES_BEFORE_CLEAR = 3;
const MAX_MINUTE60_HISTORY = 1000;
const MINUTE60_CAPTURE_MIN = 60;
const MINUTE60_CAPTURE_MAX = 63;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateData') {
    hydrateState(() => {
      handleUpdateData(request, sender);
    });
    return;
  }

  if (request.action === 'scraperError') {
    chrome.storage.local.get(['scraperState'], (result) => {
      const previous = result.scraperState || {};
      chrome.storage.local.set({
        scraperState: {
          ...previous,
          isScraping: false,
          lastUpdated: request.timestamp || new Date().toISOString(),
          pageUrl: request.pageUrl || previous.pageUrl || null,
          error: request.error || 'Unknown scraper error'
        }
      });
    });
    return;
  }
});

function hydrateState(callback) {
  if (isHydrated) {
    callback();
    return;
  }

  pendingHydrationCallbacks.push(callback);
  if (isHydrating) return;

  isHydrating = true;
  chrome.storage.local.get(['latestData', 'dataHistory', 'ouMinute60History'], (result) => {
    latestData = result.latestData || latestData;
    dataHistory = Array.isArray(result.dataHistory) ? result.dataHistory : dataHistory;
    ouMinute60History = Array.isArray(result.ouMinute60History) ? result.ouMinute60History : ouMinute60History;
    ouMinute60History = sanitizeMinute60History(ouMinute60History);

    isHydrated = true;
    isHydrating = false;

    const callbacks = pendingHydrationCallbacks;
    pendingHydrationCallbacks = [];
    callbacks.forEach((cb) => cb());
  });
}

function handleUpdateData(request, sender) {
  latestData = request.data;
  dataHistory.push(request.data);
  const liveEvents = Array.isArray(request.data?.liveEvents) ? request.data.liveEvents : [];
  const totalEvents = liveEvents.reduce((sum, league) => sum + ((league.events || []).length), 0);

  // Keep only last 1000 entries
  if (dataHistory.length > 1000) {
    dataHistory = dataHistory.slice(-1000);
  }

  const ftOuSnapshots = Array.isArray(request.data?.ftOuSnapshots) ? request.data.ftOuSnapshots : [];

  // Flush current state to CSV BEFORE processing (which may remove finished entries).
  autoUpdateMinute60CsvFile(ouMinute60History);

  const ouAnalysisLatest = processFtOuSnapshots(ftOuSnapshots);
  const minute60Snapshots = captureMinute60Snapshots(ouAnalysisLatest);
  ouMinute60History = sanitizeMinute60History(ouMinute60History);
  autoUpdateMinute60CsvFile(ouMinute60History);

  // Store in chrome storage
  chrome.storage.local.set({
    latestData: latestData,
    dataHistory: dataHistory.slice(-100), // Keep last 100 in storage
    ouAnalysisLatest,
    ouMinute60Snapshots: minute60Snapshots,
    ouMinute60History,
    analysisMeta: {
      lastUpdated: request.data?.timestamp || new Date().toISOString(),
      totalKeys: Object.keys(ftOuHistoryByKey).length,
      minute60Count: minute60Snapshots.length,
      minute60HistoryCount: ouMinute60History.length,
      threshold: FT_OU_BREAKOUT_THRESHOLD,
      window: FT_OU_VOL_WINDOW,
      overSignal: {
        delta5Max: FT_OU_OVER_DELTA5_THRESHOLD,
        volMax: FT_OU_OVER_VOL_MAX,
        minuteRange: [FT_OU_OVER_MINUTE_MIN, FT_OU_OVER_MINUTE_MAX]
      }
    },
    scraperState: {
      isScraping: true,
      lastUpdated: request.data?.timestamp || new Date().toISOString(),
      pageUrl: sender?.tab?.url || request.data?.pageUrl || null,
      totalEvents,
      error: null,
      scrapeInterval: request.data?.debug?.scrapeIntervalMs || 5000,
      debug: request.data?.debug || null
    }
  });

  // Update badge
  updateBadge();
}

// Update extension badge with live event count
function updateBadge() {
  if (latestData && latestData.liveEvents) {
    let totalEvents = 0;
    latestData.liveEvents.forEach(league => {
      totalEvents += league.events.length;
    });
    
    chrome.action.setBadgeText({ text: totalEvents.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  }
}

function processFtOuSnapshots(snapshots) {
  const nowMs = Date.now();
  const activeKeys = new Set();
  const finishedKeys = new Set();

  snapshots.forEach((snapshot) => {
    if (!snapshot || !snapshot.eventIdKey) return;

    if (isFinishedSnapshot(snapshot)) {
      finishedKeys.add(snapshot.eventIdKey);
      return;
    }

    activeKeys.add(snapshot.eventIdKey);
    missingCyclesByKey[snapshot.eventIdKey] = 0;

    if (!ftOuHistoryByKey[snapshot.eventIdKey]) {
      ftOuHistoryByKey[snapshot.eventIdKey] = [];
    }

    const history = ftOuHistoryByKey[snapshot.eventIdKey];
    const last = history[history.length - 1];

    if (last && isDuplicateOuSnapshot(last, snapshot)) {
      return;
    }

    history.push({
      timestamp: snapshot.timestamp,
      minute: toNumber(snapshot.minute),
      score: snapshot.score || '-',
      league: snapshot.league || '-',
      teams: snapshot.teams || '-',
      line: snapshot.line || '-',
      overOdds: toNullableNumber(snapshot.overOdds),
      underOdds: toNullableNumber(snapshot.underOdds)
    });

    updateGoalState(snapshot.eventIdKey, history);
    updateGoalReactionProgress(snapshot.eventIdKey, history[history.length - 1]);

    if (history.length > FT_OU_MAX_HISTORY) {
      ftOuHistoryByKey[snapshot.eventIdKey] = history.slice(-FT_OU_MAX_HISTORY);
    }
  });

  clearFinishedAndMissingKeys(activeKeys, finishedKeys);

  const analysisRows = Object.entries(ftOuHistoryByKey).map(([eventIdKey, history]) => {
    const latest = history[history.length - 1];
    const overSeries = history.map((row) => row.overOdds).filter(isFiniteNumber);
    const underSeries = history.map((row) => row.underOdds).filter(isFiniteNumber);
    const overNow = latest?.overOdds;
    const underNow = latest?.underOdds;
    const overDelta1 = calcDelta(history, 'overOdds', 1);
    const underDelta1 = calcDelta(history, 'underOdds', 1);
    const overDelta3 = calcDelta(history, 'overOdds', 3);
    const underDelta3 = calcDelta(history, 'underOdds', 3);
    const overDelta5 = calcDelta(history, 'overOdds', FT_OU_DELTA_WINDOW);
    const underDelta5 = calcDelta(history, 'underOdds', FT_OU_DELTA_WINDOW);
    const volatility = calcCombinedVolatility(history, FT_OU_VOL_WINDOW);
    const velocityOver = calcVelocity(history, 'overOdds');
    const velocityUnder = calcVelocity(history, 'underOdds');
    const breakout = Math.abs(overDelta1) >= FT_OU_BREAKOUT_THRESHOLD || Math.abs(underDelta1) >= FT_OU_BREAKOUT_THRESHOLD;
    const pattern = classifyPattern(history, {
      overDelta1,
      underDelta1,
      overDelta3,
      underDelta3,
      breakout
    });
    const signal = evaluateOverSignal({
      overDelta1,
      overDelta3,
      overDelta5,
      underDelta1,
      underDelta3,
      underDelta5,
      overNow,
      underNow,
      breakout,
      line: latest?.line,
      score: latest?.score,
      volatility,
      minute: toNumber(latest?.minute),
      pattern,
      samples: history.length
    });
    const goalState = goalStateByKey[eventIdKey] || null;
    const goalReaction = goalReactionByKey[eventIdKey] || null;
    const goalAtMs = goalState?.goalAtMs || 0;
    const goalJustHappened = goalAtMs > 0 && (nowMs - goalAtMs) <= GOAL_FLASH_WINDOW_MS;

    return {
      eventIdKey,
      league: latest?.league || '-',
      teams: latest?.teams || '-',
      line: latest?.line || '-',
      minute: toNumber(latest?.minute),
      score: latest?.score || '-',
      overNow,
      underNow,
      overDelta1,
      underDelta1,
      overDelta3,
      underDelta3,
      overDelta5,
      underDelta5,
      velocityOver,
      velocityUnder,
      volatility,
      breakout,
      pattern,
      signal: signal.name,
      confidence: signal.confidence,
      signalReasons: signal.reasons,
      goalJustHappened,
      goalAt: goalState?.goalAt || null,
      goalMinute: toNumber(goalReaction?.goalMinute),
      goalDelta: goalState?.goalDelta || 0,
      goalThreshold: GOAL_ODDS_THRESHOLD,
      firstChangeSeconds: toNullableNumber(goalReaction?.firstChangeSeconds),
      firstChangeMinute: toNullableNumber(goalReaction?.firstChangeMinute),
      thresholdChangeSeconds: toNullableNumber(goalReaction?.thresholdChangeSeconds),
      thresholdChangeMinute: toNullableNumber(goalReaction?.thresholdChangeMinute),
      overChangeFromGoal: toNullableNumber(goalReaction?.overChangeFromGoal),
      underChangeFromGoal: toNullableNumber(goalReaction?.underChangeFromGoal),
      samples: history.length,
      lastUpdated: latest?.timestamp || null
    };
  });

  const dedupedRows = collapseDuplicateAnalysisRows(analysisRows);

  return dedupedRows.sort((a, b) => {
    if (a.breakout !== b.breakout) return a.breakout ? -1 : 1;
    return b.volatility - a.volatility;
  });
}

function clearFinishedAndMissingKeys(activeKeys, finishedKeys) {
  const allKeys = Object.keys(ftOuHistoryByKey);

  allKeys.forEach((key) => {
    if (finishedKeys.has(key)) {
      deleteAnalysisStateByKey(key);
      return;
    }

    if (activeKeys.has(key)) return;

    const currentMissing = Number(missingCyclesByKey[key] || 0) + 1;
    missingCyclesByKey[key] = currentMissing;

    if (currentMissing > MAX_MISSING_CYCLES_BEFORE_CLEAR) {
      deleteAnalysisStateByKey(key);
    }
  });
}

function deleteAnalysisStateByKey(key) {
  const snapshot = minute60SnapshotByKey[key];
  const keepMinute60Snapshot = snapshot && !snapshot.score85Plus;
  delete ftOuHistoryByKey[key];
  delete goalStateByKey[key];
  delete goalReactionByKey[key];
  delete missingCyclesByKey[key];

  if (!keepMinute60Snapshot) {
    const capturedAt = snapshot?.timestamp || null;
    delete minute60SnapshotByKey[key];
    removeMinute60HistoryByKey(key, capturedAt);
  }
}

function removeMinute60HistoryByKey(eventIdKey, capturedAt60) {
  if (!eventIdKey) return;
  ouMinute60History = ouMinute60History.filter((row) => {
    if (row.eventIdKey !== eventIdKey) return true;
    // Only remove the specific match; keep other matches for the same teams.
    if (capturedAt60 && row.capturedAt60 !== capturedAt60) return true;
    return false;
  });
}

function isFinishedSnapshot(snapshot) {
  const marker = String(snapshot.gamePart || '').trim().toUpperCase();
  if (!marker) return false;
  return marker === 'FT' || marker === 'FINISHED' || marker === 'END';
}

function normalizeEventIdentity(text) {
  return String(text || '')
    .replace(/\[V\]/gi, '')
    .replace(/\s+vs\s+Draw/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeLineValue(line) {
  const raw = String(line || '').trim();
  if (!raw || raw === '-') return '-';

  const values = raw
    .split('/')
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num))
    .sort((a, b) => a - b);

  if (values.length === 0) return raw;
  if (values.length === 1) return String(values[0]);
  return `${values[0]}/${values[values.length - 1]}`;
}

function collapseDuplicateAnalysisRows(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const identity = normalizeEventIdentity(`${row.league}|${row.teams}`);
    const key = `${identity}|${normalizeLineValue(row.line)}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      return;
    }

    const existingTs = Date.parse(existing.lastUpdated || 0) || 0;
    const currentTs = Date.parse(row.lastUpdated || 0) || 0;

    if (currentTs >= existingTs) {
      map.set(key, row);
    }
  });

  return Array.from(map.values());
}

function captureMinute60Snapshots(rows) {
  rows.forEach((row) => {
    if (!row || !row.eventIdKey) return;
    const minute = toNumber(row.minute);
    if (minute < MINUTE60_CAPTURE_MIN) return;

    if (!minute60SnapshotByKey[row.eventIdKey]) {
      if (!isMinute60CaptureWindow(minute)) {
        return;
      }

      minute60SnapshotByKey[row.eventIdKey] = {
        eventIdKey: row.eventIdKey,
        league: row.league || '-',
        teams: row.teams || '-',
        line: row.line || '-',
        minute: minute,
        score: row.score || '-',
        overNow: row.overNow,
        underNow: row.underNow,
        volatility: row.volatility,
        pattern: row.pattern,
        signal: row.signal,
        confidence: row.confidence,
        timestamp: row.lastUpdated || new Date().toISOString(),
        score85Plus: null,
        minute85Plus: null,
        timestamp85Plus: null
      };

      upsertMinute60History(row.eventIdKey, {
        eventIdKey: row.eventIdKey,
        league: row.league || '-',
        teams: row.teams || '-',
        line60: row.line || '-',
        over60: row.overNow,
        under60: row.underNow,
        score60: row.score || '-',
        minute60: minute,
        signal60: row.signal || 'NO_TRADE',
        confidence60: row.confidence || 'LOW',
        capturedAt60: row.lastUpdated || new Date().toISOString(),
        score85Plus: null,
        minute85Plus: null,
        capturedAt85Plus: null
      });
    }

    if (minute >= 85) {
      const snapshot = minute60SnapshotByKey[row.eventIdKey];
      if (snapshot && !snapshot.score85Plus) {
        snapshot.score85Plus = row.score || '-';
        snapshot.minute85Plus = minute;
        snapshot.timestamp85Plus = row.lastUpdated || new Date().toISOString();
      }

      updateMinute60History85Plus(row.eventIdKey, {
        score85Plus: row.score || '-',
        minute85Plus: minute,
        capturedAt85Plus: row.lastUpdated || new Date().toISOString()
      });
    }
  });

  return Object.values(minute60SnapshotByKey)
    .sort((a, b) => (Date.parse(b.timestamp || 0) || 0) - (Date.parse(a.timestamp || 0) || 0));
}

function isMinute60CaptureWindow(minute) {
  return minute >= MINUTE60_CAPTURE_MIN && minute <= MINUTE60_CAPTURE_MAX;
}

function upsertMinute60History(eventIdKey, entry) {
  const existingIndex = findOpenMinute60HistoryIndex(eventIdKey);
  if (existingIndex >= 0) {
    ouMinute60History[existingIndex] = {
      ...ouMinute60History[existingIndex],
      ...entry
    };
  } else {
    ouMinute60History.unshift(entry);
  }

  if (ouMinute60History.length > MAX_MINUTE60_HISTORY) {
    ouMinute60History = ouMinute60History.slice(0, MAX_MINUTE60_HISTORY);
  }
}

function updateMinute60History85Plus(eventIdKey, payload) {
  const idx = findOpenMinute60HistoryIndex(eventIdKey);
  if (idx < 0) return;

  if (!ouMinute60History[idx].score85Plus) {
    ouMinute60History[idx] = {
      ...ouMinute60History[idx],
      ...payload
    };
  }
}

function findOpenMinute60HistoryIndex(eventIdKey) {
  for (let i = 0; i < ouMinute60History.length; i += 1) {
    const row = ouMinute60History[i];
    if (row.eventIdKey === eventIdKey && !isMinute60HistoryFinished(row)) {
      return i;
    }
  }
  return -1;
}

function isMinute60HistoryFinished(row) {
  const score = String(row?.score85Plus || '').trim().toUpperCase();
  return score === 'N/A' || score.includes(':');
}

function sanitizeMinute60History(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const minute60 = toNumber(row?.minute60);
    return minute60 >= MINUTE60_CAPTURE_MIN && minute60 <= MINUTE60_CAPTURE_MAX;
  });
}

function autoUpdateMinute60CsvFile(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const signature = rows
    .map((r) => `${r.eventIdKey}|${r.capturedAt60 || ''}|${r.capturedAt85Plus || ''}`)
    .join('\n');
  if (signature === lastMinute60CsvSignature) return;
  lastMinute60CsvSignature = signature;

  const csv = buildMinute60HistoryCsv(rows);
  writeMinute60CsvToLocalFile(csv);
}

function buildMinute60HistoryCsv(rows) {
  const header = [
    'eventIdKey',
    'league',
    'teams',
    'line60',
    'over60',
    'under60',
    'score60',
    'minute60',
    'signal60',
    'confidence60',
    'capturedAt60',
    'score85Plus',
    'minute85Plus',
    'capturedAt85Plus'
  ];

  let csv = `${header.join(',')}\n`;
  rows.forEach((row) => {
    const values = [
      row.eventIdKey,
      row.league,
      row.teams,
      row.line60,
      row.over60,
      row.under60,
      row.score60,
      row.minute60,
      row.signal60,
      row.confidence60,
      row.capturedAt60,
      row.score85Plus,
      row.minute85Plus,
      row.capturedAt85Plus
    ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`);

    csv += `${values.join(',')}\n`;
  });

  return csv;
}

function writeMinute60CsvToLocalFile(csv) {
  fetch(LOCAL_CSV_WRITE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: 'C:\\xampp\\htdocs\\sabarterakhir\\sports-scraper-extension\\minute60_history_live.csv',
      content: csv
    })
  }).catch(() => {
    // Silent fail: local writer service may not be running.
  });
}

function updateGoalState(eventIdKey, history) {
  if (!eventIdKey || history.length < 2) return;

  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const latestTotal = parseScoreTotal(latest?.score);
  const previousTotal = parseScoreTotal(previous?.score);

  if (latestTotal > previousTotal) {
    goalStateByKey[eventIdKey] = {
      goalAt: latest.timestamp || new Date().toISOString(),
      goalAtMs: Date.parse(latest.timestamp || new Date().toISOString()) || Date.now(),
      goalDelta: latestTotal - previousTotal,
      totalGoals: latestTotal
    };

    goalReactionByKey[eventIdKey] = {
      goalAt: latest.timestamp || new Date().toISOString(),
      goalAtMs: Date.parse(latest.timestamp || new Date().toISOString()) || Date.now(),
      goalMinute: toNumber(latest.minute),
      baselineOver: toNullableNumber(latest.overOdds),
      baselineUnder: toNullableNumber(latest.underOdds),
      firstChangeSeconds: null,
      firstChangeMinute: null,
      thresholdChangeSeconds: null,
      thresholdChangeMinute: null,
      overChangeFromGoal: 0,
      underChangeFromGoal: 0,
      threshold: GOAL_ODDS_THRESHOLD
    };
  }
}

function updateGoalReactionProgress(eventIdKey, latest) {
  const reaction = goalReactionByKey[eventIdKey];
  if (!reaction || !latest) return;

  const overNow = toNullableNumber(latest.overOdds);
  const underNow = toNullableNumber(latest.underOdds);
  const overBase = toNullableNumber(reaction.baselineOver);
  const underBase = toNullableNumber(reaction.baselineUnder);

  const overDelta = isFiniteNumber(overNow) && isFiniteNumber(overBase)
    ? round4(overNow - overBase)
    : 0;
  const underDelta = isFiniteNumber(underNow) && isFiniteNumber(underBase)
    ? round4(underNow - underBase)
    : 0;
  const overAbs = Math.abs(overDelta);
  const underAbs = Math.abs(underDelta);
  const maxAbs = Math.max(overAbs, underAbs);

  reaction.overChangeFromGoal = overDelta;
  reaction.underChangeFromGoal = underDelta;

  const latestAtMs = Date.parse(latest.timestamp || new Date().toISOString()) || Date.now();
  const secondsSinceGoal = Math.max(0, Math.round((latestAtMs - reaction.goalAtMs) / 1000));
  const latestMinute = toNumber(latest.minute);

  if (reaction.firstChangeSeconds === null && maxAbs > 0) {
    reaction.firstChangeSeconds = secondsSinceGoal;
    reaction.firstChangeMinute = latestMinute;
  }

  if (reaction.thresholdChangeSeconds === null && maxAbs >= (reaction.threshold || GOAL_ODDS_THRESHOLD)) {
    reaction.thresholdChangeSeconds = secondsSinceGoal;
    reaction.thresholdChangeMinute = latestMinute;
  }
}

function isDuplicateOuSnapshot(previous, next) {
  const sameMinute = toNumber(previous.minute) === toNumber(next.minute);
  const sameOver = toNullableNumber(previous.overOdds) === toNullableNumber(next.overOdds);
  const sameUnder = toNullableNumber(previous.underOdds) === toNullableNumber(next.underOdds);
  return sameMinute && sameOver && sameUnder;
}

function calcDelta(history, field, stepsBack) {
  const latest = history[history.length - 1]?.[field];
  const before = history[history.length - 1 - stepsBack]?.[field];
  if (!isFiniteNumber(latest) || !isFiniteNumber(before)) return 0;
  return round4(latest - before);
}

function calcVelocity(history, field) {
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  if (!latest || !previous) return 0;

  const latestValue = latest[field];
  const previousValue = previous[field];
  if (!isFiniteNumber(latestValue) || !isFiniteNumber(previousValue)) return 0;

  const minuteDelta = Math.max(1, toNumber(latest.minute) - toNumber(previous.minute));
  return round4((latestValue - previousValue) / minuteDelta);
}

function calcCombinedVolatility(history, windowSize) {
  const recent = history.slice(-windowSize);
  const overValues = recent.map((row) => row.overOdds).filter(isFiniteNumber);
  const underValues = recent.map((row) => row.underOdds).filter(isFiniteNumber);
  const overStd = calcStdDev(overValues);
  const underStd = calcStdDev(underValues);
  return round4((overStd + underStd) / 2);
}

function calcStdDev(values) {
  if (!values || values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function classifyPattern(history, metrics) {
  if (history.length < 5) return 'warming_up';
  if (metrics.breakout) return 'breakout';

  const signs = history
    .slice(-5)
    .map((_, idx, arr) => {
      if (idx === 0) return 0;
      const prev = arr[idx - 1].overOdds;
      const curr = arr[idx].overOdds;
      if (!isFiniteNumber(prev) || !isFiniteNumber(curr)) return 0;
      if (curr > prev) return 1;
      if (curr < prev) return -1;
      return 0;
    })
    .slice(1);

  const flips = signs.reduce((count, value, idx) => {
    if (idx === 0) return count;
    if (value !== 0 && signs[idx - 1] !== 0 && value !== signs[idx - 1]) {
      return count + 1;
    }
    return count;
  }, 0);

  if (flips >= 3) return 'whipsaw';

  if (metrics.overDelta3 <= -0.08 || metrics.underDelta3 <= -0.08) return 'drift_down';
  if (metrics.overDelta3 >= 0.08 || metrics.underDelta3 >= 0.08) return 'drift_up';
  return 'stable';
}

function evaluateOverSignal(input) {
  const reasons = [];
  let passed = 0;

  const momentum = pickMomentum(input.samples, input.overDelta1, input.overDelta3, input.overDelta5);
  const momentumThreshold = getMomentumThreshold(momentum.window);

  const deltaOk = momentum.value <= momentumThreshold;
  reasons.push(deltaOk ? `momentum_ok_${momentum.window}` : `momentum_fail_${momentum.window}`);
  if (deltaOk) passed += 1;

  const inverseDeltaOk = pickMomentum(input.samples, input.underDelta1, input.underDelta3, input.underDelta5).value >= Math.abs(momentumThreshold);
  reasons.push(inverseDeltaOk ? 'under_inverse_ok' : 'under_inverse_fail');
  if (inverseDeltaOk) passed += 1;

  const patternOk = input.pattern !== 'whipsaw';
  reasons.push(patternOk ? 'pattern_ok' : 'pattern_whipsaw');
  if (patternOk) passed += 1;

  const structureOk = input.pattern === 'drift_down' || input.pattern === 'breakout' || !!input.breakout;
  reasons.push(structureOk ? 'structure_ok' : 'structure_weak');
  if (structureOk) passed += 1;

  const minuteOk = input.minute >= FT_OU_OVER_MINUTE_MIN && input.minute <= FT_OU_OVER_MINUTE_MAX;
  reasons.push(minuteOk ? 'minute_ok' : 'minute_outside');
  if (minuteOk) passed += 1;

  const volOk = input.volatility <= FT_OU_OVER_VOL_MAX;
  reasons.push(volOk ? 'vol_ok' : 'vol_too_high');
  if (volOk) passed += 1;

  const priceBiasOk = isFiniteNumber(input.overNow) && isFiniteNumber(input.underNow)
    ? (input.overNow <= 1.95 || input.underNow >= 1.90)
    : false;
  reasons.push(priceBiasOk ? 'price_bias_ok' : 'price_bias_fail');
  if (priceBiasOk) passed += 1;

  const enoughSamples = input.samples >= 3;
  reasons.push(enoughSamples ? 'samples_ok' : 'samples_low');
  if (enoughSamples) passed += 1;

  const goalPressureOk = isGoalPressureOver(input.score, input.line, input.minute, input.overNow);
  reasons.push(goalPressureOk ? 'goal_pressure_ok' : 'goal_pressure_low');
  if (goalPressureOk) passed += 1;

  const momentumOrStructure = deltaOk || inverseDeltaOk || structureOk || priceBiasOk;
  const coreReady = minuteOk && patternOk && volOk && enoughSamples;
  const name = coreReady && (momentumOrStructure || goalPressureOk) && passed >= 4
    ? 'OVER_CANDIDATE'
    : 'NO_TRADE';
  const confidence = passed >= 7 ? 'HIGH' : passed >= 5 ? 'MED' : 'LOW';

  return { name, confidence, reasons };
}

function isGoalPressureOver(scoreText, lineText, minute, overNow) {
  const scoreTotal = parseScoreTotal(scoreText);
  const lineBase = parseLineBase(lineText);
  if (!isFiniteNumber(lineBase)) return false;
  if (minute < 55) return false;

  const closeToLine = scoreTotal >= (lineBase - 1);
  const favorablePrice = isFiniteNumber(overNow) ? overNow <= 2.05 : false;
  return closeToLine && favorablePrice;
}

function parseLineBase(lineText) {
  const nums = String(lineText || '')
    .split('/')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return NaN;
  return nums[0];
}

function pickMomentum(samples, delta1, delta3, delta5) {
  if (samples >= 6) {
    return { value: delta5, window: 5 };
  }

  if (samples >= 4) {
    return { value: delta3, window: 3 };
  }

  return { value: delta1, window: 1 };
}

function getMomentumThreshold(window) {
  if (window === 5) return FT_OU_OVER_DELTA5_THRESHOLD;
  if (window === 3) return -0.05;
  return -0.03;
}

function parseScoreTotal(scoreText) {
  const numbers = String(scoreText || '').match(/\d+/g);
  if (!numbers || numbers.length < 2) return 0;
  return toNumber(numbers[0]) + toNumber(numbers[1]);
}

function round4(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 10000) / 10000;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

// Handle extension installation/update without wiping existing data
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Sports Data Scraper installed/updated:', details.reason);

  chrome.storage.local.get([
    'latestData',
    'dataHistory',
    'ouMinute60Snapshots',
    'ouMinute60History',
    'settings',
    'scraperState'
  ], (result) => {
    const nextState = {
      latestData: result.latestData ?? null,
      dataHistory: Array.isArray(result.dataHistory) ? result.dataHistory : [],
      ouMinute60Snapshots: Array.isArray(result.ouMinute60Snapshots) ? result.ouMinute60Snapshots : [],
      ouMinute60History: Array.isArray(result.ouMinute60History) ? result.ouMinute60History : [],
      settings: {
        autoScrape: result.settings?.autoScrape ?? true,
        scrapeInterval: result.settings?.scrapeInterval ?? 5000,
        exportFormat: result.settings?.exportFormat ?? 'csv',
        showDebugPanel: result.settings?.showDebugPanel ?? false
      },
      scraperState: {
        isScraping: result.scraperState?.isScraping ?? false,
        lastUpdated: result.scraperState?.lastUpdated ?? null,
        pageUrl: result.scraperState?.pageUrl ?? null,
        totalEvents: result.scraperState?.totalEvents ?? 0,
        error: result.scraperState?.error ?? null,
        scrapeInterval: result.scraperState?.scrapeInterval ?? 5000,
        debug: result.scraperState?.debug ?? null
      }
    };

    chrome.storage.local.set(nextState, () => {
      // Rehydrate runtime cache and write CSV back immediately.
      ouMinute60History = sanitizeMinute60History(nextState.ouMinute60History);
      autoUpdateMinute60CsvFile(ouMinute60History);
    });
  });
});

// Restore cached history on service worker startup.
chrome.storage.local.get(['ouMinute60History'], (result) => {
  ouMinute60History = sanitizeMinute60History(result.ouMinute60History || []);
  autoUpdateMinute60CsvFile(ouMinute60History);
});

// Prevent stale UI state after extension/service-worker restart.
chrome.storage.local.get(['scraperState'], (result) => {
  const previous = result.scraperState || {};
  if (!previous.isScraping) return;

  chrome.storage.local.set({
    scraperState: {
      ...previous,
      isScraping: false,
      lastUpdated: new Date().toISOString(),
      error: previous.error || 'Session restarted. Click Start to resume scraping.'
    }
  });
});

// Handle alarm for periodic scraping
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicScrape') {
    // Notify content script to scrape
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeNow' });
      }
    });
  }
});
