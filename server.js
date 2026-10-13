'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.resolve(ROOT, process.env.SESSION_DB_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || './data/trop.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const DB = new Database(DB_PATH);
DB.pragma('journal_mode = WAL');
DB.pragma('foreign_keys = ON');
DB.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  premium_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tx_ref TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  flw_transaction_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-this-session-secret-before-deploying');
if (!SESSION_SECRET || (process.env.NODE_ENV === 'production' && SESSION_SECRET.length < 32)) {
  console.error('Set SESSION_SECRET to a random value of at least 32 characters before production.');
  process.exit(1);
}
const SQLiteStore = SQLiteStoreFactory(session);
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"],
    frameAncestors: ["'none'"], formAction: ["'self'", 'https://checkout.flutterwave.com']
  } }, crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR, concurrentDB: true }),
  name: 'trop.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const PLANS = {
  monthly: { name: 'TROP Pro Monthly', amount: 35000, currency: 'UGX', days: 30 },
  annual: { name: 'TROP Pro Annual', amount: 350000, currency: 'UGX', days: 365 }
};
const ALLOWED = new Set(['BTC/USD', 'ETH/USD', 'EUR/USD', 'AAPL', 'XAU/USD']);
const SAMPLE = {
  'BTC/USD': { price: 67420.50, change: 1.82, seed: 5 },
  'ETH/USD': { price: 3524.18, change: 0.94, seed: 11 },
  'EUR/USD': { price: 1.08742, change: -0.23, seed: 19 },
  'AAPL': { price: 228.84, change: 0.67, seed: 27 },
  'XAU/USD': { price: 2651.70, change: -0.12, seed: 37 }
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const newId = () => crypto.randomUUID();
const isPremium = user => !!user && Number(user.premium_until) > nowSeconds();
const publicUser = user => ({ id: user.id, email: user.email, premiumUntil: Number(user.premium_until) || 0 });
const emailValid = email => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please wait a little and try again.' } });
const analyzeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });

function currentUser(req) {
  if (!req.session.userId) return null;
  return DB.prepare('SELECT id, email, premium_until FROM users WHERE id = ?').get(req.session.userId) || null;
}
function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  req.user = user;
  next();
}
function requirePremium(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in and activate TROP Pro to use this feature.' });
  if (!isPremium(user)) return res.status(402).json({ error: 'TROP Pro is required. Choose a plan to unlock the premium analyst.' });
  req.user = user;
  next();
}
function sampleSeries(symbol) {
  const a = SAMPLE[symbol];
  let out = [];
  for (let i = 0; i < 30; i++) {
    const move = Math.sin((i + a.seed) * 0.71) * 0.009 + Math.cos((i + a.seed) * 0.23) * 0.006 + (a.change / 100) * ((i - 15) / 30);
    out.push(Number((a.price * (1 + move)).toFixed(symbol === 'EUR/USD' ? 5 : 2)));
  }
  out[out.length - 1] = a.price;
  return out;
}
async function marketData(symbol, allowLive = false) {
  if (!ALLOWED.has(symbol)) throw new Error('Unknown starter symbol.');
  if (allowLive && process.env.TWELVE_DATA_API_KEY) {
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', '1day');
    url.searchParams.set('outputsize', '30');
    url.searchParams.set('apikey', process.env.TWELVE_DATA_API_KEY);
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Market data provider temporarily unavailable.');
    const data = await response.json();
    if (!Array.isArray(data.values) || !data.values.length) throw new Error(data.message || 'No market series was returned by the provider.');
    const values = data.values.map(x => Number(x.close)).filter(Number.isFinite).reverse();
    if (!values.length) throw new Error('Provider returned no usable prices.');
    const price = values[values.length - 1];
    const prior = values.length > 1 ? values[values.length - 2] : price;
    return { symbol, price, change: prior ? ((price - prior) / prior) * 100 : 0, series: values, mode: 'live', timestamp: data.values[0].datetime || new Date().toISOString() };
  }
  const a = SAMPLE[symbol];
  return { symbol, price: a.price, change: a.change, series: sampleSeries(symbol), mode: 'demo', timestamp: 'Illustrative values' };
}
async function verifyFlwTransaction(transactionId) {
  if (!process.env.FLW_SECRET_KEY) throw new Error('Flutterwave is not configured.');
  const r = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`, {
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json();
  if (!r.ok || data.status !== 'success' || !data.data) throw new Error('Flutterwave could not verify this transaction.');
  return data.data;
}
async function verifyAndGrant(transactionId, txRef, sessionUser = null) {
  if (!transactionId || !txRef) throw new Error('Missing transaction verification details.');
  const payment = DB.prepare('SELECT * FROM payments WHERE tx_ref = ?').get(String(txRef));
  if (!payment) throw new Error('Payment reference was not found. Contact support if you have already paid.');
  if (sessionUser && payment.user_id !== sessionUser.id) throw new Error('This payment belongs to another account.');
  if (payment.status === 'verified') {
    const user = DB.prepare('SELECT id, email, premium_until FROM users WHERE id = ?').get(payment.user_id);
    return { user, premium: isPremium(user), alreadyVerified: true };
  }
  const tx = await verifyFlwTransaction(transactionId);
  if (tx.status !== 'successful') throw new Error('Payment has not completed successfully.');
  if (String(tx.tx_ref) !== String(payment.tx_ref)) throw new Error('Transaction reference did not match.');
  if (String(tx.currency).toUpperCase() !== payment.currency) throw new Error('Payment currency did not match.');
  if (Number(tx.amount) < Number(payment.amount)) throw new Error('The verified payment amount is below the plan price.');
  const trx = DB.transaction(() => {
    const fresh = DB.prepare('SELECT * FROM payments WHERE tx_ref = ?').get(String(txRef));
    if (fresh.status === 'verified') return;
    const user = DB.prepare('SELECT * FROM users WHERE id = ?').get(fresh.user_id);
    const startAt = Math.max(Number(user.premium_until) || 0, nowSeconds());
    const expiresAt = startAt + Number(fresh.days) * 24 * 60 * 60;
    DB.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(expiresAt, user.id);
    DB.prepare('UPDATE payments SET status = ?, flw_transaction_id = ?, verified_at = ? WHERE id = ?').run('verified', String(tx.id), nowSeconds(), fresh.id);
  });
  trx();
  const user = DB.prepare('SELECT id, email, premium_until FROM users WHERE id = ?').get(payment.user_id);
  return { user, premium: isPremium(user), alreadyVerified: false };
}

app.get('/api/config', (req, res) => res.json({ brand: 'TROP Trade Analyst', plans: PLANS, paymentsConfigured: !!process.env.FLW_SECRET_KEY, aiConfigured: !!process.env.OPENAI_API_KEY, marketDataConfigured: !!process.env.TWELVE_DATA_API_KEY }));
app.get('/api/session', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null, premium: isPremium(user), marketData: isPremium(user) && process.env.TWELVE_DATA_API_KEY ? 'live' : 'demo' });
});
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (!emailValid(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    const id = newId();
    const passwordHash = await bcrypt.hash(password, 12);
    DB.prepare('INSERT INTO users (id, email, password_hash, premium_until, created_at) VALUES (?, ?, ?, 0, ?)').run(id, email, passwordHash, nowSeconds());
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Could not start a secure session.' });
      req.session.userId = id;
      const user = DB.prepare('SELECT id, email, premium_until FROM users WHERE id = ?').get(id);
      res.status(201).json({ user: publicUser(user), premium: false });
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    console.error('Signup error:', error.message);
    res.status(500).json({ error: 'Could not create account right now.' });
  }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = DB.prepare('SELECT id, email, password_hash, premium_until FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password was not correct.' });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Could not start a secure session.' });
      req.session.userId = user.id;
      res.json({ user: publicUser(user), premium: isPremium(user) });
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Could not sign in right now.' });
  }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(err => {
  res.clearCookie('trop.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  if (err) return res.status(500).json({ error: 'Could not sign out.' });
  res.json({ ok: true });
}));

app.get('/api/market', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USD').toUpperCase();
  const user = currentUser(req);
  const allowLive = isPremium(user) && !!process.env.TWELVE_DATA_API_KEY;
  try {
    const result = await marketData(symbol, allowLive);
    res.json(result);
  } catch (error) {
    console.error('Market data error:', error.message);
    const a = SAMPLE[symbol];
    if (a) return res.json({ symbol, price: a.price, change: a.change, series: sampleSeries(symbol), mode: 'demo', note: 'Live data unavailable; showing illustrative values.' });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/analyze', requirePremium, analyzeLimiter, async (req, res) => {
  const symbol = String(req.body.symbol || '').toUpperCase();
  const style = ['balanced', 'technical', 'risk'].includes(req.body.style) ? req.body.style : 'balanced';
  if (!ALLOWED.has(symbol)) return res.status(400).json({ error: 'Select a supported starter market.' });
  try {
    const market = await marketData(symbol, !!process.env.TWELVE_DATA_API_KEY);
    const a = SAMPLE[symbol];
    const series = market.series;
    const first = series[0];
    const last = series[series.length - 1];
    const pct = first ? ((last - first) / first) * 100 : 0;
    const direction = pct > 0.35 ? 'upward' : pct < -0.35 ? 'downward' : 'sideways';
    const ruleBrief = `${style === 'technical' ? 'Technical focus' : style === 'risk' ? 'Risk-first focus' : 'Balanced market context'} · ${symbol}\n\nDATA STATUS\n${market.mode === 'live' ? `Provider-connected daily series. Latest sample timestamp: ${market.timestamp}.` : 'Illustrative demo values only. Live data is not configured or not enabled for this account.'}\n\nMARKET CONTEXT\nThe displayed ${series.length}-observation series has an overall ${direction} bias, changing ${pct.toFixed(2)}% from its first to last available observation. Latest change in the provider response: ${market.change.toFixed(2)}%. This observation is not a prediction.\n\nWHAT TO CHECK\n• Trend structure: compare swing highs and lows on the timeframe you use.\n• Momentum: confirm with more than one independent observation.\n• Volatility: ${a.vol.toLowerCase()} is the starter model's illustrative category; verify current conditions.\n\nSCENARIOS TO MONITOR\n• Continuation: price holds beyond a level you independently identify, with confirmation.\n• Failure: price moves back into the prior range or breaks the structure behind your thesis.\n• No-trade scenario: skip unclear or poorly defined setups.\n\nRISK QUESTIONS\n1. What specific condition invalidates your idea?\n2. Could spread, slippage, liquidity, or scheduled news change the result?\n3. Is the possible loss inside a risk limit you chose before entering?\n\nCONCLUSION\nThis is research support only, not a buy/sell instruction. Verify all data independently; no return or result is guaranteed.`;
    if (!process.env.OPENAI_API_KEY) return res.json({ symbol, analysis: ruleBrief, mode: 'rule-based', timestamp: new Date().toISOString() });
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: 'You are TROP Trade Analyst, a cautious market education assistant. Analyze only the supplied market observations. Do not promise profits or give personalized financial advice. Do not invent news, levels, indicators, current events, or data. Clearly distinguish observations from scenarios. Include data status, trend context, possible scenarios, risks, and a reminder to verify. Never present a guaranteed signal or tell the user to buy/sell.',
        input: `Prepare a structured ${style} research brief for ${symbol}. Data status: ${market.mode}. Latest price: ${market.price}. Latest period change: ${market.change}%. Historical closes (oldest to newest): ${series.join(', ')}. Timestamp: ${market.timestamp}. State clearly if values are illustrative demo values. Mention the 30-observation overall change is ${pct.toFixed(2)}%.`
      }),
      signal: AbortSignal.timeout(30000)
    });
    const ai = await response.json();
    if (!response.ok) {
      console.error('AI provider response:', response.status, JSON.stringify(ai).slice(0, 700));
      return res.json({ symbol, analysis: ruleBrief + '\n\nAI service temporarily unavailable; this brief uses the built-in analysis template.', mode: 'rule-based', timestamp: new Date().toISOString() });
    }
    const textOutput = ai.output_text || (ai.output || []).flatMap(item => item.content || []).map(c => c.text || '').filter(Boolean).join('\n');
    res.json({ symbol, analysis: textOutput || ruleBrief, mode: textOutput ? 'ai' : 'rule-based', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(502).json({ error: 'Analysis service is temporarily unavailable. Please try again.' });
  }
});

app.post('/api/checkout', requireUser, async (req, res) => {
  const planId = String(req.body.plan || '');
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Choose a valid plan.' });
  if (!process.env.FLW_SECRET_KEY) return res.status(503).json({ error: 'Checkout is not configured yet. Add your Flutterwave test/live keys on the server.' });
  try {
    const txRef = `TROP-${planId.toUpperCase()}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const id = newId();
    DB.prepare('INSERT INTO payments (id, user_id, tx_ref, plan, amount, currency, days, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, txRef, planId, plan.amount, plan.currency, plan.days, 'pending', nowSeconds());
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const flw = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: plan.amount,
        currency: plan.currency,
        redirect_url: `${baseUrl}/?payment=return`,
        customer: { email: req.user.email, name: req.user.email.split('@')[0] },
        customizations: { title: 'TROP Trade Analyst', description: `${plan.name} (${plan.days} days)`, logo: `${baseUrl}/` },
        meta: { trop_user_id: req.user.id, trop_plan: planId }
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await flw.json();
    if (!flw.ok || data.status !== 'success' || !data.data?.link) {
      console.error('Flutterwave checkout response:', flw.status, JSON.stringify(data).slice(0, 800));
      DB.prepare('UPDATE payments SET status = ? WHERE id = ?').run('checkout_failed', id);
      return res.status(502).json({ error: 'Could not start checkout. Confirm your Flutterwave account and plan currency.' });
    }
    res.json({ link: data.data.link, tx_ref: txRef });
  } catch (error) {
    console.error('Checkout error:', error.message);
    res.status(502).json({ error: 'Checkout is temporarily unavailable.' });
  }
});

app.post('/api/payments/verify', requireUser, async (req, res) => {
  try {
    const result = await verifyAndGrant(req.body.transactionId, req.body.tx_ref, req.user);
    res.json({ ok: true, premium: result.premium, user: publicUser(result.user) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Payment could not be verified.' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  const expected = process.env.FLW_SECRET_HASH || '';
  const received = req.get('verif-hash') || '';
  if (!expected || !received || expected.length !== received.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return res.status(401).end();
  const body = req.body || {};
  const data = body.data || {};
  if (data.id && data.tx_ref && String(data.status).toLowerCase() === 'successful') {
    try { await verifyAndGrant(data.id, data.tx_ref); }
    catch (error) { console.error('Webhook verification failed:', error.message); return res.status(500).json({ received: false }); }
  }
  return res.status(200).json({ received: true });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.sendFile(path.join(ROOT, 'public', 'index.html'), err => { if (err) next(err); });
});
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`TROP Trade Analyst running on port ${PORT}`);
  if (!process.env.FLW_SECRET_KEY) console.log('Payments are in setup mode; add Flutterwave keys to enable checkout.');
  if (!process.env.TWELVE_DATA_API_KEY) console.log('Market charts are sample/demo values until a properly licensed data key is configured.');
});
