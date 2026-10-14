require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');

const app = express();
const production = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.warn('DATABASE_URL and SESSION_SECRET must be configured before deployment.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'] } } }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'ama.sid', secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
const q = (text, params) => pool.query(text, params);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function requireAuth(req, res, next) { if (!req.session.user) return res.status(401).json({ error: 'Please sign in again.' }); next(); }
function requireRole(...roles) { return (req, res, next) => { if (!req.session.user) return res.status(401).json({ error: 'Please sign in again.' }); if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Your account does not have permission for this action.' }); next(); }; }
function schoolId(req) { return req.session.user.schoolId; }
async function audit(req, action, type = '', id = '') { await q('INSERT INTO audit_logs(school_id,user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)', [schoolId(req), req.session.user.id, action, type, String(id)]); }
function validText(value, max = 120) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await q(sql);
  await q(`
    ALTER TABLE classrooms
    ADD COLUMN IF NOT EXISTS assigned_teacher_id BIGINT
    REFERENCES users(id) ON DELETE SET NULL
  `);
}


app.get('/api/health', asyncRoute(async (_req, res) => { await q('SELECT 1'); res.json({ ok: true, service: 'Acropolis School Management API' }); }));
app.get('/api/session', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/register', authLimit, asyncRoute(async (req, res) => {
  const { schoolName, username, password, motto, termsAccepted } = req.body || {};
  if (termsAccepted !== true) {
  return res.status(400).json({
    error: 'Please agree to the Terms of Use and Privacy Notice before registering.'
  });
  }
  if (!validText(schoolName, 120) || !validText(username, 60) || username.trim().length < 3 || typeof password !== 'string' || password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Enter a school name, username (at least 3 characters), and password (at least 10 characters).' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const school = (await client.query('INSERT INTO schools(name,motto) VALUES($1,$2) RETURNING id,name,motto', [schoolName.trim(), validText(motto, 200) ? motto.trim() : 'Always praising God, Jehovah.'])).rows[0];
    const passwordHash = await bcrypt.hash(password, 12);
    const user = (await client.query('INSERT INTO users(school_id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,role', [school.id, username.trim(), passwordHash, 'ADMIN'])).rows[0];
    await client.query('INSERT INTO audit_logs(school_id,user_id,action,entity_type) VALUES($1,$2,$3,$4)', [school.id, user.id, 'school_created', 'school']);
    await client.query('COMMIT');
    req.session.user = { id: user.id, username: user.username, role: user.role, schoolId: school.id, schoolName: school.name, motto: school.motto };
    req.session.save(err => { if (err) return res.status(500).json({ error: 'Account created, but sign-in could not be started. Please sign in.' }); res.status(201).json({ user: req.session.user }); });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.post('/api/login', authLimit, asyncRoute(async (req, res) => {
  const { schoolName, username, password } = req.body || {};
  if (!validText(username, 60) || typeof password !== 'string') return res.status(400).json({ error: 'Enter your username and password.' });
  const result = await q(`SELECT u.id,u.username,u.password_hash,u.role,u.school_id,s.name AS school_name,s.motto FROM users u JOIN schools s ON s.id=u.school_id WHERE lower(u.username)=lower($1) AND ($2::text IS NULL OR lower(s.name)=lower($2)) LIMIT 1`, [username.trim(), validText(schoolName,120) ? schoolName.trim() : null]);
  const u = result.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'School, username or password is incorrect.' });
  req.session.regenerate(err => { if (err) return res.status(500).json({ error: 'Unable to start a secure session. Please try again.' }); req.session.user = { id: u.id, username: u.username, role: u.role, schoolId: u.school_id, schoolName: u.school_name, motto: u.motto }; req.session.save(e => e ? res.status(500).json({ error: 'Unable to save your session.' }) : res.json({ user: req.session.user })); });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('ama.sid'); res.json({ ok: true }); }));

app.get('/api/bootstrap', requireAuth, asyncRoute(async (req, res) => {
  const sid = schoolId(req);

  const [students, payments, marks, users, school] = await Promise.all([
    q('SELECT s.*, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id=s.id AND p.school_id=s.school_id),0) AS paid FROM students s WHERE s.school_id=$1 ORDER BY s.created_at DESC', [sid]),

    q('SELECT p.*,s.full_name AS student_name,s.student_code,u.username AS recorded_by_name FROM payments p JOIN students s ON s.id=p.student_id LEFT JOIN users u ON u.id=p.recorded_by WHERE p.school_id=$1 ORDER BY p.paid_at DESC LIMIT 1000', [sid]),

    q('SELECT m.*,s.full_name AS student_name,s.student_code,s.class_name FROM marks m JOIN students s ON s.id=m.student_id WHERE m.school_id=$1 ORDER BY m.created_at DESC', [sid]),

    req.session.user.role === 'ADMIN'
      ? q('SELECT id,username,role,created_at FROM users WHERE school_id=$1 ORDER BY created_at', [sid])
      : Promise.resolve({ rows: [] }),

    q('SELECT name,motto,academic_year AS "academicYear",current_term AS "currentTerm" FROM schools WHERE id=$1', [sid])
  ]);

  res.json({
    students: students.rows,
    payments: payments.rows,
    marks: marks.rows,
    users: users.rows,
    school: school.rows[0] || {
      name: req.session.user.schoolName,
      motto: req.session.user.motto,
      academicYear: '',
      currentTerm: 'Term 1'
    },
    session: req.session.user
  });
}));

app.put('/api/settings', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (
    !validText(b.schoolName, 120) ||
    !validText(b.motto, 200) ||
    !validText(b.academicYear, 30) ||
    !['Term 1', 'Term 2', 'Term 3'].includes(b.currentTerm)
  ) {
    return res.status(400).json({
      error: 'Enter a school name, motto, academic year, and valid term.'
    });
  }

  const r = await q(
    `UPDATE schools
     SET name=$1, motto=$2, academic_year=$3, current_term=$4
     WHERE id=$5
     RETURNING name, motto,
       academic_year AS "academicYear",
       current_term AS "currentTerm"`,
    [
      b.schoolName.trim(),
      b.motto.trim(),
      b.academicYear.trim(),
      b.currentTerm,
      schoolId(req)
    ]
  );

  if (!r.rowCount) {
    return res.status(404).json({ error: 'School not found.' });
  }

  req.session.user.schoolName = r.rows[0].name;
  req.session.user.motto = r.rows[0].motto;

  await audit(req, 'school_settings_updated', 'school', schoolId(req));

  res.json({ settings: r.rows[0] });
}));

app.post('/api/students', requireAuth, asyncRoute(async (req,res)=>{
  if (!['ADMIN','TEACHER'].includes(req.session.user.role)) return res.status(403).json({error:'Only administrators and teachers can manage students.'});
  const b=req.body||{}; if(!validText(b.fullName,120)||!validText(b.className,60)) return res.status(400).json({error:'Student name and class are required.'});
  const totalFees=Number(b.totalFees||0); if(!Number.isFinite(totalFees)||totalFees<0) return res.status(400).json({error:'Fees must be zero or more.'});
  const code=validText(b.studentCode,40)?b.studentCode.trim():`AMA-${Date.now().toString().slice(-8)}`;
  const r=await q('INSERT INTO students(school_id,student_code,full_name,class_name,gender,guardian_name,guardian_phone,total_fees) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[schoolId(req),code,b.fullName.trim(),b.className.trim(),String(b.gender||'').slice(0,20),String(b.guardianName||'').slice(0,120),String(b.guardianPhone||'').slice(0,40),totalFees]); await audit(req,'student_created','student',r.rows[0].id); res.status(201).json({student:r.rows[0]});
}));
app.put('/api/students/:id', requireRole('ADMIN','TEACHER'), asyncRoute(async(req,res)=>{const b=req.body||{};if(!validText(b.fullName,120)||!validText(b.className,60))return res.status(400).json({error:'Student name and class are required.'});const r=await q('UPDATE students SET full_name=$1,class_name=$2,gender=$3,guardian_name=$4,guardian_phone=$5,total_fees=$6 WHERE id=$7 AND school_id=$8 AND archived=false RETURNING *',[b.fullName.trim(),b.className.trim(),String(b.gender||'').slice(0,20),String(b.guardianName||'').slice(0,120),String(b.guardianPhone||'').slice(0,40),Math.max(0,Number(b.totalFees||0)),req.params.id,schoolId(req)]);if(!r.rowCount)return res.status(404).json({error:'Student not found.'});await audit(req,'student_updated','student',req.params.id);res.json({student:r.rows[0]})}));
app.delete('/api/students/:id', requireRole('ADMIN'), asyncRoute(async(req,res)=>{const r=await q('UPDATE students SET archived=true WHERE id=$1 AND school_id=$2 AND archived=false RETURNING id',[req.params.id,schoolId(req)]);if(!r.rowCount)return res.status(404).json({error:'Student not found.'});await audit(req,'student_archived','student',req.params.id);res.json({ok:true})}));
app.post('/api/marks', requireRole('ADMIN','TEACHER'), asyncRoute(async(req,res)=>{const b=req.body||{},score=Number(b.score);if(!b.studentId||!validText(b.subject,80)||!Number.isFinite(score)||score<0||score>100)return res.status(400).json({error:'Choose a student and subject, and enter a score from 0 to 100.'});const st=await q('SELECT id FROM students WHERE id=$1 AND school_id=$2 AND archived=false',[b.studentId,schoolId(req)]);if(!st.rowCount)return res.status(404).json({error:'Student not found.'});const r=await q(`INSERT INTO marks(school_id,student_id,subject,term,score) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,student_id,subject,term) DO UPDATE SET score=EXCLUDED.score RETURNING *`,[schoolId(req),b.studentId,b.subject.trim(),validText(b.term,40)?b.term.trim():'Term 1',score]);await audit(req,'mark_saved','mark',r.rows[0].id);res.status(201).json({mark:r.rows[0]})}));

app.post('/api/payments', requireRole('ADMIN', 'BURSAR'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const amount = Number(b.amount);

  if (!b.studentId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      error: 'Choose a student and enter a payment greater than zero.'
    });
  }

  const st = await q(
    'SELECT id FROM students WHERE id=$1 AND school_id=$2 AND archived=false',
    [b.studentId, schoolId(req)]
  );

  if (!st.rowCount) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  const receipt = `AMA-${Date.now().toString(36).toUpperCase()}`;

  const r = await q(
    'INSERT INTO payments(school_id,student_id,receipt_no,amount,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [
      schoolId(req),
      b.studentId,
      receipt,
      amount,
      String(b.note || '').slice(0, 200),
      req.session.user.id
    ]
  );

  await audit(req, 'payment_recorded', 'payment', r.rows[0].id);
  res.status(201).json({ payment: r.rows[0] });
}));

app.delete('/api/payments/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM payments
       WHERE id = $1 AND school_id = $2
       RETURNING id, receipt_no, student_id, amount`,
      [req.params.id, schoolId(req)]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Payment record not found.'
      });
    }

    const payment = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs
       (school_id, user_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        schoolId(req),
        req.session.user.id,
        'payment_deleted',
        'payment',
        String(payment.id)
      ]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      deletedPayment: payment,
      message: 'Payment deleted successfully.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));app.post('/api/users', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const { username, password, role } = req.body || {};

  if (!validText(username, 60) || username.trim().length < 3 ||
      typeof password !== 'string' || password.length < 10 ||
      password.length > 200 ||
      !['HEADMASTER', 'TEACHER', 'BURSAR'].includes(role)) {
    return res.status(400).json({
      error: 'Enter a username, a password of at least 10 characters, and a valid staff role.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const r = await q(
      'INSERT INTO users(school_id, username, password_hash, role) VALUES($1,$2,$3,$4) RETURNING id, username, role, created_at',
      [schoolId(req), username.trim(), passwordHash, role]
    );

    await audit(req, 'user_created', 'user', r.rows[0].id);
    res.status(201).json({ user: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That username already exists in this school.' });
    }
    throw err;
  }
}));

    
  app.delete('/api/users/:id', requireRole('ADMIN'), asyncRoute(async(req,res)=>{if(String(req.params.id)===String(req.session.user.id))return res.status(400).json({error:'You cannot delete your own active account.'});const r=await q('DELETE FROM users WHERE id=$1 AND school_id=$2 RETURNING id',[req.params.id,schoolId(req)]);if(!r.rowCount)return res.status(404).json({error:'User not found.'});await audit(req,'user_deleted','user',req.params.id);res.json({ok:true})}));

app.get('/api/parents', requireAuth, asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', s.id,
            'name', s.full_name,
            'studentCode', s.student_code,
            'className', s.class_name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS students
     FROM parents p
     LEFT JOIN parent_students ps
       ON ps.parent_id = p.id AND ps.school_id = p.school_id
     LEFT JOIN students s
       ON s.id = ps.student_id AND s.school_id = p.school_id
     WHERE p.school_id = $1
     GROUP BY p.id
     ORDER BY p.full_name`,
    [schoolId(req)]
  );
  res.json({ parents: result.rows });
}));

app.post('/api/parents', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the parent or guardian full name.' });
  }

  const studentIds = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : [])
    .map(Number))];

  if (studentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'One or more student selections are invalid.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (studentIds.length) {
      const valid = await client.query(
        'SELECT id FROM students WHERE school_id=$1 AND archived=false AND id = ANY($2::bigint[])',
        [schoolId(req), studentIds]
      );
      if (valid.rowCount !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Select valid active students from this school.' });
      }
    }

    const created = await client.query(
      `INSERT INTO parents
        (school_id, full_name, relationship, phone, alternate_phone, email, address, occupation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        schoolId(req), b.fullName.trim(),
        String(b.relationship || '').slice(0, 60),
        String(b.phone || '').slice(0, 40),
        String(b.alternatePhone || '').slice(0, 40),
        String(b.email || '').slice(0, 160),
        String(b.address || '').slice(0, 300),
        String(b.occupation || '').slice(0, 120)
      ]
    );

    for (const studentId of studentIds) {
      await client.query(
        'INSERT INTO parent_students (parent_id, student_id, school_id) VALUES ($1,$2,$3)',
        [created.rows[0].id, studentId, schoolId(req)]
      );
    }

    await client.query('COMMIT');
    await audit(req, 'parent_created', 'parent', created.rows[0].id);
    res.status(201).json({ parent: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/parents/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the parent or guardian full name.' });
  }

  const studentIds = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : [])
    .map(Number))];

  if (studentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'One or more student selections are invalid.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM parents WHERE id=$1 AND school_id=$2',
      [req.params.id, schoolId(req)]
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parent record not found.' });
    }

    if (studentIds.length) {
      const valid = await client.query(
        'SELECT id FROM students WHERE school_id=$1 AND archived=false AND id = ANY($2::bigint[])',
        [schoolId(req), studentIds]
      );
      if (valid.rowCount !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Select valid active students from this school.' });
      }
    }

    const updated = await client.query(
      `UPDATE parents SET full_name=$1, relationship=$2, phone=$3,
        alternate_phone=$4, email=$5, address=$6, occupation=$7
       WHERE id=$8 AND school_id=$9 RETURNING *`,
      [
        b.fullName.trim(),
        String(b.relationship || '').slice(0, 60),
        String(b.phone || '').slice(0, 40),
        String(b.alternatePhone || '').slice(0, 40),
        String(b.email || '').slice(0, 160),
        String(b.address || '').slice(0, 300),
        String(b.occupation || '').slice(0, 120),
        req.params.id, schoolId(req)
      ]
    );

    await client.query(
      'DELETE FROM parent_students WHERE parent_id=$1 AND school_id=$2',
      [req.params.id, schoolId(req)]
    );

    for (const studentId of studentIds) {
      await client.query(
        'INSERT INTO parent_students (parent_id, student_id, school_id) VALUES ($1,$2,$3)',
        [req.params.id, studentId, schoolId(req)]
      );
    }

    await client.query('COMMIT');
    await audit(req, 'parent_updated', 'parent', req.params.id);
    res.json({ parent: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/parents/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await q(
    'DELETE FROM parents WHERE id=$1 AND school_id=$2 RETURNING id',
    [req.params.id, schoolId(req)]
  );
  if (!result.rowCount) {
    return res.status(404).json({ error: 'Parent record not found.' });
  }
  await audit(req, 'parent_deleted', 'parent', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/parents', requireAuth, asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', s.id,
            'name', s.full_name,
            'studentCode', s.student_code,
            'className', s.class_name
          )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS students
     FROM parents p
     LEFT JOIN parent_students ps
       ON ps.parent_id = p.id AND ps.school_id = p.school_id
     LEFT JOIN students s
       ON s.id = ps.student_id AND s.school_id = p.school_id
     WHERE p.school_id = $1
     GROUP BY p.id
     ORDER BY p.full_name`,
    [schoolId(req)]
  );
  res.json({ parents: result.rows });
}));

app.post('/api/parents', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the parent or guardian full name.' });
  }

  const studentIds = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : [])
    .map(Number))];

  if (studentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'One or more student selections are invalid.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (studentIds.length) {
      const valid = await client.query(
        'SELECT id FROM students WHERE school_id=$1 AND archived=false AND id = ANY($2::bigint[])',
        [schoolId(req), studentIds]
      );
      if (valid.rowCount !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Select valid active students from this school.' });
      }
    }

    const created = await client.query(
      `INSERT INTO parents
        (school_id, full_name, relationship, phone, alternate_phone, email, address, occupation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        schoolId(req), b.fullName.trim(),
        String(b.relationship || '').slice(0, 60),
        String(b.phone || '').slice(0, 40),
        String(b.alternatePhone || '').slice(0, 40),
        String(b.email || '').slice(0, 160),
        String(b.address || '').slice(0, 300),
        String(b.occupation || '').slice(0, 120)
      ]
    );

    for (const studentId of studentIds) {
      await client.query(
        'INSERT INTO parent_students (parent_id, student_id, school_id) VALUES ($1,$2,$3)',
        [created.rows[0].id, studentId, schoolId(req)]
      );
    }

    await client.query('COMMIT');
    await audit(req, 'parent_created', 'parent', created.rows[0].id);
    res.status(201).json({ parent: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/parents/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the parent or guardian full name.' });
  }

  const studentIds = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : [])
    .map(Number))];

  if (studentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'One or more student selections are invalid.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM parents WHERE id=$1 AND school_id=$2',
      [req.params.id, schoolId(req)]
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parent record not found.' });
    }

    if (studentIds.length) {
      const valid = await client.query(
        'SELECT id FROM students WHERE school_id=$1 AND archived=false AND id = ANY($2::bigint[])',
        [schoolId(req), studentIds]
      );
      if (valid.rowCount !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Select valid active students from this school.' });
      }
    }

    const updated = await client.query(
      `UPDATE parents SET full_name=$1, relationship=$2, phone=$3,
        alternate_phone=$4, email=$5, address=$6, occupation=$7
       WHERE id=$8 AND school_id=$9 RETURNING *`,
      [
        b.fullName.trim(),
        String(b.relationship || '').slice(0, 60),
        String(b.phone || '').slice(0, 40),
        String(b.alternatePhone || '').slice(0, 40),
        String(b.email || '').slice(0, 160),
        String(b.address || '').slice(0, 300),
        String(b.occupation || '').slice(0, 120),
        req.params.id, schoolId(req)
      ]
    );

    await client.query(
      'DELETE FROM parent_students WHERE parent_id=$1 AND school_id=$2',
      [req.params.id, schoolId(req)]
    );

    for (const studentId of studentIds) {
      await client.query(
        'INSERT INTO parent_students (parent_id, student_id, school_id) VALUES ($1,$2,$3)',
        [req.params.id, studentId, schoolId(req)]
      );
    }

    await client.query('COMMIT');
    await audit(req, 'parent_updated', 'parent', req.params.id);
    res.json({ parent: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/parents/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await q(
    'DELETE FROM parents WHERE id=$1 AND school_id=$2 RETURNING id',
    [req.params.id, schoolId(req)]
  );
  if (!result.rowCount) {
    return res.status(404).json({ error: 'Parent record not found.' });
  }
  await audit(req, 'parent_deleted', 'parent', req.params.id);
  res.json({ ok: true });
}));
// DROP-OFF DENIAL MANAGEMENT
app.get('/api/drop-off-denials', requireRole('ADMIN', 'BURSAR'), asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT d.id, d.student_id AS "studentId",
            s.full_name AS "studentName",
            s.student_code AS "studentCode",
            s.class_name AS "className",
            d.person_name AS "personName",
            d.person_phone AS "personPhone",
            d.relationship, d.reason, d.details,
            d.start_date AS "startDate",
            d.review_date AS "reviewDate",
            d.status,
            d.created_at AS "createdAt",
            d.updated_at AS "updatedAt",
            u.username AS "createdByName"
     FROM drop_off_denials d
     JOIN students s ON s.id = d.student_id
                    AND s.school_id = d.school_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.school_id = $1
     ORDER BY d.created_at DESC`,
    [schoolId(req)]
  );

  res.json({ denials: result.rows });
}));

app.post('/api/drop-off-denials', requireRole('ADMIN', 'BURSAR'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const studentId = Number(b.studentId);
  const personName = typeof b.personName === 'string' ? b.personName.trim() : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';

  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    return res.status(400).json({ error: 'Please select a valid student.' });
  }

  if (!validText(personName, 120) || !validText(reason, 80)) {
    return res.status(400).json({
      error: "Enter the person's name and the reason for recording the concern."
    });
  }

  const student = await q(
    'SELECT id FROM students WHERE id=$1 AND school_id=$2 AND archived=false',
    [studentId, schoolId(req)]
  );

  if (!student.rowCount) {
    return res.status(404).json({ error: 'Active student not found.' });
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = value => {
    if (!value) return true;
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  };

  if (!validDate(b.startDate) || !validDate(b.reviewDate)) {
    return res.status(400).json({ error: 'Enter valid dates.' });
  }

  if (b.startDate && b.reviewDate && b.reviewDate < b.startDate) {
    return res.status(400).json({
      error: 'The review date cannot be earlier than the start date.'
    });
  }

  const result = await q(
    `INSERT INTO drop_off_denials
      (school_id, student_id, person_name, person_phone,
       relationship, reason, details, start_date, review_date,
       status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$10)
     RETURNING id`,
    [
      schoolId(req),
      studentId,
      personName,
      String(b.personPhone || '').trim().slice(0, 40),
      String(b.relationship || '').trim().slice(0, 80),
      reason,
      String(b.details || '').trim().slice(0, 2000),
      b.startDate || null,
      b.reviewDate || null,
      req.session.user.id
    ]
  );

  await audit(req, 'drop_off_concern_created', 'drop_off_denial', result.rows[0].id);
  res.status(201).json({
    ok: true,
    id: result.rows[0].id,
    message: 'Drop-off concern recorded for review.'
  });
}));

app.put('/api/drop-off-denials/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const allowedStatuses = ['PENDING', 'ACTIVE', 'RESOLVED'];

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid record ID.' });
  }

  if (!allowedStatuses.includes(b.status)) {
    return res.status(400).json({ error: 'Choose a valid record status.' });
  }

  const existing = await q(
    'SELECT id FROM drop_off_denials WHERE id=$1 AND school_id=$2',
    [id, schoolId(req)]
  );

  if (!existing.rowCount) {
    return res.status(404).json({ error: 'Drop-off record not found.' });
  }

  const result = await q(
    `UPDATE drop_off_denials
     SET status=$1, updated_by=$2, updated_at=NOW()
     WHERE id=$3 AND school_id=$4
     RETURNING id, status`,
    [b.status, req.session.user.id, id, schoolId(req)]
  );

  await audit(req, 'drop_off_concern_status_updated', 'drop_off_denial', id);
  res.json({ ok: true, denial: result.rows[0] });
}));
// PICKUP PERSONS MANAGEMENT
app.get('/api/pickup-persons', requireAuth, asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT p.id,
            p.student_id AS "studentId",
            s.full_name AS "studentName",
            s.student_code AS "studentCode",
            s.class_name AS "className",
            p.full_name AS "fullName",
            p.relationship,
            p.phone,
            p.id_type AS "idType",
            p.id_number AS "idNumber",
            p.status,
            p.notes,
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            u.username AS "createdByName"
     FROM pickup_persons p
     JOIN students s ON s.id = p.student_id
                    AND s.school_id = p.school_id
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.school_id = $1
     ORDER BY p.created_at DESC`,
    [schoolId(req)]
  );

  res.json({ pickupPersons: result.rows });
}));

app.post('/api/pickup-persons', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const studentId = Number(b.studentId);

  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    return res.status(400).json({ error: 'Please select a valid student.' });
  }

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the pickup person’s full name.' });
  }

  const student = await q(
    'SELECT id FROM students WHERE id=$1 AND school_id=$2 AND archived=false',
    [studentId, schoolId(req)]
  );

  if (!student.rowCount) {
    return res.status(404).json({ error: 'Active student not found.' });
  }

  const status = ['PENDING', 'AUTHORIZED', 'REVOKED'].includes(b.status)
    ? b.status
    : 'PENDING';

  const result = await q(
    `INSERT INTO pickup_persons
      (school_id, student_id, full_name, relationship, phone,
       id_type, id_number, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      schoolId(req),
      studentId,
      b.fullName.trim(),
      String(b.relationship || '').trim().slice(0, 60),
      String(b.phone || '').trim().slice(0, 40),
      String(b.idType || '').trim().slice(0, 60),
      String(b.idNumber || '').trim().slice(0, 100),
      status,
      String(b.notes || '').trim().slice(0, 1000),
      req.session.user.id
    ]
  );

  await audit(req, 'pickup_person_created', 'pickup_person', result.rows[0].id);

  res.status(201).json({
    ok: true,
    id: result.rows[0].id,
    message: 'Pickup person saved successfully.'
  });
}));/* =========================================
   EMPLOYEE MANAGEMENT API
   ========================================= */

app.get('/api/employees', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT id,
            employee_code AS "employeeCode",
            full_name AS "fullName",
            gender,
            date_of_birth AS "dateOfBirth",
            phone,
            email,
            address,
            emergency_contact_name AS "emergencyContactName",
            emergency_contact_phone AS "emergencyContactPhone",
            department,
            position,
            qualification,
            employment_type AS "employmentType",
            employment_date AS "employmentDate",
            status,
            notes,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM employees
     WHERE school_id = $1
     ORDER BY full_name ASC`,
    [schoolId(req)]
  );

  res.json({ employees: result.rows });
}));

app.post('/api/employees', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};

  if (!validText(b.employeeCode, 40)) {
    return res.status(400).json({ error: 'Enter an employee ID.' });
  }

  if (!validText(b.fullName, 120)) {
    return res.status(400).json({ error: 'Enter the employee’s full name.' });
  }

  const employmentTypes = [
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY'
  ];

  const statuses = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'];

  const employmentType = employmentTypes.includes(b.employmentType)
    ? b.employmentType
    : 'FULL_TIME';

  const status = statuses.includes(b.status)
    ? b.status
    : 'ACTIVE';

  const result = await q(
    `INSERT INTO employees (
       school_id, employee_code, full_name, gender,
       date_of_birth, phone, email, address,
       emergency_contact_name, emergency_contact_phone,
       department, position, qualification,
       employment_type, employment_date, status, notes,
       created_by
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18
     )
     RETURNING id`,
    [
      schoolId(req),
      b.employeeCode.trim(),
      b.fullName.trim(),
      String(b.gender || '').trim().slice(0, 30),
      b.dateOfBirth || null,
      String(b.phone || '').trim().slice(0, 40),
      String(b.email || '').trim().slice(0, 160),
      String(b.address || '').trim().slice(0, 300),
      String(b.emergencyContactName || '').trim().slice(0, 120),
      String(b.emergencyContactPhone || '').trim().slice(0, 40),
      String(b.department || '').trim().slice(0, 100),
      String(b.position || '').trim().slice(0, 120),
      String(b.qualification || '').trim().slice(0, 200),
      employmentType,
      b.employmentDate || null,
      status,
      String(b.notes || '').trim().slice(0, 2000),
      req.session.user.id
    ]
  );

  await audit(req, 'employee_created', 'employee', result.rows[0].id);

  res.status(201).json({
    ok: true,
    id: result.rows[0].id,
    message: 'Employee record created successfully.'
  });
}));

app.put('/api/employees/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid employee record ID.' });
  }

  if (!validText(b.employeeCode, 40) || !validText(b.fullName, 120)) {
    return res.status(400).json({
      error: 'Employee ID and full name are required.'
    });
  }

  const employmentTypes = [
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY'
  ];

  const statuses = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'];

  if (
    (b.employmentType && !employmentTypes.includes(b.employmentType)) ||
    (b.status && !statuses.includes(b.status))
  ) {
    return res.status(400).json({
      error: 'Choose a valid employment type and status.'
    });
  }

  const result = await q(
    `UPDATE employees
     SET employee_code = $1,
         full_name = $2,
         gender = $3,
         date_of_birth = $4,
         phone = $5,
         email = $6,
         address = $7,
         emergency_contact_name = $8,
         emergency_contact_phone = $9,
         department = $10,
         position = $11,
         qualification = $12,
         employment_type = $13,
         employment_date = $14,
         status = $15,
         notes = $16,
         updated_at = NOW()
     WHERE id = $17 AND school_id = $18
     RETURNING id`,
    [
      b.employeeCode.trim(),
      b.fullName.trim(),
      String(b.gender || '').trim().slice(0, 30),
      b.dateOfBirth || null,
      String(b.phone || '').trim().slice(0, 40),
      String(b.email || '').trim().slice(0, 160),
      String(b.address || '').trim().slice(0, 300),
      String(b.emergencyContactName || '').trim().slice(0, 120),
      String(b.emergencyContactPhone || '').trim().slice(0, 40),
      String(b.department || '').trim().slice(0, 100),
      String(b.position || '').trim().slice(0, 120),
      String(b.qualification || '').trim().slice(0, 200),
      b.employmentType || 'FULL_TIME',
      b.employmentDate || null,
      b.status || 'ACTIVE',
      String(b.notes || '').trim().slice(0, 2000),
      id,
      schoolId(req)
    ]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Employee record not found.' });
  }

  await audit(req, 'employee_updated', 'employee', id);

  res.json({
    ok: true,
    message: 'Employee record updated successfully.'
  });
}));

app.delete('/api/employees/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid employee record ID.' });
  }

  const result = await q(
    `UPDATE employees
     SET status = 'INACTIVE', updated_at = NOW()
     WHERE id = $1 AND school_id = $2
     RETURNING id`,
    [id, schoolId(req)]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Employee record not found.' });
  }

  await audit(req, 'employee_deactivated', 'employee', id);

  res.json({
    ok: true,
    message: 'Employee marked inactive. The record has been retained.'
  });
}));// =========================================
// GRADUATION RECORDS API
// =========================================

app.get('/api/graduations', requireAuth, asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT g.id,
            g.student_id AS "studentId",
            s.full_name AS "studentName",
            s.student_code AS "studentCode",
            s.class_name AS "currentClass",
            g.graduation_year AS "graduationYear",
            g.class_completed AS "classCompleted",
            g.graduation_date AS "graduationDate",
            g.certificate_number AS "certificateNumber",
            g.remarks,
            g.created_at AS "createdAt"
     FROM graduation_records g
     JOIN students s
       ON s.id = g.student_id
      AND s.school_id = g.school_id
     WHERE g.school_id = $1
     ORDER BY g.graduation_year DESC, s.full_name ASC`,
    [schoolId(req)]
  );

  res.json({ graduations: result.rows });
}));

app.post('/api/graduations', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const studentIds = [...new Set(
    (Array.isArray(b.studentIds) ? b.studentIds : []).map(Number)
  )];

  const graduationYear = Number(b.graduationYear);
  const classCompleted = typeof b.classCompleted === 'string'
    ? b.classCompleted.trim()
    : '';

  if (
    !studentIds.length ||
    studentIds.some(id => !Number.isSafeInteger(id) || id <= 0)
  ) {
    return res.status(400).json({
      error: 'Select at least one registered student.'
    });
  }

  if (
    !Number.isInteger(graduationYear) ||
    graduationYear < 2000 ||
    graduationYear > 2200 ||
    !validText(classCompleted, 60)
  ) {
    return res.status(400).json({
      error: 'Enter a valid graduation year and completed class.'
    });
  }

  const graduationDate = b.graduationDate || null;
  if (
    graduationDate &&
    (typeof graduationDate !== 'string' ||
     !/^\d{4}-\d{2}-\d{2}$/.test(graduationDate) ||
     Number.isNaN(Date.parse(graduationDate)))
  ) {
    return res.status(400).json({ error: 'Enter a valid graduation date.' });
  }

  const valid = await q(
    `SELECT id FROM students
     WHERE school_id = $1
       AND archived = false
       AND id = ANY($2::bigint[])`,
    [schoolId(req), studentIds]
  );

  if (valid.rowCount !== studentIds.length) {
    return res.status(400).json({
      error: 'One or more selected students are not active students in this school.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const saved = [];

    for (const studentId of studentIds) {
      const result = await client.query(
        `INSERT INTO graduation_records
          (school_id, student_id, graduation_year, class_completed,
           graduation_date, certificate_number, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (school_id, student_id, graduation_year)
         DO UPDATE SET
           class_completed = EXCLUDED.class_completed,
           graduation_date = EXCLUDED.graduation_date,
           certificate_number = EXCLUDED.certificate_number,
           remarks = EXCLUDED.remarks,
           updated_at = NOW()
         RETURNING id, student_id AS "studentId"`,
        [
          schoolId(req),
          studentId,
          graduationYear,
          classCompleted,
          graduationDate,
          String(b.certificateNumber || '').trim().slice(0, 100),
          String(b.remarks || '').trim().slice(0, 1000),
          req.session.user.id
        ]
      );

      saved.push(result.rows[0]);
    }

    await client.query(
      `INSERT INTO audit_logs
        (school_id, user_id, action, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        schoolId(req),
        req.session.user.id,
        'graduation_records_saved',
        'graduation',
        String(graduationYear)
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      ok: true,
      count: saved.length,
      graduations: saved,
      message: 'Graduation records saved successfully.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/graduations/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const result = await q(
    `DELETE FROM graduation_records
     WHERE id = $1 AND school_id = $2
     RETURNING id`,
    [req.params.id, schoolId(req)]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: 'Graduation record not found.'
    });
  }

  await audit(req, 'graduation_record_deleted', 'graduation', req.params.id);
  res.json({ ok: true, message: 'Graduation record deleted.' });
}));
app.get('/api/class-activations', requireAuth, asyncRoute(async (req, res) => {
  const sid = schoolId(req);

  const [classes, activations, school] = await Promise.all([
    q(
      `SELECT DISTINCT class_name
       FROM students
       WHERE school_id = $1 AND archived = false
       ORDER BY class_name`,
      [sid]
    ),
    q(
      `SELECT id, class_name, academic_year, status, notes,
              created_at, updated_at
       FROM class_activations
       WHERE school_id = $1
       ORDER BY academic_year DESC, class_name`,
      [sid]
    ),
    q(
      `SELECT academic_year AS "academicYear",
              current_term AS "currentTerm"
       FROM schools WHERE id = $1`,
      [sid]
    )
  ]);

  res.json({
    classes: classes.rows.map(row => row.class_name),
    activations: activations.rows,
    school: school.rows[0] || {}
  });
}));

app.post(
  '/api/class-activations',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const sid = schoolId(req);
    const { className, academicYear, status, notes = '' } = req.body || {};

    if (!validText(className, 100) ||
        !validText(academicYear, 30) ||
        !['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.status(400).json({
        error: 'Enter a class, academic year, and valid activation status.'
      });
    }

    if (typeof notes !== 'string' || notes.length > 500) {
      return res.status(400).json({
        error: 'Notes must be 500 characters or fewer.'
      });
    }

    const result = await q(
      `INSERT INTO class_activations
        (school_id, class_name, academic_year, status, notes, activated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (school_id, class_name, academic_year)
       DO UPDATE SET
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         activated_by = EXCLUDED.activated_by,
         updated_at = NOW()
       RETURNING *`,
      [
        sid,
        className.trim(),
        academicYear.trim(),
        status,
        notes.trim(),
        req.session.user.id
      ]
    );

    await audit(
      req,
      'class_activation_updated',
      'class_activation',
      result.rows[0].id
    );

    res.json({
      activation: result.rows[0],
      message: 'Class activation saved successfully.'
    });
    }));

app.get('/api/classrooms', requireAuth, asyncRoute(async (req, res) => {
  const result = await q(
    `SELECT c.*,
      u.username AS assigned_teacher_name,
      (SELECT COUNT(*) FROM students s
       WHERE s.school_id = c.school_id
         AND s.class_name = c.class_name
         AND s.archived = false) AS student_count
     FROM classrooms c
     LEFT JOIN users u
       ON u.id = c.assigned_teacher_id
      AND u.school_id = c.school_id
     WHERE c.school_id = $1
     ORDER BY c.room_name`,
    [schoolId(req)]
  );

  res.json({ classrooms: result.rows });
}));


app.post('/api/classrooms', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const {
    roomCode, roomName, building = '', floor = '',
    capacity = 0, className = '', status = 'ACTIVE', notes = ''
  } = req.body || {};

  if (!validText(roomCode, 30) || !validText(roomName, 100)) {
    return res.status(400).json({
      error: 'Enter a classroom code and classroom name.'
    });
  }

  if (!Number.isInteger(Number(capacity)) ||
      Number(capacity) < 0 ||
      !['ACTIVE', 'MAINTENANCE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({
      error: 'Enter a valid capacity and classroom status.'
    });
  }

  if (![building, floor, className, notes].every(
    value => typeof value === 'string'
  ) || building.length > 100 || floor.length > 30 ||
      className.length > 100 || notes.length > 500) {
    return res.status(400).json({
      error: 'Check the classroom details and notes.'
    });
  }

  const result = await q(
    `INSERT INTO classrooms
      (school_id, room_code, room_name, building, floor,
       capacity, class_name, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      schoolId(req), roomCode.trim(), roomName.trim(),
      building.trim(), floor.trim(), Number(capacity),
      className.trim(), status, notes.trim(), req.session.user.id
    ]
  );

  await audit(req, 'classroom_created', 'classroom', result.rows[0].id);

  res.status(201).json({
    classroom: result.rows[0],
    message: 'Classroom saved successfully.'
  });
}));
app.put('/api/classrooms/:id/teacher', requireRole('ADMIN'), asyncRoute(async (req, res) => {
const rawTeacherId = req.body?.teacherId;
const teacherId = rawTeacherId === null || rawTeacherId === '' || rawTeacherId === undefined
? null
: Number(rawTeacherId);

if (teacherId !== null &&
(!Number.isSafeInteger(teacherId) || teacherId <= 0)) {
return res.status(400).json({
error: 'Choose a valid teacher or leave the classroom unassigned.'
});
}

if (teacherId !== null) {
const teacher = await q(
"SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'TEACHER'",
[teacherId, schoolId(req)]
);

if (!teacher.rowCount) {
  return res.status(400).json({
    error: 'Choose a teacher account belonging to this school.'
  });
}

}

const result = await q(
"UPDATE classrooms SET assigned_teacher_id = $1, updated_at = NOW() WHERE id = $2 AND school_id = $3 RETURNING *",
[teacherId, req.params.id, schoolId(req)]
);

if (!result.rowCount) {
return res.status(404).json({
error: 'Classroom not found.'
});
}

await audit(
req,
teacherId === null ? 'classroom_teacher_unassigned' : 'classroom_teacher_assigned',
'classroom',
req.params.id
);

res.json({
classroom: result.rows[0],
message: teacherId === null
? 'Teacher unassigned successfully.'
: 'Teacher assigned successfully.'
});
}));
app.delete('/api/drop-off-denials/:id', requireRole('ADMIN', 'BURSAR'), asyncRoute(async (req, res) => {
const result = await q(
'DELETE FROM drop_off_denials WHERE id=$1 AND school_id=$2 RETURNING id',
[req.params.id, schoolId(req)]
);
if (!result.rowCount) return res.status(404).json({ error: 'Drop-off denial record not found.' });
await audit(req, 'drop_off_denial_deleted', 'drop_off_denial', req.params.id);
res.json({ ok: true, message: 'Drop-off denial record deleted.' });
}));

app.delete('/api/pickup-persons/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
const result = await q(
'DELETE FROM pickup_persons WHERE id=$1 AND school_id=$2 RETURNING id',
[req.params.id, schoolId(req)]
);
if (!result.rowCount) return res.status(404).json({ error: 'Pickup person not found.' });
await audit(req, 'pickup_person_deleted', 'pickup_person', req.params.id);
res.json({ ok: true, message: 'Pickup person deleted.' });
}));

app.delete('/api/marks/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
const result = await q(
'DELETE FROM marks WHERE id=$1 AND school_id=$2 RETURNING id',
[req.params.id, schoolId(req)]
);
if (!result.rowCount) return res.status(404).json({ error: 'Mark record not found.' });
await audit(req, 'mark_deleted', 'mark', req.params.id);
res.json({ ok: true, message: 'Mark record deleted.' });
}));

app.delete('/api/class-activations/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
const result = await q(
'DELETE FROM class_activations WHERE id=$1 AND school_id=$2 RETURNING id',
[req.params.id, schoolId(req)]
);
if (!result.rowCount) return res.status(404).json({ error: 'Class activation not found.' });
await audit(req, 'class_activation_deleted', 'class_activation', req.params.id);
res.json({ ok: true, message: 'Class activation deleted.' });
}));

app.delete('/api/classrooms/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
const result = await q(
'DELETE FROM classrooms WHERE id=$1 AND school_id=$2 RETURNING id',
[req.params.id, schoolId(req)]
);
if (!result.rowCount) return res.status(404).json({ error: 'Classroom not found.' });
await audit(req, 'classroom_deleted', 'classroom', req.params.id);
res.json({ ok: true, message: 'Classroom deleted.' });
}));

/* =========================================================
   FEEDING MANAGEMENT API
   Separate from tuition payments.
   Insert above app.get('/api/reports', ...)
   ========================================================= */

const FEEDING_PERIODS = ['WEEKLY', 'MONTHLY', 'TERMLY'];

const FEEDING_GROUPS = [
  'PRESCHOOL_KG2',
  'BASIC1_BASIC3',
  'BASIC4_BASIC9'
];

function feedingGroupSql(classColumn = 's.class_name') {
  return `CASE
    WHEN UPPER(REPLACE(REPLACE(${classColumn}, ' ', ''), '-', ''))
      IN ('PRESCHOOL','PRENURSERY','NURSERY','KG1','KG2',
          'KINDERGARTEN1','KINDERGARTEN2')
      THEN 'PRESCHOOL_KG2'
    WHEN UPPER(REPLACE(REPLACE(${classColumn}, ' ', ''), '-', ''))
      IN ('BASIC1','BASIC2','BASIC3','CLASS1','CLASS2','CLASS3')
      THEN 'BASIC1_BASIC3'
    WHEN UPPER(REPLACE(REPLACE(${classColumn}, ' ', ''), '-', ''))
      IN ('BASIC4','BASIC5','BASIC6','BASIC7','BASIC8','BASIC9',
          'CLASS4','CLASS5','CLASS6','CLASS7','CLASS8','CLASS9',
          'JHS1','JHS2','JHS3')
      THEN 'BASIC4_BASIC9'
    ELSE NULL
  END`;
}

/* Load settings, students and feeding payment history */
app.get('/api/feeding/bootstrap',
  requireRole('ADMIN', 'HEADMASTER', 'BURSAR'),
  asyncRoute(async (req, res) => {
    const sid = schoolId(req);

    const [settings, students, payments] = await Promise.all([
      q(
        `SELECT student_group, weekly_amount, monthly_amount,
                termly_amount, updated_at
         FROM feeding_settings
         WHERE school_id=$1
         ORDER BY student_group`,
        [sid]
      ),
      q(
        `SELECT s.id, s.student_code, s.full_name, s.class_name,
                ${feedingGroupSql()} AS student_group,
                sf.payment_period,
                COALESCE(sf.enrolled, false) AS enrolled
         FROM students s
         LEFT JOIN student_feeding sf
           ON sf.student_id=s.id AND sf.school_id=s.school_id
         WHERE s.school_id=$1 AND s.archived=false
         ORDER BY s.full_name`,
        [sid]
      ),
      q(
        `SELECT fp.id, fp.student_id, fp.amount, fp.payment_period,
                fp.payment_date, fp.period_description, fp.receipt_no,
                s.full_name AS student_name, s.student_code,
                u.username AS recorded_by_name
         FROM feeding_payments fp
         JOIN students s
           ON s.id=fp.student_id AND s.school_id=fp.school_id
         LEFT JOIN users u ON u.id=fp.recorded_by
         WHERE fp.school_id=$1
         ORDER BY fp.payment_date DESC
         LIMIT 2000`,
        [sid]
      )
    ]);

    res.json({
      settings: settings.rows,
      students: students.rows,
      payments: payments.rows
    });
  })
);

/* Administrator sets charges for each student group */
app.put('/api/feeding/settings',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    const group = String(b.studentGroup || '');
    const weekly = Number(b.weeklyAmount);
    const monthly = Number(b.monthlyAmount);
    const termly = Number(b.termlyAmount);

    if (
      !FEEDING_GROUPS.includes(group) ||
      ![weekly, monthly, termly].every(
        n => Number.isFinite(n) && n >= 0 && n <= 10000000
      )
    ) {
      return res.status(400).json({
        error: 'Choose a valid student group and enter valid non-negative charges.'
      });
    }

    const result = await q(
      `INSERT INTO feeding_settings
         (school_id, student_group, weekly_amount,
          monthly_amount, termly_amount, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (school_id, student_group)
       DO UPDATE SET
         weekly_amount=EXCLUDED.weekly_amount,
         monthly_amount=EXCLUDED.monthly_amount,
         termly_amount=EXCLUDED.termly_amount,
         updated_at=NOW()
       RETURNING *`,
      [schoolId(req), group, weekly, monthly, termly]
    );

    await audit(
      req,
      'feeding_settings_updated',
      'feeding_settings',
      result.rows[0].id
    );

    res.json({ setting: result.rows[0] });
  })
);

/* Enrol a student or change their payment period */
app.put('/api/feeding/plans/:studentId',
  requireRole('ADMIN', 'HEADMASTER', 'BURSAR'),
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    const studentId = Number(req.params.studentId);
    const period = String(b.paymentPeriod || '').toUpperCase();
    const enrolled = b.enrolled === undefined ? true : b.enrolled;

    if (
      !Number.isSafeInteger(studentId) ||
      studentId <= 0 ||
      !FEEDING_PERIODS.includes(period) ||
      typeof enrolled !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'Choose a valid student, payment period and enrolment status.'
      });
    }

    const student = await q(
      `SELECT id FROM students
       WHERE id=$1 AND school_id=$2 AND archived=false`,
      [studentId, schoolId(req)]
    );

    if (!student.rowCount) {
      return res.status(404).json({
        error: 'Active student not found.'
      });
    }

    const result = await q(
      `INSERT INTO student_feeding
         (school_id, student_id, payment_period, enrolled, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (school_id, student_id)
       DO UPDATE SET
         payment_period=EXCLUDED.payment_period,
         enrolled=EXCLUDED.enrolled,
         updated_at=NOW()
       RETURNING *`,
      [schoolId(req), studentId, period, enrolled]
    );

    await audit(
      req,
      'feeding_plan_updated',
      'student_feeding',
      studentId
    );

    res.json({ plan: result.rows[0] });
  })
);

/* Record a feeding payment with a separate receipt number */
app.post('/api/feeding/payments',
  requireRole('ADMIN', 'BURSAR'),
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const amount = Number(b.amount);
    const period = String(b.paymentPeriod || '').toUpperCase();
    const description = String(b.periodDescription || '').trim();

    if (
      !Number.isSafeInteger(studentId) ||
      studentId <= 0 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 10000000 ||
      !FEEDING_PERIODS.includes(period) ||
      description.length > 120
    ) {
      return res.status(400).json({
        error: 'Enter a valid student, payment amount, payment period and period description.'
      });
    }

    const student = await q(
      `SELECT id FROM students
       WHERE id=$1 AND school_id=$2 AND archived=false`,
      [studentId, schoolId(req)]
    );

    if (!student.rowCount) {
      return res.status(404).json({
        error: 'Active student not found.'
      });
    }

    const plan = await q(
      `SELECT enrolled FROM student_feeding
       WHERE school_id=$1 AND student_id=$2`,
      [schoolId(req), studentId]
    );

    if (!plan.rowCount || !plan.rows[0].enrolled) {
      return res.status(400).json({
        error: 'Set up an active feeding plan for this student first.'
      });
    }

    const receipt =
      `FEE-${Date.now().toString(36).toUpperCase()}-` +
      `${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const result = await q(
      `INSERT INTO feeding_payments
         (school_id, student_id, amount, payment_period,
          period_description, receipt_no, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        schoolId(req),
        studentId,
        amount,
        period,
        description,
        receipt,
        req.session.user.id
      ]
    );

    await audit(
      req,
      'feeding_payment_recorded',
      'feeding_payment',
      result.rows[0].id
    );

    res.status(201).json({ payment: result.rows[0] });
  })
);

/* Feeding-only summary and totals by group */
app.get('/api/feeding/reports',
  requireRole('ADMIN', 'HEADMASTER', 'BURSAR'),
  asyncRoute(async (req, res) => {
    const sid = schoolId(req);

    const summary = await q(
      `SELECT
         (
           SELECT COUNT(*)
           FROM student_feeding
           WHERE school_id=$1 AND enrolled=true
         ) AS enrolled_students,
         COALESCE((
           SELECT SUM(amount)
           FROM feeding_payments
           WHERE school_id=$1
         ),0) AS total_received,
         (
           SELECT COUNT(*)
           FROM feeding_payments
           WHERE school_id=$1
         ) AS payment_count`,
      [sid]
    );

    const byGroup = await q(
      `SELECT ${feedingGroupSql()} AS student_group,
              COUNT(DISTINCT s.id) AS students,
              COALESCE((
                SELECT SUM(fp.amount)
                FROM feeding_payments fp
                JOIN students ps ON ps.id=fp.student_id
                  AND ps.school_id=fp.school_id
                WHERE fp.school_id=$1
                  AND ${feedingGroupSql('ps.class_name')} =
                      ${feedingGroupSql()}
              ),0) AS total_received
       FROM students s
       WHERE s.school_id=$1 AND s.archived=false
       GROUP BY ${feedingGroupSql()}
       ORDER BY student_group`,
      [sid]
    );

    res.json({
      summary: summary.rows[0],
      byGroup: byGroup.rows
    });
  })
);

app.get('/api/reports', requireRole('ADMIN'), asyncRoute(async(req,res)=>{const sid=schoolId(req);const r=await q(`SELECT (SELECT COUNT(*) FROM students WHERE school_id=$1 AND archived=false) AS active_students,(SELECT COUNT(*) FROM students WHERE school_id=$1 AND archived=true) AS archived_students,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE school_id=$1) AS total_paid,(SELECT COUNT(*) FROM payments WHERE school_id=$1) AS payment_count,(SELECT COALESCE(SUM(total_fees),0) FROM students WHERE school_id=$1 AND archived=false) AS fees_expected`,[sid]);const recent=await q('SELECT action,entity_type,entity_id,created_at FROM audit_logs WHERE school_id=$1 ORDER BY created_at DESC LIMIT 100',[sid]);res.json({summary:r.rows[0],audit:recent.rows})}));
app.get('/api/export', requireRole('ADMIN'), asyncRoute(async(req,res)=>{const sid=schoolId(req);const [students,payments,marks]=await Promise.all([q('SELECT * FROM students WHERE school_id=$1 ORDER BY id',[sid]),q('SELECT * FROM payments WHERE school_id=$1 ORDER BY id',[sid]),q('SELECT * FROM marks WHERE school_id=$1 ORDER BY id',[sid])]);res.setHeader('Content-Disposition','attachment; filename="acropolis-school-backup.json"');res.json({exportedAt:new Date().toISOString(),school:req.session.user.schoolName,students:students.rows,payments:payments.rows,marks:marks.rows});}));
app.use('/api', (err, req, res, next) => { console.error(err); if(res.headersSent)return next(err); if(err.code==='23505')return res.status(409).json({error:'A record with these details already exists.'}); res.status(500).json({error:'Something went wrong. Please try again.'}); });
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=Number(process.env.PORT||3000);
initDb().then(()=>app.listen(port,()=>console.log(`Acropolis School System listening on ${port}`))).catch(err=>{console.error('Database initialization failed:',err.message);process.exit(1)});
