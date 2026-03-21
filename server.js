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

const app = express();
app.use(express.json());

const staticDir = process.env.VERCEL ? path.join(process.cwd()) : path.join(__dirname);
app.use(express.static(staticDir));
const APP_VERSION = `v-${Date.now()}`;
app.get('/', (req, res) => {
  if (req.query.v !== APP_VERSION) {
    return res.redirect(302, `/?v=${APP_VERSION}`);
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ─── DB ────────────────────────────────────────────────────────────────
const DB_PATH        = process.env.VERCEL ? '/tmp/miniapp.db' : path.join(__dirname, 'miniapp.db');
const CURRICULUM_JSON = path.join(__dirname, 'curriculum.json');
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
  CREATE TABLE IF NOT EXISTS courses (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    emoji      TEXT DEFAULT '📚',
    color      TEXT DEFAULT 'ct-blue',
    meta       TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS chapters (
    id         TEXT PRIMARY KEY,
    course_id  TEXT NOT NULL,
    title      TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (course_id) REFERENCES courses(id)
  );
  CREATE TABLE IF NOT EXISTS lessons (
    id          TEXT PRIMARY KEY,
    chapter_id  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    video_url   TEXT DEFAULT '',
    tags        TEXT DEFAULT '[]',
    exercises   TEXT DEFAULT '[]',
    homework    TEXT DEFAULT '[]',
    sort_order  INTEGER DEFAULT 0,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id)
  );
  CREATE TABLE IF NOT EXISTS quizzes (
    id         TEXT PRIMARY KEY,
    chapter_id TEXT UNIQUE NOT NULL,
    title      TEXT DEFAULT 'מבחן מסכם',
    questions  TEXT DEFAULT '[]',
    FOREIGN KEY (chapter_id) REFERENCES chapters(id)
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

try { db.exec("ALTER TABLE users ADD COLUMN completed_lessons TEXT DEFAULT '{}'"); } catch {}

// ─── VERSION TRACKING ──────────────────────────────────────────────────
// Bumped on every admin save — the client polls this to detect changes
// and re-fetch the curriculum without a full page reload.
let curriculumVersion = Date.now();

// Normalise quiz.questions string → array (SQLite stores as TEXT)
function normalisedCurriculum() {
  const data = getCurriculum();
  for (const c of data)
    for (const ch of c.chapters)
      if (ch.quiz && typeof ch.quiz.questions === 'string')
        try { ch.quiz.questions = JSON.parse(ch.quiz.questions); } catch { ch.quiz.questions = []; }
  return data;
}

// ─── SEED ──────────────────────────────────────────────────────────────

function seedFromJson(data) {
  for (const course of data) {
    db.prepare('INSERT OR REPLACE INTO courses (id,name,emoji,color,meta,sort_order) VALUES (?,?,?,?,?,?)')
      .run(course.id, course.name, course.emoji || '📚', course.color || 'ct-blue', course.meta || '', course.sort_order || 0);
    for (const ch of (course.chapters || [])) {
      db.prepare('INSERT OR REPLACE INTO chapters (id,course_id,title,sort_order) VALUES (?,?,?,?)')
        .run(ch.id, course.id, ch.title, ch.sort_order || 0);
      if (ch.quiz) {
        db.prepare('INSERT OR REPLACE INTO quizzes (id,chapter_id,title,questions) VALUES (?,?,?,?)')
          .run(ch.quiz.id, ch.id, ch.quiz.title || 'מבחן מסכם',
               typeof ch.quiz.questions === 'string' ? ch.quiz.questions : JSON.stringify(ch.quiz.questions || []));
      }
      for (const ls of (ch.lessons || [])) {
        db.prepare('INSERT OR REPLACE INTO lessons (id,chapter_id,title,description,video_url,tags,exercises,homework,sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(ls.id, ch.id, ls.title, ls.description || '', ls.video_url || '',
               typeof ls.tags      === 'string' ? ls.tags      : JSON.stringify(ls.tags      || []),
               typeof ls.exercises === 'string' ? ls.exercises : JSON.stringify(ls.exercises || []),
               typeof ls.homework  === 'string' ? ls.homework  : JSON.stringify(ls.homework  || []),
               ls.sort_order || 0);
      }
    }
  }
}

function seedHardcoded() {
  const TEMPLATE = [
    {
      id: 'חטיבה-תיכון', name: 'חטיבה → תיכון', emoji: '📐', color: 'ct-blue',
      meta: '', sort_order: 0,
      chapters: [
        { id: 'ch1', title: 'מספרים ושברים',            sort_order: 0, quiz: { id: 'qz1', title: 'מבחן: מספרים ושברים' } },
        { id: 'ch2', title: 'אלגברה — ביטויים ומשוואות', sort_order: 1, quiz: { id: 'qz2', title: 'מבחן: אלגברה' } },
        { id: 'ch3', title: 'גאומטריה',                  sort_order: 2, quiz: { id: 'qz3', title: 'מבחן: גאומטריה' } },
        { id: 'ch4', title: 'פונקציות לינאריות',         sort_order: 3, quiz: { id: 'qz4', title: 'מבחן: פונקציות' } },
        { id: 'ch5', title: 'סטטיסטיקה',                sort_order: 4, quiz: { id: 'qz5', title: 'מבחן: סטטיסטיקה' } },
      ]
    },
    {
      id: 'הכנה לבגרות', name: 'הכנה לבגרות', emoji: '📝', color: 'ct-green',
      meta: '', sort_order: 1,
      chapters: [
        { id: 'bg1', title: 'חזרה על בסיס',        sort_order: 0, quiz: { id: 'qz6', title: 'מבחן: חזרה על בסיס' } },
        { id: 'bg2', title: 'מבנה שאלון הבגרות',   sort_order: 1, quiz: { id: 'qz7', title: 'מבחן: אסטרטגיה' } },
      ]
    },
    {
      id: 'בגרות מורחבת', name: "בגרות מורחבת (5 יח')", emoji: '🏆', color: 'ct-amber',
      meta: '', sort_order: 2,
      chapters: [
        { id: 'mr1', title: 'חשבון דיפרנציאלי', sort_order: 0, quiz: { id: 'qz8', title: 'מבחן: נגזרות' } },
      ]
    }
  ];

  for (const course of TEMPLATE) {
    db.prepare('INSERT OR IGNORE INTO courses (id,name,emoji,color,meta,sort_order) VALUES (?,?,?,?,?,?)')
      .run(course.id, course.name, course.emoji, course.color, course.meta, course.sort_order);
    for (const ch of course.chapters) {
      db.prepare('INSERT OR IGNORE INTO chapters (id,course_id,title,sort_order) VALUES (?,?,?,?)')
        .run(ch.id, course.id, ch.title, ch.sort_order);
      if (ch.quiz) {
        db.prepare('INSERT OR IGNORE INTO quizzes (id,chapter_id,title,questions) VALUES (?,?,?,?)')
          .run(ch.quiz.id, ch.id, ch.quiz.title, '[]');
      }
    }
  }
  console.log('[Seed] Curriculum structure seeded — courses + chapters only, ready for admin');
}

async function seedCurriculum() {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    try {
      const token = process.env.GITHUB_TOKEN;
      const repo  = process.env.GITHUB_REPO;
      const res   = await fetch(`https://api.github.com/repos/${repo}/contents/curriculum.json`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'miniapp-server'
        }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.content) {
          const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
          if (Array.isArray(data) && data.length > 0) {
            db.exec('DELETE FROM quizzes; DELETE FROM lessons; DELETE FROM chapters; DELETE FROM courses;');
            seedFromJson(data);
            console.log('[Seed] Synced from GitHub ✓');
            return;
          }
        }
      }
    } catch (e) { console.error('[Seed] GitHub failed:', e.message); }
  }
  // fallback: רק אם DB ריק
  const count = db.prepare('SELECT COUNT(*) as n FROM courses').get().n;
  if (count > 0) return;
  const filePaths = [CURRICULUM_JSON, path.join(process.cwd(), 'curriculum.json')];
  for (const p of filePaths) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
          seedFromJson(data);
          console.log('[Seed] Loaded from', p);
          return;
        }
      }
    } catch {}
  }
  seedHardcoded();
}

const _seedPromise = seedCurriculum();

// (migrations removed — on Vercel /tmp is always fresh, so one-time
//  migrations would re-run every cold start and destroy data)

// ─── CURRICULUM READ ───────────────────────────────────────────────────
function getCurriculum() {
  const courses  = db.prepare('SELECT * FROM courses ORDER BY sort_order').all();
  const chapters = db.prepare('SELECT * FROM chapters ORDER BY sort_order').all();
  const lessons  = db.prepare('SELECT * FROM lessons ORDER BY sort_order').all();
  const quizzes  = db.prepare('SELECT * FROM quizzes').all();
  return courses.map(c => ({
    ...c,
    chapters: chapters
      .filter(ch => ch.course_id === c.id)
      .map(ch => ({
        ...ch,
        quiz: quizzes.find(q => q.chapter_id === ch.id) || null,
        lessons: lessons
          .filter(l => l.chapter_id === ch.id)
          .map(l => ({
            ...l,
            tags:      JSON.parse(l.tags      || '[]'),
            exercises: JSON.parse(l.exercises || '[]'),
            homework:  JSON.parse(l.homework  || '[]'),
          }))
      }))
  }));
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

// ─── CURRICULUM READ ───────────────────────────────────────────────────
app.get('/api/curriculum', async (req, res) => {
  await _seedPromise;
  res.json(normalisedCurriculum());
});

app.get('/api/curriculum-version', (req, res) => {
  res.json({ version: curriculumVersion });
});

// ─── QUIZ RESULT ───────────────────────────────────────────────────────
app.post('/api/quiz-result', (req, res) => {
  const { telegram_id, quiz_id, score, total } = req.body;
  if (!quiz_id || score === undefined || !total) return res.status(400).json({ error: 'bad_request' });
  db.prepare('INSERT INTO quiz_results (user_telegram_id,quiz_id,score,total) VALUES (?,?,?,?)').run(telegram_id||null, quiz_id, score, total);
  res.json({ ok: true });
});

// ─── ADMIN AUTH ────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'refaroman2003';

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

app.get('/api/admin/courses', async (req, res) => {
  await _seedPromise;
  res.json(normalisedCurriculum());
});

// ─── ADMIN CURRICULUM CRUD ─────────────────────────────────────────────

// Courses
app.post('/api/admin/courses', async (req, res) => {
  await _seedPromise;
  const { id, name, emoji='📚', color='ct-blue', meta='' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const n = db.prepare('SELECT COUNT(*) as n FROM courses').get().n;
  db.prepare('INSERT INTO courses (id,name,emoji,color,meta,sort_order) VALUES (?,?,?,?,?,?)').run(id,name,emoji,color,meta,n);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.put('/api/admin/courses/:id', async (req, res) => {
  await _seedPromise;
  const { name, emoji, color, meta, sort_order } = req.body;
  db.prepare('UPDATE courses SET name=COALESCE(?,name), emoji=COALESCE(?,emoji), color=COALESCE(?,color), meta=COALESCE(?,meta), sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name||null, emoji||null, color||null, meta||null, sort_order??null, req.params.id);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.delete('/api/admin/courses/:id', async (req, res) => {
  await _seedPromise;
  const cid = req.params.id;
  const chapters = db.prepare('SELECT id FROM chapters WHERE course_id=?').all(cid);
  for (const ch of chapters) {
    db.prepare('DELETE FROM lessons WHERE chapter_id=?').run(ch.id);
    db.prepare('DELETE FROM quizzes WHERE chapter_id=?').run(ch.id);
  }
  db.prepare('DELETE FROM chapters WHERE course_id=?').run(cid);
  db.prepare('DELETE FROM courses WHERE id=?').run(cid);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

// Chapters
app.post('/api/admin/chapters', async (req, res) => {
  await _seedPromise;
  const { id, course_id, title } = req.body;
  if (!id || !course_id || !title) return res.status(400).json({ error: 'missing fields' });
  const n = db.prepare('SELECT COUNT(*) as n FROM chapters WHERE course_id=?').get(course_id).n;
  db.prepare('INSERT INTO chapters (id,course_id,title,sort_order) VALUES (?,?,?,?)').run(id,course_id,title,n);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.put('/api/admin/chapters/:id', async (req, res) => {
  await _seedPromise;
  const { title, sort_order } = req.body;
  db.prepare('UPDATE chapters SET title=COALESCE(?,title), sort_order=COALESCE(?,sort_order) WHERE id=?').run(title||null, sort_order??null, req.params.id);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.delete('/api/admin/chapters/:id', async (req, res) => {
  await _seedPromise;
  const cid = req.params.id;
  db.prepare('DELETE FROM lessons WHERE chapter_id=?').run(cid);
  db.prepare('DELETE FROM quizzes WHERE chapter_id=?').run(cid);
  db.prepare('DELETE FROM chapters WHERE id=?').run(cid);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

// Lessons
app.post('/api/admin/lessons', async (req, res) => {
  await _seedPromise;
  const { id, chapter_id, title, description='', video_url='', tags=[], exercises=[], homework=[] } = req.body;
  if (!id || !chapter_id || !title) return res.status(400).json({ error: 'missing fields' });
  const n = db.prepare('SELECT COUNT(*) as n FROM lessons WHERE chapter_id=?').get(chapter_id).n;
  db.prepare('INSERT INTO lessons (id,chapter_id,title,description,video_url,tags,exercises,homework,sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,chapter_id,title,description,video_url,JSON.stringify(tags),JSON.stringify(exercises),JSON.stringify(homework),n);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.put('/api/admin/lessons/:id', async (req, res) => {
  await _seedPromise;
  const { title, description, video_url, tags, exercises, homework, sort_order } = req.body;
  db.prepare(`UPDATE lessons SET
    title=COALESCE(?,title), description=COALESCE(?,description),
    video_url=COALESCE(?,video_url), tags=COALESCE(?,tags),
    exercises=COALESCE(?,exercises), homework=COALESCE(?,homework),
    sort_order=COALESCE(?,sort_order) WHERE id=?`)
    .run(
      title||null, description||null, video_url!==undefined?video_url:null,
      tags?JSON.stringify(tags):null,
      exercises?JSON.stringify(exercises):null,
      homework?JSON.stringify(homework):null,
      sort_order??null, req.params.id
    );
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

app.delete('/api/admin/lessons/:id', async (req, res) => {
  await _seedPromise;
  db.prepare('DELETE FROM lessons WHERE id=?').run(req.params.id);
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

// Quizzes
app.put('/api/admin/quizzes/:chapter_id', async (req, res) => {
  await _seedPromise;
  const { title, questions } = req.body;
  const existing = db.prepare('SELECT id FROM quizzes WHERE chapter_id=?').get(req.params.chapter_id);
  if (existing) {
    db.prepare('UPDATE quizzes SET title=COALESCE(?,title), questions=COALESCE(?,questions) WHERE chapter_id=?')
      .run(title||null, questions?JSON.stringify(questions):null, req.params.chapter_id);
  } else {
    const id = 'qz_' + Date.now();
    db.prepare('INSERT INTO quizzes (id,chapter_id,title,questions) VALUES (?,?,?,?)').run(id, req.params.chapter_id, title||'מבחן מסכם', JSON.stringify(questions||[]));
  }
  curriculumVersion = Date.now(); bgSync(); res.json({ ok: true });
});

// ─── GITHUB SYNC ──────────────────────────────────────────────────────
// Every admin write syncs the full curriculum to GitHub so data survives
// Vercel cold starts (which wipe /tmp/miniapp.db every time).
async function syncToGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) return;
  const content = Buffer.from(JSON.stringify(normalisedCurriculum(), null, 2)).toString('base64');
  const getRes  = await fetch(`https://api.github.com/repos/${repo}/contents/curriculum.json`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'miniapp-server' }
  });
  const sha = getRes.ok ? (await getRes.json()).sha : undefined;
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/curriculum.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'miniapp-server', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'admin: publish curriculum', content, ...(sha ? { sha } : {}) })
  });
  if (!putRes.ok) throw new Error(`GitHub PUT ${putRes.status}`);
}

// Fire-and-forget sync after every admin write
function bgSync() {
  syncToGitHub().catch(e => console.error('[bgSync]', e.message));
}

app.post('/api/admin/push', async (req, res) => {
  await _seedPromise;
  curriculumVersion = Date.now();
  const data = normalisedCurriculum();
  try {
    await syncToGitHub();
    console.log('[Publish] Synced curriculum → GitHub ✓');
    res.json({ ok: true, version: curriculumVersion, courses: data.length, synced: true });
  } catch (e) {
    console.error('[Publish] GitHub sync failed:', e.message);
    res.json({ ok: true, version: curriculumVersion, courses: data.length, synced: false, syncError: e.message });
  }
});

app.get('/api/admin/export-curriculum', async (req, res) => {
  await _seedPromise;
  const data = getCurriculum();
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

if (process.env.NODE_ENV !== 'production') {
  const insPerm = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  insPerm.run(null,          '123',      'סולו',  'permanent_123');
  insPerm.run('t@test.com',  null,       'סולו',  'permanent_ttest');
}

// ─── START ────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3458;
  app.listen(PORT, () => console.log(`✅  Mini App server → http://localhost:${PORT}`));
}

module.exports = app;
