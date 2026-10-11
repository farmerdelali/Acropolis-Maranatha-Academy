]'use strict';
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
function setAuthTab(which){document.querySelectorAll('[data-auth-tab]').forEach(b=>b.classList.toggle('active',b.dataset.authTab===which));$('#registerForm').classList.toggle('hidden',which!=='register');$('#loginForm').classList.toggle('hidden',which!=='login');$('#registerError').textContent='';$('#loginError').textContent='';}
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
      (name !== 'Users' && name !== 'Settings') ||
      user.role === 'ADMIN'
    )
    .map(([name, icon]) =>
      `<button class="nav-item ${state.view === name ? 'active' : ''}" type="button" data-view="${esc(name)}"><span class="nav-icon">${icon}</span><span>${esc(name)}</span></button>`
    )
    .join('');

  closeDrawer();
  loadData().catch(e => toast(e.message, true));
}

async function loadData(){
  const d = await api('/api/bootstrap');
  const parentResult = await api('/api/parents');
const parents = parentResult.parents || [];
  state.data = {...d, parents};
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
 const rows=d.payments.length?`<div class="table-wrap"><table><thead><tr><th>Receipt</th><th>Student</th><th>Student ID</th><th>Amount</th><th>Date</th><th>Note</th></tr></thead><tbody>${d.payments.map(p=>`<tr><td><b>${esc(p.receipt_no)}</b></td><td>${esc(p.student_name)}</td><td>${esc(p.student_code)}</td><td>${money(p.amount)}</td><td>${new Date(p.paid_at).toLocaleDateString()}</td><td>${esc(p.note||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No payments recorded yet.</div>';
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
  html = `<section class="panel"><h2>Match Students</h2><p>Find and review student records that may belong to the same student.</p><p>Student matching tools will be added here.</p></section>`;
} else if (state.view === 'Drop-off Denial') {
  html = `<section class="panel"><h2>Drop-off Denial</h2><p>Manage restrictions on who may drop off students.</p><p>Drop-off restriction records will be added here.</p></section>`;

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
  html = `<section class="panel"><h2>Authorized Pickup Persons</h2><p>Manage people authorized to collect students from school.</p></section>`;
} else if (state.view === 'Employees') {
  html = `<section class="panel"><h2>Employees</h2><p>Manage school employee records and assignments.</p></section>`;
} else if (state.view === 'Graduations') {
  html = `<section class="panel"><h2>Graduations</h2><p>Manage graduation records for eligible students.</p></section>`;
} else if (state.view === 'Class Activations') {
  html = `<section class="panel"><h2>Class Activations</h2><p>Manage class activation and academic-year status.</p></section>`;
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

function studentForm(s=null){openModal(s?'Edit student':'Register student',`<form id="studentForm"><div class="form-grid"><label class="field">Full name<input name="fullName" required maxlength="120" value="${esc(s?.full_name||'')}"></label><label class="field">Student ID (optional)<input name="studentCode" maxlength="40" value="${esc(s?.student_code||'')}" ${s?'readonly':''} placeholder="Auto-generated if blank"></label><label class="field">Class / form<input name="className" required maxlength="60" value="${esc(s?.class_name||'')}"></label><label class="field">Gender<select name="gender"><option value="">Select</option>${['Female','Male','Other'].map(g=>`<option ${s?.gender===g?'selected':''}>${g}</option>`).join('')}</select></label><label class="field">Guardian name<input name="guardianName" maxlength="120" value="${esc(s?.guardian_name||'')}"></label><label class="field">Guardian phone<input name="guardianPhone" maxlength="40" inputmode="tel" value="${esc(s?.guardian_phone||'')}"></label><label class="field">Total fees (GHS)<input name="totalFees" type="number" min="0" step="0.01" required value="${Number(s?.total_fees||0)}"></label></div><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save student</button></div></form>`);$('#studentForm').dataset.id=s?.id||'';}
function paymentForm(){const students=state.data.students.filter(s=>!s.archived);if(!students.length)return toast('Register a student before recording payments.',true);openModal('Record payment',`<form id="paymentForm"><label class="field">Student<select name="studentId" required>${students.map(s=>`<option value="${s.id}">${esc(s.full_name)} · ${esc(s.student_code)}</option>`).join('')}</select></label><label class="field">Amount (GHS)<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label class="field">Note / payment method<input name="note" maxlength="200" placeholder="Cash, bank transfer, term fees…"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save payment</button></div></form>`);}
function markForm(){const students=state.data.students.filter(s=>!s.archived);if(!students.length)return toast('Register a student before entering marks.',true);openModal('Enter examination mark',`<form id="markForm"><label class="field">Student<select name="studentId" required>${students.map(s=>`<option value="${s.id}">${esc(s.full_name)} · ${esc(s.class_name)}</option>`).join('')}</select></label><label class="field">Subject<input name="subject" required maxlength="80" placeholder="e.g. Mathematics"></label><label class="field">Term<input name="term" maxlength="40" value="Term 1" required></label><label class="field">Score (%)<input name="score" type="number" min="0" max="100" step="0.01" required inputmode="decimal"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save mark</button></div></form>`);}
function userForm(){openModal('Create staff account',`<form id="userForm"><label class="field">Username<input name="username" required minlength="3" maxlength="60" autocomplete="off"></label><label class="field">Role<select name="role"><option value="TEACHER">Teacher — students and marks</option><option value="BURSAR">Bursar — fees and payments</option><option value="ADMIN">Administrator — full access</option></select></label><label class="field">Temporary password <small>At least 10 characters</small><input name="password" type="password" required minlength="10" autocomplete="new-password"></label><div class="form-actions"><button type="button" class="btn soft" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create account</button></div></form>`);}
async function refresh(){await loadData();}
async function download(url,filename){const r=await fetch(url,{credentials:'same-origin'});if(!r.ok){let b={};try{b=await r.json()}catch{}throw new Error(b.error||'Download failed');}const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}

document.addEventListener('submit', async e => {
  const form = e.target;

  const allowedForms = [
    'registerForm',
    'loginForm',
    'studentForm',
    'paymentForm',
    'markForm',
    'userForm',
    'settingsForm'
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
        paymentForm: 'Save payment',
        markForm: 'Save mark',
        userForm: 'Create account',
        settingsForm: 'Save settings'
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
document.addEventListener('input',e=>{if(e.target.id==='studentSearch'){state.search=e.target.value;const pos=e.target.selectionStart;render();const input=$('#studentSearch');input.focus();input.setSelectionRange(pos,pos);}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();$('#modalHost').innerHTML='';}});
$('#drawerBackdrop').addEventListener('click',closeDrawer);
$('#menuToggle').addEventListener('click', () => {
  if (state.drawer) {
    closeDrawer();
  } else {
    openDrawer();
  }
});
(async function init(){try{const r=await api('/api/session');if(r.user){state.view='Dashboard';showApp(r.user);}else showAuth();}catch{showAuth();}})();
