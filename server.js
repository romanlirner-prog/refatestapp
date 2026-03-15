/**
 * Rafael Mini App — Backend
 * Stack: Express + node:sqlite (Node 22.5+)
 */

require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── DB ────────────────────────────────────────────────────────────────
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

// ─── SEED CURRICULUM ─────────────────────────────────────────────────
function seedCurriculum() {
  const count = db.prepare('SELECT COUNT(*) as n FROM courses').get().n;
  if (count > 0) return; // already seeded

  const curriculum = [
    {
      id: 'חטיבה-תיכון', name: 'חטיבה → תיכון', emoji: '📐', color: 'ct-blue', meta: '32 שיעורים · הכנה מלאה', sort_order: 0,
      chapters: [
        {
          id: 'ch1', title: 'מספרים ושברים', sort_order: 0,
          quiz: { id: 'qz1', title: 'מבחן: מספרים ושברים', questions: [
            { q: 'כמה הוא (-3) + 7?', options: ['4','10','-10','-4'], answer: 0 },
            { q: 'מה הוא הערך המוחלט של -5?', options: ['5','-5','0','25'], answer: 0 },
            { q: 'כמה הוא ²⁄₃ + ¹⁄₄?', options: ['¹¹⁄₁₂','³⁄₇','⅚','¾'], answer: 0 },
          ]},
          lessons: [
            { id: 'c1l1', title: 'מספרים טבעיים ושלמים', description: 'נלמד על מספרים שלמים, ערך מוחלט וסדר פעולות חשבון.', tags: ['תיאוריה'], exercises: ['פתור: (-3) + 7 - (-2)', 'חשב: |−5| + |3|', 'סדר מקטן לגדול: -4, 2, -1, 0, 3'], hw: ['דף תרגול 1 — שאלות 1–10', 'אתר: 5 תרגילי חזרה על מספרים שלמים'] },
            { id: 'c1l2', title: 'שברים רגילים וחישובים', description: 'חיבור, חיסור, כפל וחילוק של שברים. פישוט שברים.', tags: ['תיאוריה', 'תרגול'], exercises: ['חשב: ²⁄₃ + ¹⁄₄', 'פשט: ⁶⁄₉', 'חשב: ³⁄₄ × ⁸⁄₉'], hw: ['דף תרגול 2 — שאלות 1–12', 'חזור על המרה בין שברים'] },
            { id: 'c1l3', title: 'עשרוניים ואחוזים', description: 'המרה בין עשרוניים לאחוזים ופתרון שאלות אחוזים.', tags: ['תרגול'], exercises: ['המר לאחוז: 0.35', 'מה הם 20% מ-80?', 'ירידת מחיר של 15% מ-200 ₪'], hw: ['דף תרגול 3 — שאלות 1–8'] },
          ]
        },
        {
          id: 'ch2', title: 'אלגברה — ביטויים ומשוואות', sort_order: 1,
          quiz: { id: 'qz2', title: 'מבחן: אלגברה', questions: [
            { q: 'פשט: 3x + 2x - x', options: ['4x','6x','5x','x'], answer: 0 },
            { q: 'פתור: 2x + 5 = 13', options: ['x=4','x=9','x=3','x=5'], answer: 0 },
            { q: 'פתור: x² - 5x + 6 = 0', options: ['x=2,3','x=1,6','x=-2,-3','x=0,5'], answer: 0 },
          ]},
          lessons: [
            { id: 'c2l1', title: 'ביטויים אלגבריים', description: 'פישוט ביטויים, הוצאת גורם משותף וכפל סוגריים.', tags: ['תיאוריה'], exercises: ['פשט: 3x + 2x - x', 'הוצא גורם משותף: 6x² + 9x', 'הכפל: (x+2)(x-3)'], hw: ['דף ביטויים — שאלות 1–15'] },
            { id: 'c2l2', title: 'משוואה ממעלה ראשונה', description: 'פתרון משוואות לינאריות ושאלות מילוליות.', tags: ['תרגול'], exercises: ['פתור: 2x + 5 = 13', 'פתור: 3(x-2) = 9', 'גיל עמי הוא פי 2 מאחיו, יחד 24 — מה גילו?'], hw: ['דף משוואות — שאלות 1–10', 'שאלות מילוליות 3 ראשונות'] },
            { id: 'c2l3', title: 'משוואה ממעלה שנייה', description: 'פתרון ריבועית: פירוק לגורמים ונוסחת שורשים.', tags: ['תיאוריה', 'תרגול'], exercises: ['פתור: x² - 5x + 6 = 0', 'פתור: 2x² - 8 = 0', 'פתור: x² + 4x + 4 = 0'], hw: ['דף ריבועית — שאלות 1–12'] },
            { id: 'c2l4', title: 'אי-שוויונות', description: 'פתרון אי-שוויונות ויצוג על ציר המספרים.', tags: ['תרגול'], exercises: ['פתור: 2x - 3 > 7', 'פתור: -x + 4 ≤ 2', 'מתי 3x + 1 < 10?'], hw: ['דף אי-שוויונות — שאלות 1–8'] },
          ]
        },
        {
          id: 'ch3', title: 'גאומטריה', sort_order: 2,
          quiz: { id: 'qz3', title: 'מבחן: גאומטריה', questions: [
            { q: 'מהי הזווית הנשלמת ל-65°?', options: ['115°','25°','90°','180°'], answer: 0 },
            { q: 'במשולש עם זוויות 40° ו-70°, מהי הזווית השלישית?', options: ['70°','80°','60°','90°'], answer: 0 },
            { q: 'שטח ריבוע עם צלע 7:', options: ['49','14','28','21'], answer: 0 },
          ]},
          lessons: [
            { id: 'c3l1', title: 'זוויות ומשפטים בסיסיים', description: 'זוויות משלימות, זוויות במשולש ומשפטים על קווים מקבילים.', tags: ['תיאוריה'], exercises: ['מצא זווית נשלמת ל-65°', 'זוויות במשולש: 40°, 70°, ?', 'זוויות על צלע מקבילות'], hw: ['דף גאומטריה — שאלות 1–10'] },
            { id: 'c3l2', title: 'משפט פיתגורס', description: 'הכרת המשפט, שימוש ובדיקה.', tags: ['תרגול'], exercises: ['מצא צלע חסרה: 3, 4, ?', 'בדוק: האם 5, 12, 13 הם ישר-זווי?', 'גובה 8, אלכסון 10 — מה הרוחב?'], hw: ['דף פיתגורס — שאלות 1–8'] },
            { id: 'c3l3', title: 'שטחים ונפחים', description: 'חישוב שטח ונפח של צורות מישוריות ותלת-מימדיות.', tags: ['תיאוריה', 'תרגול'], exercises: ['שטח ריבוע עם צלע 7', 'שטח משולש: בסיס 6, גובה 4', 'נפח תיבה 5×3×2'], hw: ['דף שטחים — שאלות 1–12'] },
          ]
        },
        {
          id: 'ch4', title: 'פונקציות לינאריות', sort_order: 3,
          quiz: { id: 'qz4', title: 'מבחן: פונקציות', questions: [
            { q: 'האם (2,5) על y = 2x+1?', options: ['כן','לא'], answer: 0 },
            { q: 'שיפוע: (1,2) ו-(3,8)?', options: ['3','2','4','6'], answer: 0 },
          ]},
          lessons: [
            { id: 'c4l1', title: 'מושגי יסוד בפונקציה', description: 'תחום, טווח, נקודת חיתוך עם הצירים.', tags: ['תיאוריה'], exercises: ['האם (2,5) נמצאת על y=2x+1?', 'חשב f(3) עבור f(x)=4x-2', 'מצא חיתוך עם ציר y'], hw: ['דף פונקציות — שאלות 1–8'] },
            { id: 'c4l2', title: 'שיפוע וקו ישר', description: 'חישוב שיפוע ומשוואת קו ישר.', tags: ['תרגול'], exercises: ['מצא שיפוע: (1,2) ו-(3,8)', 'משוואת קו: m=2, עובר (0,3)', 'חיתוך: y=x+2 ו- y=3x-4'], hw: ['דף שיפוע — שאלות 1–10'] },
          ]
        },
        {
          id: 'ch5', title: 'סטטיסטיקה', sort_order: 4,
          quiz: { id: 'qz5', title: 'מבחן: סטטיסטיקה', questions: [
            { q: 'ממוצע של: 3, 7, 5, 9, 1?', options: ['5','4','6','7'], answer: 0 },
            { q: 'P(זוגי) בהטלת קוביה?', options: ['½','⅓','⅙','¼'], answer: 0 },
          ]},
          lessons: [
            { id: 'c5l1', title: 'ממוצע, חציון, שכיח', description: 'חישוב מדדי מיקום מרכזיים.', tags: ['תיאוריה'], exercises: ['ממוצע: 3, 7, 5, 9, 1', 'חציון: 2, 8, 4, 6, 10', 'שכיח: 3, 5, 3, 7, 5, 3'], hw: ['דף סטטיסטיקה — שאלות 1–10'] },
            { id: 'c5l2', title: 'הסתברות בסיסית', description: 'חישוב הסתברות של אירועים פשוטים ומורכבים.', tags: ['תרגול'], exercises: ['קוביה: P(זוגי)?', 'קלפים: P(מלך) מחפיסה?', 'שתי הטלות מטבע: P(שתי עצים)?'], hw: ['דף הסתברות — שאלות 1–8'] },
          ]
        }
      ]
    },
    {
      id: 'הכנה לבגרות', name: 'הכנה לבגרות', emoji: '📝', color: 'ct-green', meta: '48 שיעורים · 3 רמות', sort_order: 1,
      chapters: [
        {
          id: 'bg1', title: 'חזרה על בסיס', sort_order: 0,
          quiz: { id: 'qz6', title: 'מבחן: חזרה על בסיס', questions: [
            { q: 'פשט: (2x²)³', options: ['8x⁶','6x⁶','8x⁵','2x⁶'], answer: 0 },
          ]},
          lessons: [
            { id: 'b1l1', title: 'אלגברה — חזרה מהירה', description: 'חזרה על נושאי אלגברה מהחטיבה.', tags: ['חזרה'], exercises: ['פשט: (2x²)³', 'פתור: |x-3|=5', 'מערכת: x+y=5, 2x-y=4'], hw: ['חזרה על נוסחאות — דף 1'] },
            { id: 'b1l2', title: 'פונקציות — חזרה', description: 'גרפים, נקודות קיצון ואסימפטוטות.', tags: ['חזרה', 'גרף'], exercises: ['שרטט: y=x²-4', 'מצא נקודות קיצון', 'פתור גרפית: x²=2x+3'], hw: ['גרפים — דף 2'] },
          ]
        },
        {
          id: 'bg2', title: 'מבנה שאלון הבגרות', sort_order: 1,
          quiz: { id: 'qz7', title: 'מבחן: אסטרטגיה', questions: [
            { q: 'כמה זמן יש לשאלון בגרות מלאה?', options: ['3 שעות','2 שעות','4 שעות','שעתיים וחצי'], answer: 0 },
          ]},
          lessons: [
            { id: 'b2l1', title: 'הכרת השאלון ואסטרטגיה', description: 'מבנה שאלון 806, ניהול זמן ואסטרטגיית פתרון.', tags: ['אסטרטגיה'], exercises: ['ניהול זמן: שאלון לדוגמה', 'אלו שאלות לדלג ראשית?'], hw: ['קרא: הסבר מבנה שאלון 806', 'ענה על 5 שאלות מניסיון 2023'] },
            { id: 'b2l2', title: 'שאלות מילוליות — שיטה', description: 'שיטת 4 שלבים לפתרון שאלות מילוליות.', tags: ['שיטה'], exercises: ['שאלה מילולית: ריבית פשוטה', 'שאלה: תנועה במהירות קבועה', 'שאלה: תערובות'], hw: ['10 שאלות מילוליות מניסיונות קודמים'] },
          ]
        }
      ]
    },
    {
      id: 'בגרות מורחבת', name: "בגרות מורחבת (5 יח')", emoji: '🏆', color: 'ct-amber', meta: '28 שיעורים · רמה גבוהה', sort_order: 2,
      chapters: [
        {
          id: 'mr1', title: 'חשבון דיפרנציאלי', sort_order: 0,
          quiz: { id: 'qz8', title: 'מבחן: נגזרות', questions: [
            { q: "f'(x) של x³:", options: ['3x²','x²','3x','x³'], answer: 0 },
          ]},
          lessons: [
            { id: 'm1l1', title: 'גבולות ורציפות', description: 'חישוב גבולות ובדיקת רציפות.', tags: ['תיאוריה'], exercises: ['lim(x→2) (x²-4)/(x-2)', 'בדוק רציפות: f(x)=|x|/x', 'מצא אסימפטוטה אנכית'], hw: ['גבולות — שאלות 1–8'] },
            { id: 'm1l2', title: 'נגזרות — כללים', description: 'כללי גזירה: חיבור, מכפלה, מנה, שרשרת.', tags: ['תרגול'], exercises: ["f'(x): x³+5x²-2x+1", "f'(x): (x²+1)(x-3)", "f'(x): (3x+2)/(x-1)"], hw: ['נגזרות — שאלות 1–12'] },
          ]
        }
      ]
    }
  ];

  for (const course of curriculum) {
    db.prepare('INSERT OR IGNORE INTO courses (id,name,emoji,color,meta,sort_order) VALUES (?,?,?,?,?,?)')
      .run(course.id, course.name, course.emoji, course.color, course.meta, course.sort_order);
    for (const ch of course.chapters) {
      db.prepare('INSERT OR IGNORE INTO chapters (id,course_id,title,sort_order) VALUES (?,?,?,?)')
        .run(ch.id, course.id, ch.title, ch.sort_order);
      if (ch.quiz) {
        db.prepare('INSERT OR IGNORE INTO quizzes (id,chapter_id,title,questions) VALUES (?,?,?,?)')
          .run(ch.quiz.id, ch.id, ch.quiz.title, JSON.stringify(ch.quiz.questions));
      }
      for (let li = 0; li < ch.lessons.length; li++) {
        const ls = ch.lessons[li];
        db.prepare('INSERT OR IGNORE INTO lessons (id,chapter_id,title,description,video_url,tags,exercises,homework,sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(ls.id, ch.id, ls.title, ls.description, '', JSON.stringify(ls.tags), JSON.stringify(ls.exercises), JSON.stringify(ls.hw), li);
      }
    }
  }
  console.log('[Seed] Curriculum seeded.');
}
seedCurriculum();

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
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  if (!user) return res.status(404).json({ error: 'not_found' });
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
  const { telegram_id, progress } = req.body;
  if (!telegram_id || progress === undefined) return res.status(400).json({ error: 'bad_request' });
  db.prepare('UPDATE users SET progress=? WHERE telegram_id=?').run(Math.min(100,Math.max(0,Number(progress))), telegram_id);
  res.json({ ok: true });
});

// ─── CURRICULUM READ ───────────────────────────────────────────────────
app.get('/api/curriculum', (req, res) => {
  res.json(getCurriculum());
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
  const adminPhone     = process.env.ADMIN_PHONE || '0535266628';
  const normalizedInput = normalizePhone(phone);
  const normalizedAdmin = normalizePhone(adminPhone);
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  if (normalizedInput !== normalizedAdmin) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true });
});

// PUT /api/admin/users/:telegram_id — edit plan
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

// ─── ADMIN CURRICULUM CRUD ─────────────────────────────────────────────

// Courses
app.get('/api/admin/courses', (req, res) => res.json(getCurriculum()));

app.post('/api/admin/courses', (req, res) => {
  const { id, name, emoji='📚', color='ct-blue', meta='' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const n = db.prepare('SELECT COUNT(*) as n FROM courses').get().n;
  db.prepare('INSERT INTO courses (id,name,emoji,color,meta,sort_order) VALUES (?,?,?,?,?,?)').run(id,name,emoji,color,meta,n);
  res.json({ ok: true });
});

app.put('/api/admin/courses/:id', (req, res) => {
  const { name, emoji, color, meta, sort_order } = req.body;
  db.prepare('UPDATE courses SET name=COALESCE(?,name), emoji=COALESCE(?,emoji), color=COALESCE(?,color), meta=COALESCE(?,meta), sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name||null, emoji||null, color||null, meta||null, sort_order??null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/courses/:id', (req, res) => {
  const cid = req.params.id;
  const chapters = db.prepare('SELECT id FROM chapters WHERE course_id=?').all(cid);
  for (const ch of chapters) {
    db.prepare('DELETE FROM lessons WHERE chapter_id=?').run(ch.id);
    db.prepare('DELETE FROM quizzes WHERE chapter_id=?').run(ch.id);
  }
  db.prepare('DELETE FROM chapters WHERE course_id=?').run(cid);
  db.prepare('DELETE FROM courses WHERE id=?').run(cid);
  res.json({ ok: true });
});

// Chapters
app.post('/api/admin/chapters', (req, res) => {
  const { id, course_id, title } = req.body;
  if (!id || !course_id || !title) return res.status(400).json({ error: 'missing fields' });
  const n = db.prepare('SELECT COUNT(*) as n FROM chapters WHERE course_id=?').get(course_id).n;
  db.prepare('INSERT INTO chapters (id,course_id,title,sort_order) VALUES (?,?,?,?)').run(id,course_id,title,n);
  res.json({ ok: true });
});

app.put('/api/admin/chapters/:id', (req, res) => {
  const { title, sort_order } = req.body;
  db.prepare('UPDATE chapters SET title=COALESCE(?,title), sort_order=COALESCE(?,sort_order) WHERE id=?').run(title||null, sort_order??null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/chapters/:id', (req, res) => {
  const cid = req.params.id;
  db.prepare('DELETE FROM lessons WHERE chapter_id=?').run(cid);
  db.prepare('DELETE FROM quizzes WHERE chapter_id=?').run(cid);
  db.prepare('DELETE FROM chapters WHERE id=?').run(cid);
  res.json({ ok: true });
});

// Lessons
app.post('/api/admin/lessons', (req, res) => {
  const { id, chapter_id, title, description='', video_url='', tags=[], exercises=[], homework=[] } = req.body;
  if (!id || !chapter_id || !title) return res.status(400).json({ error: 'missing fields' });
  const n = db.prepare('SELECT COUNT(*) as n FROM lessons WHERE chapter_id=?').get(chapter_id).n;
  db.prepare('INSERT INTO lessons (id,chapter_id,title,description,video_url,tags,exercises,homework,sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,chapter_id,title,description,video_url,JSON.stringify(tags),JSON.stringify(exercises),JSON.stringify(homework),n);
  res.json({ ok: true });
});

app.put('/api/admin/lessons/:id', (req, res) => {
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
  res.json({ ok: true });
});

app.delete('/api/admin/lessons/:id', (req, res) => {
  db.prepare('DELETE FROM lessons WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Quizzes
app.put('/api/admin/quizzes/:chapter_id', (req, res) => {
  const { title, questions } = req.body;
  const existing = db.prepare('SELECT id FROM quizzes WHERE chapter_id=?').get(req.params.chapter_id);
  if (existing) {
    db.prepare('UPDATE quizzes SET title=COALESCE(?,title), questions=COALESCE(?,questions) WHERE chapter_id=?')
      .run(title||null, questions?JSON.stringify(questions):null, req.params.chapter_id);
  } else {
    const id = 'qz_' + Date.now();
    db.prepare('INSERT INTO quizzes (id,chapter_id,title,questions) VALUES (?,?,?,?)').run(id, req.params.chapter_id, title||'מבחן מסכם', JSON.stringify(questions||[]));
  }
  res.json({ ok: true });
});

// ─── SEED (dev only) ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const ins = db.prepare('INSERT OR IGNORE INTO purchases (email,phone,plan,grow_transaction_id) VALUES (?,?,?,?)');
  ins.run('test@test.com', null,         'כיתה',  'dev_1');
  ins.run(null, '0501234567',            'מנטור', 'dev_2');
  ins.run('student@edu.com', null,       'סולו',  'dev_3');
}

// ─── PERMANENT USERS ─────────────────────────────────────────────────
// Always ensure these users exist (runs on every startup)
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
