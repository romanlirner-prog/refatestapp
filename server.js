/**
 * Rafael Mini App — Backend
 * Stack: Express + node:sqlite (Node 22.5+)
 */

require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { DatabaseSync } = require('node:sqlite');

const CURRICULUM_JSON = path.join(__dirname, 'curriculum.json');

const app = express();
app.use(express.json());

const staticDir = process.env.VERCEL ? path.join(process.cwd()) : path.join(__dirname);
app.use(express.static(staticDir));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

// ─── DB (users / purchases / quiz_results only) ────────────────────────
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
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_telegram_id TEXT,
    quiz_id         TEXT,
    score           INTEGER,
    total           INTEGER,
    taken_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: add completed_lessons column if missing
try { db.exec("ALTER TABLE users ADD COLUMN completed_lessons TEXT DEFAULT '{}'"); } catch {}

// ─── CURRICULUM STATE (GitHub JSON = source of truth) ─────────────────
// Step 1 (synchronous, instant): load from bundled local file → data immediately available
// Step 2 (async, background):    refresh from GitHub → overwrites with latest version
// Admin saves always await the GitHub refresh before writing back.

let curriculumData = [];

// ── Synchronous bootstrap from bundled file (runs at module load, no latency) ──
(function syncBootstrap() {
  // 1. Try require() — always bundled by Vercel/webpack (most reliable)
  try {
    const data = require('./curriculum.json');
    if (Array.isArray(data) && data.length > 0) {
      curriculumData = JSON.parse(JSON.stringify(data)); // deep clone
      console.log('[Curriculum] Bootstrap via require() —', curriculumData.length, 'courses');
      return;
    }
  } catch {}
  // 2. Try fs.readFileSync for local dev
  const paths = [CURRICULUM_JSON, path.join(process.cwd(), 'curriculum.json')];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
          curriculumData = data;
          console.log('[Curriculum] Bootstrap from', p, '—', curriculumData.length, 'courses');
          return;
        }
      }
    } catch {}
  }
  // 3. Hardcoded fallback
  curriculumData = getHardcodedCurriculum();
  console.log('[Curriculum] Bootstrap: using hardcoded defaults');
})();

// ── Async refresh from GitHub (runs in background, overwrites once ready) ──
let _initPromise = null;

async function initCurriculum() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) return;
    try {
      const token = process.env.GITHUB_TOKEN;
      const repo  = process.env.GITHUB_REPO;
      const res   = await fetch(`https://api.github.com/repos/${repo}/contents/curriculum.json`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'miniapp-server' },
        signal: AbortSignal.timeout(8000),   // 8s timeout — don't block Vercel
      });
      if (!res.ok) { console.warn('[Curriculum] GitHub returned', res.status); return; }
      const json = await res.json();
      if (!json.content) { console.warn('[Curriculum] GitHub: no content (file too large?)'); return; }
      const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
      if (Array.isArray(data) && data.length > 0) {
        curriculumData = data;
        console.log('[Curriculum] Refreshed from GitHub ✓', curriculumData.length, 'courses');
      }
    } catch (e) { console.error('[Curriculum] GitHub refresh failed:', e.message); }
  })();
  return _initPromise;
}

// Start GitHub refresh in background immediately
initCurriculum();

// ─── GITHUB SYNC ──────────────────────────────────────────────────────
async function syncToGitHub(data) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) { console.warn('[GitHub] No token/repo configured'); return; }
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const apiBase = `https://api.github.com/repos/${repo}/contents/curriculum.json`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'miniapp-server'
    };
    const getRes  = await fetch(apiBase, { headers });
    const getJson = await getRes.json();
    const sha = getJson.sha;
    const putRes = await fetch(apiBase, {
      method: 'PUT', headers,
      body: JSON.stringify({ message: 'chore: sync curriculum via admin', content, sha })
    });
    if (putRes.ok) console.log('[GitHub] curriculum.json synced ✓');
    else console.error('[GitHub] sync failed:', await putRes.text());
  } catch (e) { console.error('[GitHub sync]', e.message); }
}

async function saveCurriculum() {
  // Write to local file (dev only — silently fails on Vercel read-only fs)
  try { fs.writeFileSync(CURRICULUM_JSON, JSON.stringify(curriculumData, null, 2), 'utf8'); } catch {}
  // Push to GitHub (the real persistent store)
  await syncToGitHub(curriculumData);
}

// ─── CURRICULUM HELPERS ───────────────────────────────────────────────
function findCourse(id) {
  return curriculumData.find(c => c.id === id) || null;
}
function findChapter(id) {
  for (const c of curriculumData) {
    const ch = c.chapters?.find(ch => ch.id === id);
    if (ch) return ch;
  }
  return null;
}
function findLesson(id) {
  for (const c of curriculumData) {
    for (const ch of (c.chapters || [])) {
      const ls = ch.lessons?.find(l => l.id === id);
      if (ls) return ls;
    }
  }
  return null;
}

// ─── HARDCODED FALLBACK ───────────────────────────────────────────────
function getHardcodedCurriculum() {
  return [
    {
      id: 'חטיבה-תיכון', name: 'חטיבה → תיכון', emoji: '📐', color: 'ct-blue',
      meta: '32 שיעורים · הכנה מלאה', sort_order: 0,
      chapters: [
        {
          id: 'ch1', course_id: 'חטיבה-תיכון', title: 'מספרים ושברים', sort_order: 0,
          quiz: { id: 'qz1', chapter_id: 'ch1', title: 'מבחן: מספרים ושברים', questions: [
            { q: 'כמה הוא (-3) + 7?', options: ['4','10','-10','-4'], answer: 0 },
            { q: 'מה הוא הערך המוחלט של -5?', options: ['5','-5','0','25'], answer: 0 },
            { q: 'כמה הוא ²⁄₃ + ¹⁄₄?', options: ['¹¹⁄₁₂','³⁄₇','⅚','¾'], answer: 0 },
          ]},
          lessons: [
            { id: 'c1l1', chapter_id: 'ch1', title: 'מספרים טבעיים ושלמים', description: 'נלמד על מספרים שלמים, ערך מוחלט וסדר פעולות חשבון.', video_url: '', tags: ['תיאוריה'], exercises: [], homework: [], sort_order: 0 },
            { id: 'c1l2', chapter_id: 'ch1', title: 'שברים רגילים וחישובים', description: 'חיבור, חיסור, כפל וחילוק של שברים.', video_url: '', tags: ['תיאוריה','תרגול'], exercises: [], homework: [], sort_order: 1 },
            { id: 'c1l3', chapter_id: 'ch1', title: 'עשרוניים ואחוזים', description: 'המרה בין עשרוניים לאחוזים.', video_url: '', tags: ['תרגול'], exercises: [], homework: [], sort_order: 2 },
          ]
        },
        {
          id: 'ch2', course_id: 'חטיבה-תיכון', title: 'אלגברה — ביטויים ומשוואות', sort_order: 1,
          quiz: { id: 'qz2', chapter_id: 'ch2', title: 'מבחן: אלגברה', questions: [
            { q: 'פשט: 3x + 2x - x', options: ['4x','6x','5x','x'], answer: 0 },
            { q: 'פתור: 2x + 5 = 13', options: ['x=4','x=9','x=3','x=5'], answer: 0 },
          ]},
          lessons: [
            { id: 'c2l1', chapter_id: 'ch2', title: 'ביטויים אלגבריים', description: '', video_url: '', tags: ['תיאוריה'], exercises: [], homework: [], sort_order: 0 },
            { id: 'c2l2', chapter_id: 'ch2', title: 'משוואה ממעלה ראשונה', description: '', video_url: '', tags: ['תרגול'], exercises: [], homework: [], sort_order: 1 },
            { id: 'c2l3', chapter_id: 'ch2', title: 'משוואה ממעלה שנייה', description: '', video_url: '', tags: ['תיאוריה','תרגול'], exercises: [], homework: [], sort_order: 2 },
            { id: 'c2l4', chapter_id: 'ch2', title: 'אי-שוויונות', description: '', video_url: '', tags: ['תרגול'], exercises: [], homework: [], sort_order: 3 },
          ]
        },
      ]
    },
    {
      id: 'הכנה לבגרות', name: 'הכנה לבגרות', emoji: '📝', color: 'ct-green',
      meta: '48 שיעורים · 3 רמות', sort_order: 1,
      chapters: [
        {
          id: 'bg1', course_id: 'הכנה לבגרות', title: 'חזרה על בסיס', sort_order: 0,
          quiz: { id: 'qz6', chapter_id: 'bg1', title: 'מבחן: חזרה על בסיס', questions: [
            { q: 'פשט: (2x²)³', options: ['8x⁶','6x⁶','8x⁵','2x⁶'], answer: 0 },
          ]},
          lessons: [
            { id: 'b1l1', chapter_id: 'bg1', title: 'אלגברה — חזרה מהירה', description: '', video_url: '', tags: ['חזרה'], exercises: [], homework: [], sort_order: 0 },
            { id: 'b1l2', chapter_id: 'bg1', title: 'פונקציות — חזרה', description: '', video_url: '', tags: ['חזרה'], exercises: [], homework: [], sort_order: 1 },
          ]
        },
      ]
    },
    {
      id: 'בגרות מורחבת', name: "בגרות מורחבת (5 יח')", emoji: '🏆', color: 'ct-amber',
      meta: '28 שיעורים · רמה גבוהה', sort_order: 2,
      chapters: [
        {
          id: 'mr1', course_id: 'בגרות מורחבת', title: 'חשבון דיפרנציאלי', sort_order: 0,
          quiz: { id: 'qz8', chapter_id: 'mr1', title: 'מבחן: נגזרות', questions: [
            { q: "f'(x) של x³:", options: ['3x²','x²','3x','x³'], answer: 0 },
          ]},
          lessons: [
            { id: 'm1l1', chapter_id: 'mr1', title: 'גבולות ורציפות', description: '', video_url: '', tags: ['תיאוריה'], exercises: [], homework: [], sort_order: 0 },
            { id: 'm1l2', chapter_id: 'mr1', title: 'נגזרות — כללים', description: '', video_url: '', tags: ['תרגול'], exercises: [], homework: [], sort_order: 1 },
          ]
        }
      ]
    }
  ];
}

// ─── HELPERS ───────────────────────────────────────────────────────────
function verifyTgInitData(initData) {
  if (!process.env.BOT_TOKEN || process.env.NODE_ENV !== 'production') return true;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash');
    params.delete('hash');
    const dataStr = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
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

// ─── USER ROUTES ───────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { identifier = '', telegram_id, telegram_name, telegram_username, telegram_photo, initData } = req.body;
  if (!identifier.trim()) return res.status(400).json({ error: 'missing_identifier' });
  const raw = identifier.trim();
  const isPhone  = /^[\d\s\-+]+$/.test(raw) && raw.replace(/\D/g,'').length >= 1;
  const emailKey = raw.toLowerCase();
  const phoneKey = normalizePhone(raw);
  const purchase = isPhone
    ? db.prepare('SELECT * FROM purchases WHERE phone = ? ORDER BY created_at DESC LIMIT 1').get(phoneKey)
    : db.prepare('SELECT * FROM purchases WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(emailKey);
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
  const user = telegram_id ? db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id) : null;
  res.json({ name: telegram_name||'משתמש', plan: purchase.plan, progress: user?.progress??0, telegram_id,
             username: user?.username, photo_url: user?.photo_url });
});

app.get('/api/me', (req, res) => {
  const telegram_id = req.headers['x-telegram-id'];
  if (!telegram_id) return res.status(400).json({ error: 'missing' });
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  if (!user) {
    const tg_name     = req.headers['x-telegram-name']     || null;
    const tg_username = req.headers['x-telegram-username'] || null;
    db.prepare('INSERT OR IGNORE INTO users (telegram_id,name,username,plan) VALUES (?,?,?,?)')
      .run(telegram_id, tg_name, tg_username, 'סולו');
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  }
  res.json(user);
});

app.post('/api/webhook/grow', (req, res) => {
  const { transactionId, status, amount=0, productName='', customerEmail, customerPhone } = req.body;
  const ok = ['success','approved','completed','J4','J5'];
  if (!ok.includes(status)) return res.json({ ok: true });
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

// ─── CURRICULUM READ ───────────────────────────────────────────────────
app.get('/api/curriculum', (req, res) => {
  // Return immediately from in-memory state (bootstrapped synchronously at startup)
  res.json(curriculumData);
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
  const { phone = '', password = '' } = req.body;
  const adminPhone      = process.env.ADMIN_PHONE || '0535266628';
  const normalizedInput = normalizePhone(phone);
  const normalizedAdmin = normalizePhone(adminPhone);
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  if (normalizedInput !== normalizedAdmin) return res.status(401).json({ error: 'unauthorized' });
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

// ─── ADMIN CURRICULUM CRUD (in-memory + GitHub) ────────────────────────

// GET: return current curriculum
app.get('/api/admin/courses', (req, res) => {
  res.json(curriculumData);
});

// ── COURSES ──────────────────────────────────────────────
app.post('/api/admin/courses', async (req, res) => {
  await initCurriculum();
  const { id, name, emoji='📚', color='ct-blue', meta='' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  if (findCourse(id)) return res.status(400).json({ error: 'id already exists' });
  curriculumData.push({ id, name, emoji, color, meta, sort_order: curriculumData.length, chapters: [] });
  await saveCurriculum();
  res.json({ ok: true });
});

app.put('/api/admin/courses/:id', async (req, res) => {
  await initCurriculum();
  const course = findCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'not found' });
  const { name, emoji, color, meta, sort_order } = req.body;
  if (name       !== undefined) course.name       = name;
  if (emoji      !== undefined) course.emoji      = emoji;
  if (color      !== undefined) course.color      = color;
  if (meta       !== undefined) course.meta       = meta;
  if (sort_order !== undefined) course.sort_order = sort_order;
  await saveCurriculum();
  res.json({ ok: true });
});

app.delete('/api/admin/courses/:id', async (req, res) => {
  await initCurriculum();
  const idx = curriculumData.findIndex(c => c.id === req.params.id);
  if (idx >= 0) curriculumData.splice(idx, 1);
  await saveCurriculum();
  res.json({ ok: true });
});

// ── CHAPTERS ─────────────────────────────────────────────
app.post('/api/admin/chapters', async (req, res) => {
  await initCurriculum();
  const { id, course_id, title } = req.body;
  if (!id || !course_id || !title) return res.status(400).json({ error: 'missing fields' });
  const course = findCourse(course_id);
  if (!course) return res.status(404).json({ error: 'course not found' });
  course.chapters.push({ id, course_id, title, sort_order: course.chapters.length, quiz: null, lessons: [] });
  await saveCurriculum();
  res.json({ ok: true });
});

app.put('/api/admin/chapters/:id', async (req, res) => {
  await initCurriculum();
  const ch = findChapter(req.params.id);
  if (!ch) return res.status(404).json({ error: 'not found' });
  const { title, sort_order } = req.body;
  if (title      !== undefined) ch.title      = title;
  if (sort_order !== undefined) ch.sort_order = sort_order;
  await saveCurriculum();
  res.json({ ok: true });
});

app.delete('/api/admin/chapters/:id', async (req, res) => {
  await initCurriculum();
  for (const course of curriculumData) {
    const idx = course.chapters.findIndex(ch => ch.id === req.params.id);
    if (idx >= 0) { course.chapters.splice(idx, 1); break; }
  }
  await saveCurriculum();
  res.json({ ok: true });
});

// ── LESSONS ──────────────────────────────────────────────
app.post('/api/admin/lessons', async (req, res) => {
  await initCurriculum();
  const { id, chapter_id, title, description='', video_url='', tags=[], exercises=[], homework=[] } = req.body;
  if (!id || !chapter_id || !title) return res.status(400).json({ error: 'missing fields' });
  const ch = findChapter(chapter_id);
  if (!ch) return res.status(404).json({ error: 'chapter not found' });
  ch.lessons.push({ id, chapter_id, title, description, video_url, tags, exercises, homework, sort_order: ch.lessons.length });
  await saveCurriculum();
  res.json({ ok: true });
});

app.put('/api/admin/lessons/:id', async (req, res) => {
  await initCurriculum();
  const ls = findLesson(req.params.id);
  if (!ls) return res.status(404).json({ error: 'not found' });
  const { title, description, video_url, tags, exercises, homework, sort_order } = req.body;
  if (title       !== undefined) ls.title       = title;
  if (description !== undefined) ls.description = description;
  if (video_url   !== undefined) ls.video_url   = video_url;
  if (tags        !== undefined) ls.tags        = tags;
  if (exercises   !== undefined) ls.exercises   = exercises;
  if (homework    !== undefined) ls.homework    = homework;
  if (sort_order  !== undefined) ls.sort_order  = sort_order;
  await saveCurriculum();
  res.json({ ok: true });
});

app.delete('/api/admin/lessons/:id', async (req, res) => {
  await initCurriculum();
  for (const course of curriculumData) {
    for (const ch of course.chapters) {
      const idx = ch.lessons.findIndex(l => l.id === req.params.id);
      if (idx >= 0) { ch.lessons.splice(idx, 1); break; }
    }
  }
  await saveCurriculum();
  res.json({ ok: true });
});

// ── QUIZZES ──────────────────────────────────────────────
app.put('/api/admin/quizzes/:chapter_id', async (req, res) => {
  await initCurriculum();
  const ch = findChapter(req.params.chapter_id);
  if (!ch) return res.status(404).json({ error: 'chapter not found' });
  if (!ch.quiz) {
    ch.quiz = { id: 'qz_' + Date.now(), chapter_id: req.params.chapter_id, title: 'מבחן מסכם', questions: [] };
  }
  const { title, questions } = req.body;
  if (title     !== undefined) ch.quiz.title     = title;
  if (questions !== undefined) ch.quiz.questions = questions;
  await saveCurriculum();
  res.json({ ok: true });
});

// ─── ADMIN EXPORT ──────────────────────────────────────────────────────
app.get('/api/admin/export-curriculum', async (req, res) => {
  await initCurriculum();
  res.setHeader('Content-Disposition', 'attachment; filename="curriculum.json"');
  res.json(curriculumData);
});

// ─── DEV SEED ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const ins = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  ins.run('test@test.com', null,       'כיתה',  'dev_1');
  ins.run(null, '0501234567',          'מנטור', 'dev_2');
  ins.run('student@edu.com', null,     'סולו',  'dev_3');
}

// ─── PERMANENT USERS ──────────────────────────────────────────────────
;(() => {
  const ins = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  ins.run(null,          '123',        'סולו',  'permanent_123');
  ins.run('t@test.com',  null,         'סולו',  'permanent_ttest');
})();

// ─── START ────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3458;
  app.listen(PORT, () => console.log(`✅  Mini App server → http://localhost:${PORT}`));
}

module.exports = app;
