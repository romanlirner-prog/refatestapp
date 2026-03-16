/**
 * Rafael Mini App — Backend
 * Stack: Express + node:sqlite (Node 22.5+)
 * Curriculum stored in draft.json / published.json on GitHub (not SQLite).
 * SQLite used only for users / purchases / progress / quiz_results.
 */

require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { DatabaseSync } = require('node:sqlite');

const CURRICULUM_JSON = path.join(__dirname, 'curriculum.json'); // local fallback only

const app = express();
app.use(express.json());

const staticDir = process.env.VERCEL ? path.join(process.cwd()) : path.join(__dirname);
app.use(express.static(staticDir));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

// ─── DB (users / purchases / progress only) ────────────────────────────
const DB_PATH = process.env.VERCEL ? '/tmp/miniapp.db' : path.join(__dirname, 'miniapp.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS purchases (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT,
    phone                TEXT,
    plan                 TEXT NOT NULL,
    grow_transaction_id  TEXT UNIQUE,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    name        TEXT,
    email       TEXT,
    phone       TEXT,
    username    TEXT,
    photo_url   TEXT,
    plan        TEXT DEFAULT 'none',
    progress    INTEGER DEFAULT 0,
    linked_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS quiz_results (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_telegram_id TEXT,
    quiz_id          TEXT,
    score            INTEGER,
    total            INTEGER,
    taken_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try { db.exec("ALTER TABLE users ADD COLUMN completed_lessons TEXT DEFAULT '{}'"); } catch {}

// ─── GITHUB ────────────────────────────────────────────────────────────
// Set DATA_GITHUB_REPO=owner/repo in Vercel env vars pointing to miniapp-data repo.
const DATA_REPO = process.env.DATA_GITHUB_REPO || process.env.GITHUB_REPO;

// Generic GitHub file writer — GET existing SHA then PUT new content
async function writeGitHubFile(filename, data, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = DATA_REPO;
  if (!token || !repo) { console.error('[writeGitHubFile] missing token or repo — skipping'); return; }
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const apiBase = `https://api.github.com/repos/${repo}/contents/${filename}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'miniapp-server'
    };
    const getRes  = await fetch(apiBase, { headers });
    const getJson = getRes.ok ? await getRes.json() : {};
    const putRes  = await fetch(apiBase, {
      method: 'PUT', headers,
      body: JSON.stringify({ message, content, ...(getJson.sha && { sha: getJson.sha }) })
    });
    if (putRes.ok) console.log(`[GitHub] ${filename} updated ✓`);
    else console.error(`[GitHub] ${filename} PUT failed (${putRes.status}):`, await putRes.text());
  } catch (e) { console.error(`[GitHub ${filename}] exception:`, e.message); }
}

// ─── DRAFT.JSON — curriculum database ──────────────────────────────────
let _draftCache = { data: null, ts: 0 };
const DRAFT_CACHE_TTL = 1000; // 1 s

async function readDraft() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = DATA_REPO;
  const now   = Date.now();
  if (_draftCache.data && (now - _draftCache.ts) < DRAFT_CACHE_TTL) return _draftCache.data;
  if (token && repo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/draft.json`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'miniapp-server' }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.content) {
          const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
          _draftCache = { data: Array.isArray(data) ? data : [], ts: now };
          return _draftCache.data;
        }
      }
    } catch (e) { console.error('[readDraft]', e.message); }
  }
  // Fallback: already-cached stale data or local file
  if (_draftCache.data) return _draftCache.data;
  try {
    const paths = [CURRICULUM_JSON, path.join(process.cwd(), 'curriculum.json')];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        const local = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(local) && local.length > 0) {
          _draftCache = { data: local, ts: now };
          return local;
        }
      }
    }
  } catch {}
  return [];
}

async function writeDraft(data) {
  _draftCache = { data, ts: Date.now() };
  await writeGitHubFile('draft.json', data, 'draft: admin saved');
}

// ─── PUBLISHED.JSON — user-facing version (only updated on push) ───────
let _pubCache = { data: null, sha: null, ts: 0 };
const PUB_CACHE_TTL = 5000;

async function getPublished() {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !DATA_REPO) return null;
  const now = Date.now();
  if (_pubCache.data && (now - _pubCache.ts) < PUB_CACHE_TTL) return _pubCache;
  try {
    const res = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/published.json`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'miniapp-server' }
    });
    if (res.ok) {
      const json = await res.json();
      if (json.content) {
        const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
        _pubCache = { data, sha: json.sha, ts: now };
        return _pubCache;
      }
    }
  } catch (e) { console.error('[getPublished]', e.message); }
  return _pubCache.data ? _pubCache : null;
}

// Fallback in-memory version bump (used when GitHub not configured)
let curriculumVersion = Date.now();

// ─── HELPERS ───────────────────────────────────────────────────────────
function verifyTgInitData(initData) {
  if (!process.env.BOT_TOKEN || process.env.NODE_ENV !== 'production') return true;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash');
    params.delete('hash');
    const dataStr  = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
    const secret   = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(dataStr).digest('hex');
    return hash === expected;
  } catch { return false; }
}

function resolvePlan(productName = '', amount = 0) {
  const p = productName.toLowerCase();
  if (p.includes('מנטור') || p.includes('mentor')) return 'מנטור';
  if (p.includes('כיתה')  || p.includes('class'))  return 'כיתה';
  if (p.includes('סולו')  || p.includes('solo'))   return 'סולו';
  if (amount >= 500) return 'מנטור';
  if (amount >= 120) return 'כיתה';
  return 'סולו';
}

function normalizePhone(phone = '') {
  return phone.replace(/[\s\-+]/g, '');
}

// Deep-clone helper so we never mutate cache directly
function cloneDraft(d) { return JSON.parse(JSON.stringify(d)); }

// ─── USER ROUTES ───────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { identifier = '', telegram_id, telegram_name, telegram_username, telegram_photo } = req.body;
  if (!identifier.trim()) return res.status(400).json({ error: 'missing_identifier' });
  const raw      = identifier.trim();
  const isPhone  = /^[\d\s\-+]+$/.test(raw) && raw.replace(/\D/g,'').length >= 1;
  const emailKey = raw.toLowerCase();
  const phoneKey = normalizePhone(raw);
  const purchase = isPhone
    ? db.prepare('SELECT * FROM purchases WHERE phone=? ORDER BY created_at DESC LIMIT 1').get(phoneKey)
    : db.prepare('SELECT * FROM purchases WHERE email=? ORDER BY created_at DESC LIMIT 1').get(emailKey);
  if (!purchase) return res.status(404).json({ error: 'not_found' });
  if (telegram_id) {
    db.prepare(`INSERT INTO users (telegram_id,name,email,phone,username,photo_url,plan) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET plan=excluded.plan,
        email=COALESCE(excluded.email,email), phone=COALESCE(excluded.phone,phone),
        name=COALESCE(excluded.name,name), username=COALESCE(excluded.username,username),
        photo_url=COALESCE(excluded.photo_url,photo_url)`)
      .run(telegram_id, telegram_name||null, isPhone?null:emailKey, isPhone?phoneKey:null,
           telegram_username||null, telegram_photo||null, purchase.plan);
  }
  const user = telegram_id ? db.prepare('SELECT * FROM users WHERE telegram_id=?').get(telegram_id) : null;
  res.json({ name: telegram_name||'משתמש', plan: purchase.plan, progress: user?.progress??0,
             telegram_id, username: user?.username, photo_url: user?.photo_url });
});

app.get('/api/me', (req, res) => {
  const telegram_id = req.headers['x-telegram-id'];
  if (!telegram_id) return res.status(400).json({ error: 'missing' });
  let user = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(telegram_id);
  if (!user) {
    db.prepare('INSERT OR IGNORE INTO users (telegram_id,name,username,plan) VALUES (?,?,?,?)')
      .run(telegram_id, req.headers['x-telegram-name']||null, req.headers['x-telegram-username']||null, 'סולו');
    user = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(telegram_id);
  }
  res.json(user);
});

app.post('/api/webhook/grow', (req, res) => {
  const { transactionId, status, amount=0, productName='', customerEmail, customerPhone } = req.body;
  if (!['success','approved','completed','J4','J5'].includes(status)) return res.json({ ok: true });
  const plan  = resolvePlan(productName, Number(amount));
  const email = customerEmail?.toLowerCase()?.trim() || null;
  const phone = customerPhone ? normalizePhone(customerPhone) : null;
  if (!email && !phone) return res.status(400).json({ error: 'no_identifier' });
  db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)').run(email,phone,plan,transactionId||null);
  db.prepare('UPDATE users SET plan=? WHERE (email=? AND email IS NOT NULL) OR (phone=? AND phone IS NOT NULL)').run(plan,email,phone);
  res.json({ ok: true });
});

app.post('/api/progress', (req, res) => {
  const { telegram_id, progress, completedLessons } = req.body;
  if (!telegram_id || progress === undefined) return res.status(400).json({ error: 'bad_request' });
  const pct = Math.min(100, Math.max(0, Number(progress)));
  if (completedLessons) {
    const existing = db.prepare('SELECT completed_lessons FROM users WHERE telegram_id=?').get(telegram_id);
    let merged = {};
    try { merged = JSON.parse(existing?.completed_lessons || '{}'); } catch {}
    Object.assign(merged, completedLessons);
    db.prepare('UPDATE users SET progress=?, completed_lessons=? WHERE telegram_id=?')
      .run(pct, JSON.stringify(merged), telegram_id);
  } else {
    db.prepare('UPDATE users SET progress=? WHERE telegram_id=?').run(pct, telegram_id);
  }
  res.json({ ok: true });
});

// ─── CURRICULUM READ (public) ───────────────────────────────────────────
// Returns published.json — only updated when admin presses "פרסם לכולם"
app.get('/api/curriculum', async (req, res) => {
  const cached = await getPublished();
  if (cached?.data && cached.data.length > 0) return res.json(cached.data);
  // Fallback: draft (so students aren't left with empty content)
  const draft = await readDraft();
  res.json(draft);
});

app.get('/api/curriculum-version', async (req, res) => {
  const cached = await getPublished();
  res.json({ version: cached?.sha || curriculumVersion });
});

// ─── QUIZ RESULT ───────────────────────────────────────────────────────
app.post('/api/quiz-result', (req, res) => {
  const { telegram_id, quiz_id, score, total } = req.body;
  if (!quiz_id || score === undefined || !total) return res.status(400).json({ error: 'bad_request' });
  db.prepare('INSERT INTO quiz_results (user_telegram_id,quiz_id,score,total) VALUES (?,?,?,?)').run(telegram_id||null, quiz_id, score, total);
  res.json({ ok: true });
});

// ─── ADMIN AUTH ────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'refaroman2003';

app.post('/api/admin/login', (req, res) => {
  const { phone='', password='' } = req.body;
  const adminPhone = process.env.ADMIN_PHONE || '0535266628';
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  if (normalizePhone(phone) !== normalizePhone(adminPhone)) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true });
});

app.put('/api/admin/users/:telegram_id', (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'plan required' });
  db.prepare('UPDATE users SET plan=? WHERE telegram_id=?').run(plan, req.params.telegram_id);
  db.prepare('UPDATE purchases SET plan=? WHERE phone=(SELECT phone FROM users WHERE telegram_id=?) OR email=(SELECT email FROM users WHERE telegram_id=?)').run(plan, req.params.telegram_id, req.params.telegram_id);
  res.json({ ok: true });
});

app.get('/api/admin/stats', (req, res) => {
  const totalUsers     = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const totalPurchases = db.prepare('SELECT COUNT(*) as n FROM purchases').get().n;
  const bySolo   = db.prepare("SELECT COUNT(*) as n FROM purchases WHERE plan='סולו'").get().n;
  const byClass  = db.prepare("SELECT COUNT(*) as n FROM purchases WHERE plan='כיתה'").get().n;
  const byMentor = db.prepare("SELECT COUNT(*) as n FROM purchases WHERE plan='מנטור'").get().n;
  const recentUsers = db.prepare('SELECT telegram_id,name,email,phone,plan,progress FROM users ORDER BY linked_at DESC LIMIT 20').all();
  res.json({ totalUsers, totalPurchases, bySolo, byClass, byMentor, recentUsers });
});

// Admin: read curriculum from draft.json
app.get('/api/admin/courses', async (req, res) => {
  res.json(await readDraft());
});

// ─── ADMIN CURRICULUM CRUD (all operate on draft.json directly) ─────────

// Courses
app.post('/api/admin/courses', async (req, res) => {
  const { id, name, emoji='📚', color='ct-blue', meta='' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const draft = cloneDraft(await readDraft());
  if (draft.find(c => c.id === id)) return res.status(400).json({ error: 'id already exists' });
  draft.push({ id, name, emoji, color, meta, sort_order: draft.length, chapters: [] });
  await writeDraft(draft);
  res.json({ ok: true });
});

app.put('/api/admin/courses/:id', async (req, res) => {
  const { name, emoji, color, meta, sort_order } = req.body;
  const draft = cloneDraft(await readDraft());
  const course = draft.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'not found' });
  if (name        !== undefined) course.name       = name;
  if (emoji       !== undefined) course.emoji      = emoji;
  if (color       !== undefined) course.color      = color;
  if (meta        !== undefined) course.meta       = meta;
  if (sort_order  !== undefined) course.sort_order = sort_order;
  await writeDraft(draft);
  res.json({ ok: true });
});

app.delete('/api/admin/courses/:id', async (req, res) => {
  const draft = cloneDraft(await readDraft());
  const idx = draft.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  draft.splice(idx, 1);
  await writeDraft(draft);
  res.json({ ok: true });
});

// Chapters
app.post('/api/admin/chapters', async (req, res) => {
  const { id, course_id, title } = req.body;
  if (!id || !course_id || !title) return res.status(400).json({ error: 'missing fields' });
  const draft = cloneDraft(await readDraft());
  const course = draft.find(c => c.id === course_id);
  if (!course) return res.status(404).json({ error: 'course not found' });
  course.chapters = course.chapters || [];
  course.chapters.push({ id, course_id, title, sort_order: course.chapters.length, lessons: [], quiz: null });
  await writeDraft(draft);
  res.json({ ok: true });
});

app.put('/api/admin/chapters/:id', async (req, res) => {
  const { title, sort_order } = req.body;
  const draft = cloneDraft(await readDraft());
  let found = null;
  for (const c of draft) for (const ch of (c.chapters||[])) if (ch.id === req.params.id) { found = ch; break; }
  if (!found) return res.status(404).json({ error: 'not found' });
  if (title      !== undefined) found.title      = title;
  if (sort_order !== undefined) found.sort_order = sort_order;
  await writeDraft(draft);
  res.json({ ok: true });
});

app.delete('/api/admin/chapters/:id', async (req, res) => {
  const draft = cloneDraft(await readDraft());
  for (const c of draft) {
    const idx = (c.chapters||[]).findIndex(ch => ch.id === req.params.id);
    if (idx !== -1) { c.chapters.splice(idx, 1); await writeDraft(draft); return res.json({ ok: true }); }
  }
  res.status(404).json({ error: 'not found' });
});

// Lessons
app.post('/api/admin/lessons', async (req, res) => {
  const { id, chapter_id, title, description='', video_url='', tags=[], exercises=[], homework=[] } = req.body;
  if (!id || !chapter_id || !title) return res.status(400).json({ error: 'missing fields' });
  const draft = cloneDraft(await readDraft());
  let found = null;
  for (const c of draft) for (const ch of (c.chapters||[])) if (ch.id === chapter_id) { found = ch; break; }
  if (!found) return res.status(404).json({ error: 'chapter not found' });
  found.lessons = found.lessons || [];
  found.lessons.push({ id, chapter_id, title, description, video_url, tags, exercises, homework, sort_order: found.lessons.length });
  await writeDraft(draft);
  res.json({ ok: true });
});

app.put('/api/admin/lessons/:id', async (req, res) => {
  const { title, description, video_url, tags, exercises, homework, sort_order } = req.body;
  const draft = cloneDraft(await readDraft());
  let found = null;
  for (const c of draft) for (const ch of (c.chapters||[])) for (const l of (ch.lessons||[])) if (l.id === req.params.id) { found = l; break; }
  if (!found) return res.status(404).json({ error: 'not found' });
  if (title       !== undefined) found.title       = title;
  if (description !== undefined) found.description = description;
  if (video_url   !== undefined) found.video_url   = video_url;
  if (tags        !== undefined) found.tags        = tags;
  if (exercises   !== undefined) found.exercises   = exercises;
  if (homework    !== undefined) found.homework    = homework;
  if (sort_order  !== undefined) found.sort_order  = sort_order;
  await writeDraft(draft);
  res.json({ ok: true });
});

app.delete('/api/admin/lessons/:id', async (req, res) => {
  const draft = cloneDraft(await readDraft());
  for (const c of draft) for (const ch of (c.chapters||[])) {
    const idx = (ch.lessons||[]).findIndex(l => l.id === req.params.id);
    if (idx !== -1) { ch.lessons.splice(idx, 1); await writeDraft(draft); return res.json({ ok: true }); }
  }
  res.status(404).json({ error: 'not found' });
});

// Quizzes
app.put('/api/admin/quizzes/:chapter_id', async (req, res) => {
  const { title, questions } = req.body;
  const draft = cloneDraft(await readDraft());
  let found = null;
  for (const c of draft) for (const ch of (c.chapters||[])) if (ch.id === req.params.chapter_id) { found = ch; break; }
  if (!found) return res.status(404).json({ error: 'chapter not found' });
  if (!found.quiz) found.quiz = { id: 'qz_' + Date.now(), chapter_id: req.params.chapter_id, title: 'מבחן מסכם', questions: [] };
  if (title     !== undefined) found.quiz.title     = title;
  if (questions !== undefined) found.quiz.questions = questions;
  await writeDraft(draft);
  res.json({ ok: true });
});

// Publish — copies draft → published.json, busts cache
app.post('/api/admin/push', async (req, res) => {
  const draft = await readDraft();
  console.log(`[push] courses in draft: ${draft.length}, DATA_REPO: ${DATA_REPO}`);
  await writeGitHubFile('published.json', draft, 'publish: admin pushed');
  _pubCache = { data: null, sha: null, ts: 0 }; // bust cache
  curriculumVersion = Date.now();
  res.json({ ok: true, version: curriculumVersion, courses: draft.length, repo: DATA_REPO || 'NOT SET' });
});

app.get('/api/admin/export-curriculum', async (req, res) => {
  const data = await readDraft();
  res.setHeader('Content-Disposition', 'attachment; filename="published.json"');
  res.json(data);
});

// ─── DEV SEED ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const ins = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  ins.run('test@test.com', null,     'כיתה',  'dev_1');
  ins.run(null, '0501234567',        'מנטור', 'dev_2');
  ins.run('student@edu.com', null,   'סולו',  'dev_3');
}

;(() => {
  const ins = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  ins.run(null,          '123',      'סולו',  'permanent_123');
  ins.run('t@test.com',  null,       'סולו',  'permanent_ttest');
})();

// ─── START ────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3458;
  app.listen(PORT, () => console.log(`✅  Mini App server → http://localhost:${PORT}`));
}

module.exports = app;
