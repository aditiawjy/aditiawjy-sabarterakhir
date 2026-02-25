// Sports Live Data Scraper - Content Script
class SportsDataScraper {
  constructor() {
    this.scrapedData = [];
    this.isScraping = false;
    this.scrapeInterval = null;
    this.pendingRescrape = false;
    this.scrapeInProgress = false;
    this.retryTimer = null;
    this.retryCount = 0;
    this.maxRetryAttempts = 3;
    this.retryDelayMs = 700;
    this.scrapeIntervalMs = 5000;
    this.boundOnWindowError = this.onWindowError.bind(this);
    this.boundOnUnhandledRejection = this.onUnhandledRejection.bind(this);
    this.init();
  }

  init() {
    if (!this.isExtensionContextValid()) {
      return;
    }

    window.addEventListener('error', this.boundOnWindowError);
    window.addEventListener('unhandledrejection', this.boundOnUnhandledRejection);

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!this.isExtensionContextValid()) {
        sendResponse({ status: 'context_invalid' });
        return true;
      }

      if (request.action === 'startScraping') {
        this.startScraping();
        sendResponse({ status: 'started' });
      } else if (request.action === 'stopScraping') {
        this.stopScraping();
        sendResponse({ status: 'stopped' });
      } else if (request.action === 'scrapeNow') {
        this.scrapeLiveData();
        sendResponse({ status: 'scraped' });
      } else if (request.action === 'getData') {
        sendResponse({ data: this.scrapedData });
      } else if (request.action === 'exportData') {
        this.exportData();
        sendResponse({ status: 'exported' });
      }
    });

    // Auto-start scraping when page loads
    this.safeStorageGet(['settings'], (result) => {
      this.scrapeIntervalMs = this.getScrapeInterval(result.settings?.scrapeInterval);
      const autoScrape = result.settings?.autoScrape !== false;
      if (!autoScrape) return;

      setTimeout(() => {
        this.startScraping();
      }, 2000);
    });
  }

  startScraping() {
    if (this.isScraping) return;
    if (!this.isExtensionContextValid()) return;
    this.isScraping = true;
    this.retryCount = 0;
    this.saveScraperState(null);
    
    console.log('Starting sports data scraping...');
    
    this.safeStorageGet(['settings'], (result) => {
      this.scrapeIntervalMs = this.getScrapeInterval(result.settings?.scrapeInterval);

      if (!this.isScraping) return;

      // Scrape data on configured interval
      this.scrapeInterval = setInterval(() => {
        try {
          this.scrapeLiveData();
        } catch (e) {
          if (this.isContextInvalidError(e)) {
            this.hardStop();
            return;
          }
          this.reportError(e);
          throw e;
        }
      }, this.scrapeIntervalMs);

      // Initial scrape
      this.scrapeLiveData();
    });
  }

  scrapeLiveData() {
    if (this.scrapeInProgress) return;

    if (!this.isExtensionContextValid()) {
      this.hardStop();
      return;
    }

    this.scrapeInProgress = true;

    const expandedAny = this.expandCollapsedLeagues();
    if (expandedAny) {
      this.scheduleRetry();
    }

    const leagueContainers = document.querySelectorAll('.eventlist_asia_fe_EventListLeague_container');

    const data = {
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      debug: {
        leagueContainersFound: leagueContainers.length,
        expandedAny,
        retryCount: this.retryCount,
        scrapeIntervalMs: this.scrapeIntervalMs,
        isScraping: this.isScraping
      },
      liveEvents: []
    };
    
    leagueContainers.forEach(container => {
      const leagueData = this.extractLeagueData(container, data.debug);
      if (leagueData && leagueData.events.length > 0) {
        data.liveEvents.push(leagueData);
      }
    });

    data.debug.validLeagues = data.liveEvents.length;
    data.debug.totalEvents = data.liveEvents.reduce((sum, league) => sum + league.events.length, 0);
    data.debug.eventsWithOdds = data.liveEvents.reduce((sum, league) => {
      return sum + league.events.filter((event) => (event.odds.fullTime.length + event.odds.firstHalf.length) > 0).length;
    }, 0);
    data.ftOuSnapshots = this.extractFtOuSnapshots(data.liveEvents, data.timestamp);
    data.debug.ftOuSnapshots = data.ftOuSnapshots.length;

    if (data.liveEvents.length === 0) {
      this.scheduleRetry();
    } else {
      this.resetRetry();
    }

    // Update scraped data
    this.scrapedData.push(data);
    
    // Keep only last 100 entries to avoid memory issues
    if (this.scrapedData.length > 100) {
      this.scrapedData = this.scrapedData.slice(-100);
    }

    // Send data to background script
    this.safeRuntimeSendMessage({
      action: 'updateData',
      data: data
    });

    console.log('Scraped data:', data);
    this.scrapeInProgress = false;
  }

  expandCollapsedLeagues() {
    let expanded = false;
    const containers = document.querySelectorAll('.eventlist_asia_fe_EventListLeague_container');

    containers.forEach(container => {
      const arrow = container.querySelector('.eventlist_asia_fe_EventListLeague_expandCollapseArrow');
      const isExpanded = arrow?.classList.contains('eventlist_asia_fe_EventListLeague_expandCollapseArrowExpanded');

      if (isExpanded) return;

      const toggle = container.querySelector('.eventlist_asia_fe_EventListLeague_expandCollapse')
        || container.querySelector('.eventlist_asia_fe_EventListLeague_headerWrapper');

      if (!toggle) return;

      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      expanded = true;
    });

    return expanded;
  }

  extractLeagueData(container, debugInfo) {
    const leagueNameSpans = container.querySelectorAll('.eventlist_asia_fe_EventListLeague_leagueName span');
    const leagueName = leagueNameSpans[0]?.textContent?.trim() || '';
    const eventCount = leagueNameSpans[1]?.textContent?.trim() || '';
    
    const events = [];
    const eventElements = container.querySelectorAll('.eventlist_asia_fe_EventListLeague_singleEvent');
    
    eventElements.forEach(event => {
      const eventData = this.extractEventData(event, debugInfo);
      if (eventData) {
        events.push(eventData);
      }
    });

    if (!leagueName && events.length === 0) {
      return null;
    }

    return {
      league: leagueName,
      count: eventCount,
      events: events
    };
  }

  extractEventData(eventElement, debugInfo) {
    // Extract time and score
    const scoreElement = eventElement.querySelector('.eventlist_asia_fe_EventTime_scoreLive');
    const score = scoreElement?.textContent?.trim() || '';
    
    const progressElement = eventElement.querySelector('.eventlist_asia_fe_EventTime_gameProgress');
    const gamePart = progressElement?.querySelector('.eventlist_asia_fe_EventTime_gamePart')?.textContent?.trim() || '';
    const gameTime = progressElement?.querySelector('span:last-child')?.textContent?.trim() || '';
    
    // Extract team names
    const teamElements = eventElement.querySelectorAll('.eventlist_asia_fe_EventCard_teamNameText, .eventlist_asia_fe_EventCard_teamName');
    const rawTeams = Array.from(teamElements)
      .map((el) => el.textContent?.trim() || '')
      .filter(Boolean);
    const teams = this.getCanonicalTeams(rawTeams);

    if (!this.isValidEvent(teams, score, gameTime)) {
      return null;
    }
    
    // Extract odds
    const odds = this.extractOdds(eventElement, debugInfo);
    
    // Check if streaming is available
    const streamingIcon = eventElement.querySelector('.eventlist_asia_fe_EventIcons_iconAvailable');
    const hasStreaming = !!streamingIcon;
    
    return {
      score: score,
      gamePart: gamePart,
      gameTime: gameTime,
      teams: teams,
      odds: odds,
      hasStreaming: hasStreaming,
      timestamp: new Date().toISOString()
    };
  }

  extractOdds(eventElement, debugInfo) {
    const odds = {};

    const verticalSections = this.getVerticalSections(eventElement);
    if (debugInfo) {
      debugInfo.verticalSectionsFound = (debugInfo.verticalSectionsFound || 0) + verticalSections.length;
    }
    odds.fullTime = this.extractMarketOdds(verticalSections[0]);
    odds.firstHalf = this.extractMarketOdds(verticalSections[1]);
    
    return odds;
  }

  getVerticalSections(eventElement) {
    const primary = eventElement.querySelectorAll('.eventlist_asia_fe_sharedGrid_suspendedWrapper > .eventlist_asia_fe_sharedGrid_verticalCellWrapper');
    if (primary.length >= 2) {
      return primary;
    }

    return eventElement.querySelectorAll('.eventlist_asia_fe_sharedGrid_verticalCellWrapper');
  }

  extractMarketOdds(sectionElement) {
    const markets = [];

    if (!sectionElement) {
      return markets;
    }

    const marketElements = sectionElement.querySelectorAll('.eventlist_asia_fe_sharedGrid_singleMarket');
    
    marketElements.forEach(market => {
      const handicap = market.querySelector('.eventlist_asia_fe_sharedGrid_singleLeftLive')?.textContent?.trim() || '';
      const oddsButton = market.querySelector('.eventlist_asia_fe_sharedGrid_betCell');
      let oddsValue = (
        oddsButton?.querySelector('.eventlist_asia_fe_OddsArrow_oddsArrowNumberLive')?.textContent
        || oddsButton?.querySelector('.eventlist_asia_fe_OddsArrow_oddsArrowNumber')?.textContent
        || ''
      ).trim();

      if (!oddsValue && oddsButton) {
        const fallbackText = oddsButton.textContent || '';
        const match = fallbackText.match(/\d+(?:\.\d+)?/);
        oddsValue = match ? match[0] : '';
      }

      if (this.isValidOddsValue(oddsValue)) {
        markets.push({
          type: handicap || 'Odds',
          category: this.getMarketCategory(market, handicap),
          odds: oddsValue,
          trend: this.getOddsTrend(oddsButton)
        });
      }
    });
    
    return markets;
  }

  getOddsTrend(oddsButton) {
    const arrow = oddsButton?.querySelector('.eventlist_asia_fe_OddsArrow_oddsArrow');
    if (!arrow) return 'stable';
    
    if (arrow.classList.contains('eventlist_asia_fe_OddsArrow_oddsArrowUp')) return 'up';
    if (arrow.classList.contains('eventlist_asia_fe_OddsArrow_oddsArrowDown')) return 'down';
    return 'stable';
  }

  exportData() {
    if (!this.isExtensionContextValid()) return;

    const csvContent = this.convertToCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const filename = `sports_data_${new Date().toISOString().slice(0, 10)}.csv`;
    
    chrome.downloads.download({
      url: url,
      filename: filename
    });
  }

  convertToCSV() {
    let csv = 'Timestamp,League,Event,Score,Game Time,Team 1,Team 2,Market Type,Odds,Trend\n';
    
    this.scrapedData.forEach(entry => {
      entry.liveEvents.forEach(league => {
        league.events.forEach(event => {
          event.odds.fullTime.forEach(market => {
            csv += `"${entry.timestamp}","${league.league}","${event.teams.join(' vs ')}","${event.score}","${event.gameTime}","${event.teams[0] || ''}","${event.teams[1] || ''}","Full Time - ${market.type}","${market.odds}","${market.trend}"\n`;
          });
        });
      });
    });
    
    return csv;
  }

  stopScraping() {
    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
      this.scrapeInterval = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.isScraping = false;
    this.saveScraperState(null);
  }

  hardStop() {
    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
      this.scrapeInterval = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.isScraping = false;
    this.scrapeInProgress = false;
    this.pendingRescrape = false;
    window.removeEventListener('error', this.boundOnWindowError);
    window.removeEventListener('unhandledrejection', this.boundOnUnhandledRejection);
    this.saveScraperState('Extension context invalidated. Scraper stopped.');
  }

  scheduleRetry() {
    if (!this.isScraping || this.pendingRescrape) return;
    if (this.retryCount >= this.maxRetryAttempts) return;

    this.pendingRescrape = true;
    this.retryCount += 1;

    this.retryTimer = setTimeout(() => {
      this.pendingRescrape = false;
      this.retryTimer = null;
      this.scrapeInProgress = false;
      if (this.isScraping) {
        this.scrapeLiveData();
      }
    }, this.retryDelayMs);
  }

  resetRetry() {
    this.retryCount = 0;
    this.pendingRescrape = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  isValidEvent(teams, score, gameTime) {
    if (teams.length >= 2) return true;
    if (score && score.includes(':')) return true;
    if (gameTime && /\d/.test(gameTime)) return true;
    return false;
  }

  isValidOddsValue(value) {
    return /^\d+(?:\.\d+)?$/.test(value);
  }

  extractFtOuSnapshots(liveEvents, timestamp) {
    const snapshots = [];

    liveEvents.forEach((league) => {
      (league.events || []).forEach((event) => {
        const fullTimeMarkets = Array.isArray(event.odds?.fullTime) ? event.odds.fullTime : [];
        const ouMarkets = fullTimeMarkets.filter((market) => market.category === 'over_under');
        if (ouMarkets.length === 0) return;

        const pairs = this.buildFtOuPairs(ouMarkets);
        const minute = this.parseGameMinute(event.gameTime || '');
        const teamsList = this.getCanonicalTeams(event.teams);
        const teams = teamsList.join(' vs ');
        const normalizedLeague = this.normalizeKeyPart(league.league || '-');
        const normalizedTeams = teamsList.map((team) => this.normalizeKeyPart(team)).join('|') || '-';

        pairs.forEach((pair) => {
          if (!this.isFiniteNumber(pair.overOdds) && !this.isFiniteNumber(pair.underOdds)) {
            return;
          }

          const eventIdKey = `${normalizedLeague}|${normalizedTeams}|FT_OU`;
          snapshots.push({
            eventIdKey,
            league: league.league || '-',
            teams: teams || '-',
            line: pair.line || '-',
            gamePart: event.gamePart || '',
            minute,
            score: event.score || '-',
            overOdds: this.isFiniteNumber(pair.overOdds) ? pair.overOdds : null,
            underOdds: this.isFiniteNumber(pair.underOdds) ? pair.underOdds : null,
            timestamp
          });
        });
      });
    });

    return snapshots;
  }

  buildFtOuPairs(markets) {
    const pairs = [];
    let currentPair = null;

    markets.forEach((market) => {
      const type = String(market.type || '').trim().toUpperCase();
      const oddsNumber = Number(market.odds);
      if (!this.isFiniteNumber(oddsNumber)) return;

      if (type === 'U') {
        if (!currentPair) {
          currentPair = { line: '-', overOdds: null, underOdds: null };
          pairs.push(currentPair);
        }
        currentPair.underOdds = oddsNumber;
        return;
      }

      if (type === 'O') {
        if (!currentPair) {
          currentPair = { line: '-', overOdds: null, underOdds: null };
          pairs.push(currentPair);
        }
        currentPair.overOdds = oddsNumber;
        return;
      }

      currentPair = { line: market.type || '-', overOdds: oddsNumber, underOdds: null };
      pairs.push(currentPair);
    });

    return pairs;
  }

  parseGameMinute(gameTime) {
    const match = String(gameTime).match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  isFiniteNumber(value) {
    return Number.isFinite(value);
  }

  getCanonicalTeams(teams) {
    const source = Array.isArray(teams) ? teams : [];
    const cleaned = source
      .map((team) => String(team || '').trim())
      .filter(Boolean)
      .filter((team) => !/^draw$/i.test(team));

    if (cleaned.length >= 2) {
      return cleaned.slice(0, 2);
    }

    return cleaned;
  }

  normalizeKeyPart(value) {
    return String(value || '')
      .replace(/\[V\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  getMarketCategory(marketElement, handicap) {
    const normalized = String(handicap || '').trim().toUpperCase();

    if (!normalized) {
      return '1x2';
    }

    if (normalized === 'U' || normalized === 'O') {
      return 'over_under';
    }

    if (/\d/.test(normalized)) {
      return 'over_under';
    }

    return 'other';
  }

  saveScraperState(errorMessage) {
    this.safeStorageSet({
      scraperState: {
        isScraping: this.isScraping,
        lastUpdated: new Date().toISOString(),
        pageUrl: window.location.href,
        scrapeInterval: this.scrapeIntervalMs,
        error: errorMessage || null
      }
    });
  }

  getScrapeInterval(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 5000;
    return Math.min(15000, Math.max(2000, value));
  }

  reportError(error) {
    const message = error?.message || String(error || 'Unknown scrape error');
    this.saveScraperState(message);
    this.safeRuntimeSendMessage({
      action: 'scraperError',
      error: message,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  isContextInvalidError(errorOrMessage) {
    if (!errorOrMessage) return false;
    const text = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : (errorOrMessage.message || String(errorOrMessage));
    return /Extension context invalidated/i.test(text);
  }

  onWindowError(event) {
    if (this.isContextInvalidError(event?.message || event?.error)) {
      this.hardStop();
      event.preventDefault();
    }
  }

  onUnhandledRejection(event) {
    if (this.isContextInvalidError(event?.reason)) {
      this.hardStop();
      event.preventDefault();
    }
  }

  safeRuntimeSendMessage(payload) {
    if (!this.isExtensionContextValid()) {
      this.hardStop();
      return;
    }

    try {
      chrome.runtime.sendMessage(payload);
    } catch (e) {
      this.hardStop();
    }
  }

  safeStorageGet(keys, callback) {
    if (!this.isExtensionContextValid()) {
      callback({});
      return;
    }

    try {
      chrome.storage.local.get(keys, (result) => {
        try {
          callback(result || {});
        } catch (e) {
          callback({});
        }
      });
    } catch (e) {
      callback({});
    }
  }

  safeStorageSet(data) {
    if (!this.isExtensionContextValid()) return;

    try {
      chrome.storage.local.set(data);
    } catch (e) {
      // Ignore runtime errors during extension reload.
    }
  }
}

// Initialize a single scraper instance per tab
if (window.__sportsDataScraperInstance && typeof window.__sportsDataScraperInstance.hardStop === 'function') {
  window.__sportsDataScraperInstance.hardStop();
}
window.__sportsDataScraperInstance = new SportsDataScraper();
