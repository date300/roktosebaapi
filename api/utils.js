function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url) {
  const q = new Map();
  const idx = url.indexOf('?');
  if (idx === -1) return q;
  const query = url.slice(idx + 1);
  if (!query) return q;
  query.split('&').forEach(pair => {
    const [key, val] = pair.split('=');
    q.set(decodeURIComponent(key), decodeURIComponent(val || ''));
  });
  return q;
}

module.exports = { sendJson, getBody, parseQuery };