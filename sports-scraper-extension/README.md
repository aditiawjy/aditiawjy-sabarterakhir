# Sports Live Data Scraper Chrome Extension

node "C:\xampp\htdocs\sabarterakhir\sports-scraper-extension\write-minute60-csv-server.js"

A Chrome extension that scrapes live sports data from betting websites in real-time.

## Features

- **Real-time Data Scraping**: Automatically scrapes live sports data every 5 seconds
- **Live Match Information**: Captures scores, game time, team names, and odds
- **Odds Tracking**: Monitors odds changes with trend indicators (up/down)
- **Data Export**: Export scraped data to CSV format
- **Live Streaming Detection**: Identifies matches with live streaming available
- **Visual Dashboard**: Clean popup interface showing current live events
- **Auto-scrape Option**: Automatically starts scraping when page loads

## Data Captured

For each live event, the extension captures:
- League name and event count
- Live score
- Game time and period (1H/2H)
- Team names
- Full-time and first-half odds
- Odds trends (up/down/stable)
- Live streaming availability
- Timestamp of data capture

## Installation

1. Download or clone this repository to your local machine
2. Open Google Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the `sports-scraper-extension` folder
5. The extension should now appear in your extensions list

## Usage

1. Navigate to a sports betting website with live events
2. Click the Sports Scraper extension icon in your toolbar
3. Click "Start" to begin scraping data
4. View live data in the popup window
5. Click "Export CSV" to download the scraped data

## Extension Interface

### Popup Controls
- **Start/Stop**: Control the scraping process
- **Export CSV**: Download all scraped data as a CSV file
- **Live Events Counter**: Shows current number of live events
- **Total Records**: Shows total number of records captured

### Data Display
- League names with event counts
- Individual match cards showing:
  - Current score
  - Team names
  - Game time and period
  - Live streaming indicator (📺)

## Settings

- **Auto-scrape on page load**: Toggle automatic scraping when visiting supported pages

## Technical Details

### Files Structure
```
sports-scraper-extension/
├── manifest.json       # Extension configuration
├── content.js          # Main scraping logic
├── background.js       # Background service worker
├── popup.html          # Extension popup interface
├── popup.js            # Popup functionality
└── README.md           # This file
```

### Data Storage
- Latest 100 records stored in Chrome local storage
- Full history maintained in memory (up to 1000 records)
- CSV export includes all captured data

### Scraping Mechanism
- Uses CSS selectors to identify and extract data
- Runs every 5 seconds when active
- Automatically handles page updates and new events
- Graceful error handling for missing elements

## CSV Export Format

The exported CSV includes the following columns:
- Timestamp
- League
- Event (Teams)
- Score
- Game Time
- Team 1
- Team 2
- Market Type
- Odds
- Trend

## Privacy & Security

- Extension only runs on active tabs when manually started
- No data is sent to external servers
- All data is stored locally in the browser
- No tracking or analytics

## Compatibility

- Chrome 88+
- Works on most sports betting websites with similar HTML structure
- Designed for the specific interface shown in the example

## Troubleshooting

1. **Extension not scraping data**: 
   - Ensure you're on a compatible page
   - Try refreshing the page
   - Check browser console for errors

2. **Export not working**:
   - Ensure you have started scraping first
   - Check if browser has download permissions

3. **Data not updating**:
   - Click Stop then Start again
   - Check if the page structure has changed

## Development

To modify the extension:
1. Update the CSS selectors in `content.js` to match different websites
2. Modify the popup UI in `popup.html` and `popup.js`
3. Add new data fields in the extraction functions
4. Update the manifest version after making changes

## License

MIT License - feel free to modify and distribute

## Support

For issues or feature requests, please create an issue in the repository.
