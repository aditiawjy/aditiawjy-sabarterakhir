const http = require('http');
const fs = require('fs');

const PORT = 8765;
const ALLOWED_PATH = 'C:\\xampp\\htdocs\\sabarterakhir\\sports-scraper-extension\\minute60_history_live.csv';

function send(res, status, body = '') {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/write-minute60-csv') {
    send(res, 404, 'Not found');
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 20 * 1024 * 1024) {
      raw = '';
      send(res, 413, 'Payload too large');
      req.destroy();
    }
  });

  req.on('end', () => {
    try {
      const payload = JSON.parse(raw || '{}');
      if (payload.path !== ALLOWED_PATH || typeof payload.content !== 'string') {
        send(res, 400, 'Invalid payload');
        return;
      }

      fs.writeFileSync(ALLOWED_PATH, payload.content, 'utf8');
      send(res, 200, 'ok');
    } catch (e) {
      send(res, 500, 'Write failed');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Minute60 CSV writer running on http://127.0.0.1:${PORT}`);
});
