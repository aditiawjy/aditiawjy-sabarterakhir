const http = require('http');
const fs = require('fs');

const PORT = 8765;
const ALLOWED_PATH = 'C:\\xampp\\htdocs\\sabarterakhir\\sports-scraper-extension\\minute60_history_live.csv';

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
}

function parseCsv(content) {
  const text = String(content || '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length === 0) continue;
    const row = {};
    header.forEach((key, idx) => {
      row[key] = fields[idx] ?? '';
    });
    rows.push(row);
  }

  return { header, rows };
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function toCsv(header, rows) {
  let csv = `${header.join(',')}\n`;
  rows.forEach((row) => {
    const values = header.map((key) => csvEscape(row[key]));
    csv += `${values.join(',')}\n`;
  });
  return csv;
}

function mergeCsv(existing, incoming) {
  const header = incoming.header.length > 0 ? incoming.header : existing.header;
  if (header.length === 0) {
    return { header: [], rows: [] };
  }

  const existingByEvent = new Map();
  existing.rows.forEach((row) => {
    if (!row.eventIdKey) return;
    existingByEvent.set(row.eventIdKey, row);
  });

  const mergedByEvent = new Map();
  incoming.rows.forEach((row) => {
    if (!row.eventIdKey) return;
    const existingRow = existingByEvent.get(row.eventIdKey);
    if (existingRow) {
      if (!row.score85Plus && existingRow.score85Plus) row.score85Plus = existingRow.score85Plus;
      if (!row.minute85Plus && existingRow.minute85Plus) row.minute85Plus = existingRow.minute85Plus;
      if (!row.capturedAt85Plus && existingRow.capturedAt85Plus) row.capturedAt85Plus = existingRow.capturedAt85Plus;
    }

    const current = mergedByEvent.get(row.eventIdKey);
    if (!current) {
      mergedByEvent.set(row.eventIdKey, row);
      return;
    }

    const currentMs = Date.parse(current.capturedAt60) || 0;
    const incomingMs = Date.parse(row.capturedAt60) || 0;
    if (incomingMs >= currentMs) {
      mergedByEvent.set(row.eventIdKey, row);
    }
  });

  return { header, rows: Array.from(mergedByEvent.values()) };
}

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
