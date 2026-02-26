// Popup Script for Sports Data Scraper
let isScraping = false;
let currentData = null;
let dataHistory = [];
let scraperState = {};
let activeOddsFilter = 'all';
let tableSort = { key: 'time', dir: 'desc' };
let ouAnalysisLatest = [];
let ouMinute60Snapshots = [];
let ouMinute60History = [];
let activeAnalysisFilter = 'all';
let filterState = {
  search: '',
  sortSelect: 'time_desc'
};
const SUPPORTED_URL_PATTERN = /^https:\/\/prod20191-101527338\.1x2aaa\.com\/en\/asian-view\/today\/Virtual-Soccer(?:\?|$)/i;

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startBtn').addEventListener('click', startScraping);
  document.getElementById('stopBtn').addEventListener('click', stopScraping);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('copyJsonBtn').addEventListener('click', copyJson);
  document.getElementById('autoScrapeToggle').addEventListener('click', toggleAutoScrape);
  document.getElementById('scrapeIntervalSelect').addEventListener('change', updateScrapeInterval);
  document.getElementById('debugToggle').addEventListener('click', toggleDebugPanel);
  document.getElementById('searchInput').addEventListener('input', updateUI);
  document.getElementById('sortSelect').addEventListener('change', updateUI);
  document.getElementById('chipAll').addEventListener('click', () => setOddsFilter('all'));
  document.getElementById('chipFt').addEventListener('click', () => setOddsFilter('ft'));
  document.getElementById('chip1h').addEventListener('click', () => setOddsFilter('1h'));
  document.getElementById('chipBoth').addEventListener('click', () => setOddsFilter('both'));
  document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
  const analysisChipAll = document.getElementById('analysisChipAll');
  if (analysisChipAll) {
    analysisChipAll.addEventListener('click', () => setAnalysisFilter('all'));
    document.getElementById('analysisChipBreakout').addEventListener('click', () => setAnalysisFilter('breakout'));
    document.getElementById('analysisChipVol').addEventListener('click', () => setAnalysisFilter('high_vol'));
    document.getElementById('analysisChip60').addEventListener('click', () => setAnalysisFilter('minute_60'));
    document.getElementById('analysisChipOver').addEventListener('click', () => setAnalysisFilter('over_only'));
    document.getElementById('exportOuBtn').addEventListener('click', exportOuAnalysisCsv);
  }

  document.getElementById('exportMinute60HistoryBtn').addEventListener('click', exportMinute60HistoryCsv);

  loadSettings();
  loadScrapeState();
  loadData();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.latestData) {
      currentData = changes.latestData.newValue || null;
      updateUI();
    }

    if (changes.ouAnalysisLatest) {
      ouAnalysisLatest = changes.ouAnalysisLatest.newValue || [];
      renderOuAnalysisTable();
    }

    if (changes.ouMinute60Snapshots) {
      ouMinute60Snapshots = changes.ouMinute60Snapshots.newValue || [];
      renderMinute60Table();
    }

    if (changes.ouMinute60History) {
      ouMinute60History = changes.ouMinute60History.newValue || [];
      renderMinute60HistoryTable();
    }

    if (changes.dataHistory) {
      dataHistory = changes.dataHistory.newValue || [];
      document.getElementById('totalRecords').textContent = dataHistory.length;
    }

    if (changes.scraperState) {
      scraperState = changes.scraperState.newValue || {};
      updateScrapingUI(!!scraperState.isScraping);
      updateMetaInfo();
    }
  });
  
  // Refresh data every 2 seconds when popup is open
  setInterval(() => {
    loadData();
  }, 2000);

  setInterval(() => {
    updateMetaInfo();
  }, 1000);
});

function loadScrapeState() {
  chrome.storage.local.get(['scraperState'], (result) => {
    scraperState = result.scraperState || {};
    updateScrapingUI(!!scraperState.isScraping);
    updateMetaInfo();
  });
}

function updateScrapingUI(active) {
  isScraping = active;
  document.getElementById('startBtn').disabled = active;
  document.getElementById('stopBtn').disabled = !active;
  document.getElementById('statusDot').classList.toggle('active', active);
  document.getElementById('statusText').textContent = active ? 'Active' : 'Inactive';

  const statusBadge = document.getElementById('statusBadge');
  statusBadge.classList.remove('running', 'stopped', 'error');
  statusBadge.classList.add(active ? 'running' : 'stopped');
  statusBadge.textContent = active ? 'Running' : 'Stopped';
}

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    const autoScrapeToggle = document.getElementById('autoScrapeToggle');
    const intervalSelect = document.getElementById('scrapeIntervalSelect');
    const debugToggle = document.getElementById('debugToggle');

    if (settings.autoScrape === false) {
      autoScrapeToggle.classList.remove('active');
    }

    const intervalValue = String(settings.scrapeInterval || 5000);
    if ([...intervalSelect.options].some((option) => option.value === intervalValue)) {
      intervalSelect.value = intervalValue;
    } else {
      intervalSelect.value = '5000';
    }

    if (settings.showDebugPanel) {
      debugToggle.classList.add('active');
      setDebugPanelVisible(true);
    }
  });
}

// Load data from storage
function loadData() {
  chrome.storage.local.get(['latestData', 'dataHistory', 'scraperState', 'ouAnalysisLatest', 'ouMinute60Snapshots', 'ouMinute60History'], (result) => {
    if (result.latestData) {
      currentData = result.latestData;
      updateUI();
    }
    
    if (result.dataHistory) {
      dataHistory = result.dataHistory;
      document.getElementById('totalRecords').textContent = dataHistory.length;
    }

    if (result.scraperState) {
      scraperState = result.scraperState;
      updateMetaInfo();
    }

    if (result.ouAnalysisLatest) {
      ouAnalysisLatest = result.ouAnalysisLatest;
      renderOuAnalysisTable();
    }

    if (result.ouMinute60Snapshots) {
      ouMinute60Snapshots = result.ouMinute60Snapshots;
      renderMinute60Table();
    }

    if (result.ouMinute60History) {
      ouMinute60History = result.ouMinute60History;
      renderMinute60HistoryTable();
    }
  });
}

// Update UI with current data
function updateUI() {
  if (!currentData) return;
  
  // Update stats
  let totalEvents = 0;
  if (currentData.liveEvents) {
    currentData.liveEvents.forEach(league => {
      totalEvents += league.events.length;
    });
  }
  
  document.getElementById('liveEventsCount').textContent = totalEvents;
  
  // Update live data display
  const container = document.getElementById('liveDataContainer');
  container.innerHTML = '';
  
  if (!currentData.liveEvents || currentData.liveEvents.length === 0) {
    container.innerHTML = '<div class="no-data">No live events found</div>';
    return;
  }

  const table = createEventsTable(currentData.liveEvents);
  container.appendChild(table);
  updateErrorCard();
  renderOuAnalysisTable();
  renderMinute60Table();
  renderMinute60HistoryTable();
}

function createEventsTable(liveEvents) {
  const wrapper = document.createElement('div');
  wrapper.className = 'events-table-wrapper';

  const table = document.createElement('table');
  table.className = 'events-table';

  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML = '<col><col><col><col><col><col><col>';
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.appendChild(createHeaderCell('Teams', 'teams'));
  headerRow.appendChild(createHeaderCell('Score', 'score'));
  headerRow.appendChild(createHeaderCell('Time', 'time'));
  headerRow.appendChild(createHeaderCell('FT O/U', null));
  headerRow.appendChild(createHeaderCell('FT 1X2', null));
  headerRow.appendChild(createHeaderCell('1H O/U', null));
  headerRow.appendChild(createHeaderCell('1H 1X2', null));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const rows = applySearchAndSort(flattenRows(liveEvents));

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.appendChild(createTeamsCell(row.teamsText, row.league));
    tr.appendChild(createCell(row.score || '-', { className: 'score-badge' }));
    tr.appendChild(createCell(row.timeText || '-', { className: 'time-badge' }));
    tr.appendChild(createOverUnderCell(row.ftOverUnderMarkets));
    tr.appendChild(createVerticalOddsCell(row.ft1x2Markets));
    tr.appendChild(createOverUnderCell(row.firstHalfOverUnderMarkets));
    tr.appendChild(createVerticalOddsCell(row.firstHalf1x2Markets));
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function flattenRows(liveEvents) {
  const rows = [];

  liveEvents.forEach((league) => {
    (league.events || []).forEach((event) => {
      const teamsText = event.teams && event.teams.length ? event.teams.join(' vs ') : '-';
      const leagueText = `${league.league || '-'} ${league.count || ''}`.trim();
      const timeText = `${event.gamePart || ''} ${event.gameTime || ''}`.trim();
      const fullTimeMarkets = event.odds && Array.isArray(event.odds.fullTime) ? event.odds.fullTime : [];
      const firstHalfMarkets = event.odds && Array.isArray(event.odds.firstHalf) ? event.odds.firstHalf : [];
      const ftOverUnderMarkets = fullTimeMarkets.filter((market) => market.category === 'over_under');
      const ft1x2Markets = fullTimeMarkets.filter((market) => market.category === '1x2');
      const firstHalfOverUnderMarkets = firstHalfMarkets.filter((market) => market.category === 'over_under');
      const firstHalf1x2Markets = firstHalfMarkets.filter((market) => market.category === '1x2');

      rows.push({
        league: leagueText,
        teamsText,
        teamsWithLeague: `${teamsText} | ${leagueText}`,
        score: event.score || '-',
        timeText: timeText || '-',
        gameMinute: parseGameMinute(event.gameTime || ''),
        scoreTotal: parseScoreTotal(event.score || ''),
        fullTimeMarkets,
        firstHalfMarkets
        ,ftOverUnderMarkets
        ,ft1x2Markets
        ,firstHalfOverUnderMarkets
        ,firstHalf1x2Markets
      });
    });
  });

  return rows;
}

function applySearchAndSort(rows) {
  const searchValue = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const sortValue = document.getElementById('sortSelect')?.value || 'time_desc';

  filterState.search = searchValue;
  filterState.sortSelect = sortValue;

  let filtered = rows;

  if (searchValue) {
    filtered = rows.filter((row) => (
      row.teamsWithLeague.toLowerCase().includes(searchValue)
      || row.score.toLowerCase().includes(searchValue)
      || row.timeText.toLowerCase().includes(searchValue)
      || formatMarkets(row.ftOverUnderMarkets).toLowerCase().includes(searchValue)
      || format1x2Markets(row.ft1x2Markets).toLowerCase().includes(searchValue)
      || formatMarkets(row.firstHalfOverUnderMarkets).toLowerCase().includes(searchValue)
      || format1x2Markets(row.firstHalf1x2Markets).toLowerCase().includes(searchValue)
    ));
  }

  if (activeOddsFilter === 'ft') {
    filtered = filtered.filter((row) => row.ftOverUnderMarkets.length > 0 || row.ft1x2Markets.length > 0);
  } else if (activeOddsFilter === '1h') {
    filtered = filtered.filter((row) => row.firstHalfOverUnderMarkets.length > 0 || row.firstHalf1x2Markets.length > 0);
  } else if (activeOddsFilter === 'both') {
    filtered = filtered.filter((row) => {
      const hasFT = row.ftOverUnderMarkets.length > 0 || row.ft1x2Markets.length > 0;
      const has1H = row.firstHalfOverUnderMarkets.length > 0 || row.firstHalf1x2Markets.length > 0;
      return hasFT && has1H;
    });
  }

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (tableSort.key === 'time') return tableSort.dir === 'asc' ? a.gameMinute - b.gameMinute : b.gameMinute - a.gameMinute;
    if (tableSort.key === 'teams') return tableSort.dir === 'asc' ? a.teamsText.localeCompare(b.teamsText) : b.teamsText.localeCompare(a.teamsText);
    if (tableSort.key === 'score') return tableSort.dir === 'asc' ? a.scoreTotal - b.scoreTotal : b.scoreTotal - a.scoreTotal;
    if (sortValue === 'time_asc') return a.gameMinute - b.gameMinute;
    if (sortValue === 'teams_asc') return a.teamsText.localeCompare(b.teamsText);
    if (sortValue === 'score_desc') return b.scoreTotal - a.scoreTotal;
    return b.gameMinute - a.gameMinute;
  });

  return sorted;
}

function parseGameMinute(gameTime) {
  const match = String(gameTime).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseScoreTotal(scoreText) {
  const numbers = String(scoreText).match(/\d+/g);
  if (!numbers || numbers.length < 2) return 0;
  return Number(numbers[0]) + Number(numbers[1]);
}

function createCell(value, options = {}) {
  const td = document.createElement('td');
  if (options.className) {
    const span = document.createElement('span');
    span.className = options.className;
    span.textContent = value;
    td.appendChild(span);
  } else {
    td.textContent = value;
  }
  td.title = String(value || '');
  return td;
}

function createTeamsCell(teams, league) {
  const td = document.createElement('td');
  td.className = 'teams-cell';

  const teamsLine = document.createElement('div');
  teamsLine.textContent = teams;
  teamsLine.title = teams;

  const leagueLine = document.createElement('span');
  leagueLine.className = 'league-sub';
  leagueLine.textContent = league;
  leagueLine.title = league;

  td.appendChild(teamsLine);
  td.appendChild(leagueLine);
  return td;
}

function createVerticalOddsCell(markets) {
  const td = document.createElement('td');
  td.className = 'odds-stack-cell';

  if (!Array.isArray(markets) || markets.length === 0) {
    td.textContent = '-';
    return td;
  }

  markets.slice(0, 6).forEach((market) => {
    const line = document.createElement('div');
    line.className = 'odds-stack-item';
    line.textContent = market.odds;
    td.appendChild(line);
  });

  td.title = format1x2Markets(markets);
  return td;
}

function createOverUnderCell(markets) {
  const td = document.createElement('td');
  td.className = 'ou-stack-cell';

  if (!Array.isArray(markets) || markets.length === 0) {
    td.textContent = '-';
    return td;
  }

  markets.slice(0, 6).forEach((market) => {
    const line = document.createElement('div');
    line.className = 'ou-stack-item';

    const marketType = document.createElement('span');
    marketType.className = 'ou-market-type';
    marketType.textContent = market.type || '-';

    const marketOdds = document.createElement('span');
    marketOdds.className = 'ou-market-odds';
    marketOdds.textContent = market.odds || '-';

    line.appendChild(marketType);
    line.appendChild(marketOdds);
    td.appendChild(line);
  });

  td.title = formatMarkets(markets);
  return td;
}

function createHeaderCell(label, key) {
  const th = document.createElement('th');
  th.textContent = label;

  if (!key) {
    th.classList.add('no-sort');
    return th;
  }

  if (tableSort.key === key) {
    th.classList.add('sorted');
    th.textContent = `${label} ${tableSort.dir === 'asc' ? '↑' : '↓'}`;
  }

  th.addEventListener('click', () => {
    if (tableSort.key === key) {
      tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      tableSort.key = key;
      tableSort.dir = key === 'teams' ? 'asc' : 'desc';
    }
    updateUI();
  });

  return th;
}

function formatMarkets(markets) {
  return markets
    .slice(0, 6)
    .map((market) => `${market.type} ${market.odds}`)
    .join(' | ');
}

function format1x2Markets(markets) {
  return markets
    .slice(0, 6)
    .map((market) => market.odds)
    .join(' | ');
}

function updateMetaInfo() {
  const metaEl = document.getElementById('metaInfo');
  if (!metaEl) return;

  const lastUpdated = scraperState.lastUpdated ? new Date(scraperState.lastUpdated).toLocaleTimeString() : '-';
  const age = getAgeText(scraperState.lastUpdated);
  const pageUrl = scraperState.pageUrl || '-';
  const totalEvents = Number.isFinite(scraperState.totalEvents) ? scraperState.totalEvents : 0;
  metaEl.textContent = `Last update: ${lastUpdated} (${age}) | Events: ${totalEvents} | Source: ${pageUrl}`;

  const statusBadge = document.getElementById('statusBadge');
  const hasError = !!scraperState.error;
  if (hasError) {
    statusBadge.classList.remove('running', 'stopped');
    statusBadge.classList.add('error');
    statusBadge.textContent = 'Error';
  }

  updateDebugPanel();
}

function getAgeText(isoTime) {
  if (!isoTime) return '-';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  return `${minutes}m ago`;
}

function sendMessageToActiveTab(message, onSuccess, onFailure) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.id) {
      if (onFailure) onFailure('No active tab found');
      return;
    }

    if (!/^https?:\/\//i.test(activeTab.url || '')) {
      if (onFailure) onFailure('Active tab is not a website');
      return;
    }

    if (!SUPPORTED_URL_PATTERN.test(activeTab.url || '')) {
      if (onFailure) onFailure('Open the Virtual Soccer page, then try again');
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        const missingReceiver = chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('Receiving end does not exist');

        if (!missingReceiver) {
          if (onFailure) onFailure(chrome.runtime.lastError.message);
          return;
        }

        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            files: ['content.js']
          },
          () => {
            if (chrome.runtime.lastError) {
              if (onFailure) onFailure(chrome.runtime.lastError.message);
              return;
            }

            setTimeout(() => {
              chrome.tabs.sendMessage(activeTab.id, message, (retryResponse) => {
                if (chrome.runtime.lastError) {
                  if (onFailure) onFailure(chrome.runtime.lastError.message);
                  return;
                }

                if (onSuccess) onSuccess(retryResponse);
              });
            }, 150);
          }
        );
        return;
      }

      if (onSuccess) onSuccess(response);
    });
  });
}

// Start scraping
function startScraping() {
  updateScrapingUI(true);
  chrome.runtime.sendMessage({ action: 'resetMinute60History' }, () => {
    // Send message to content script
    sendMessageToActiveTab(
      { action: 'startScraping' },
      null,
      () => {
        showError('Open a supported website tab, refresh it, then try again');
        stopScraping();
      }
    );
  });
}

// Stop scraping
function stopScraping() {
  updateScrapingUI(false);
  
  // Send message to content script
  sendMessageToActiveTab({ action: 'stopScraping' });
}

// Export data
function exportData() {
  if (!currentData || !Array.isArray(currentData.liveEvents)) {
    showError('No data to export yet. Start scraping first.');
    return;
  }

  const rows = applySearchAndSort(flattenRows(currentData.liveEvents));
  if (rows.length === 0) {
    showError('No rows match current filter.');
    return;
  }

  let csv = 'Teams,League,Score,Time,FT OverUnder,FT 1X2,1H OverUnder,1H 1X2\n';
  rows.forEach((row) => {
    const line = [
      row.teamsText,
      row.league,
      row.score,
      row.timeText,
      formatMarkets(row.ftOverUnderMarkets),
      format1x2Markets(row.ft1x2Markets),
      formatMarkets(row.firstHalfOverUnderMarkets),
      format1x2Markets(row.firstHalf1x2Markets)
    ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',');
    csv += `${line}\n`;
  });

  copyText(csv,
    'CSV copied from current table.',
    'Copy CSV failed. Allow clipboard permission.'
  );
}

function copyJson() {
  if (!currentData || !Array.isArray(currentData.liveEvents)) {
    showError('No data to copy yet. Start scraping first.');
    return;
  }

  const rows = applySearchAndSort(flattenRows(currentData.liveEvents)).map((row) => ({
    teams: row.teamsText,
    league: row.league,
    score: row.score,
    time: row.timeText,
    fullTimeOverUnder: row.ftOverUnderMarkets,
    fullTime1x2: row.ft1x2Markets,
    firstHalfOverUnder: row.firstHalfOverUnderMarkets,
    firstHalf1x2: row.firstHalf1x2Markets,
    fullTimeMarkets: row.fullTimeMarkets,
    firstHalfMarkets: row.firstHalfMarkets
  }));

  navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
    .then(() => showSuccess('JSON copied from current table.'))
    .catch(() => showError('Copy failed. Allow clipboard permission.'));
}

// Toggle auto-scrape setting
function toggleAutoScrape() {
  const toggle = document.getElementById('autoScrapeToggle');
  const isActive = toggle.classList.toggle('active');
  
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    settings.autoScrape = isActive;
    chrome.storage.local.set({ settings });
  });
}

function updateScrapeInterval() {
  const intervalSelect = document.getElementById('scrapeIntervalSelect');
  const interval = Number(intervalSelect.value) || 5000;

  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    settings.scrapeInterval = interval;
    chrome.storage.local.set({ settings }, () => {
      showSuccess(`Scrape interval set to ${interval / 1000}s`);
    });
  });
}

function setOddsFilter(filterValue) {
  activeOddsFilter = filterValue;
  const chipIds = ['chipAll', 'chipFt', 'chip1h', 'chipBoth'];
  chipIds.forEach((id) => document.getElementById(id).classList.remove('active'));
  if (filterValue === 'all') document.getElementById('chipAll').classList.add('active');
  if (filterValue === 'ft') document.getElementById('chipFt').classList.add('active');
  if (filterValue === '1h') document.getElementById('chip1h').classList.add('active');
  if (filterValue === 'both') document.getElementById('chipBoth').classList.add('active');
  updateUI();
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('sortSelect').value = 'time_desc';
  tableSort = { key: 'time', dir: 'desc' };
  setOddsFilter('all');
}

function setAnalysisFilter(filterValue) {
  activeAnalysisFilter = filterValue;
  const chipMap = {
    all: 'analysisChipAll',
    breakout: 'analysisChipBreakout',
    high_vol: 'analysisChipVol',
    minute_60: 'analysisChip60',
    over_only: 'analysisChipOver'
  };

  Object.values(chipMap).forEach((id) => document.getElementById(id).classList.remove('active'));
  const activeId = chipMap[filterValue] || chipMap.all;
  document.getElementById(activeId).classList.add('active');
  renderOuAnalysisTable();
}

function renderOuAnalysisTable() {
  const tbody = document.getElementById('analysisTableBody');
  if (!tbody) return;

  const rows = filterOuAnalysisRows(ouAnalysisLatest || []);
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13">No FT O/U analysis yet.</td></tr>';
    return;
  }

  rows.slice(0, 120).forEach((row) => {
    const tr = document.createElement('tr');
    tr.appendChild(createAnalysisMatchCell(row.teams || '-'));
    tr.appendChild(createAnalysisScoreCell(row));
    tr.appendChild(createPlainCell(row.line || '-'));
    tr.appendChild(createMinute60FrozenGapCell(row));
    tr.appendChild(createPlainCell(`${fmt(row.overNow)} / ${fmtDelta(row.overDelta5)}`));
    tr.appendChild(createPlainCell(`${fmt(row.underNow)} / ${fmtDelta(row.underDelta5)}`));
    tr.appendChild(createPlainCell(fmt(row.volatility)));
    tr.appendChild(createPatternCell(row.pattern || 'stable'));
    tr.appendChild(createSignalCell(row));
    tr.appendChild(createPlainCell(String(row.minute ?? 0)));
    tr.appendChild(createPlainCell(fmtGoalMinute(row.goalMinute)));
    tr.appendChild(createPlainCell(fmtSeconds(row.firstChangeSeconds)));
    tr.appendChild(createPlainCell(fmtThresholdSeconds(row.thresholdChangeSeconds, row.goalThreshold)));
    tbody.appendChild(tr);
  });
}

function renderMinute60Table() {
  const tbody = document.getElementById('minute60TableBody');
  if (!tbody) return;

  const rows = Array.isArray(ouMinute60Snapshots) ? ouMinute60Snapshots : [];
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">No minute-60 snapshots yet.</td></tr>';
    return;
  }

  rows.slice(0, 120).forEach((row) => {
    const tr = document.createElement('tr');
    tr.appendChild(createAnalysisMatchCell(row.teams || '-'));
    tr.appendChild(createPlainCell(row.score || '-'));
    tr.appendChild(createPlainCell(row.line || '-'));
    tr.appendChild(createGapCell(row.score, row.line, true));
    tr.appendChild(createPlainCell(fmt(row.overNow)));
    tr.appendChild(createPlainCell(fmt(row.underNow)));
    tr.appendChild(createPatternCell(row.pattern || 'stable'));
    tr.appendChild(createSignalCell(row));
    tr.appendChild(createPlainCell(String(row.minute ?? 0)));
    tbody.appendChild(tr);
  });
}

function renderMinute60HistoryTable() {
  const tbody = document.getElementById('minute60HistoryTableBody');
  if (!tbody) return;

  const rows = Array.isArray(ouMinute60History) ? ouMinute60History : [];
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No minute-60 history yet.</td></tr>';
    return;
  }

  rows.slice(0, 200).forEach((row) => {
    const tr = document.createElement('tr');
    tr.appendChild(createAnalysisMatchCell(row.teams || '-'));
    tr.appendChild(createPlainCell(row.line60 || '-'));
    tr.appendChild(createPlainCell(`${fmt(row.over60)} / ${fmt(row.under60)}`));
    tr.appendChild(createPlainCell(`${row.score60 || '-'} (${row.minute60 || '-'})`));
    tr.appendChild(createPlainCell(row.score85Plus ? `${row.score85Plus}${row.minute85Plus ? ` (${row.minute85Plus})` : ''}` : '-'));
    tr.appendChild(createSignalCell({
      signal: row.signal60,
      confidence: row.confidence60,
      signalReasons: []
    }));
    tbody.appendChild(tr);
  });
}

function filterOuAnalysisRows(rows) {
  if (!Array.isArray(rows)) return [];

  let filtered = rows;
  if (activeAnalysisFilter === 'breakout') {
    filtered = filtered.filter((row) => !!row.breakout);
  } else if (activeAnalysisFilter === 'high_vol') {
    filtered = filtered.filter((row) => Number(row.volatility) >= 0.08);
  } else if (activeAnalysisFilter === 'minute_60') {
    filtered = filtered.filter((row) => Number(row.minute) >= 60);
  } else if (activeAnalysisFilter === 'over_only') {
    filtered = filtered.filter((row) => row.signal === 'OVER_CANDIDATE');
  }

  return [...filtered].sort((a, b) => {
    if (!!a.breakout !== !!b.breakout) return a.breakout ? -1 : 1;
    return Number(b.volatility || 0) - Number(a.volatility || 0);
  });
}

function createPlainCell(value) {
  const td = document.createElement('td');
  td.textContent = value;
  td.title = value;
  return td;
}

function createAnalysisMatchCell(teams) {
  const td = document.createElement('td');
  td.className = 'analysis-match-cell';

  const teamsLine = document.createElement('span');
  teamsLine.className = 'analysis-match-teams';
  teamsLine.textContent = teams;

  td.appendChild(teamsLine);
  td.title = teams;
  return td;
}

function createPatternCell(pattern) {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `pattern-badge pattern-${pattern}`;
  badge.textContent = pattern;
  td.appendChild(badge);
  return td;
}

function createGapCell(scoreText, lineText, withHighlight = false) {
  const scoreTotal = parseScoreTotalFromText(scoreText);
  const lineBase = parseLineBaseFromText(lineText);

  if (!Number.isFinite(scoreTotal) || !Number.isFinite(lineBase)) {
    return createPlainCell('-');
  }

  const gap = Number((lineBase - scoreTotal).toFixed(2));
  const sign = gap > 0 ? '+' : '';
  const text = `${sign}${gap}`;

  if (!withHighlight || gap !== 2.5) {
    return createPlainCell(text);
  }

  const td = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'gap-highlight';
  badge.textContent = text;
  td.appendChild(badge);
  td.title = `Gap ${text} highlighted`;
  return td;
}

function createMinute60FrozenGapCell(row) {
  const snapshot = findMinute60Snapshot(row.eventIdKey);
  if (!snapshot) {
    return createPlainCell('-');
  }

  const scoreTotal = parseScoreTotalFromText(snapshot.score);
  const lineBase = parseLineBaseFromText(snapshot.line);
  if (!Number.isFinite(scoreTotal) || !Number.isFinite(lineBase)) {
    return createPlainCell('-');
  }

  const gap = Number((lineBase - scoreTotal).toFixed(2));
  const sign = gap > 0 ? '+' : '';
  const td = createPlainCell(`${sign}${gap}`);
  td.title = `Frozen at minute ${snapshot.minute}`;
  return td;
}

function findMinute60Snapshot(eventIdKey) {
  if (!eventIdKey || !Array.isArray(ouMinute60Snapshots)) return null;
  return ouMinute60Snapshots.find((row) => row.eventIdKey === eventIdKey) || null;
}

function parseScoreTotalFromText(scoreText) {
  const numbers = String(scoreText || '').match(/\d+/g);
  if (!numbers || numbers.length < 2) return NaN;
  return Number(numbers[0]) + Number(numbers[1]);
}

function parseLineBaseFromText(lineText) {
  const values = String(lineText || '')
    .split('/')
    .map((part) => Number(String(part).trim()))
    .filter((num) => Number.isFinite(num));

  if (values.length === 0) return NaN;
  if (values.length === 1) return values[0];
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function createAnalysisScoreCell(row) {
  const td = document.createElement('td');
  td.className = 'analysis-score-cell';

  const wrap = document.createElement('span');
  wrap.className = 'analysis-score-wrap';

  const score = document.createElement('span');
  score.textContent = row.score || '-';

  if (row.goalJustHappened) {
    score.classList.add('analysis-score-goal');

    const chip = document.createElement('span');
    chip.className = 'analysis-goal-chip';
    chip.textContent = row.goalDelta > 1 ? `GOAL x${row.goalDelta}` : 'GOAL!';
    wrap.appendChild(score);
    wrap.appendChild(chip);
  } else {
    wrap.appendChild(score);
  }

  td.appendChild(wrap);
  td.title = row.goalJustHappened && row.goalAt
    ? `Goal detected at ${new Date(row.goalAt).toLocaleTimeString()}`
    : (row.score || '-');
  return td;
}

function createSignalCell(row) {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  const isOver = row.signal === 'OVER_CANDIDATE';

  badge.className = `signal-badge ${isOver ? 'signal-over' : 'signal-no'}`;
  badge.textContent = row.signal || 'NO_TRADE';
  td.appendChild(badge);

  const reasons = Array.isArray(row.signalReasons) ? row.signalReasons.join(', ') : '-';
  td.title = `Confidence: ${row.confidence || '-'} | ${reasons}`;
  return td;
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(2);
}

function fmtDelta(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '-';
  if (num > 0) return `+${num.toFixed(2)}`;
  return num.toFixed(2);
}

function fmtGoalMinute(value) {
  const minute = Number(value);
  if (!Number.isFinite(minute) || minute <= 0) return '-';
  return String(Math.round(minute));
}

function fmtSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  return `${Math.round(seconds)}s`;
}

function fmtThresholdSeconds(value, threshold) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return `${Math.round(seconds)}s`;
  }

  const thresholdNum = Number(threshold);
  const suffix = Number.isFinite(thresholdNum) ? thresholdNum.toFixed(2) : '0.03';
  return `>=${suffix} pending`;
}

function exportOuAnalysisCsv() {
  const rows = filterOuAnalysisRows(ouAnalysisLatest || []);
  if (rows.length === 0) {
    showError('No FT O/U analysis rows to export.');
    return;
  }

  const header = [
    'eventIdKey',
    'league',
    'teams',
    'score',
    'line',
    'gap',
    'minute',
    'overNow',
    'underNow',
    'overDelta1',
    'underDelta1',
    'overDelta3',
    'underDelta3',
    'overDelta5',
    'underDelta5',
    'velocityOver',
    'velocityUnder',
    'volatility',
    'breakout',
    'pattern',
    'signal',
    'confidence',
    'signalReasons',
    'goalMinute',
    'firstChangeSeconds',
    'thresholdChangeSeconds',
    'goalThreshold',
    'overChangeFromGoal',
    'underChangeFromGoal',
    'samples',
    'lastUpdated'
  ];

  let csv = `${header.join(',')}\n`;
  rows.forEach((row) => {
    const values = [
      row.eventIdKey,
      row.league,
      row.teams,
      row.score,
      row.line,
      computeGapValue(row.score, row.line),
      row.minute,
      row.overNow,
      row.underNow,
      row.overDelta1,
      row.underDelta1,
      row.overDelta3,
      row.underDelta3,
      row.overDelta5,
      row.underDelta5,
      row.velocityOver,
      row.velocityUnder,
      row.volatility,
      row.breakout,
      row.pattern,
      row.signal,
      row.confidence,
      Array.isArray(row.signalReasons) ? row.signalReasons.join('|') : '',
      row.goalMinute,
      row.firstChangeSeconds,
      row.thresholdChangeSeconds,
      row.goalThreshold,
      row.overChangeFromGoal,
      row.underChangeFromGoal,
      row.samples,
      row.lastUpdated
    ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`);

    csv += `${values.join(',')}\n`;
  });

  copyText(csv,
    'FT O/U analysis CSV copied.',
    'Copy FT O/U CSV failed. Allow clipboard permission.'
  );
}

function exportMinute60HistoryCsv() {
  const rows = Array.isArray(ouMinute60History) ? ouMinute60History : [];
  if (rows.length === 0) {
    showError('No minute-60 history rows to export yet.');
    return;
  }

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

  copyText(csv,
    'Minute 60 history CSV copied.',
    'Copy minute 60 CSV failed. Allow clipboard permission.'
  );
}

function copyText(text, successMessage, failureMessage) {
  navigator.clipboard.writeText(text)
    .then(() => showSuccess(successMessage))
    .catch(() => showError(failureMessage));
}

function computeGapValue(scoreText, lineText) {
  const scoreTotal = parseScoreTotalFromText(scoreText);
  const lineBase = parseLineBaseFromText(lineText);
  if (!Number.isFinite(scoreTotal) || !Number.isFinite(lineBase)) return '';
  const gap = Number((lineBase - scoreTotal).toFixed(2));
  const sign = gap > 0 ? '+' : '';
  return `${sign}${gap}`;
}

function toggleDebugPanel() {
  const toggle = document.getElementById('debugToggle');
  const isActive = toggle.classList.toggle('active');
  setDebugPanelVisible(isActive);

  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    settings.showDebugPanel = isActive;
    chrome.storage.local.set({ settings });
  });
}

function setDebugPanelVisible(visible) {
  const panel = document.getElementById('debugPanel');
  panel.classList.toggle('visible', visible);
}

function updateDebugPanel() {
  const debug = scraperState.debug || currentData?.debug || {};
  const error = scraperState.error || '-';

  document.getElementById('debugLineLeagues').textContent = `Leagues found: ${debug.leagueContainersFound ?? '-'}`;
  document.getElementById('debugLineValid').textContent = `Valid leagues/events: ${debug.validLeagues ?? '-'} / ${debug.totalEvents ?? '-'}`;
  document.getElementById('debugLineOdds').textContent = `Events with odds: ${debug.eventsWithOdds ?? '-'}`;
  document.getElementById('debugLineSections').textContent = `Vertical sections found: ${debug.verticalSectionsFound ?? '-'}`;
  document.getElementById('debugLineRetry').textContent = `Retry count: ${debug.retryCount ?? '-'}`;
  document.getElementById('debugLineError').textContent = `Last error: ${error}`;
}

function updateErrorCard() {
  const errorCard = document.getElementById('errorCard');
  const message = scraperState.error;

  if (!message) {
    errorCard.classList.remove('visible');
    errorCard.textContent = '-';
    return;
  }

  errorCard.classList.add('visible');
  errorCard.textContent = `Last error: ${message}. Try: refresh page, then click Start.`;
}

// Show error message
function showError(message) {
  const container = document.getElementById('liveDataContainer');
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'padding: 16px; background: #ffebee; color: #c62828; border-radius: 4px; margin: 8px;';
  errorDiv.textContent = message;
  container.appendChild(errorDiv);
  
  setTimeout(() => {
    errorDiv.remove();
  }, 3000);
}

// Show success message
function showSuccess(message) {
  const container = document.getElementById('liveDataContainer');
  const successDiv = document.createElement('div');
  successDiv.style.cssText = 'padding: 16px; background: #e8f5e9; color: #2e7d32; border-radius: 4px; margin: 8px;';
  successDiv.textContent = message;
  container.appendChild(successDiv);
  
  setTimeout(() => {
    successDiv.remove();
  }, 3000);
}
