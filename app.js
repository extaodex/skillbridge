/* SKILLBRIDGE Africa — Frontend */
(function () {
  'use strict';

  const $app = document.getElementById('app');
  let supabase = null;
  const state = {
    user: null,
    profile: null,
    view: 'loading',
    teachers: [],
    mySessions: [],
    notifications: [],
    skills: [],
  };

  // ---------- Utils ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function checkConfig() {
    if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('YOUR_')) return false;
    if (!window.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY.includes('YOUR_')) return false;
    return true;
  }

  function initSupabase() {
    if (!checkConfig()) {
      $app.innerHTML = `<div class="config-error card"><h2>Configuration manquante</h2><p>Remplis <code>config.js</code> avec l'URL et la clé anon de ton projet Supabase, puis recharge la page.</p></div>`;
      return false;
    }
    supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return true;
  }

  // ---------- Auth ----------
  async function loadSession() {
    const { data } = await supabase.auth.getSession();
    state.user = data.session ? data.session.user : null;
    if (state.user) await loadProfile();
  }

  async function loadProfile() {
    if (!state.user) { state.profile = null; return; }
    const { data, error } = await supabase
      .from('profiles').select('*').eq('id', state.user.id).single();
    if (error && error.code === 'PGRST116') {
      const username = (state.user.email || '').split('@')[0] + '_' + state.user.id.slice(0, 6);
      const { data: created } = await supabase.from('profiles').insert({
        id: state.user.id, username, display_name: username,
      }).select().single();
      state.profile = created;
    } else {
      state.profile = data;
    }
  }

  async function signUp(email, password, displayName) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user) {
      const username = email.split('@')[0] + '_' + data.user.id.slice(0, 6);
      await supabase.from('profiles').insert({
        id: data.user.id, username, display_name: displayName || username,
      });
    }
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    state.user = null; state.profile = null;
    render();
  }

  // ---------- Data ----------
  async function loadTeachers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, school, study_domain, total_credits, level, avatar_url')
      .neq('id', state.user.id)
      .order('total_credits', { ascending: false });
    state.teachers = data || [];
  }

  async function loadSkills() {
    const { data } = await supabase.from('skills').select('*').order('name');
    state.skills = data || [];
  }

  async function loadMySessions() {
    const { data } = await supabase
      .from('sessions')
      .select('*, skills(name)')
      .or(`requester_id.eq.${state.user.id},teacher_id.eq.${state.user.id}`)
      .order('created_at', { ascending: false });
    state.mySessions = data || [];
  }

  async function loadNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    state.notifications = data || [];
  }

  async function loadAll() {
    await Promise.all([loadTeachers(), loadSkills(), loadMySessions(), loadNotifications()]);
  }

  // ---------- Actions ----------
  async function requestSession(teacherId, skillId, mode, duration) {
    const { data, error } = await supabase.functions.invoke('create-session-request', {
      body: { teacher_id: teacherId, skill_id: skillId, mode, duration_minutes: duration },
    });
    if (error) { toast('Erreur : ' + (error.message || error), 'error'); return; }
    toast('Demande envoyée !');
    await loadMySessions();
    render();
  }

  async function updateSessionStatus(sessionId, status) {
    const { error } = await supabase.from('sessions')
      .update({ status }).eq('id', sessionId);
    if (error) { toast('Erreur : ' + error.message, 'error'); return; }
    await loadMySessions();
    render();
  }

  async function completeSession(sessionId) {
    const { data, error } = await supabase.functions.invoke('confirm-session', {
      body: { session_id: sessionId },
    });
    if (error) { toast('Erreur : ' + (error.message || error), 'error'); return; }
    toast('Séance validée ! Crédits attribués.');
    await loadAll();
    render();
  }

  async function markNotifRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    await loadNotifications();
    render();
  }

  // ---------- Rendering ----------
  function shell(content) {
    const unread = state.notifications.filter(n => !n.read).length;
    const p = state.profile;
    const initial = (p && (p.display_name || p.username) || '?').charAt(0).toUpperCase();
    return `
      <div class="shell">
        <aside class="sidebar">
          <div style="display:flex;align-items:center;gap:12px">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="36" height="36" aria-label="SKILLBRIDGE">
              <rect x="2" y="2" width="44" height="44" rx="10" fill="#D9A441"/>
              <path d="M12 30 Q24 14 36 30" stroke="#1F6F54" stroke-width="3" fill="none" stroke-linecap="round"/>
              <rect x="14" y="30" width="4" height="8" rx="1" fill="#0B1F1A"/>
              <rect x="30" y="30" width="4" height="8" rx="1" fill="#0B1F1A"/>
              <circle cx="24" cy="20" r="3" fill="#0B1F1A"/>
            </svg>
            <div>
              <div class="brand">Skill<span>bridge</span></div>
              <div class="tagline">Échange de compétences entre étudiants</div>
            </div>
          </div>
          <nav>
            <button data-view="dashboard" class="${state.view === 'dashboard' ? 'active' : ''}">Accueil</button>
            <button data-view="teachers" class="${state.view === 'teachers' ? 'active' : ''}">Trouver un prof</button>
            <button data-view="sessions" class="${state.view === 'sessions' ? 'active' : ''}">Mes séances</button>
            <button data-view="notifs" class="${state.view === 'notifs' ? 'active' : ''}">Notifications ${unread ? '(' + unread + ')' : ''}</button>
          </nav>
          <div class="profile-mini">
            <div class="name">${escapeHtml(p ? (p.display_name || p.username) : '')}</div>
            <div class="level">${escapeHtml(p ? (p.level || 'Contributeur') : '')}</div>
            <div class="credits">${p ? (p.total_credits || 0) : 0}</div>
          </div>
          <button class="btn btn-ghost" id="logoutBtn" style="margin-top:8px;align-self:flex-start">Déconnexion</button>
        </aside>
        <main class="main">${content}</main>
      </div>`;
  }

  function wireNav() {
    document.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = async () => {
        state.view = b.getAttribute('data-view');
        if (state.view === 'teachers') await loadTeachers();
        if (state.view === 'sessions') await loadMySessions();
        if (state.view === 'notifs') await loadNotifications();
        render();
      };
    });
    const logout = document.getElementById('logoutBtn');
    if (logout) logout.onclick = signOut;
  }

  function renderAuth() {
    $app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-side">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-label="SKILLBRIDGE" style="margin-bottom:24px">
              <rect x="2" y="2" width="44" height="44" rx="10" fill="#D9A441"/>
              <path d="M12 30 Q24 14 36 30" stroke="#1F6F54" stroke-width="3" fill="none" stroke-linecap="round"/>
              <rect x="14" y="30" width="4" height="8" rx="1" fill="#0B1F1A"/>
              <rect x="30" y="30" width="4" height="8" rx="1" fill="#0B1F1A"/>
              <circle cx="24" cy="20" r="3" fill="#0B1F1A"/>
            </svg>
            <h1>Échange tes <em>compétences</em>, grandis ensemble.</h1>
            <p>SKILLBRIDGE Africa connecte les étudiants qui veulent apprendre avec ceux qui peuvent enseigner. Gagne des SkillCredits en partageant ton savoir.</p>
          </div>
          <div class="foot">© 2026 SKILLBRIDGE Africa</div>
        </div>
        <div class="auth-forms">
          <div class="card">
            <h2>Connexion</h2>
            <div class="form" style="margin-top:16px">
              <div class="form-group"><label>Email</label><input id="loginEmail" type="email" placeholder="toi@ecole.fr"></div>
              <div class="form-group"><label>Mot de passe</label><input id="loginPwd" type="password"></div>
              <button class="btn btn-primary" id="loginBtn">Se connecter</button>
            </div>
          </div>
          <div class="card">
            <h2>Créer un compte</h2>
            <div class="form" style="margin-top:16px">
              <div class="form-group"><label>Nom affiché</label><input id="signupName" placeholder="Marie Dupont"></div>
              <div class="form-group"><label>Email</label><input id="signupEmail" type="email" placeholder="toi@ecole.fr"></div>
              <div class="form-group"><label>Mot de passe</label><input id="signupPwd" type="password"></div>
              <button class="btn btn-accent" id="signupBtn">Créer mon compte</button>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('loginBtn').onclick = async () => {
      try {
        await signIn(document.getElementById('loginEmail').value, document.getElementById('loginPwd').value);
        await loadSession(); await loadAll();
        state.view = 'dashboard'; render();
      } catch (e) { toast('Connexion échouée : ' + e.message, 'error'); }
    };
    document.getElementById('signupBtn').onclick = async () => {
      try {
        await signUp(document.getElementById('signupEmail').value, document.getElementById('signupPwd').value,
          document.getElementById('signupName').value);
        toast('Compte créé, connecte-toi.');
      } catch (e) { toast('Inscription échouée : ' + e.message, 'error'); }
    };
  }

  function renderDashboard() {
    const p = state.profile;
    const initial = (p && (p.display_name || p.username) || '?').charAt(0).toUpperCase();
    const unread = state.notifications.filter(n => !n.read).length;
    const content = `
      <div class="profile-card">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="info">
          <h3>${escapeHtml(p ? (p.display_name || p.username) : '')}</h3>
          <div class="meta">${escapeHtml(p && p.school ? p.school : 'Étudiant')} ${p && p.study_domain ? '· ' + escapeHtml(p.study_domain) : ''}</div>
          <span class="level-badge">${escapeHtml(p ? (p.level || 'Contributeur') : 'Contributeur')}</span>
        </div>
        <div class="credits-block">
          <div class="number">${p ? (p.total_credits || 0) : 0}</div>
          <div class="label">SkillCredits</div>
        </div>
      </div>

      <div class="section">
        <h2>Bienvenue</h2>
        <p class="lede">Trouve un prof pour apprendre une compétence, ou propose la tienne pour gagner des crédits.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <button class="btn btn-primary" data-view="teachers">Trouver un prof</button>
          <button class="btn btn-ghost" data-view="sessions">Mes séances (${state.mySessions.length})</button>
          ${unread ? `<button class="btn btn-accent" data-view="notifs">${unread} notification${unread > 1 ? 's' : ''}</button>` : ''}
        </div>
      </div>

      ${state.mySessions.length ? `
      <div class="section">
        <h2>Séances récentes</h2>
        <div class="session-list">
          ${state.mySessions.slice(0, 3).map(s => sessionItemHtml(s)).join('')}
        </div>
      </div>` : ''}`;
    $app.innerHTML = shell(content);
    wireNav();
    bindSessionActions();
  }

  function sessionItemHtml(s) {
    const isTeacher = s.teacher_id === state.user.id;
    const statusCls = 'status-' + (s.status || 'pending');
    const statusLabel = { pending: 'En attente', accepted: 'Acceptée', completed: 'Terminée', refused: 'Refusée' }[s.status] || s.status;
    let actions = '';
    if (isTeacher && s.status === 'pending') {
      actions = `<button class="btn btn-primary" data-accept="${s.id}">Accepter</button>
                 <button class="btn btn-ghost" data-refuse="${s.id}">Refuser</button>`;
    }
    if ((isTeacher || s.requester_id === state.user.id) && ['pending','accepted','scheduled','in_progress'].includes(s.status)) {
      actions += ` <button class="btn btn-accent" data-complete="${s.id}">Valider</button>`;
    }
    return `
      <div class="session-item">
        <div class="info">
          <h3>${escapeHtml(s.skills ? s.skills.name : 'Compétence')}</h3>
          <p>${escapeHtml(s.mode === 'online' ? 'En ligne' : 'Présentiel')} · ${s.duration_minutes || 30} min${s.scheduled_at ? ' · ' + new Date(s.scheduled_at).toLocaleDateString('fr-FR') : ''}</p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <span class="status ${statusCls}">${escapeHtml(statusLabel)}</span>
          <div class="actions">${actions}</div>
        </div>
      </div>`;
  }

  function renderTeachers() {
    const cards = state.teachers.map(t => `
      <div class="teacher-card">
        <div class="name">${escapeHtml(t.display_name || t.username)}</div>
        <div class="meta">${escapeHtml(t.school || 'Étudiant')} ${t.study_domain ? '· ' + escapeHtml(t.study_domain) : ''}</div>
        <span class="level-badge" style="background:var(--accent);color:var(--paper);padding:3px 8px;border-radius:999px;font-size:0.75rem;font-weight:600;align-self:flex-start">${escapeHtml(t.level || 'Contributeur')}</span>
        <div class="credits">${t.total_credits || 0} crédits</div>
        <div class="actions"><button class="btn btn-primary" style="width:100%" data-req="${t.id}">Demander une séance</button></div>
      </div>`).join('') || `<div class="empty"><strong>Aucun prof disponible</strong>Ajoute des compétences à ton profil pour apparaître ici.</div>`;
    const content = `
      <div class="section">
        <h2>Trouver un prof</h2>
        <p class="lede">Parcours les étudiants qui partagent leurs compétences.</p>
        <div class="teacher-grid">${cards}</div>
      </div>`;
    $app.innerHTML = shell(content);
    wireNav();
    document.querySelectorAll('[data-req]').forEach(btn => {
      btn.onclick = () => openRequestModal(btn.getAttribute('data-req'));
    });
  }

  function openRequestModal(teacherId) {
    const teacher = state.teachers.find(t => t.id === teacherId);
    const skillOpts = state.skills.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <h2>Demande à ${escapeHtml(teacher.display_name || teacher.username)}</h2>
        <div class="form">
          <div class="form-group"><label>Compétence</label><select id="mSkill">${skillOpts || '<option value="">Aucune compétence</option>'}</select></div>
          <div class="form-group"><label>Mode</label><select id="mMode"><option value="online">En ligne</option><option value="in_person">En présentiel</option></select></div>
          <div class="form-group"><label>Durée (min)</label><input id="mDur" type="number" value="30" min="15" step="15"></div>
        </div>
        <div class="actions">
          <button class="btn btn-ghost" id="mCancel">Annuler</button>
          <button class="btn btn-primary" id="mSend">Envoyer la demande</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('mCancel').onclick = () => modal.remove();
    document.getElementById('mSend').onclick = async () => {
      await requestSession(teacherId,
        document.getElementById('mSkill').value,
        document.getElementById('mMode').value,
        parseInt(document.getElementById('mDur').value, 10));
      modal.remove();
    };
  }

  function renderSessions() {
    const rows = state.mySessions.map(s => sessionItemHtml(s)).join('') || `<div class="empty"><strong>Aucune séance</strong>Demander une séance à un prof pour commencer.</div>`;
    const content = `
      <div class="section">
        <h2>Mes séances</h2>
        <p class="lede">Suis tes demandes et valide les séances terminées.</p>
        <div class="session-list">${rows}</div>
      </div>`;
    $app.innerHTML = shell(content);
    wireNav();
    bindSessionActions();
  }

  function bindSessionActions() {
    document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => updateSessionStatus(b.dataset.accept, 'accepted'));
    document.querySelectorAll('[data-refuse]').forEach(b => b.onclick = () => updateSessionStatus(b.dataset.refuse, 'refused'));
    document.querySelectorAll('[data-complete]').forEach(b => b.onclick = () => completeSession(b.dataset.complete));
  }

  function renderNotifs() {
    const rows = state.notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div>
          <div class="title">${escapeHtml(n.title)}</div>
          <div class="body">${escapeHtml(n.body || '')}</div>
          <div class="time">${new Date(n.created_at).toLocaleString('fr-FR')}</div>
        </div>
        ${n.read ? '' : `<button class="btn btn-ghost" data-read="${n.id}">Marquer lu</button>`}
      </div>`).join('') || `<div class="empty"><strong>Aucune notification</strong>Tu seras informé ici des nouvelles demandes et crédits.</div>`;
    const content = `
      <div class="section">
        <h2>Notifications</h2>
        <p class="lede">Reste informé de l'activité sur ton compte.</p>
        <div class="notif-list">${rows}</div>
      </div>`;
    $app.innerHTML = shell(content);
    wireNav();
    document.querySelectorAll('[data-read]').forEach(b => b.onclick = () => markNotifRead(b.dataset.read));
  }

  function render() {
    if (!state.user) { renderAuth(); return; }
    switch (state.view) {
      case 'teachers': renderTeachers(); break;
      case 'sessions': renderSessions(); break;
      case 'notifs': renderNotifs(); break;
      default: renderDashboard(); break;
    }
  }

  // ---------- Boot ----------
  async function boot() {
    if (!initSupabase()) return;
    supabase.auth.onAuthStateChange(async () => {
      await loadSession();
      if (state.user) { state.view = 'dashboard'; await loadAll(); }
      render();
    });
    await loadSession();
    if (state.user) { state.view = 'dashboard'; await loadAll(); }
    render();
  }

  boot();
})();