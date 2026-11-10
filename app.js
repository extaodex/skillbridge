/* SKILLBRIDGE Africa - Frontend (vanilla JS) */
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
    error: null,
  };

  // ---------- Utils ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;max-width:320px;border-left:4px solid ' +
      (type === 'error' ? 'var(--danger)' : 'var(--success)');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---------- Supabase init ----------
  function checkConfig() {
    if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('YOUR_')) return false;
    if (!window.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY.includes('YOUR_')) return false;
    return true;
  }

  function initSupabase() {
    if (!checkConfig()) {
      renderConfigError();
      return false;
    }
    supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return true;
  }

  function renderConfigError() {
    $app.innerHTML = `
      <div class="card">
        <h2>Configuration manquante</h2>
        <p>Remplis <code>config.js</code> avec l'URL et la clé anon de ton projet Supabase
        (Dashboard Supabase &gt; Settings &gt; API), puis recharge la page.</p>
      </div>`;
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
      // profil inexistant -> créer
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

  // ---------- Data loading ----------
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
  function renderHeader() {
    if (!state.user) return '';
    const unread = state.notifications.filter(n => !n.read).length;
    return `
      <div class="header">
        <div>
          <h1>SKILLBRIDGE Africa</h1>
          <div class="subtitle">Échange de compétences entre étudiants</div>
        </div>
        <div class="nav">
          <button class="btn btn-outline" data-view="dashboard">Accueil</button>
          <button class="btn btn-outline" data-view="teachers">Trouver un prof</button>
          <button class="btn btn-outline" data-view="sessions">Mes séances</button>
          <button class="btn btn-outline" data-view="notifs">Notifications ${unread ? '(' + unread + ')' : ''}</button>
          <button class="btn btn-outline" id="logoutBtn">Déconnexion</button>
        </div>
      </div>`;
  }

  function renderProfileCard() {
    const p = state.profile;
    if (!p) return '';
    const initial = (p.display_name || p.username || '?').charAt(0).toUpperCase();
    return `
      <div class="card profile-card">
        <div class="avatar">${escapeHtml(initial)}</div>
        <h3>${escapeHtml(p.display_name || p.username)}</h3>
        <div class="level-badge">${escapeHtml(p.level || 'Contributeur')}</div>
        <div>${escapeHtml(p.school || '')} ${p.study_domain ? '· ' + escapeHtml(p.study_domain) : ''}</div>
        <div class="credits">${p.total_credits || 0} SkillCredits</div>
      </div>`;
  }

  function renderAuth() {
    $app.innerHTML = `
      ${renderHeader()}
      <div class="grid">
        <div class="card">
          <h2>Connexion</h2>
          <div class="form-group"><label>Email</label><input id="loginEmail" type="email"></div>
          <div class="form-group"><label>Mot de passe</label><input id="loginPwd" type="password"></div>
          <button class="btn btn-primary" id="loginBtn">Se connecter</button>
        </div>
        <div class="card">
          <h2>Inscription</h2>
          <div class="form-group"><label>Nom affiché</label><input id="signupName"></div>
          <div class="form-group"><label>Email</label><input id="signupEmail" type="email"></div>
          <div class="form-group"><label>Mot de passe</label><input id="signupPwd" type="password"></div>
          <button class="btn btn-primary" id="signupBtn">Créer un compte</button>
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
    $app.innerHTML = `
      ${renderHeader()}
      <div class="grid">
        ${renderProfileCard()}
        <div class="card">
          <h2>Bienvenue</h2>
          <p>Utilise le menu pour trouver un prof, gérer tes séances et voir tes notifications.</p>
          <div class="tabs" style="margin-top:15px">
            <button class="tab" data-view="teachers">Trouver un prof</button>
            <button class="tab" data-view="sessions">Mes séances (${state.mySessions.length})</button>
          </div>
        </div>
      </div>`;
    wireNav();
  }

  function renderTeachers() {
    const cards = state.teachers.map(t => `
      <div class="card">
        <h3>${escapeHtml(t.display_name || t.username)}</h3>
        <div class="level-badge">${escapeHtml(t.level || 'Contributeur')}</div>
        <p>${escapeHtml(t.school || '')} ${t.study_domain ? '· ' + escapeHtml(t.study_domain) : ''}</p>
        <p><strong>${t.total_credits || 0}</strong> SkillCredits</p>
        <button class="btn btn-primary" data-req="${t.id}">Demander une séance</button>
      </div>`).join('') || '<div class="card">Aucun prof disponible pour le moment.</div>';
    $app.innerHTML = `
      ${renderHeader()}
      <div class="card"><h2>Trouver un prof</h2><div class="grid">${cards}</div></div>`;
    wireNav();
    document.querySelectorAll('[data-req]').forEach(btn => {
      btn.onclick = () => openRequestModal(btn.getAttribute('data-req'));
    });
  }

  function openRequestModal(teacherId) {
    const teacher = state.teachers.find(t => t.id === teacherId);
    const skillOpts = state.skills.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    modal.innerHTML = `
      <div class="card" style="max-width:480px;width:90%">
        <h2>Demande à ${escapeHtml(teacher.display_name || teacher.username)}</h2>
        <div class="form-group"><label>Compétence</label><select id="mSkill">${skillOpts}</select></div>
        <div class="form-group"><label>Mode</label>
          <select id="mMode"><option value="online">En ligne</option><option value="in_person">En présentiel</option></select></div>
        <div class="form-group"><label>Durée (min)</label><input id="mDur" type="number" value="30" min="15" step="15"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" id="mCancel">Annuler</button>
          <button class="btn btn-primary" id="mSend">Envoyer</button>
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
    const rows = state.mySessions.map(s => {
      const isTeacher = s.teacher_id === state.user.id;
      const other = isTeacher ? s.requester_id : s.teacher_id;
      const statusCls = 'status-' + (s.status || 'pending');
      let actions = '';
      if (isTeacher && s.status === 'pending') {
        actions = `<button class="btn btn-primary" data-accept="${s.id}">Accepter</button>
                   <button class="btn" data-refuse="${s.id}">Refuser</button>`;
      }
      if ((isTeacher || s.requester_id === state.user.id) && ['pending','accepted','scheduled','in_progress'].includes(s.status)) {
        actions += ` <button class="btn btn-primary" data-complete="${s.id}">Valider la séance</button>`;
      }
      return `
        <div class="session-card card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${escapeHtml(s.skills ? s.skills.name : 'Compétence')}</strong>
            <span class="status ${statusCls}">${escapeHtml(s.status)}</span>
          </div>
          <p>Mode : ${escapeHtml(s.mode || '-')}, ${s.duration_minutes || 30} min</p>
          <p>Planifié : ${s.scheduled_at ? new Date(s.scheduled_at).toLocaleString() : 'à définir'}</p>
          <div style="margin-top:10px">${actions}</div>
        </div>`;
    }).join('') || '<div class="card">Aucune séance pour le moment.</div>';
    $app.innerHTML = `
      ${renderHeader()}
      <div class="card"><h2>Mes séances</h2><div class="grid">${rows}</div></div>`;
    wireNav();
    document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => updateSessionStatus(b.dataset.accept, 'accepted'));
    document.querySelectorAll('[data-refuse]').forEach(b => b.onclick = () => updateSessionStatus(b.dataset.refuse, 'refused'));
    document.querySelectorAll('[data-complete]').forEach(b => b.onclick = () => completeSession(b.dataset.complete));
  }

  function renderNotifs() {
    const rows = state.notifications.map(n => `
      <div class="notification ${n.read ? '' : 'unread'}">
        <div>
          <strong>${escapeHtml(n.title)}</strong>
          <div>${escapeHtml(n.body || '')}</div>
          <small>${new Date(n.created_at).toLocaleString()}</small>
        </div>
        ${n.read ? '' : `<button class="btn" data-read="${n.id}">Marquer lu</button>`}
      </div>`).join('') || '<div class="card">Aucune notification.</div>';
    $app.innerHTML = `
      ${renderHeader()}
      <div class="card"><h2>Notifications</h2>${rows}</div>`;
    wireNav();
    document.querySelectorAll('[data-read]').forEach(b => b.onclick = () => markNotifRead(b.dataset.read));
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
