// Live shared brackets, stored in Upstash Redis (Vercel Marketplace).
//
//   POST   /api/bracket              { data }  -> { id, key, version }
//   GET    /api/bracket?id=&since=n            -> { data, version, updatedAt } | { unchanged: true }
//   PUT    /api/bracket?id=  X-Edit-Key        { data } -> { version, updatedAt }
//   DELETE /api/bracket?id=  X-Edit-Key        -> { ok: true }
//
// Anyone with the id can read; only the holder of the edit key (kept on the
// organiser's device, stored here only as a hash) can change or remove it.
// Brackets expire after 90 days without an update.

const crypto = require('crypto');

const TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_BODY_BYTES = 100 * 1024;
const ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function redisConfig() {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redis(command) {
    const cfg = redisConfig();
    if (!cfg) throw Object.assign(new Error('Live sharing is not configured'), { status: 503 });
    const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(command)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw Object.assign(new Error('Storage error'), { status: 502, detail: out.error });
    return out.result;
}

const storageKey = (id) => 'bracket:' + id;
const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

function newId() {
    const bytes = crypto.randomBytes(10);
    let id = '';
    for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
    return id;
}

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

async function readBody(req) {
    // Vercel's Node runtime pre-parses JSON bodies; other hosts hand us the stream.
    if (req.body !== undefined && req.body !== null && req.body !== '') {
        if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
        const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
        if (text.length > MAX_BODY_BYTES) throw Object.assign(new Error('Bracket is too large'), { status: 413 });
        return JSON.parse(text);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Bracket is too large'), { status: 413 });
        chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// Just enough shape checking that the viewer can always render what's stored.
function validData(data) {
    return data && typeof data === 'object' && data.v === 1 &&
        Array.isArray(data.p) && Array.isArray(data.r) && data.r.length > 0 && data.r.length <= 7 &&
        data.p.length <= 64 && data.p.every(n => typeof n === 'string' && n.length <= 64);
}

async function load(id) {
    const raw = await redis(['GET', storageKey(id)]);
    return raw ? JSON.parse(raw) : null;
}

async function store(id, record) {
    await redis(['SET', storageKey(id), JSON.stringify(record), 'EX', String(TTL_SECONDS)]);
}

function checkKey(req, record) {
    const key = req.headers['x-edit-key'];
    if (!key || !record) return false;
    const a = Buffer.from(hashKey(key)), b = Buffer.from(record.h);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
    try {
        const url = new URL(req.url, 'http://local');
        const id = url.searchParams.get('id');

        if (req.method === 'POST') {
            const body = await readBody(req);
            if (!validData(body.data)) return send(res, 400, { error: 'Not a bracket' });
            const newIdValue = newId();
            const key = crypto.randomBytes(24).toString('base64url');
            const record = { h: hashKey(key), d: body.data, n: 1, u: Date.now() };
            await store(newIdValue, record);
            return send(res, 201, { id: newIdValue, key: key, version: 1, updatedAt: record.u });
        }

        if (!id || !ID_PATTERN.test(id)) return send(res, 400, { error: 'Missing or bad id' });

        if (req.method === 'GET') {
            const record = await load(id);
            if (!record) return send(res, 404, { error: 'This bracket is no longer shared' });
            const since = Number(url.searchParams.get('since'));
            if (since && since === record.n) return send(res, 200, { unchanged: true, version: record.n, updatedAt: record.u });
            return send(res, 200, { data: record.d, version: record.n, updatedAt: record.u });
        }

        if (req.method === 'PUT') {
            const body = await readBody(req);
            if (!validData(body.data)) return send(res, 400, { error: 'Not a bracket' });
            const record = await load(id);
            if (!record) return send(res, 404, { error: 'This bracket is no longer shared' });
            if (!checkKey(req, record)) return send(res, 403, { error: 'Not allowed' });
            record.d = body.data;
            record.n += 1;
            record.u = Date.now();
            await store(id, record);
            return send(res, 200, { version: record.n, updatedAt: record.u });
        }

        if (req.method === 'DELETE') {
            const record = await load(id);
            if (!record) return send(res, 200, { ok: true });
            if (!checkKey(req, record)) return send(res, 403, { error: 'Not allowed' });
            await redis(['DEL', storageKey(id)]);
            return send(res, 200, { ok: true });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return send(res, 405, { error: 'Method not allowed' });
    } catch (e) {
        if (e instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON' });
        if (e.status !== 503) console.error('bracket api:', e.message, e.detail || '');
        return send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
};
