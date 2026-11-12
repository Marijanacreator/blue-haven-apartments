const { createHash } = require('node:crypto');
const capacities = { A101: 2, A102: 3, B201: 4 };
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid inquiry.');
  const text = (key, max, optional = false) => {
    if (optional && body[key] === undefined) return '';
    if (typeof body[key] !== 'string' || body[key].length > max || (!optional && !body[key].trim())) throw Error('Please check ' + key.replaceAll('_', ' ') + '.');
    return body[key].trim();
  };
  const request_id = text('request_id', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id)) throw Error('Invalid request ID.');
  const guest_name = text('guest_name', 100), email = text('email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Please enter a valid email address.');
  const room_id = text('room_id', 4), adults = body.adults;
  if (!Object.hasOwn(capacities, room_id) || !Number.isInteger(adults) || adults < 1 || adults > capacities[room_id]) throw Error('Please choose an available apartment and a valid number of adults.');
  const date = key => {
    const v = text(key, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw Error('Please enter valid dates.');
    return v;
  };
  const check_in = date('check_in'), check_out = date('check_out');
  if (check_out <= check_in) throw Error('Check-out must be after check-in.');
  return { request_id, guest_name, email, room_id, check_in, check_out, adults, message: text('message', 500, true), source: 'website', status: 'New' };
}
function createHandler({ env = process.env, fetchImpl = fetch, now = Date.now, timeoutMs = 10000 } = {}) {
  // Bounded process-local protection; n8n must also persist request IDs atomically.
  const rates = new Map(), requests = new Map();
  return async (req, res) => {
    const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Use POST to submit an inquiry.' }); }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(415, { error: 'Send JSON data.' });
    let origin;
    try { origin = new URL(env.SITE_ORIGIN).origin; } catch { return reply(503, { error: 'Inquiries are not connected yet. Please try again later.' }); }
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Please submit using the website form.' });
    const time = now();
    for (const [key, value] of rates) if (value.expires <= time) rates.delete(key);
    for (const [key, value] of requests) if (value.expires <= time && !value.pending) requests.delete(key);
    // Vercel overwrites x-forwarded-for; local server uses the socket address.
    const ip = env.VERCEL ? String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim() : req.socket?.remoteAddress || 'local';
    const rate = rates.get(ip) || { count: 0, expires: time + 60000 };
    if (rate.count >= 10 || (!rates.has(ip) && rates.size >= 10000)) { res.setHeader('Retry-After', '60'); return reply(429, { error: 'Too many requests. Please wait a minute and try again.' }); }
    rate.count++; rates.set(ip, rate);
    let data;
    try {
      if (Number(req.headers['content-length']) > 8192) return reply(413, { error: 'Inquiry is too large.' });
      let body = req.body;
      if (body === undefined) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 8192) return reply(413, { error: 'Inquiry is too large.' }); chunks.push(Buffer.from(chunk)); }
        body = Buffer.concat(chunks).toString('utf8');
      }
      if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 8192) return reply(413, { error: 'Inquiry is too large.' });
      data = validate(typeof body === 'string' ? JSON.parse(body) : body);
    } catch (err) { return reply(400, { error: err instanceof SyntaxError ? 'Invalid JSON data.' : err.message }); }
    let webhook;
    try {
      webhook = new URL(env.N8N_WEBHOOK_URL);
      if (webhook.protocol !== 'https:' || webhook.username || webhook.password || !env.N8N_WEBHOOK_SECRET || /[\r\n]/.test(env.N8N_WEBHOOK_SECRET)) throw Error();
    } catch { return reply(503, { error: 'Inquiries are not connected yet. Your request has not been accepted. Please try again later.' }); }
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const previous = requests.get(data.request_id);
    if (previous) {
      if (previous.hash !== hash) return reply(409, { error: 'This request ID belongs to different details. Please start a new inquiry.' });
      if (previous.accepted) return reply(200, { accepted: true, request_id: data.request_id });
      return reply(409, { error: 'This inquiry is already being submitted. Please wait before retrying.' });
    }
    if (requests.size >= 10000) return reply(503, { error: 'The service is busy. Please try again shortly.' });
    const record = { hash, pending: true, expires: time + 86400000 };
    requests.set(data.request_id, record);
    try {
      const upstream = await fetchImpl(webhook.href, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': env.N8N_WEBHOOK_SECRET, 'Idempotency-Key': data.request_id }, body: JSON.stringify(data), signal: AbortSignal.timeout(timeoutMs) });
      // n8n must explicitly acknowledge the same request, rather than return its default workflow-start response.
      const answer = await upstream.json();
      if (!upstream.ok || answer.accepted !== true || answer.request_id !== data.request_id) throw Error('Not accepted');
      record.pending = false; record.accepted = true;
      return reply(200, { accepted: true, request_id: data.request_id });
    } catch {
      requests.delete(data.request_id);
      return reply(502, { error: 'We could not verify acceptance of your inquiry. Please retry with the same details. Your reservation has not been confirmed.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.validate = validate;
