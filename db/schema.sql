CREATE TABLE IF NOT EXISTS schools (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  motto TEXT NOT NULL DEFAULT 'Always praising God, Jehovah.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS current_term TEXT NOT NULL DEFAULT 'Term 1';
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','HEADMASTER','TEACHER','BURSAR','PARENT','STUDENT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, username)
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
CHECK (role IN ('ADMIN','HEADMASTER','TEACHER','BURSAR','PARENT','STUDENT'));
CREATE UNIQUE INDEX IF NOT EXISTS one_headmaster_per_school ON users(school_id) WHERE role = 'HEADMASTER';
CREATE OR REPLACE FUNCTION enforce_school_admin_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
admin_count INTEGER;
BEGIN
IF NEW.role <> 'ADMIN' THEN
RETURN NEW;
END IF;

PERFORM pg_advisory_xact_lock(NEW.school_id);

SELECT COUNT(*) INTO admin_count
FROM users
WHERE school_id = NEW.school_id
AND role = 'ADMIN'
AND (TG_OP = 'INSERT' OR id <> NEW.id);

IF admin_count >= 2 THEN
RAISE EXCEPTION 'A school can have at most two administrator accounts.'
USING ERRCODE = '23514';
END IF;

RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS school_admin_limit_trigger ON users;

CREATE TRIGGER school_admin_limit_trigger
BEFORE INSERT OR UPDATE OF role, school_id ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_school_admin_limit();CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  total_fees NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_fees >= 0),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_code)
);
CREATE TABLE IF NOT EXISTS marks (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'Term 1',
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, subject, term)
);
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  receipt_no TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NOT NULL DEFAULT '',
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (school_id, receipt_no)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS students_school_idx ON students(school_id, archived, full_name);
CREATE INDEX IF NOT EXISTS payments_school_idx ON payments(school_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS marks_school_idx ON marks(school_id, student_id);

CREATE TABLE IF NOT EXISTS parents (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  alternate_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parent_students (
  parent_id BIGINT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS parents_school_idx
ON parents(school_id, full_name);
CREATE TABLE IF NOT EXISTS drop_off_denials (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  person_phone TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  start_date DATE,
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'RESOLVED')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drop_off_denials_school_status_idx
ON drop_off_denials(school_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS pickup_persons (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  id_type TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'AUTHORIZED', 'REVOKED')),
  notes TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pickup_persons_school_student_idx
ON pickup_persons(school_id, student_id, status);

-- EMPLOYEE MANAGEMENT
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  date_of_birth DATE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_phone TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME'
    CHECK (employment_type IN (
      'FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY'
    )),
  employment_date DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
  notes TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, employee_code)
);

CREATE INDEX IF NOT EXISTS employees_school_status_idx
ON employees(school_id, status, full_name);

CREATE INDEX IF NOT EXISTS employees_school_department_idx
ON employees(school_id, department);
-- GRADUATION RECORDS
CREATE TABLE IF NOT EXISTS graduation_records (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  graduation_year INTEGER NOT NULL,
  class_completed TEXT NOT NULL,
  graduation_date DATE,
  certificate_number TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, graduation_year)
);

CREATE INDEX IF NOT EXISTS graduation_records_school_year_idx
ON graduation_records(school_id, graduation_year DESC);

-- CLASS ACTIVATIONS
CREATE TABLE IF NOT EXISTS class_activations (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  notes TEXT NOT NULL DEFAULT '',
  activated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_name, academic_year)
);

CREATE INDEX IF NOT EXISTS class_activations_school_year_idx
ON class_activations(school_id, academic_year, status);

-- CLASSROOM MANAGEMENT
CREATE TABLE IF NOT EXISTS classrooms (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  room_name TEXT NOT NULL,
  building TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  class_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
  notes TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_teacher_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, room_code)
);

CREATE INDEX IF NOT EXISTS classrooms_school_status_idx
ON classrooms(school_id, status, room_name);

CREATE INDEX IF NOT EXISTS classrooms_school_class_idx
ON classrooms(school_id, class_name);

CREATE TABLE IF NOT EXISTS feeding_settings (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_group TEXT NOT NULL CHECK (
    student_group IN (
      'PRESCHOOL_KG2',
      'BASIC1_BASIC3',
      'BASIC4_BASIC9'
    )
  ),
  weekly_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (weekly_amount >= 0),
  monthly_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  termly_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (termly_amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_group)
);

CREATE TABLE IF NOT EXISTS student_feeding (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  payment_period TEXT NOT NULL DEFAULT 'WEEKLY'
    CHECK (payment_period IN ('WEEKLY', 'MONTHLY', 'TERMLY')),
  enrolled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id)
);

CREATE TABLE IF NOT EXISTS feeding_payments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_period TEXT NOT NULL
    CHECK (payment_period IN ('WEEKLY', 'MONTHLY', 'TERMLY')),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_description TEXT NOT NULL DEFAULT '',
  receipt_no TEXT NOT NULL,
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, receipt_no)
);

CREATE INDEX IF NOT EXISTS student_feeding_school_idx
ON student_feeding(school_id, student_id);

CREATE INDEX IF NOT EXISTS feeding_payments_school_idx
ON feeding_payments(school_id, payment_date DESC);
CREATE TABLE IF NOT EXISTS student_documents (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL
    REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL
    REFERENCES students(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
 file_data BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_documents_lookup_idx
ON student_documents (school_id, student_id, created_at DESC);

-- SCHOOL NOTICE BOARD
CREATE TABLE IF NOT EXISTS school_notices (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'ALL'
    CHECK (audience IN ('ALL', 'STAFF', 'PARENTS')),
  status TEXT NOT NULL DEFAULT 'PUBLISHED'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS school_notices_school_status_idx
ON school_notices(school_id, status, created_at DESC);

-- SCHOOL EVENTS CALENDAR
CREATE TABLE IF NOT EXISTS school_events (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'ALL'
    CHECK (audience IN ('ALL', 'STAFF', 'PARENTS')),
  status TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS school_events_school_date_idx
ON school_events(school_id, status, event_date, start_time);
