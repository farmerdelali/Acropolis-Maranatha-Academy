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
  name: 'ama.sid', secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
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
async function initDb() { const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'); await q(sql); }

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
app.post('/api/payments',
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
}));
 requireRole('ADMIN','BURSAR'), asyncRoute(async(req,res)=>{const b=req.body||{},amount=Number(b.amount);if(!b.studentId||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Choose a student and enter a payment greater than zero.'});const st=await q('SELECT id FROM students WHERE id=$1 AND school_id=$2 AND archived=false',[b.studentId,schoolId(req)]);if(!st.rowCount)return res.status(404).json({error:'Student not found.'});const receipt=`AMA-${Date.now().toString(36).toUpperCase()}`;const r=await q('INSERT INTO payments(school_id,student_id,receipt_no,amount,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[schoolId(req),b.studentId,receipt,amount,String(b.note||'').slice(0,200),req.session.user.id]);await audit(req,'payment_recorded','payment',r.rows[0].id);res.status(201).json({payment:r.rows[0]})}));
app.post('/api/users', requireRole('ADMIN'), asyncRoute(async(req,res)=>{const b=req.body||{};if(!validText(b.username,60)||b.username.trim().length<3||typeof b.password!=='string'||b.password.length<10||!['ADMIN','TEACHER','BURSAR'].includes(b.role))return res.status(400).json({error:'Enter a username (3+ characters), password (10+ characters), and valid role.'});const hash=await bcrypt.hash(b.password,12);try{const r=await q('INSERT INTO users(school_id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,role,created_at',[schoolId(req),b.username.trim(),hash,b.role]);await audit(req,'user_created','user',r.rows[0].id);res.status(201).json({user:r.rows[0]})}catch(e){if(e.code==='23505')return res.status(409).json({error:'That username already exists in this school.'});throw e}}));
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

app.get('/api/reports', requireAuth, asyncRoute(async(req,res)=>{const sid=schoolId(req);const r=await q(`SELECT (SELECT COUNT(*) FROM students WHERE school_id=$1 AND archived=false) AS active_students,(SELECT COUNT(*) FROM students WHERE school_id=$1 AND archived=true) AS archived_students,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE school_id=$1) AS total_paid,(SELECT COUNT(*) FROM payments WHERE school_id=$1) AS payment_count,(SELECT COALESCE(SUM(total_fees),0) FROM students WHERE school_id=$1 AND archived=false) AS fees_expected`,[sid]);const recent=await q('SELECT action,entity_type,entity_id,created_at FROM audit_logs WHERE school_id=$1 ORDER BY created_at DESC LIMIT 100',[sid]);res.json({summary:r.rows[0],audit:recent.rows})}));
app.get('/api/export', requireAuth, asyncRoute(async(req,res)=>{const sid=schoolId(req);const [students,payments,marks]=await Promise.all([q('SELECT * FROM students WHERE school_id=$1 ORDER BY id',[sid]),q('SELECT * FROM payments WHERE school_id=$1 ORDER BY id',[sid]),q('SELECT * FROM marks WHERE school_id=$1 ORDER BY id',[sid])]);res.setHeader('Content-Disposition','attachment; filename="acropolis-school-backup.json"');res.json({exportedAt:new Date().toISOString(),school:req.session.user.schoolName,students:students.rows,payments:payments.rows,marks:marks.rows});}));
app.use('/api', (err, req, res, next) => { console.error(err); if(res.headersSent)return next(err); if(err.code==='23505')return res.status(409).json({error:'A record with these details already exists.'}); res.status(500).json({error:'Something went wrong. Please try again.'}); });
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=Number(process.env.PORT||3000);
initDb().then(()=>app.listen(port,()=>console.log(`Acropolis School System listening on ${port}`))).catch(err=>{console.error('Database initialization failed:',err.message);process.exit(1)});
