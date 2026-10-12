'use strict';
const $ = s => document.querySelector(s);

const state = { user:null, data:{students:[],payments:[],marks:[],users:[],parents:[]}, view:'Dashboard', search:'', drawer:false };

const nav = [
  ['Dashboard','▦','Overview'],
  ['Students','♙','Student records'],
  ['Match Students','⇄','Match student records'],
  ['Drop-off Denial','⛔','Drop-off restrictions'],
  ['Parents','♧','Parent records'],
  ['Pickup Persons','✓','Authorized pickup'],
  ['Employees','♙','Employee records'],
  ['Graduations','☆','Graduation records'],
  ['Class Activations','▣','Activate classes'],
  ['Classrooms','▤','Classroom management'],
  ['Marks','✓','Examinations'],
  ['Fees & Payments','₵','Fees and receipts'],
  ['Reports','▤','Reports and audit'],
  ['Users','⚙','Staff accounts'],
  ['Settings','⚙','School configuration']
];

const money = v => 'GH₵ ' + Number(v||0).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options={}) {
  const res = await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const type = res.headers.get('content-type')||'';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  if(!res.ok) throw new Error(body && body.error ? body.error : `Request failed (${res.status})`);
  return body;
}
function toast(message, error=false){const host=$('#toastHost');host.innerHTML=`<div class="toast${error?' error':''}" role="status">${esc(message)}</div>`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>host.innerHTML='',3200);}

function setAuthTab(which) {
  const register = document.getElementById('registerForm');
  const login = document.getElementById('loginForm');

  if (!register || !login) return;

  document.querySelectorAll('[data-auth-tab]').forEach(button => {
    const active = button.getAttribute('data-auth-tab') === which;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  register.classList.toggle('hidden', which !== 'register');
  login.classList.toggle('hidden', which !== 'login');

  const registerError = document.getElementById('registerError');
  const loginError = document.getElementById('loginError');

  if (registerError) registerError.textContent = '';
  if (loginError) loginError.textContent = '';
}

function showAuth(){state.user=null;$('#appScreen').classList.add('hidden');$('#authScreen').classList.remove('hidden');setAuthTab('login');}
function showApp(user) {
  state.user = user;
  $('#authScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');

  $('#schoolTitle').textContent = user.schoolName;
  $('#schoolMotto').textContent =
    user.motto || 'Always praising God, Jehovah.';
  $('#userBadge').textContent = `${user.username} · ${user.role}`;

  $('#navItems').innerHTML = nav
    .filter(([name]) =>
      (name !== 'Users' && name !== 'Settings' && name !== 'Employees') ||
      user.role === 'ADMIN'
    )
    .map(([name, icon]) =>
      `<button class="nav-item ${state.view === name ? 'active' : ''}" type="button" data-view="${esc(name)}"><span class="nav-icon">${icon}</span><span>${esc(name)}</span></button>`
    )
    .join('');

  closeDrawer();
  loadData().catch(e => toast(e.message, true));
}


 
async function loadData() {
  const d = await api('/api/bootstrap');
  const parentResult = await api('/api/parents');
    const pickupResult = await api('/api/pickup-persons');
  const pickupPersons = pickupResult.pickupPersons || [];
  const parents = parentResult.parents || [];
const graduationResult = await api('/api/graduations');
const graduations = graduationResult.graduations || [];
  let denials = [];

  if (state.user && state.user.role === 'ADMIN') {
    const denialResult = await api('/api/drop-off-denials');
    denials = denialResult.denials || [];
  }

  let employees = [];

if (state.user && state.user.role === 'ADMIN') {
const employeeResult = await api('/api/employees');
employees = employeeResult.employees || [];
}

state.data = {
  ...d,
  parents,
  denials,
  pickupPersons,
  employees,
  graduations
};

  $('#schoolTitle').textContent = d.school.name;
  $('#schoolMotto').textContent = d.school.motto;

  render();
}




function openDrawer(){state.drawer=true;$('#sideNav').classList.add('open');$('#drawerBackdrop').classList.add('open');$('#menuToggle').setAttribute('aria-expanded','true');$('#menuToggle').setAttribute('aria-label','Close menu');document.body.style.overflow='hidden';}
function closeDrawer(){state.drawer=false;$('#sideNav').classList.remove('open');$('#drawerBackdrop').classList.remove('open');$('#menuToggle').setAttribute('aria-expanded','false');$('#menuToggle').setAttribute('aria-label','Open menu');document.body.style.overflow='';}
function pageHead(title,sub,actions=''){return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="head-actions">${actions}</div></div>`;}
function stat(label,value,note=''){return `<article class="stat"><div class="stat-label">${esc(label)}</div><strong class="stat-value">${value}</strong><div class="stat-note">${esc(note)}</div></article>`;}
function panel(title,body,action=''){return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${action}</div><div class="panel-body">${body}</div></section>`;}
function studentRows(rows,actions=true){if(!rows.length)return '<div class="empty">No student records found. Register your first student to get started.</div>';return `<div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Full name</th><th>Class</th><th>Guardian</th><th>Fees</th><th>Paid</th>${actions?'<th>Actions</th>':''}</tr></thead><tbody>${rows.map(s=>`<tr><td><b>${esc(s.student_code)}</b></td><td>${esc(s.full_name)}</td><td>${esc(s.class_name)}</td><td>${esc(s.guardian_name||'—')}<br><small>${esc(s.guardian_phone||'')}</small></td><td>${money(s.total_fees)}</td><td>${money(s.paid)}</td>${actions?`<td><button class="btn soft" data-action="edit-student" data-id="${s.id}">Edit</button> ${state.user.role==='ADMIN'?`<button class="btn danger" data-action="archive-student" data-id="${s.id}">Archive</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table></div>`;}
function render(){const d=state.data,students=d.students.filter(s=>!s.archived),paid=d.payments.reduce((n,p)=>n+Number(p.amount||0),0),expected=students.reduce((n,s)=>n+Number(s.total_fees||0),0),owing=students.filter(s=>Number(s.total_fees||0)>Number(s.paid||0)).length;let html='';
if(state.view==='Dashboard'){
 html=pageHead('School overview',`Welcome back, ${state.user.username}. Here is your school's current position.`,`<button class="btn primary" data-action="add-student">+ Register student</button>`)+`<div class="cards">${stat('Active students',students.length,'Currently enrolled')}${stat('Fees expected',money(expected),'Total registered fees')}${stat('Payments received',money(paid),'All recorded receipts')}${stat('Students with balance',owing,'Students with outstanding fees')}</div>`;
 html+=panel('Recently registered students',studentRows(students.slice(0,6),false),`<button class="btn soft" data-view="Students">View all</button>`);
 html+=panel('Quick actions',`<div class="toolbar"><button class="btn primary" data-action="add-student">Register student</button>${['ADMIN','TEACHER'].includes(state.user.role)?'<button class="btn soft" data-action="add-mark">Enter examination mark</button>':''}${['ADMIN','BURSAR'].includes(state.user.role)?'<button class="btn soft" data-action="add-payment">Record payment</button>':''}<button class="btn soft" data-view="Reports">Open reports</button></div>`);
}else if(state.view==='Students'){
 html=pageHead('Student records','Register, search and maintain student information.',`<button class="btn primary" data-action="add-student">+ Register student</button>`)+`<section class="panel"><div class="panel-body"><div class="toolbar"><input id="studentSearch" placeholder="Search name, ID, class or guardian…" value="${esc(state.search)}"><button class="btn soft" data-action="clear-search">Clear</button></div>${studentRows(students.filter(s=>[s.full_name,s.student_code,s.class_name,s.guardian_name,s.guardian_phone].join(' ').toLowerCase().includes(state.search.toLowerCase())))}</div></section>`;
}else if(state.view==='Marks'){
 const markRows=d.marks.length?`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Student ID</th><th>Class</th><th>Subject</th><th>Term</th><th>Score</th><th>Grade</th></tr></thead><tbody>${d.marks.map(m=>`<tr><td>${esc(m.student_name||'')}</td><td>${esc(m.student_code||'')}</td><td>${esc(m.class_name||'')}</td><td>${esc(m.subject)}</td><td>${esc(m.term)}</td><td>${Number(m.score).toFixed(1)}%</td><td><span class="badge">${grade(m.score)}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No marks recorded yet. Use Enter mark to add results.</div>';
 html=pageHead('Examinations & marks','Record subject scores and review students’ results.',`${['ADMIN','TEACHER'].includes(state.user.role)?'<button class="btn primary" data-action="add-mark">+ Enter mark</button>':''}`)+panel('Recorded results',markRows);
}else if(state.view==='Fees & Payments'){
 html=pageHead('Fees & payments','Record receipts and track outstanding school fees.',`${['ADMIN','BURSAR'].includes(state.user.role)?'<button class="btn primary" data-action="add-payment">+ Record payment</button>':''}`)+`<div class="cards">${stat('Total fees expected',money(expected),'Active student records')}${stat('Total received',money(paid),'All payment records')}${stat('Outstanding balance',money(Math.max(0,expected-paid)),'Expected minus received')}${stat('Receipts issued',d.payments.length,'Payment transactions')}</div>`;

const rows = d.payments.length
  ? `<div class="table-wrap"><table>
      <thead><tr>
        <th>Receipt</th>
        <th>Student</th>
        <th>Student ID</th>
        <th>Amount</th>
        <th>Date</th>
        <th>Note</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>${d.payments.map(p => `<tr>
        <td><b>${esc(p.receipt_no)}</b></td>
        <td>${esc(p.student_name)}</td>
        <td>${esc(p.student_code)}</td>
        <td>${money(p.amount)}</td>
        <td>${new Date(p.paid_at).toLocaleDateString()}</td>
        <td>${esc(p.note || '—')}</td>
        <td>${state.user.role === 'ADMIN'
          ? `<button class="btn danger"
              data-action="delete-payment"
              data-id="${esc(p.id)}"
              data-receipt="${esc(p.receipt_no)}">Delete</button>`
          : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
  : '<div class="empty">No payments recorded yet.</div>';
 
 html+=panel('Payment history',rows);
}else if(state.view==='Reports'){
 html=pageHead('Reports & data','Review school totals, recent activity and export a backup.',`<button class="btn primary" data-action="export">Export backup</button><button class="btn soft" data-action="csv">Export student CSV</button>`)+`<div class="cards">${stat('Active students',students.length,'Enrolment')}${stat('Total fees',money(expected),'Expected')}${stat('Payments',money(paid),'Collected')}${stat('Balance',money(Math.max(0,expected-paid)),'Expected less collected')}</div>`;
 html+=panel('Fee balance by student',`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Expected</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${students.map(s=>`<tr><td>${esc(s.full_name)}</td><td>${esc(s.class_name)}</td><td>${money(s.total_fees)}</td><td>${money(s.paid)}</td><td>${money(Math.max(0,Number(s.total_fees)-Number(s.paid)))}</td></tr>`).join('')}</tbody></table></div>`);
 api('/api/reports').then(r=>{if(state.view!=='Reports')return;const box=$('#auditBody');if(box)box.innerHTML=r.audit.length?r.audit.map(a=>`<div class="report-row"><span><b>${esc(a.action.replaceAll('_',' '))}</b> · ${esc(a.entity_type)}</span><small>${new Date(a.created_at).toLocaleString()}</small></div>`).join(''):'<div class="empty">No activity yet.</div>';}).catch(()=>{});
 html+=panel('Recent activity','<div id="auditBody" class="report-list"><div class="empty">Loading activity…</div></div>');
}else if(state.view==='Users'){
 const users=d.users||[];html=pageHead('Staff & user accounts','Create staff accounts with role-based permissions.',`<button class="btn primary" data-action="add-user">+ Add user</button>`)+panel('School users',users.length?`<div class="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Action</th></tr></thead><tbody>${users.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td><span class="badge">${esc(u.role)}</span></td><td>${new Date(u.created_at).toLocaleDateString()}</td><td>${String(u.id)===String(state.user.id)?'<small>Current account</small>':`<button class="btn danger" data-action="delete-user" data-id="${u.id}" data-username="${esc(u.username)}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No staff accounts found.</div>')+'<p class="muted">Administrators manage staff access. Teachers manage students and marks. Bursars manage payments.</p>';
}else if(state.view==='Settings'){
 const school=d.school||{};
 html=pageHead(
   'School settings',
   'Manage your school identity and academic details.'
 )+
 panel('School information',`
   <form id="settingsForm">
     <label class="field">
       School name
       <input name="schoolName" required maxlength="120"
         value="${esc(school.name||'')}">
     </label>
     <label class="field">
       School motto
       <input name="motto" required maxlength="200"
         value="${esc(school.motto||'Always praising God, Jehovah.')}">
     </label>
     <label class="field">
       Academic year
       
<input name="academicYear" required maxlength="30"
  value="${esc(school.academicYear||'')}"
  placeholder="e.g. 2026/2027">
  
     </label>
     <label class="field">
       Current term
       <select name="currentTerm" required>
         
<option value="Term 1" ${school.currentTerm==='Term 1'?'selected':''}>Term 1</option>
<option value="Term 2" ${school.currentTerm==='Term 2'?'selected':''}>Term 2</option>
<option value="Term 3" ${school.currentTerm==='Term 3'?'selected':''}>Term 3</option>

       </select>
     </label>
     <div class="form-actions">
       <button class="btn primary" type="submit">
         Save settings
       </button>
     </div>
   </form>
 `);
}


else if (state.view === 'Match Students') {
  const normalize = value =>
    String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const surname = value => {
    const parts = normalize(value).split(' ').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  };

  const candidates = [];

  for (let i = 0; i < students.length; i++) {
    for (let j = i + 1; j < students.length; j++) {
      const a = students[i];
      const b = students[j];

      const sameName =
        normalize(a.full_name) &&
        normalize(a.full_name) === normalize(b.full_name);

      const sameId =
        normalize(a.student_code) &&
        normalize(a.student_code) === normalize(b.student_code);

      const sameGuardian =
        normalize(a.guardian_phone) &&
        normalize(a.guardian_phone) === normalize(b.guardian_phone);

      const sameSurname =
        surname(a.full_name) &&
        surname(a.full_name) === surname(b.full_name);

      const reasons = [];
      if (sameId) reasons.push('Same student ID');
      if (sameName) reasons.push('Same full name');
      if (sameGuardian) reasons.push('Same guardian phone');
      if (sameSurname) reasons.push('Same surname');

      if (sameId || sameName || sameGuardian) {
        candidates.push({ a, b, reasons });
      }
    }
  }

  html = pageHead(
    'Match Students',
    'Review possible duplicate student records. No records are merged or deleted automatically.'
  );

  html += `<div class="cards">
    ${stat('Active students', students.length, 'Records checked')}
    ${stat('Possible matches', candidates.length, 'Pairs requiring review')}
  </div>`;

  const matchRows = candidates.length
    ? `<div class="table-wrap"><table>
        <thead><tr>
          <th>Student 1</th>
          <th>Student 2</th>
          <th>Class comparison</th>
          <th>Why they matched</th>
        </tr></thead>
        <tbody>${candidates.map(({a, b, reasons}) => `
          <tr>
            <td><b>${esc(a.full_name)}</b><br>
              <small>${esc(a.student_code || 'No ID')}</small></td>
            <td><b>${esc(b.full_name)}</b><br>
              <small>${esc(b.student_code || 'No ID')}</small></td>
            <td>${esc(a.class_name || '—')} / ${esc(b.class_name || '—')}</td>
            <td>${reasons.map(esc).join(', ')}</td>
          </tr>
        `).join('')}</tbody>
      </table></div>`
    : '<div class="empty">No possible duplicate records found among active students.</div>';

  html += panel('Possible matches to review', matchRows);

} else if (state.view === 'Drop-off Denial') {
  const denials = state.data.denials || [];

  if (!state.user || state.user.role !== 'ADMIN') {
    html = `
      <section class="panel">
        <h2>Drop-off Denial</h2>
        <p>Only administrators can manage drop-off concerns and restrictions.</p>
      </section>`;
  } else {
    const rows = denials.length
      ? denials.map(item => `
          <tr>
            <td>${esc(item.studentName || '')}</td>
            <td>${esc(item.personName || '')}</td>
            <td>${esc(item.relationship || '')}</td>
            <td>${esc(item.reason || '')}</td>
            <td>${esc(item.status || 'PENDING')}</td>
          </tr>`).join('')
      : `<tr><td colspan="5">No drop-off records yet.</td></tr>`;

    html = `
      <section class="panel">
        <h2>Drop-off Denial</h2>
        <p>Record and review concerns about who is permitted to drop off a student.</p>
        <button type="button" data-action="add-drop-off-denial">
          + Add Record
        </button>
        <div style="overflow-x:auto;margin-top:16px">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Person concerned</th>
                <th>Relationship</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }


} else if (state.view === 'Parents') {
  const parents = d.parents || [];

  const parentRows = parents.length
    ? `<div class="table-wrap"><table>
        <thead>
          <tr>
            <th>Parent / Guardian</th>
            <th>Relationship</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Linked students</th>
          </tr>
        </thead>
        <tbody>
          ${parents.map(p => `<tr>
            <td><b>${esc(p.full_name)}</b></td>
            <td>${esc(p.relationship || '—')}</td>
            <td>${esc(p.phone || '—')}</td>
            <td>${esc(p.email || '—')}</td>
            <td>${esc((p.students || []).map(s =>
              s.full_name || s.name || ''
            ).filter(Boolean).join(', ') || 'None linked')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`
    : '<div class="empty">No parent records yet. Parent records will appear here when registered.</div>';
html = pageHead(
    'Parents & guardians',
    'Maintain guardian contact details and connect each guardian to their students.',
    `${state.user.role === 'ADMIN' ? '<button class="btn primary" data-action="add-parent">+ Register parent</button>' : ''}`
  ) +
  
  `<div class="cards">
    ${stat('Registered parents', parents.length, 'Parent and guardian records')}
    ${stat(
      'Linked students',
      parents.reduce((n, p) => n + (p.students || []).length, 0),
      'Student relationships'
    )}
  </div>` +
  panel('Parent register', parentRows);

} else if (state.view === 'Pickup Persons') {
  const pickupPersons = d.pickupPersons || [];
  const authorized = pickupPersons.filter(p => p.status === 'AUTHORIZED').length;
  const pending = pickupPersons.filter(p => p.status === 'PENDING').length;
  const revoked = pickupPersons.filter(p => p.status === 'REVOKED').length;

  const pickupRows = pickupPersons.length
    ? `<div class="table-wrap"><table>
        <thead><tr>
          <th>Pickup person</th>
          <th>Student</th>
          <th>Relationship</th>
          <th>Phone</th>
          <th>ID details</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${pickupPersons.map(p => `<tr>
          <td><b>${esc(p.fullName)}</b></td>
          <td>${esc(p.studentName)}<br><small>${esc(p.studentCode || '')} · ${esc(p.className || '')}</small></td>
          <td>${esc(p.relationship || '—')}</td>
          <td>${esc(p.phone || '—')}</td>
          <td>${esc([p.idType, p.idNumber].filter(Boolean).join(': ') || '—')}</td>
          <td><span class="badge">${esc(p.status)}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<div class="empty">No pickup persons have been registered yet. Add an authorized contact when you are ready.</div>';

  html = pageHead(
    'Pickup persons',
    'Manage and review people permitted to collect students from school.',
    state.user.role === 'ADMIN'
      ? '<button class="btn primary" data-action="add-pickup-person">+ Register pickup person</button>'
      : ''
  ) +
  `<div class="cards">
    ${stat('Total records', pickupPersons.length, 'Pickup contacts')}
    ${stat('Authorized', authorized, 'Approved for collection')}
    ${stat('Pending review', pending, 'Awaiting approval')}
    ${stat('Revoked', revoked, 'No longer authorized')}
  </div>` +
  panel('Pickup person register', pickupRows);
} else if (state.view === 'Employees') {
  const allEmployees = d.employees || [];

  const employees = allEmployees.filter(emp =>
    [
      emp.employeeCode,
      emp.fullName,
      emp.department,
      emp.position,
      emp.phone,
      emp.email,
      emp.status
    ].join(' ').toLowerCase().includes(state.search.toLowerCase())
  );

  const activeEmployees = allEmployees.filter(
    e => e.status === 'ACTIVE'
  ).length;

  const onLeaveEmployees = allEmployees.filter(
    e => e.status === 'ON_LEAVE'
  ).length;

  const inactiveEmployees = allEmployees.filter(
    e => e.status === 'INACTIVE'
  ).length;

  const employeeRows = employees.length
    ? `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Full name</th>
              <th>Department / Position</th>
              <th>Contact</th>
              <th>Employment type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${employees.map(emp => `
              <tr>
                <td><b>${esc(emp.employeeCode || '—')}</b></td>
                <td>
                  <b>${esc(emp.fullName || '—')}</b><br>
                  <small>${esc(emp.gender || '—')}</small>
                </td>
                <td>
                  ${esc(emp.department || '—')}<br>
                  <small>${esc(emp.position || '—')}</small>
                </td>
                <td>
                  ${esc(emp.phone || '—')}<br>
                  <small>${esc(emp.email || '')}</small>
                </td>
                <td>
                  ${esc(String(
                    emp.employmentType || 'FULL_TIME'
                  ).replaceAll('_', ' '))}
                  <br>
                  <small>${
                    emp.employmentDate
                      ? esc(String(emp.employmentDate).slice(0, 10))
                      : 'Date not entered'
                  }</small>
                </td>
                <td>
                  <span class="badge">
                    ${esc(String(emp.status || 'ACTIVE').replaceAll('_', ' '))}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn soft"
                    data-action="edit-employee"
                    data-id="${esc(emp.id)}">
                    Edit
                  </button>

                  ${emp.status !== 'INACTIVE' ? `
                    <button
                      type="button"
                      class="btn danger"
                      data-action="deactivate-employee"
                      data-id="${esc(emp.id)}"
                      data-name="${esc(emp.fullName || 'this employee')}">
                      Deactivate
                    </button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`
    : '<div class="empty">No employee records found. Add your first employee when you are ready.</div>';

  html = pageHead(
    'Employees & staff',
    'Register employees and maintain staff employment records.',
    '<button class="btn primary" data-action="add-employee">+ Add employee</button>'
  ) +
  `<div class="cards">
    ${stat('Total employees', allEmployees.length, 'All staff records')}
    ${stat('Active employees', activeEmployees, 'Currently active')}
    ${stat('On leave', onLeaveEmployees, 'Staff on leave')}
    ${stat('Inactive', inactiveEmployees, 'Deactivated records')}
  </div>` +
  panel(
    'Employee register',
    `<div class="toolbar">
      <input
        id="employeeSearch"
        placeholder="Search employee, ID, department or phone…"
        value="${esc(state.search)}">
      <button class="btn soft" data-action="clear-search">Clear</button>
    </div>
    ${employeeRows}`
  );

} else if (state.view === 'Graduations') {
  const students = state.data.students || [];
  const graduations = state.data.graduations || [];
  const isAdmin = state.user && state.user.role === 'ADMIN';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const classes = [...new Set(students
    .filter(s => !s.archived)
    .map(s => s.class_name || s.class || s.className)
    .filter(Boolean))].sort();
  html = `
    <section class="panel">
      <h2>Graduation Records</h2>
      <p>Select registered students below. Names are taken directly from Students.</p>
      ${isAdmin ? `
      <form id="graduation-form" class="form-grid">
        <label>Class completed
          <select id="grad-class" name="classCompleted" required>
            <option value="">Choose class</option>
            ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label>Graduation year
          <input name="graduationYear" type="number" min="2000" max="2100"
            value="${new Date().getFullYear()}" required>
        </label>
        <label>Graduation date
          <input name="graduationDate" type="date">
        </label>
        <label>Certificate number (optional)
          <input name="certificateNumber" placeholder="Leave blank if not assigned">
        </label>
        <label>Remarks (optional)
          <input name="remarks" placeholder="Additional notes">
        </label>
        <div class="form-actions">
          <button type="button" id="grad-select-all">Select all listed students</button>
          <button type="button" id="grad-clear">Clear selection</button>
        </div>
        <div id="grad-student-list" class="panel">
          <p>Choose a class to list registered students.</p>
        </div>
        <button type="submit">Save Graduation Records</button>
      </form>` : '<p>Only administrators can add or delete graduation records.</p>'}
    </section>
    <section class="panel">
      <h2>Saved Graduations</h2>
      ${graduations.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Student</th><th>Class completed</th><th>Year</th><th>Date</th><th>Certificate</th>${isAdmin?'<th>Action</th>':''}</tr></thead>
        <tbody>${graduations.map(g => `<tr>
          <td>${esc(g.student_name || [g.first_name,g.last_name].filter(Boolean).join(' ') || 'Student')}</td>
          <td>${esc(g.class_completed)}</td><td>${esc(g.graduation_year)}</td>
          <td>${esc(g.graduation_date || '—')}</td><td>${esc(g.certificate_number || '—')}</td>
          ${isAdmin?`<td><button type="button" data-delete-graduation="${esc(g.id)}">Delete</button></td>`:''}
        </tr>`).join('')}</tbody>
      </table></div>` : '<p>No graduation records have been saved yet.</p>'}
    </section>`;

} else if (state.view === 'Class Activations') {
  const students = state.data.students || [];
  const activations = state.data.classActivations || [];
  const isAdmin = state.user && state.user.role === 'ADMIN';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  const classes = [...new Set(
    students.filter(s => !s.archived)
      .map(s => s.class_name)
      .filter(Boolean)
  )].sort();

  const academicYear = state.data.school?.academicYear || '';

  html = `
    <section class="panel">
      <h2>Class Activations</h2>
      <p>Manage which classes are active for each academic year.</p>
      ${isAdmin ? `
      <form id="classActivationForm" class="form-grid">
        <label>Class
          <select name="className" required>
            <option value="">Choose class</option>
            ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label>Academic year
          <input name="academicYear" required maxlength="30"
            value="${esc(academicYear)}" placeholder="e.g. 2026/2027">
        </label>
        <label>Activation status
          <select name="status" required>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <label>Notes (optional)
          <input name="notes" maxlength="500" placeholder="Reason or additional details">
        </label>
        <button type="submit">Save Class Activation</button>
      </form>` : '<p>Only administrators can change class activation status.</p>'}
    </section>

    <section class="panel">
      <h2>Saved Class Activations</h2>
      ${activations.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Class</th><th>Academic year</th><th>Status</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${activations.map(a => `
              <tr>
                <td>${esc(a.class_name)}</td>
                <td>${esc(a.academic_year)}</td>
                <td>${esc(a.status)}</td>
                <td>${esc(a.notes || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : '<p>No class activations have been saved yet.</p>'}
    </section>`;

} else if (state.view === 'Classrooms') {
  html = `<section class="panel"><h2>Classrooms</h2><p>Manage classrooms, class names, and classroom assignments.</p></section>`;
} else if (state.view === 'Settings') {
  html = `<section class="panel"><h2>School Settings</h2><p>Configure school information and system preferences.</p></section>`;
} else if (state.view === 'Students with same Surname') {
  html = `<section class="panel"><h2>Students with the Same Surname</h2><p>Identify students who share a surname. Matching results will be connected to the student records.</p></section>`;
}

$('#mainContent').innerHTML=html;
}
function grade(v){v=Number(v);return v>=80?'A':v>=70?'B':v>=60?'C':v>=50?'D':'F';}
function openModal(title,body){$('#modalHost').innerHTML=`<div class="modal-back" id="modalBack"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><h2 id="modalTitle">${esc(title)}</h2><button class="btn soft" type="button" data-action="close-modal">Close</button></div><div class="modal-body">${body}</div></section></div>`;const first=$('#modalHost input,#modalHost select');if(first)first.focus();} 
function parentForm(p = null) {
  const students = state.data.students.filter(s => !s.archived);
  const linked = (p?.students || []).map(s => String(s.id));

  openModal(p ? 'Edit parent / guardian' : 'Register parent / guardian', `
    <form id="parentForm">
      <div class="form-grid">
        <label class="field">Full name
          <input name="fullName" required maxlength="120"
            value="${esc(p?.full_name || '')}">
        </label>

        <label class="field">Relationship to student
          <input name="relationship" maxlength="60"
            placeholder="e.g. Mother, Father, Guardian"
            value="${esc(p?.relationship || '')}">
        </label>

        <label class="field">Primary phone
          <input name="phone" maxlength="40" inputmode="tel"
            value="${esc(p?.phone || '')}">
        </label>

        <label class="field">Alternative phone
          <input name="alternatePhone" maxlength="40" inputmode="tel"
            value="${esc(p?.alternate_phone || '')}">
        </label>

        <label class="field">Email
          <input name="email" type="email" maxlength="160"
            value="${esc(p?.email || '')}">
        </label>

        <label class="field">Occupation
          <input name="occupation" maxlength="120"
            value="${esc(p?.occupation || '')}">
        </label>

        <label class="field">Residential address
          <input name="address" maxlength="300"
            value="${esc(p?.address || '')}">
        </label>
      </div>

      <label class="field">Link to student(s)
        <select name="studentIds" multiple size="5">
          ${students.map(s => `
            <option value="${s.id}"
              ${linked.includes(String(s.id)) ? 'selected' : ''}>
              ${esc(s.full_name)} — ${esc(s.student_code || '')}
              (${esc(s.class_name || '')})
            </option>
          `).join('')}
        </select>
        <small>On a computer, hold Ctrl to select multiple students.
        On a phone, use the selection control to choose students.</small>
      </label>

      <div class="form-actions">
        <button type="button" class="btn soft"
          data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">
          Save parent
        </button>
      </div>
    </form>
  `);

  $('#parentForm').dataset.id = p?.id || '';
}


const CLASS_LEVELS = [
  'Pre-Nursery',
  'Nursery 1',
  'Nursery 2',
  'KG 1',
  'KG 2',
  'Basic 1',
  'Basic 2',
  'Basic 3',
  'Basic 4',
  'Basic 5',
  'Basic 6',
  'Basic 7',
  'Basic 8',
  'Basic 9'
];



function studentForm(s = null) {
  const currentClass = s?.class_name || '';

  const classOptions = CLASS_LEVELS.map(level =>
    `<option value="${level}" ${
      currentClass === level ? 'selected' : ''
    }>${level}</option>`
  ).join('');

  const legacyOption =
    currentClass && !CLASS_LEVELS.includes(currentClass)
      ? `<option value="${esc(currentClass)}" selected>${
          esc(currentClass)
        } (existing class)</option>`
      : '';

  openModal(s ? 'Edit student' : 'Register student', `
    <form id="studentForm">
      <div class="form-grid">
        <label class="field">Full name
          <input name="fullName" required maxlength="120"
            value="${esc(s?.full_name || '')}">
        </label>

        <label class="field">Student ID
          <input name="studentCode" maxlength="40"
            value="${esc(s?.student_code || '')}"
            ${s ? 'readonly' : ''}
            placeholder="Auto-generated if blank">
        </label>

        <label class="field">Class / form
          <select name="className" required>
            <option value="">Select class</option>
            ${legacyOption}
            ${classOptions}
          </select>
        </label>

        <label class="field">Gender
          <select name="gender">
            <option value="">Select</option>
            ${['Female', 'Male', 'Other'].map(g =>
              `<option value="${g}"
                ${s?.gender === g ? 'selected' : ''}>${g}</option>`
            ).join('')}
          </select>
        </label>

        <label class="field">Guardian name
          <input name="guardianName" maxlength="120"
            value="${esc(s?.guardian_name || '')}">
        </label>

        <label class="field">Guardian phone
          <input name="guardianPhone" maxlength="40"
            inputmode="tel"
            value="${esc(s?.guardian_phone || '')}">
        </label>

        <label class="field">Total fees (GHS)
          <input name="totalFees" type="number" min="0"
            step="0.01" required
            value="${Number(s?.total_fees || 0)}">
        </label>
      </div>

      <div class="form-actions">
        <button type="button" class="btn soft"
          data-action="close-modal">Cancel</button>
        <button class="btn primary" type="submit">
          Save student
        </button>
      </div>
    </form>
  `);

  $('#studentForm').dataset.id = s?.id || '';
}


function dropOffDenialForm() {
  if (!state.user || state.user.role !== 'ADMIN') {
    return toast('Only administrators can add drop-off records.', true);
  }

  const students = state.data.students.filter(s => !s.archived);

  if (!students.length) {
    return toast('Register a student before adding this record.', true);
  }

  openModal('Add Drop-off Denial Record', `
    <form id="dropOffDenialForm">
      <label class="field">Student concerned
        <select name="studentId" required>
          <option value="">Select student</option>
          ${students.map(s => `
            <option value="${esc(s.id)}">
              ${esc(s.full_name)} — ${esc(s.student_code || 'No ID')}
              (${esc(s.class_name || '')})
            </option>
          `).join('')}
        </select>
      </label>

      <div class="form-grid">
        <label class="field">Person concerned
          <input name="personName" required maxlength="120"
            placeholder="Full name">
        </label>

        <label class="field">Phone number
          <input name="personPhone" maxlength="40"
            inputmode="tel" placeholder="Contact number">
        </label>

        <label class="field">Relationship to student
          <input name="relationship" maxlength="60"
            placeholder="e.g. Parent, guardian">
        </label>

        <label class="field">Reason for restriction
          <input name="reason" required maxlength="200"
            placeholder="Enter the reason">
        </label>

        <label class="field">Start date
          <input name="startDate" type="date">
        </label>

        <label class="field">Review date
          <input name="reviewDate" type="date">
        </label>
      </div>

      <label class="field">Additional details
        <textarea name="details" rows="3" maxlength="2000"
          placeholder="Relevant details or instructions"></textarea>
      </label>

      <div class="form-actions">
        <button type="button" class="btn soft"
          data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">
          Save record
        </button>
      </div>
    </form>
  `);
}
function employeeForm(employee = null) {
  if (!state.user || state.user.role !== 'ADMIN') {
    toast('Only administrators can manage employee records.', true);
    return;
  }

  const e = employee || {};

  openModal(employee ? 'Edit employee details' : 'Register new employee', `
    <form id="employeeForm" data-id="${esc(e.id || '')}">
      <div class="form-grid">
        <label class="field">Employee ID *
          <input name="employeeCode" required maxlength="50"
            value="${esc(e.employeeCode || '')}"
            placeholder="e.g. EMP001">
        </label>

        <label class="field">Full name *
          <input name="fullName" required maxlength="150"
            value="${esc(e.fullName || '')}"
            placeholder="Enter full name">
        </label>

        <label class="field">Gender
          <select name="gender">
            <option value="">Select gender</option>
            <option value="Male" ${e.gender === 'Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${e.gender === 'Female' ? 'selected' : ''}>Female</option>
            <option value="Other" ${e.gender === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </label>

        <label class="field">Date of birth
          <input name="dateOfBirth" type="date"
            value="${esc(e.dateOfBirth ? String(e.dateOfBirth).slice(0, 10) : '')}">
        </label>

        <label class="field">Phone number
          <input name="phone" type="tel" maxlength="30"
            value="${esc(e.phone || '')}"
            placeholder="Enter phone number">
        </label>

        <label class="field">Email address
          <input name="email" type="email" maxlength="150"
            value="${esc(e.email || '')}"
            placeholder="Enter email address">
        </label>

        <label class="field">Department
          <input name="department" maxlength="100"
            value="${esc(e.department || '')}"
            placeholder="e.g. Teaching">
        </label>

        <label class="field">Position / Job title
          <input name="position" maxlength="100"
            value="${esc(e.position || '')}"
            placeholder="e.g. Class Teacher">
        </label>

        <label class="field">Qualification
          <input name="qualification" maxlength="200"
            value="${esc(e.qualification || '')}"
            placeholder="Highest qualification">
        </label>

        <label class="field">Employment type
          <select name="employmentType">
            <option value="FULL_TIME" ${!e.employmentType || e.employmentType === 'FULL_TIME' ? 'selected' : ''}>Full-time</option>
            <option value="PART_TIME" ${e.employmentType === 'PART_TIME' ? 'selected' : ''}>Part-time</option>
            <option value="CONTRACT" ${e.employmentType === 'CONTRACT' ? 'selected' : ''}>Contract</option>
            <option value="TEMPORARY" ${e.employmentType === 'TEMPORARY' ? 'selected' : ''}>Temporary</option>
          </select>
        </label>

        <label class="field">Employment date
          <input name="employmentDate" type="date"
            value="${esc(e.employmentDate ? String(e.employmentDate).slice(0, 10) : '')}">
        </label>

        <label class="field">Employment status
          <select name="status">
            <option value="ACTIVE" ${!e.status || e.status === 'ACTIVE' ? 'selected' : ''}>Active</option>
            <option value="ON_LEAVE" ${e.status === 'ON_LEAVE' ? 'selected' : ''}>On leave</option>
            <option value="INACTIVE" ${e.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option>
          </select>
        </label>

        <label class="field">Emergency contact name
          <input name="emergencyContactName" maxlength="120"
            value="${esc(e.emergencyContactName || '')}">
        </label>

        <label class="field">Emergency contact phone
          <input name="emergencyContactPhone" type="tel" maxlength="30"
            value="${esc(e.emergencyContactPhone || '')}">
        </label>
      </div>

      <label class="field">Residential address
        <textarea name="address" rows="2" maxlength="1000"
          placeholder="Enter residential address">${esc(e.address || '')}</textarea>
      </label>

      <label class="field">Additional notes
        <textarea name="notes" rows="3" maxlength="2000"
          placeholder="Enter any relevant notes">${esc(e.notes || '')}</textarea>
      </label>

      <div class="form-actions">
        <button type="button" class="btn soft"
          data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">
          ${employee ? 'Save changes' : 'Register employee'}
        </button>
      </div>
    </form>
  `);
}
function pickupPersonForm() {
  if (!state.user || state.user.role !== 'ADMIN') {
    toast('Only administrators can register pickup persons.', true);
    return;
  }

  const students = (state.data.students || []).filter(s => !s.archived);

  if (!students.length) {
    toast('Please register a student before adding a pickup person.', true);
    return;
  }

  openModal('Register pickup person', `
    <form id="pickupPersonForm">
      <div class="form-grid">
        <label class="field">Student *
          <select name="studentId" required>
            <option value="">Select student</option>
            ${students.map(s => `<option value="${esc(s.id)}">${esc(s.full_name)} — ${esc(s.student_code || 'No ID')} (${esc(s.class_name || '')})</option>`).join('')}
          </select>
        </label>

        <label class="field">Pickup person's full name *
          <input name="fullName" required maxlength="120">
        </label>

        <label class="field">Relationship
          <input name="relationship" maxlength="60">
        </label>

        <label class="field">Phone
          <input name="phone" type="tel" maxlength="40">
        </label>

        <label class="field">ID type
          <input name="idType" maxlength="60">
        </label>

        <label class="field">ID number
          <input name="idNumber" maxlength="100">
        </label>

        <label class="field">Status
          <select name="status" required>
            <option value="PENDING" selected>Pending review</option>
            <option value="AUTHORIZED">Authorized</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </label>
      </div>

      <label class="field">Notes
        <textarea name="notes" rows="3" maxlength="1000"></textarea>
      </label>

      <div class="form-actions">
        <button type="button" class="btn soft" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save pickup person</button>
      </div>
    </form>
  `);
}

function paymentForm(){const students=state.data.students.filter(s=>!s.archived);if(!students.length)return toast('Register a student before recording payments.',true);openModal('Record payment',`<form id="paymentForm"><label class="field">Student<select name="studentId" required>${students.map(s=>`<option value="${s.id}">${esc(s.full_name)} · ${esc(s.student_code)}</option>`).join('')}</select></label><label class="field">Amount (GHS)<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label class="field">Note / payment method<input name="note" maxlength="200" placeholder="Cash, bank transfer, term fees…"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save payment</button></div></form>`);}
function markForm(){const students=state.data.students.filter(s=>!s.archived);if(!students.length)return toast('Register a student before entering marks.',true);openModal('Enter examination mark',`<form id="markForm"><label class="field">Student<select name="studentId" required>${students.map(s=>`<option value="${s.id}">${esc(s.full_name)} · ${esc(s.class_name)}</option>`).join('')}</select></label><label class="field">Subject<input name="subject" required maxlength="80" placeholder="e.g. Mathematics"></label><label class="field">Term<input name="term" maxlength="40" value="Term 1" required></label><label class="field">Score (%)<input name="score" type="number" min="0" max="100" step="0.01" required inputmode="decimal"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save mark</button></div></form>`);}
function userForm(){openModal('Create staff account',`<form id="userForm"><label class="field">Username<input name="username" required minlength="3" maxlength="60" autocomplete="off"></label><label class="field">Role<select name="role"><option value="TEACHER">Teacher — students and marks</option><option value="BURSAR">Bursar — fees and payments</option><option value="ADMIN">Administrator — full access</option></select></label><label class="field">Temporary password <small>At least 10 characters</small><input name="password" type="password" required minlength="10" autocomplete="new-password"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create account</button></div></form>`);}
async function refresh(){await loadData();}
async function download(url,filename){const r=await fetch(url,{credentials:'same-origin'});if(!r.ok){let b={};try{b=await r.json()}catch{}throw new Error(b.error||'Download failed');}const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}

document.addEventListener('change', e => {
  if (e.target.id !== 'grad-class') return;

  const selectedClass = e.target.value;
  const list = document.getElementById('grad-student-list');
  if (!list) return;

  const students = (state.data.students || []).filter(s =>
    !s.archived &&
    String(s.class_name || s.class || s.className || '') === selectedClass
  );

  if (!selectedClass) {
    list.innerHTML = '<p>Choose a class to list registered students.</p>';
    return;
  }

  if (!students.length) {
    list.innerHTML = '<p>No registered students found in this class.</p>';
    return;
  }

  list.innerHTML = `
    <h3>Choose students (${students.length})</h3>
    ${students.map(s => `
      <label style="display:flex;gap:10px;align-items:center;padding:8px 0">
        <input type="checkbox" name="gradStudentIds" value="${String(s.id)}">
        <span>${String(s.full_name || [s.first_name,s.last_name].filter(Boolean).join(' ') || 'Student').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
        ${s.student_code ? ' · ' + String(s.student_code) : ''}</span>
      </label>
    `).join('')}
  `;
});

document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.id === 'grad-select-all' || button.id === 'grad-clear') {
    document.querySelectorAll('input[name="gradStudentIds"]').forEach(input => {
      input.checked = button.id === 'grad-select-all';
    });
  }
});

document.addEventListener('submit', async e => {
  const form = e.target;

  const allowedForms = [
  'registerForm',
  'loginForm',
  'parentForm',
  'studentForm',
    'paymentForm','dropOffDenialForm',
'pickupPersonForm',
'markForm',
      'employeeForm',
    'userForm',
    'settingsForm',
'graduation-form'
  ];

  if (!allowedForms.includes(form.id)) return;
  e.preventDefault();

  const fd = new FormData(form);
  const v = Object.fromEntries(fd.entries());
  const submit = form.querySelector('button[type="submit"]');

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Please wait…';
  }

  try {
    if (form.id === 'registerForm') {
      if (v.password !== v.confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      if (!v.termsAccepted) {
        throw new Error('Please agree to the Terms of Use and Privacy Notice.');
      }

      delete v.confirmPassword;
      v.termsAccepted = true;

      const r = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      state.view = 'Dashboard';
      showApp(r.user);
      toast('School workspace created successfully.');
    } else if (form.id === 'loginForm') {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      state.view = 'Dashboard';
      showApp(r.user);
      toast('Welcome back.');
} else if (form.id === 'parentForm') {
  const studentSelect = form.elements.studentIds;
  v.studentIds = Array.from(studentSelect.selectedOptions)
    .map(option => Number(option.value));

  await api('/api/parents', {
    method: 'POST',
    body: JSON.stringify(v)
  });

  await refresh();
  state.view = 'Parents';
  render();
  toast('Parent registered successfully.');

    } else if (form.id === 'dropOffDenialForm') {
      await api('/api/drop-off-denials', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Drop-off Denial';
      render();
      toast('Drop-off denial record saved successfully.');
} else if (form.id === 'pickupPersonForm') {
      await api('/api/pickup-persons', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Pickup Persons';
      render();
      toast('Pickup person saved successfully.');
          } else if (form.id === 'employeeForm') {
      const employeeId = form.dataset.id;

      await api(
        employeeId
          ? '/api/employees/' + encodeURIComponent(employeeId)
          : '/api/employees',
        {
          method: employeeId ? 'PUT' : 'POST',
          body: JSON.stringify(v)
        }
      );

      await refresh();
      state.view = 'Employees';
      render();
      toast(employeeId
        ? 'Employee details updated successfully.'
        : 'Employee registered successfully.');
    } else if (form.id === 'studentForm') {
      await api('/api/students', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Students';
      render();
      toast('Student saved successfully.');
    } else if (form.id === 'paymentForm') {
      await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Fees & Payments';
      render();
      toast('Payment recorded successfully.');
    } else if (form.id === 'markForm') {
      await api('/api/marks', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Marks';
      render();
      toast('Mark saved successfully.');
    } else if (form.id === 'userForm') {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify(v)
      });

      await refresh();
      state.view = 'Users';
      render();
      toast('Staff account created successfully.');
      } else if (form.id === 'graduation-form') {
  const studentIds = Array.from(
    form.querySelectorAll('input[name="gradStudentIds"]:checked')
  ).map(input => Number(input.value));

  if (!studentIds.length) {
    throw new Error('Select at least one student.');
  }

  const payload = {
    studentIds,
    graduationYear: Number(v.graduationYear),
    classCompleted: v.classCompleted,
    graduationDate: v.graduationDate || null,
    certificateNumber: v.certificateNumber || '',
    remarks: v.remarks || ''
  };

  await api('/api/graduations', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  await refresh();
  state.view = 'Graduations';
  render();
  toast('Graduation records saved successfully.');
    } else if (form.id === 'settingsForm') {
      const r = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(v)
      });

      if (state.data.school) {
        Object.assign(state.data.school, r.settings);
      }

      if (state.user) {
        state.user.schoolName = r.settings.name;
        state.user.motto = r.settings.motto;
      }

      await refresh();
      state.view = 'Settings';
      render();
      toast('School settings saved successfully.');
    }
  } catch (err) {
    toast(err.message || 'Something went wrong. Please try again.', true);
 
  } finally {
    if (submit) {
      submit.disabled = false;

      const labels = {
        registerForm: 'Create school & administrator →',
        loginForm: 'Sign in securely →',
        studentForm: 'Save student',
        'graduation-form': 'Save Graduation Records',
        pickupPersonForm: 'Save pickup person',
        paymentForm: 'Save payment',
        markForm: 'Save mark',
        userForm: 'Create account',
        settingsForm: 'Save settings',
        parentForm: 'Save parent'
      };

      submit.textContent = labels[form.id] || 'Save';
    }
  }
});

document.addEventListener('click', async e => {
  const button = e.target.closest('button');
  if (!button) return;

  // Login and registration tabs
  const tab = button.closest('[data-auth-tab]');
  if (tab) {
    setAuthTab(tab.dataset.authTab);
    return;
  }

  // Dashboard navigation
  if (button.dataset.view) {
    state.view = button.dataset.view;
    state.search = '';
    render();
    closeDrawer();

    document.querySelectorAll('[data-view]').forEach(item => {
      item.classList.toggle(
        'active',
        item.dataset.view === state.view
      );
    });
    return;
  }

  const action = button.dataset.action;
  if (!action) return;

  try {
    switch (action) { 
      case 'add-drop-off-denial':
        dropOffDenialForm();
        break;
              case 'add-employee':
        employeeForm();
        break;

      case 'edit-employee': {
        if (state.user.role !== 'ADMIN') {
          throw new Error('Only administrators can edit employees.');
        }

        const employee = (state.data.employees || []).find(
          emp => String(emp.id) === String(button.dataset.id)
        );

        if (employee) {
          employeeForm(employee);
        } else {
          toast('Employee record not found. Please refresh.', true);
        }
        break;
      }

      case 'deactivate-employee': {
        if (state.user.role !== 'ADMIN') {
          throw new Error('Only administrators can deactivate employees.');
        }

        if (confirm(
          'Deactivate ' + (button.dataset.name || 'this employee') +
          '? The employee record will be retained.'
        )) {
          await api('/api/employees/' + encodeURIComponent(button.dataset.id), {
            method: 'DELETE'
          });

          await refresh();
          state.view = 'Employees';
          render();
          toast('Employee deactivated successfully.');
        }
        break;
      }
case 'add-pickup-person':
  pickupPersonForm();
  break;

      case 'add-parent':
        parentForm();
        break;

      case 'add-student':
      case 'add-student':
        studentForm();
        break;

      case 'edit-student': {
        const student = state.data.students.find(
          s => String(s.id) === String(button.dataset.id)
        );
        if (student) studentForm(student);
        break;
      }

      case 'archive-student':
        if (confirm('Archive this student record?')) {
          await api('/api/students/' + button.dataset.id, {
            method: 'DELETE'
          });
          await refresh();
          toast('Student archived successfully.');
        }
        break;

      case 'add-payment':
        paymentForm();
        break;

      case 'add-mark':
        markForm();
        break;

      case 'add-user':
        userForm();
        break;

      case 'delete-payment':
        if (state.user.role !== 'ADMIN') {
          throw new Error('Only administrators can delete payments.');
        }

        if (confirm(
          `Permanently delete payment receipt ${button.dataset.receipt}? ` +
          'The student balance and reports will be recalculated.'
        )) {
          await api('/api/payments/' + encodeURIComponent(button.dataset.id), {
            method: 'DELETE'
          });

          await refresh();
          state.view = 'Fees & Payments';
          render();
          toast('Payment deleted. Balances and reports updated.');
        }
        break;

      case 'delete-user':
        if (confirm('Remove staff account ' + button.dataset.username + '?')) {
          await api('/api/users/' + button.dataset.id, {
            method: 'DELETE'
          });
          await refresh();
          toast('Staff account removed.');
        }
        break;

      case 'close-modal':
        $('#modalHost').innerHTML = '';
        break;

      case 'clear-search':
        state.search = '';
        render();
        break;

      case 'export':
        await download('/api/export', 'acropolis-school-backup.json');
        toast('Backup exported successfully.');
        break;

      case 'csv': {
        const rows = [
          ['Student ID', 'Full name', 'Class', 'Guardian', 'Phone', 'Total fees', 'Paid'],
          ...state.data.students
            .filter(s => !s.archived)
            .map(s => [
              s.student_code,
              s.full_name,
              s.class_name,
              s.guardian_name || '',
              s.guardian_phone || '',
              s.total_fees,
              s.paid
            ])
        ];

        const csv = rows.map(row =>
          row.map(value =>
            '"' + String(value ?? '').replace(/"/g, '""') + '"'
          ).join(',')
        ).join('\r\n');

        const blob = new Blob([csv], {
          type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'acropolis-students.csv';
        link.click();
        URL.revokeObjectURL(url);
        toast('Student CSV exported.');
        break;
      }
    }
  } catch (error) {
    toast(error.message || 'The action failed. Please try again.', true);
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'studentSearch' || e.target.id === 'employeeSearch') {
    state.search = e.target.value;
    const inputId = e.target.id;
    const pos = e.target.selectionStart;
    render();
    const input = document.getElementById(inputId);
    if (input) {
      input.focus();
      input.setSelectionRange(pos, pos);
    }
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();$('#modalHost').innerHTML='';}});
$('#drawerBackdrop').addEventListener('click',closeDrawer);
$('#menuToggle').addEventListener('click', () => {
  if (state.drawer) {
    closeDrawer();
  } else {
    openDrawer();
  }
});

document.querySelectorAll('[data-auth-tab]').forEach(tab => {
  tab.addEventListener('click', event => {
    event.preventDefault();
    setAuthTab(tab.getAttribute('data-auth-tab'));
  });
});

$('#logoutBtn').addEventListener('click', async () => {
  const button = $('#logoutBtn');
  button.disabled = true;

  try {
    await api('/api/logout', { method: 'POST' });

    state.user = null;
    state.view = 'Dashboard';
    state.search = '';
    state.drawer = false;
    $('#modalHost').innerHTML = '';

    showAuth();
    toast('Signed out successfully.');
  } catch (error) {
    toast(error.message || 'Sign out failed. Please try again.', true);
  } finally {
    button.disabled = false;
  }
});


(async function init(){try{const r=await api('/api/session');if(r.user){state.view='Dashboard';showApp(r.user);}else showAuth();}catch{showAuth();}})();
