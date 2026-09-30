// Site da fazenda (PWA). JavaScript simples, sem framework.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fdate = (s) => (s ? s.split('-').reverse().join('/') : '—');
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const LABEL = { ok: 'Normal', atencao: 'Atenção', alerta: 'Alerta' };
const chip = (s) => `<span class="chip ${s}">${LABEL[s]}</span>`;
const ROLE = { dono: 'Dono', encarregado: 'Encarregado', funcionario: 'Funcionário', veterinaria: 'Veterinária' };
const STATUS = { lactacao: 'Lactação', seca: 'Seca', novilha: 'Novilha', bezerra: 'Bezerra', descartada: 'Descartada', vendida: 'Vendida', morta: 'Morta' };

const S = { farm: null, user: null, token: localStorage.getItem('token'), charts: [] };
const can = (p) => S.user?.permissions.includes(p);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (S.token) headers.authorization = `Bearer ${S.token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401 && S.token && path !== '/api/login') { logout(true); throw new Error('Sessão encerrada. Entre de novo.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

// ---------------- fila offline ----------------
const QKEY = () => `fila:${S.farm?.slug}`;
const getQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY()) || '[]'); } catch { return []; } };
const setQueue = (q) => { try { localStorage.setItem(QKEY(), JSON.stringify(q)); } catch { toast('Sem espaço no aparelho para guardar.'); } updateBadge(); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
let syncing = false;
async function syncQueue() {
  if (syncing || !S.token || !navigator.onLine) return;
  const q = getQueue().filter((i) => !i.error);
  if (!q.length) return;
  syncing = true;
  try {
    const { results } = await api('/api/analyses/sync', { method: 'POST', body: { items: q.slice(0, 200) } });
    const byId = new Map(results.map((r) => [r.client_uuid, r]));
    const next = getQueue().flatMap((i) => {
      const r = byId.get(i.client_uuid);
      if (!r) return [i];
      return r.status === 'erro' ? [{ ...i, error: r.error }] : [];
    });
    const ok = results.filter((r) => r.status !== 'erro').length;
    setQueue(next);
    if (ok) toast(`${ok} lançamento(s) enviados.`);
    if (location.hash.startsWith('#/lancar')) route();
  } catch { /* segue na fila; tenta de novo depois */ } finally { syncing = false; }
}
function updateBadge() {
  const b = $('#netbadge'); if (!b) return;
  const n = getQueue().length;
  b.textContent = !navigator.onLine ? `Sem internet${n ? ` · ${n} na fila` : ''}` : n ? `${n} na fila` : 'Online';
  b.className = 'badge' + (!navigator.onLine || n ? ' off' : '');
}
addEventListener('online', () => { updateBadge(); syncQueue(); });
addEventListener('offline', updateBadge);

// ---------------- gráficos ----------------
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function killCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
function chart(el, cfg) {
  Chart.defaults.font.family = 'system-ui, sans-serif'; Chart.defaults.color = css('--muted');
  const c = new Chart(el, { ...cfg, options: { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options } });
  S.charts.push(c); return c;
}
const monthLabel = (m) => { const [y, mo] = m.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+mo - 1]}/${y.slice(2)}`; };

// ---------------- estrutura da tela ----------------
function shell(html, active) {
  const items = [];
  if (can('relatorios')) items.push(['painel', '📊', 'Painel']);
  items.push(['animais', '🐄', 'Animais'], ['lancar', '➕', 'Lançar']);
  if (can('importar')) items.push(['importar', '📥', 'Importar']);
  const reports = can('relatorios') ? [['controle', 'Controle leiteiro'], ['tanque', 'Tanque / laticínio']] : [];
  const more = [];
  if (can('config')) more.push(['config', 'Tipos de análise e limites']);
  if (can('usuarios')) more.push(['usuarios', 'Usuários']);
  if (can('auditoria')) more.push(['auditoria', 'Registro de alterações']);
  more.push(['senha', 'Trocar senha / PIN']);
  $('#app').innerHTML = `
    <aside class="side"><img class="logo" src="/brand/dairyup-vertical.png" alt="DairyUp">
      <div class="who"><b>${esc(S.farm.name)}</b>${esc(S.user.name)} · ${ROLE[S.user.role]}</div>
      ${items.map(([k, , l]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}
      ${reports.length ? `<div class="sect">Relatórios</div>${reports.map(([k, l]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}` : ''}
      <div class="sect">Configurações</div>
      ${more.map(([k, l]) => `<a href="#/${k}" class="${location.hash.startsWith('#/' + k) ? 'on' : ''}">${l}</a>`).join('')}
      ${can('exportar') ? '<a href="#" data-x="exp">Exportar dados (planilha)</a>' : ''}
      <a href="#" data-x="out">Sair</a></aside>
    <div class="content"><header class="top"><img src="/brand/dairyup-vaca.png" alt="DairyUp"><b>${esc(S.farm.name)}</b><span id="netbadge" class="badge">Online</span></header>
    <main>${html}</main></div>
    <nav class="bottom">${items.concat([['mais', '☰', 'Mais']]).map(([k, ic, l]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')}</nav>`;
  $('[data-x=out]').onclick = (e) => { e.preventDefault(); logout(); };
  if ($('[data-x=exp]')) $('[data-x=exp]').onclick = (e) => { e.preventDefault(); exportAll(); };
  updateBadge();
}
async function exportAll() {
  try { const blob = await api('/api/export/all.xlsx'); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.farm.slug}-dados.xlsx`; a.click(); toast('Planilha gerada.'); } catch (x) { toast(x.message); }
}
const err = (e) => `<div class="msg err">${esc(e.message || e)}</div>`;

// ---------------- login ----------------
function viewLogin(message) {
  killCharts();
  $('#app').innerHTML = `<div class="login"><img src="/brand/dairyup-vertical.png" alt="DairyUp"><h1>${esc(S.farm.name)}</h1>${message ? `<div class="msg info">${esc(message)}</div>` : ''}
    <form id="f" class="card"><label for="em">E-mail</label><input id="em" type="email" autocomplete="username" required value="${esc(localStorage.getItem('lastEmail') || '')}">
      <label for="pw" id="pwl">Senha</label><input id="pw" type="password" autocomplete="current-password" required>
      <div id="e"></div><div style="margin-top:14px"><button class="primary" style="width:100%">Entrar</button></div>
      <p style="text-align:center;margin:12px 0 0"><a href="#" id="tg">Entrar com PIN</a></p></form></div>`;
  let usePin = false;
  $('#tg').onclick = (ev) => { ev.preventDefault(); usePin = !usePin; $('#pwl').textContent = usePin ? 'PIN' : 'Senha'; $('#pw').type = usePin ? 'tel' : 'password'; $('#pw').inputMode = usePin ? 'numeric' : 'text'; $('#tg').textContent = usePin ? 'Entrar com senha' : 'Entrar com PIN'; };
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); const btn = $('#f button'); btn.disabled = true;
    try {
      const email = $('#em').value.trim();
      const r = await api('/api/login', { method: 'POST', body: { email, [usePin ? 'pin' : 'password']: $('#pw').value } });
      S.token = r.token; S.user = r.user; localStorage.setItem('token', r.token); localStorage.setItem('lastEmail', email);
      location.hash = r.user.must_change_password ? '#/senha' : (r.user.permissions.includes('relatorios') ? '#/painel' : '#/animais'); route(); syncQueue();
    } catch (e) { $('#e').innerHTML = err(e); btn.disabled = false; }
  };
}
function logout(expired) {
  if (S.token && !expired) api('/api/logout', { method: 'POST' }).catch(() => {});
  S.token = null; S.user = null; localStorage.removeItem('token'); viewLogin(expired ? 'Sessão encerrada. Entre de novo.' : '');
}

function viewPassword(first) {
  shell(`<h1>${first ? 'Crie sua senha' : 'Trocar senha'}</h1><form id="f" class="card">
    <label>Senha atual (a temporária, se for o primeiro acesso)</label><input id="a" type="password" autocomplete="current-password" required>
    <label>Nova senha (mínimo 8 caracteres)</label><input id="b" type="password" minlength="8" autocomplete="new-password" required><div id="e"></div>
    <div style="margin-top:14px"><button class="primary">Salvar</button></div></form>
    <form id="p" class="card"><h2>PIN (opcional)</h2><p class="muted small">Um número de 4 a 6 dígitos para entrar mais rápido no celular.</p>
    <label>Sua senha</label><input id="pp" type="password" required><label>PIN novo (deixe vazio para remover)</label><input id="pn" inputmode="numeric" pattern="\\d{4,6}" maxlength="6"><div id="e2"></div>
    <div style="margin-top:14px"><button>Salvar PIN</button></div></form>`, 'mais');
  $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/me/password', { method: 'POST', body: { current: $('#a').value, next: $('#b').value } }); S.user = await api('/api/me'); toast('Senha alterada.'); location.hash = can('relatorios') ? '#/painel' : '#/animais'; } catch (e) { $('#e').innerHTML = err(e); } };
  $('#p').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/me/pin', { method: 'POST', body: { password: $('#pp').value, pin: $('#pn').value } }); toast('PIN salvo.'); $('#p').reset(); } catch (e) { $('#e2').innerHTML = err(e); } };
}

// ---------------- painel ----------------
const delta = (c) => {
  if (c.previous == null) return '';
  const diff = c.value - c.previous; const pct = c.previous ? (diff / c.previous) * 100 : 0;
  const worseUp = c.code === 'CCS' || c.code === 'CBT';
  const bad = worseUp ? diff > 0 : diff < 0;
  return `<div class="d" style="color:var(--${Math.abs(pct) < 1 ? 'muted' : bad ? 'bad' : 'ok'})">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${nf(Math.abs(pct), 1)}% vs. coleta anterior</div>`;
};
async function viewPainel() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Painel de qualidade do leite</h1><div class="muted">Carregando…</div>', 'painel');
  try {
    let lot = sessionStorage.getItem('lot') || '';
    const [lots, types] = await Promise.all([api('/api/dashboard/lots'), api('/api/analysis-types')]);
    const render = async () => {
      killCharts();
      const q = lot ? `lot=${encodeURIComponent(lot)}` : '';
      const [sum, trA, trT, dist, rank, alerts] = await Promise.all([
        api(`/api/dashboard/summary?${q}`), api(`/api/dashboard/trend?months=12&${q}`), api('/api/dashboard/trend?scope=tank&months=12'),
        api(`/api/dashboard/distribution?code=CCS&${q}`), api(`/api/dashboard/ranking?code=${S.rankCode || 'CCS'}&order=${S.rankOrder || 'worst'}&limit=15&${q}`), api(`/api/dashboard/alerts?code=CCS&${q}`)]);
      const hasData = sum.cards.some((c) => c.date);
      const main = $('main');
      main.innerHTML = `<h1>Painel de qualidade do leite</h1>
        ${sum.last_control ? `<p class="muted" style="margin:-6px 0 10px">Último controle enviado: <b>${fdate(sum.last_control)}</b>${sum.last_import ? ` · arquivo enviado em ${new Date(sum.last_import.at).toLocaleDateString('pt-BR')}` : ''}</p>` : ''}
        <div class="row" style="margin-bottom:12px"><div><label for="lot" class="sr">Lote</label><select id="lot"><option value="">Todo o rebanho</option>${lots.map((l) => `<option ${l.lot === lot ? 'selected' : ''} value="${esc(l.lot)}">${esc(l.lot)} (${l.n})</option>`).join('')}</select></div></div>
        ${hasData ? '' : '<div class="msg info">Ainda não há análises. Use <b>Importar</b> para enviar a planilha do controle leiteiro ou <b>Lançar</b> para digitar.</div>'}
        <div class="grid" style="margin-bottom:14px">${sum.cards.filter((c) => c.date).map((c) => `
          <div class="kpi ${c.status_herd}"><div class="l">${esc(c.name)}${c.geometric ? ' (média geométrica)' : ''}</div>
            <div class="v">${nf(c.value, c.decimals)} <span class="u">${esc(c.unit)}</span></div>${delta(c)}
            <div class="d muted">${c.n} vacas · coleta de ${fdate(c.date)}</div>
            ${c.pct_alerta || c.pct_atencao ? `<div class="d">${chip('alerta')} ${nf(c.pct_alerta, 1)}% · ${chip('atencao')} ${nf(c.pct_atencao, 1)}%</div>` : ''}</div>`).join('')}</div>
        ${sum.tank.length ? `<div class="card"><h2>Tanque / laticínio (mapa do leite)</h2><div class="grid">${sum.tank.map((c) => `
          <div class="kpi ${c.status}"><div class="l">${esc(c.name)} · ${fdate(c.date)}</div><div class="v">${nf(c.value, c.decimals)} <span class="u">${esc(c.unit)}</span></div><div>${chip(c.status)}</div></div>`).join('')}</div></div>` : ''}
        <div class="grid two">
          <div class="card"><h2>Evolução mensal</h2><div class="tabs" id="tt">${types.filter((t) => t.active && [...trA, ...trT].some((r) => r.code === t.code)).map((t) => `<button data-c="${t.code}" class="${(S.trendCode || 'CCS') === t.code ? 'on' : ''}">${esc(t.code === 'PROTEINA' ? 'Proteína' : t.name.length > 14 ? t.code : t.name)}</button>`).join('')}</div><div class="chart"><canvas id="ctrend"></canvas></div></div>
          <div class="card"><h2>Distribuição da CCS${dist.date ? ` · ${fdate(dist.date)}` : ''}</h2>${dist.date ? `<div class="chart"><canvas id="cdist"></canvas></div>
            <p class="small muted">${dist.counts.ok} vacas normais · ${dist.counts.atencao} em atenção · ${dist.counts.alerta} em alerta${dist.last_bin_open ? ' · a última faixa inclui valores acima' : ''}</p>` : '<p class="muted">Sem dados.</p>'}</div>
        </div>
        <div class="grid two">
          <div class="card"><h2>Vacas para atenção (CCS)</h2>${alerts.items?.length ? `<div class="scroll"><table><tr><th>Brinco</th><th class="n">CCS</th><th class="n">Anterior</th><th>Situação</th></tr>${alerts.items.slice(0, 25).map((i) => `
            <tr><td><a href="#/animal/${i.id}">${esc(i.tag)}</a></td><td class="n">${nf(i.value)}</td><td class="n">${nf(i.previous)}</td>
            <td>${i.kinds.includes('alta') ? chip('alerta') : ''} ${i.kinds.includes('cronica') ? '<span class="chip atencao">Crônica</span>' : ''} ${i.kinds.includes('nova') ? '<span class="chip atencao">Nova</span>' : ''}</td></tr>`).join('')}</table></div>
            <p class="small muted">Alerta: CCS acima de ${nf(alerts.alert)} mil. Crônica: ${nf(alerts.warn)} mil ou mais em coletas seguidas. Nova: chegou a ${nf(alerts.warn)} mil ou mais agora. ${alerts.items.length > 25 ? `Mostrando 25 de ${alerts.items.length}.` : ''}</p>` : '<p class="muted">Nenhuma vaca em alerta na última coleta. 👍</p>'}</div>
          <div class="card"><h2>Ranking do rebanho</h2><div class="row" style="margin-bottom:8px"><div><select id="rc">${types.filter((t) => t.active && t.scale !== 'tank').map((t) => `<option value="${t.code}" ${(S.rankCode || 'CCS') === t.code ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
            <div><select id="ro"><option value="worst" ${(S.rankOrder || 'worst') === 'worst' ? 'selected' : ''}>Piores</option><option value="best" ${S.rankOrder === 'best' ? 'selected' : ''}>Melhores</option></select></div></div>
            ${rank.rows?.length ? `<div class="scroll"><table><tr><th>#</th><th>Brinco</th><th>Lote</th><th class="n">Valor</th><th class="n">Anterior</th></tr>${rank.rows.map((r, i) => `<tr><td>${i + 1}</td><td><a href="#/animal/${r.id}">${esc(r.tag)}</a></td><td class="small">${esc(r.lot || '')}</td><td class="n">${nf(r.value, types.find((t) => t.code === rank.code).decimals)} ${r.status_value !== 'ok' ? chip(r.status_value) : ''}</td><td class="n">${nf(r.previous, types.find((t) => t.code === rank.code).decimals)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Sem dados.</p>'}</div>
        </div>`;
      $('#lot').onchange = (e) => { lot = e.target.value; sessionStorage.setItem('lot', lot); render().catch(fail); };
      $('#rc').onchange = (e) => { S.rankCode = e.target.value; render().catch(fail); };
      $('#ro').onchange = (e) => { S.rankOrder = e.target.value; render().catch(fail); };
      const drawTrend = () => {
        const code = S.trendCode || 'CCS'; const t = types.find((x) => x.code === code);
        const months = [...new Set([...trA, ...trT].filter((r) => r.code === code).map((r) => r.month))].sort();
        const series = (arr) => months.map((m) => arr.find((r) => r.month === m && r.code === code)?.value ?? null);
        const datasets = [{ label: 'Rebanho (vacas)', data: series(trA), borderColor: css('--c1'), backgroundColor: css('--c1'), tension: .25, spanGaps: true }];
        if (trT.some((r) => r.code === code)) datasets.push({ label: 'Tanque / laticínio', data: series(trT), borderColor: css('--c2'), backgroundColor: css('--c2'), borderDash: [6, 4], tension: .25, spanGaps: true });
        chart($('#ctrend'), { type: 'line', data: { labels: months.map(monthLabel), datasets }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { title: { display: true, text: t.unit }, beginAtZero: t.geometric } } } });
      };
      drawTrend();
      $('#tt').onclick = (e) => { const c = e.target.closest('button')?.dataset.c; if (!c) return; S.trendCode = c; killCharts(); $('#tt').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === c)); drawTrend(); if (dist.date) drawDist(); };
      const drawDist = () => {
        if (!dist.date) return;
        const th = types.find((t) => t.code === 'CCS');
        chart($('#cdist'), { type: 'bar', data: { labels: dist.bins.map((b, i) => `${nf(b.from)}${i === dist.bins.length - 1 && dist.last_bin_open ? '+' : '–' + nf(b.to)}`), datasets: [{ label: 'Vacas', data: dist.bins.map((b) => b.n),
          backgroundColor: dist.bins.map((b) => (b.from >= th.alert_high ? css('--bad') : b.from >= th.warn_high ? css('--warn') : css('--c1'))) }] },
          options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'CCS (mil cél/mL)' } }, y: { title: { display: true, text: 'nº de vacas' }, ticks: { precision: 0 } } } } });
      };
      drawDist();
    };
    const fail = (e) => { $('main').insertAdjacentHTML('afterbegin', err(e)); };
    await render();
  } catch (e) { $('main').innerHTML = err(e); }
}

// ---------------- leitura de código de barras / QR ----------------
async function scanCode() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { toast('Leitura pela câmera não é suportada neste aparelho. Digite o brinco.'); return null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('Sem permissão para usar a câmera.'); return null; }
  const det = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'itf', 'codabar'] });
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = '<video playsinline muted></video><div style="color:#fff">Aponte para o código do brinco</div><button id="cx">Cancelar</button>';
  document.body.append(modal); const v = $('video', modal); v.srcObject = stream; await v.play();
  return new Promise((resolve) => {
    let done = false; const end = (val) => { done = true; stream.getTracks().forEach((t) => t.stop()); modal.remove(); resolve(val); };
    $('#cx', modal).onclick = () => end(null);
    (async function loop() { while (!done) { try { const r = await det.detect(v); if (r[0]) return end(r[0].rawValue); } catch { /* segue */ } await new Promise((r) => setTimeout(r, 250)); } })();
  });
}

// ---------------- animais ----------------
async function viewAnimais() {
  shell(`<h1>Animais</h1><div class="row"><div><label for="q" class="sr">Brinco</label><input id="q" placeholder="Digite o brinco" inputmode="search" autocomplete="off"></div>
    <button class="fit" id="scan" type="button">📷 Ler código</button>${can('lancar') ? '<button class="fit" id="new" type="button">+ Novo</button>' : ''}</div>
    <div class="card" style="margin-top:12px"><div id="list" class="list muted">Carregando…</div></div>`, 'animais');
  const load = async () => {
    try {
      const r = await api(`/api/animals?limit=60&q=${encodeURIComponent($('#q').value)}`);
      $('#list').className = 'list';
      $('#list').innerHTML = r.items.length ? r.items.map((a) => `<a class="item" href="#/animal/${a.id}"><span><b>${esc(a.tag)}</b> <span class="muted small">${esc(a.breed || '')}</span></span><span class="muted small">${esc(a.lot || '')} · ${STATUS[a.status]}</span></a>`).join('') + (r.total > r.items.length ? `<p class="small muted">Mostrando ${r.items.length} de ${r.total}. Digite mais do brinco para filtrar.</p>` : '')
        : '<p class="muted">Nenhum animal encontrado.</p>';
    } catch (e) { $('#list').innerHTML = navigator.onLine ? err(e) : '<p class="muted">Sem internet: a busca precisa de conexão.</p>'; }
  };
  let tm; $('#q').oninput = () => { clearTimeout(tm); tm = setTimeout(load, 250); };
  $('#q').onkeydown = async (e) => { if (e.key === 'Enter') { try { const a = await api(`/api/animals/by-tag/${encodeURIComponent($('#q').value.trim())}`); location.hash = `#/animal/${a.id}`; } catch { /* lista mostra */ } } };
  $('#scan').onclick = async () => { const code = await scanCode(); if (code) { $('#q').value = code; try { const a = await api(`/api/animals/by-tag/${encodeURIComponent(code)}`); location.hash = `#/animal/${a.id}`; } catch { load(); toast(`Brinco ${code} não cadastrado.`); } } };
  if ($('#new')) $('#new').onclick = () => (location.hash = '#/animal/novo');
  load();
}

function animalForm(a = {}) {
  return `<form id="f" class="card"><label>Brinco</label><input id="tag" required value="${esc(a.tag || '')}">
    <div class="row"><div><label>Raça</label><input id="breed" value="${esc(a.breed || '')}"></div><div><label>Nascimento</label><input id="bd" type="date" value="${esc(a.birth_date || '')}"></div></div>
    <div class="row"><div><label>Lote</label><input id="lot" value="${esc(a.lot || '')}"></div><div><label>Situação</label><select id="st">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(a.status || 'lactacao') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <div class="row"><div><label>Nº da lactação (LAC)</label><input id="lac" inputmode="numeric" value="${esc(a.lactation_number ?? '')}"></div><div><label>Último parto</label><input id="cd" type="date" value="${esc(a.calving_date || '')}"></div></div>
    <label>Observações</label><textarea id="nt" rows="2">${esc(a.notes || '')}</textarea><div id="e"></div><div style="margin-top:14px" class="row"><button class="primary">Salvar</button><button type="button" class="fit" onclick="history.back()">Cancelar</button></div></form>`;
}
const animalBody = () => ({ tag: $('#tag').value, breed: $('#breed').value, birth_date: $('#bd').value, lot: $('#lot').value, status: $('#st').value, notes: $('#nt').value, lactation_number: $('#lac').value, calving_date: $('#cd').value });

async function viewAnimal(id) {
  if (id === 'novo') {
    shell(`<h1>Novo animal</h1>${animalForm()}`, 'animais');
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { const a = await api('/api/animals', { method: 'POST', body: animalBody() }); toast('Animal cadastrado.'); location.hash = `#/animal/${a.id}`; } catch (e) { $('#e').innerHTML = err(e); } };
    return;
  }
  shell('<div class="muted">Carregando…</div>', 'animais');
  try {
    const { animal: a, types, analyses } = await api(`/api/animals/${id}`);
    const dates = [...new Set(analyses.map((x) => x.d))].sort();
    const val = (d, c) => analyses.find((x) => x.d === d && x.type_code === c);
    $('main').innerHTML = `<p><a href="#/animais">← Animais</a></p><h1>Brinco ${esc(a.tag)} ${a.deleted_at ? '<span class="chip alerta">Apagado</span>' : ''}</h1>
      <div class="card"><div class="grid"><div><div class="muted small">Situação</div><b>${STATUS[a.status]}</b></div><div><div class="muted small">Lote</div><b>${esc(a.lot || '—')}</b></div>
        <div><div class="muted small">Raça</div><b>${esc(a.breed || '—')}</b></div><div><div class="muted small">Nascimento</div><b>${fdate(a.birth_date)}</b></div>
        <div><div class="muted small">Lactação (LAC)</div><b>${a.lactation_number ?? '—'}</b></div><div><div class="muted small">DEL na última coleta${dates.length ? ' (' + fdate(dates[dates.length - 1]) + ')' : ''}</div><b>${a.calving_date ? Math.max(0, Math.round((new Date((dates[dates.length - 1] || today()) + 'T00:00:00Z') - new Date(a.calving_date + 'T00:00:00Z')) / 864e5)) : '—'}</b></div>
        ${a.notes ? `<p class="small">${esc(a.notes)}</p>` : ''}
        <div class="row" style="margin-top:10px">${can('lancar') ? `<a class="btn fit primary" href="#/lancar?tag=${encodeURIComponent(a.tag)}">➕ Lançar análise</a>` : ''}${can('corrigir') ? '<button class="fit" id="ed">Editar</button>' : ''}${can('apagar') ? `<button class="fit danger" id="del">${a.deleted_at ? 'Restaurar' : 'Apagar'}</button>` : ''}</div></div>
      <div id="editbox"></div>
      ${dates.length ? `<div class="grid two">${types.filter((t) => analyses.some((x) => x.type_code === t.code)).map((t) => `<div class="card"><h2>${esc(t.name)} <span class="muted small">${esc(t.unit)}</span></h2><div class="chart short"><canvas id="c_${t.code}"></canvas></div></div>`).join('')}</div>
      <div class="card"><h2>Histórico</h2><div class="scroll"><table><tr><th>Data</th>${types.map((t) => `<th class="n">${esc(t.code)}</th>`).join('')}</tr>
        ${[...dates].reverse().map((d) => `<tr><td>${fdate(d)}</td>${types.map((t) => { const v = val(d, t.code); return `<td class="n">${v ? `<span style="color:var(--${v.status === 'alerta' ? 'bad' : v.status === 'atencao' ? 'warn' : 'ink'})">${nf(v.value, t.decimals)}</span>${can('corrigir') ? ` <a href="#" class="small" data-edit="${v.id}" data-v="${v.value}" title="Corrigir">✎</a>` : ''}` : ''}</td>`; }).join('')}</tr>`).join('')}</table></div></div>` : '<div class="card muted">Sem análises registradas para este animal.</div>'}`;
    for (const t of types) {
      const el = $(`#c_${t.code}`); if (!el) continue;
      const pts = analyses.filter((x) => x.type_code === t.code);
      const line = (v, color, label) => v == null ? null : { label, data: pts.map(() => v), borderColor: color, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 };
      chart(el, { type: 'line', data: { labels: pts.map((p) => fdate(p.d).slice(0, 5) + '/' + p.d.slice(2, 4)), datasets: [
        { label: t.name, data: pts.map((p) => p.value), borderColor: css('--c1'), backgroundColor: css('--c1'), tension: .2 },
        line(t.alert_high ?? t.alert_low, css('--bad'), 'Limite alerta'), line(t.warn_high ?? t.warn_low, css('--warn'), 'Limite atenção')].filter(Boolean) },
        options: { plugins: { legend: { display: false } } } });
    }
    if ($('#ed')) $('#ed').onclick = () => {
      $('#editbox').innerHTML = animalForm(a);
      $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/api/animals/${a.id}`, { method: 'PUT', body: animalBody() }); toast('Salvo.'); viewAnimal(id); } catch (e) { $('#e').innerHTML = err(e); } };
    };
    if ($('#del')) $('#del').onclick = async () => {
      if (!a.deleted_at && !confirm(`Apagar o brinco ${a.tag}? Dá para recuperar depois.`)) return;
      try { await api(`/api/animals/${a.id}${a.deleted_at ? '/restore' : ''}`, { method: a.deleted_at ? 'POST' : 'DELETE' }); toast(a.deleted_at ? 'Restaurado.' : 'Apagado.'); viewAnimal(id); } catch (e) { toast(e.message); }
    };
    document.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = async (ev) => {
      ev.preventDefault(); const nv = prompt('Novo valor:', el.dataset.v); if (nv === null) return;
      try { await api(`/api/analyses/${el.dataset.edit}`, { method: 'PUT', body: { value: nv } }); toast('Corrigido.'); viewAnimal(id); } catch (e) { toast(e.message); }
    }));
  } catch (e) { $('main').innerHTML = err(e); }
}

// ---------------- lançar ----------------
async function viewLancar() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let types = []; try { types = (await api('/api/analysis-types')).filter((t) => t.active); localStorage.setItem(`tipos:${S.farm.slug}`, JSON.stringify(types)); } catch { types = JSON.parse(localStorage.getItem(`tipos:${S.farm.slug}`) || '[]'); }
  const last = JSON.parse(localStorage.getItem('lastType') || '"CCS"');
  const q = getQueue();
  shell(`<h1>Lançar análise</h1><form id="f" class="card">
    <div class="tabs" id="sc"><button type="button" class="on" data-s="animal">Vaca</button><button type="button" data-s="tank">Tanque / laticínio</button></div>
    <div id="tagbox"><label for="tag">Brinco</label><div class="row"><div><input id="tag" required autocomplete="off" inputmode="text" value="${esc(params.get('tag') || '')}"></div><button type="button" class="fit" id="scan">📷</button></div></div>
    <div class="row"><div><label for="d">Data</label><input id="d" type="date" required value="${today()}"></div>
      <div><label for="t">Análise</label><select id="t">${types.map((t) => `<option value="${t.code}" ${t.code === last ? 'selected' : ''}>${esc(t.name)} (${esc(t.unit)})</option>`).join('')}</select></div></div>
    <label for="v">Valor</label><input id="v" required inputmode="decimal" autocomplete="off" placeholder="Ex.: 250 ou 3,85">
    <div id="e"></div><div style="margin-top:14px"><button class="primary" style="width:100%">Salvar</button></div>
    <p class="small muted" id="hint"></p></form>
    ${q.length ? `<div class="card"><h2>Fila de envio (${q.length})</h2><p class="small muted">Lançamentos guardados neste aparelho. Sobem sozinhos quando houver internet.</p>
      <table>${q.map((i, n) => `<tr><td>${esc(i.scope === 'tank' ? 'Tanque' : i.tag)}</td><td>${fdate(i.date)}</td><td>${esc(i.type)}</td><td class="n">${esc(i.value)}</td><td>${i.error ? `<span class="chip alerta">${esc(i.error)}</span> <button class="small danger" data-rm="${n}" type="button">Descartar</button>` : '<span class="chip atencao">Aguardando</span>'}</td></tr>`).join('')}</table>
      <div style="margin-top:8px"><button class="small" id="sync" type="button">Enviar agora</button></div></div>` : ''}`, 'lancar');
  let scope = 'animal';
  $('#sc').onclick = (e) => { const s = e.target.dataset.s; if (!s) return; scope = s; $('#sc').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); $('#tagbox').style.display = s === 'tank' ? 'none' : ''; $('#tag').required = s !== 'tank'; };
  $('#scan').onclick = async () => { const c = await scanCode(); if (c) { $('#tag').value = c; $('#v').focus(); } };
  const hint = () => { const t = types.find((x) => x.code === $('#t').value); $('#hint').textContent = t ? `Unidade: ${t.unit}. Use vírgula ou ponto para decimais.` : ''; }; $('#t').onchange = hint; hint();
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const item = { client_uuid: uuid(), scope, tag: scope === 'tank' ? undefined : $('#tag').value.trim(), date: $('#d').value, type: $('#t').value, value: $('#v').value.trim() };
    localStorage.setItem('lastType', JSON.stringify(item.type));
    setQueue([...getQueue(), item]);          // sempre entra na fila primeiro: nada se perde se o sinal cair
    $('#v').value = ''; if (scope === 'animal') $('#tag').value = '';
    toast(navigator.onLine ? 'Salvo. Enviando…' : 'Salvo no aparelho. Envia quando voltar o sinal.');
    await syncQueue(); (scope === 'animal' ? $('#tag') : $('#v')).focus(); route();
  };
  if ($('#sync')) $('#sync').onclick = () => syncQueue();
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { const q2 = getQueue(); q2.splice(+b.dataset.rm, 1); setQueue(q2); viewLancar(); }));
  if (navigator.onLine && q.length) syncQueue();
}

// ---------------- importar ----------------
async function viewImportar() {
  if (!can('importar')) return (location.hash = '#/animais');
  shell(`<h1>Importar planilha</h1><form id="f" class="card">
    <p class="muted small">Envie o relatório do controle leiteiro oficial (APCBRH: <b>Relatório 2</b> e <b>Relatório 2.2</b> são reconhecidos automaticamente, com o tanque) ou uma planilha sua em Excel (.xlsx) ou CSV com colunas como Brinco, Data, CCS, Gordura, Proteína e CBT. Enviar o mesmo arquivo de novo não duplica nada.</p>
    <label>Se for uma planilha comum, o que ela contém?</label><select id="sc"><option value="animal">Análises por vaca (controle leiteiro)</option><option value="tank">Mapa do leite (tanque / laticínio)</option></select>
    <label>Arquivo</label><input id="file" type="file" accept=".xlsx,.csv,.txt" required>
    <label>Data padrão (só se a planilha não tiver coluna de data)</label><input id="dd" type="date">
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)" id="cml"><input id="cm" type="checkbox" checked style="width:auto;min-height:0"> Cadastrar automaticamente os brincos que ainda não existem</label>
    <div id="e"></div><div style="margin-top:14px"><button class="primary">Ver prévia</button></div></form><div id="prev"></div>
    <div class="card"><h2>Importações anteriores</h2><div id="hist" class="scroll muted">Carregando…</div></div>`, 'importar');
  $('#sc').onchange = () => { $('#cml').style.display = $('#sc').value === 'tank' ? 'none' : 'flex'; };
  const send = (commit) => { const fd = new FormData(); fd.append('scope', $('#sc').value); fd.append('commit', commit ? '1' : '0'); fd.append('create_missing', $('#cm').checked ? '1' : '0'); if ($('#dd').value) fd.append('default_date', $('#dd').value); fd.append('file', $('#file').files[0]); return api('/api/import', { method: 'POST', form: fd }); };
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); $('#e').innerHTML = ''; const btn = $('#f button'); btn.disabled = true;
    try {
      const p = await send(false);
      const cols = Array.isArray(p.columns) ? `<p class="small">Colunas reconhecidas: ${p.columns.map((c) => `${esc(c.header)} → <b>${c.code}</b>`).join(' · ')}</p>` : '';
      const types = p.by_type ? Object.entries(p.by_type).map(([k, v]) => `${esc(k)}: ${nf(v)}`).join(' · ') : '';
      $('#prev').innerHTML = `<div class="card"><h2>Prévia — nada foi gravado ainda</h2>
        <p><b>${esc(p.format)}</b></p>
        ${p.problems.length ? p.problems.map((x) => `<div class="msg err">${esc(x)}</div>`).join('') : ''}
        ${(p.warnings || []).map((x) => `<div class="msg info">${esc(x)}</div>`).join('')}
        ${(p.notes || []).map((x) => `<div class="msg okm">${esc(x)}</div>`).join('')}
        <p>${nf(p.rows_read)} ${p.controls ? 'vacas' : 'linhas'} lidas · <b>${nf(p.records)}</b> valores válidos${p.controls ? ` em ${p.controls} controle(s)` : ''}${p.date_from ? ` · datas de ${fdate(p.date_from)} a ${fdate(p.date_to)}` : ''}</p>
        ${types ? `<p class="small muted">${types}</p>` : ''}${cols}
        ${p.animals_total ? `<p class="small">${nf(p.animals_total)} brincos no arquivo · <b>${nf(p.animals_missing)}</b> ainda não cadastrados${p.missing_sample.length ? ` (ex.: ${p.missing_sample.map(esc).join(', ')})` : ''}</p>` : ''}
        ${p.errors_total ? `<div class="msg info"><b>${p.errors_total}</b> linhas com problema serão ignoradas:<br>${p.errors.slice(0, 8).map((x) => `Linha ${x.line}: ${esc(x.error)}`).join('<br>')}${p.errors_total > 8 ? '<br>…' : ''}</div>` : ''}
        ${!p.problems.length && p.records ? '<button class="primary" id="go">Confirmar importação</button>' : ''}</div>`;
      if ($('#go')) $('#go').onclick = async () => {
        $('#go').disabled = true;
        try { const r = await send(true); $('#prev').innerHTML = `<div class="msg okm">Importado: <b>${r.inserted}</b> valores novos, <b>${r.updated}</b> atualizados${r.animals_created ? `, <b>${r.animals_created}</b> animais cadastrados` : ''}.</div>`; $('#f').reset(); loadHist(); }
        catch (e) { $('#prev').innerHTML = err(e); }
      };
    } catch (e) { $('#e').innerHTML = err(e); } finally { btn.disabled = false; }
  };
  const loadHist = async () => {
    try {
      const b = await api('/api/import/batches');
      $('#hist').className = 'scroll';
      $('#hist').innerHTML = b.length ? `<table><tr><th>Data</th><th>Arquivo</th><th class="n">Valores</th><th></th></tr>${b.map((x) => `<tr><td class="small">${new Date(x.created_at).toLocaleString('pt-BR')}</td><td>${esc(x.filename)}<div class="small muted">${esc(x.user_name || '')}</div></td><td class="n">${x.rows_ok}</td>
        <td>${x.undone_at ? '<span class="chip atencao">Desfeita</span>' : can('apagar') ? `<button class="small danger" data-undo="${x.id}">Desfazer</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhuma ainda.</p>';
      document.querySelectorAll('[data-undo]').forEach((el) => (el.onclick = async () => { if (!confirm('Desfazer esta importação? Os valores dela saem do sistema.')) return; try { const r = await api(`/api/import/batches/${el.dataset.undo}/undo`, { method: 'POST' }); toast(`${r.removed} valores removidos.`); loadHist(); } catch (e) { toast(e.message); } }));
    } catch (e) { $('#hist').innerHTML = err(e); }
  };
  loadHist();
}

// ---------------- mais / configurações ----------------
function viewMais() {
  shell(`<h1>Mais</h1><div class="card list">
    <div class="item"><span><b>${esc(S.user.name)}</b><br><span class="muted small">${esc(S.user.email)} · ${ROLE[S.user.role]}</span></span></div>
    <a class="item" href="#/senha"><span>Trocar senha / PIN</span><span>›</span></a>
    ${can('relatorios') ? '<a class="item" href="#/controle"><span>Controle leiteiro (por vaca)</span><span>›</span></a><a class="item" href="#/tanque"><span>Tanque / laticínio</span><span>›</span></a>' : ''}
    ${can('config') ? '<a class="item" href="#/config"><span>Tipos de análise e limites de alerta</span><span>›</span></a>' : ''}
    ${can('usuarios') ? '<a class="item" href="#/usuarios"><span>Usuários da fazenda</span><span>›</span></a>' : ''}
    ${can('auditoria') ? '<a class="item" href="#/auditoria"><span>Registro de alterações</span><span>›</span></a>' : ''}
    ${can('exportar') ? '<a class="item" href="#" id="exp"><span>Exportar todos os dados (planilha)</span><span>⬇</span></a>' : ''}
    <a class="item" href="#" id="out"><span>Sair</span><span></span></a></div>`, 'mais');
  $('#out').onclick = (e) => { e.preventDefault(); logout(); };
  if ($('#exp')) $('#exp').onclick = (e) => { e.preventDefault(); exportAll(); };
}

async function viewConfig() {
  if (!can('config')) return (location.hash = '#/mais');
  shell('<p><a href="#/mais">← Mais</a></p><h1>Tipos de análise e limites</h1><div class="muted">Carregando…</div>', 'mais');
  try {
    const types = await api('/api/analysis-types');
    const fld = (t, k, w = 70) => `<input data-t="${t.code}" data-k="${k}" inputmode="decimal" value="${t[k] ?? ''}" style="width:${w}px;min-height:36px;padding:4px 6px">`;
    $('main').innerHTML = `<p><a href="#/mais">← Mais</a></p><h1>Tipos de análise e limites</h1>
      <div class="card"><p class="small muted">Os limites definem as cores e os alertas. <b>Atenção</b> e <b>alerta</b> valem por vaca; as colunas "tanque" valem para o mapa do leite do laticínio. Os valores iniciais são sugestões: ajuste conforme a realidade da fazenda e a legislação vigente do laticínio.</p>
      <div class="scroll"><table><tr><th>Análise</th><th>Atenção ↑</th><th>Alerta ↑</th><th>Atenção ↓</th><th>Alerta ↓</th><th>Tanque atenção ↑</th><th>Tanque alerta ↑</th><th>Tanque atenção ↓</th><th>Tanque alerta ↓</th><th>Ativa</th></tr>
      ${types.map((t) => `<tr><td><b>${esc(t.code)}</b><div class="small muted">${esc(t.name)} · ${esc(t.unit)}</div></td>${['warn_high', 'alert_high', 'warn_low', 'alert_low', 'tank_warn_high', 'tank_alert_high', 'tank_warn_low', 'tank_alert_low'].map((k) => `<td>${fld(t, k)}</td>`).join('')}<td><input type="checkbox" data-t="${t.code}" data-k="active" ${t.active ? 'checked' : ''} style="width:auto;min-height:0"></td></tr>`).join('')}</table></div>
      <div style="margin-top:10px"><button class="primary" id="save">Salvar limites</button></div></div>
      <form id="nf" class="card"><h2>Nova análise</h2><p class="small muted">Ex.: Ureia (N ureico), Lactose, Sólidos totais. Não precisa mexer no código.</p>
        <div class="row"><div><label>Código</label><input id="nc" required maxlength="20" placeholder="UREIA"></div><div><label>Nome</label><input id="nn" required></div><div><label>Unidade</label><input id="nu" placeholder="mg/dL"></div><div><label>Casas decimais</label><input id="nd" inputmode="numeric" value="2"></div></div>
        <label>Nomes alternativos nas planilhas (separados por vírgula)</label><input id="na" placeholder="nu, n ureico">
        <label>Vale para</label><select id="ns"><option value="animal">Vaca</option><option value="tank">Tanque</option><option value="both" selected>Vaca e tanque</option></select><div id="e"></div><div style="margin-top:12px"><button class="primary">Adicionar</button></div></form>`;
    $('#save').onclick = async () => {
      const changes = {};
      document.querySelectorAll('[data-t]').forEach((el) => { const c = (changes[el.dataset.t] ||= {}); c[el.dataset.k] = el.type === 'checkbox' ? el.checked : (el.value.trim() === '' ? null : Number(el.value.replace(',', '.'))); });
      try { for (const [code, body] of Object.entries(changes)) await api(`/api/analysis-types/${code}`, { method: 'PUT', body }); toast('Limites salvos.'); } catch (e) { toast(e.message); }
    };
    $('#nf').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/analysis-types', { method: 'POST', body: { code: $('#nc').value, name: $('#nn').value, unit: $('#nu').value, decimals: +$('#nd').value, scale: $('#ns').value, aliases: $('#na').value.split(',').map((x) => x.trim()).filter(Boolean) } }); toast('Análise adicionada.'); viewConfig(); } catch (e) { $('#e').innerHTML = err(e); } };
  } catch (e) { $('main').innerHTML = err(e); }
}

async function viewUsuarios() {
  if (!can('usuarios')) return (location.hash = '#/mais');
  shell('<div class="muted">Carregando…</div>', 'mais');
  try {
    const users = await api('/api/users');
    $('main').innerHTML = `<p><a href="#/mais">← Mais</a></p><h1>Usuários</h1><div class="card"><div class="scroll"><table><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th></th></tr>
      ${users.map((u) => `<tr><td>${esc(u.name)}<div class="small muted">${esc(u.email)}</div></td><td>${ROLE[u.role]}</td><td>${u.active ? '<span class="chip ok">Ativo</span>' : '<span class="chip alerta">Bloqueado</span>'}</td>
        <td>${u.id === S.user.id ? '' : `<button class="small" data-act="${u.id}" data-to="${!u.active}">${u.active ? 'Desativar' : 'Ativar'}</button> <button class="small" data-rst="${u.id}">Nova senha</button>`}</td></tr>`).join('')}</table></div></div>
      <form id="f" class="card"><h2>Novo usuário</h2><div class="row"><div><label>Nome</label><input id="n" required></div><div><label>E-mail</label><input id="m" type="email" required></div>
        <div><label>Perfil</label><select id="r">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === 'funcionario' ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><div id="e"></div><div style="margin-top:12px"><button class="primary">Criar</button></div><div id="pw"></div></form>`;
    document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => { try { await api(`/api/users/${b.dataset.act}`, { method: 'PUT', body: { active: b.dataset.to === 'true' } }); viewUsuarios(); } catch (e) { toast(e.message); } }));
    document.querySelectorAll('[data-rst]').forEach((b) => (b.onclick = async () => { if (!confirm('Gerar nova senha temporária? A pessoa será desconectada.')) return; try { const r = await api(`/api/users/${b.dataset.rst}/reset-password`, { method: 'POST' }); alert(`Senha temporária: ${r.temporary_password}\n\nAnote e entregue à pessoa. Ela não aparece de novo.`); } catch (e) { toast(e.message); } }));
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { const r = await api('/api/users', { method: 'POST', body: { name: $('#n').value, email: $('#m').value, role: $('#r').value } }); $('#pw').innerHTML = `<div class="msg okm">Usuário criado. Senha temporária: <b>${esc(r.temporary_password)}</b><br>Anote e entregue à pessoa — ela não aparece de novo e será trocada no primeiro acesso.</div>`; $('#f').querySelectorAll('input').forEach((i) => (i.value = '')); } catch (e) { $('#e').innerHTML = err(e); } };
  } catch (e) { $('main').innerHTML = err(e); }
}

async function viewAuditoria() {
  if (!can('auditoria')) return (location.hash = '#/mais');
  shell('<div class="muted">Carregando…</div>', 'mais');
  try {
    const rows = await api('/api/audit?limit=200');
    $('main').innerHTML = `<p><a href="#/mais">← Mais</a></p><h1>Registro de alterações</h1><div class="card scroll"><table><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhes</th></tr>
      ${rows.map((r) => `<tr><td class="small">${new Date(r.at).toLocaleString('pt-BR')}</td><td>${esc(r.user_name || '—')}</td><td>${esc(r.action)} ${esc(r.entity)} ${esc(r.entity_id || '')}</td><td class="small muted">${esc(r.changes ? JSON.stringify(r.changes).slice(0, 140) : '')}</td></tr>`).join('')}</table></div>`;
  } catch (e) { $('main').innerHTML = err(e); }
}


// ---------------- controle leiteiro (por vaca) ----------------
const QSTATUS = { sadia: ['ok', 'Sadia'], curada: ['ok', 'Curada'], nova: ['atencao', 'Nova infecção'], cronica: ['alerta', 'Crônica'], acima: ['atencao', 'Acima da meta'], sem_historico: ['', 'Sem histórico'] };
const GROUPS = [['todas', 'Todas'], ['lactantes', 'Lactantes'], ['paridas', 'Paridas'], ['primiparas', 'Primíparas'], ['novilhas', 'Novilhas']];
const STATUSES = [['todas', 'Todas'], ['sadias', 'Sadias'], ['curadas', 'Curadas'], ['nova', 'Nova infecção'], ['cronicas', 'Crônicas'], ['acima200', 'Acima da meta']];
async function viewControle() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Relatório de controle leiteiro</h1><div class="muted">Carregando…</div>', 'controle');
  S.ctl ||= { group: 'todas', status: 'todas' };
  const draw = async () => {
    try {
      const r = await api(`/api/reports/milk-control?group=${S.ctl.group}&status=${S.ctl.status}${sessionStorage.getItem('lot') ? '&lot=' + encodeURIComponent(sessionStorage.getItem('lot')) : ''}`);
      const k = r.kpis; const mlabel = (m) => `${m.slice(5)}/${m.slice(2, 4)}`;
      const kpi = (l, v, note) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v ?? '—'}</div>${note ? `<div class="d muted">${note}</div>` : ''}</div>`;
      $('main').innerHTML = `<h1>Relatório de controle leiteiro</h1>
        ${!r.latest ? '<div class="msg info">Ainda não há análises de CCS. Importe a planilha do controle leiteiro.</div>' : `
        <div class="grid" style="margin-bottom:14px">${kpi('Quantidade', k.quantity)}${kpi('% do rebanho', k.pct_herd == null ? null : nf(k.pct_herd, 1) + '%')}${kpi('% impacto no tanque', k.tank_impact == null ? null : nf(k.tank_impact, 1) + '%')}
          ${kpi('Média de leite', k.avg_milk == null ? null : nf(k.avg_milk, 1) + ' kg')}${kpi('Média DEL', k.avg_del)}${kpi(`DEL &lt; 45 e CCS ≥ ${nf(r.goal)}`, k.early_high)}</div>
        <div class="card"><h2>Filtros</h2><div class="muted small">Grupo</div><div class="tabs" id="g">${GROUPS.map(([v, l]) => `<button data-v="${v}" class="${S.ctl.group === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="muted small">Situação de qualidade do leite</div><div class="tabs" id="s">${STATUSES.map(([v, l]) => `<button data-v="${v}" class="${S.ctl.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <p class="small muted">Meta de CCS: sadia = abaixo de ${nf(r.goal)} mil cél/mL · coleta mais recente: ${fdate(r.latest)}. Situação pelas duas últimas coletas (nova infecção, crônica e curada: regras provisórias). Grupos: lactantes = testadas na coleta mais recente; paridas = LAC 2 ou mais; primíparas = LAC 1.</p></div>
        <div class="card"><h2>Vacas (${r.rows.length})</h2><div class="scroll"><table><tr><th>Brinco</th><th>LAC</th><th>DEL</th>${r.months.map((m) => `<th class="n">${mlabel(m)}</th>`).join('')}<th>Situação</th><th class="n">CCS 12 m</th><th class="n">Produção</th><th class="n">Impacto tanque</th></tr>
          ${r.rows.slice(0, 500).map((x) => { const [c, l] = QSTATUS[x.status] || ['', '—']; return `<tr><td><a href="#/animal/${x.id}">${esc(x.tag)}</a>${x.stale ? `<div class="small muted">${x.hint === 'pulou' ? 'pulou o último controle' : x.hint === 'seca' ? `sem teste há ${x.missed} controles: possível secagem` : `sem teste há ${x.missed} controles: saiu do rebanho?`}</div>` : ''}</td><td>${x.lac ?? '—'}</td><td>${x.del ?? '—'}</td>${x.months.map((v) => `<td class="n" style="${v != null && v > r.goal ? 'color:var(--bad);font-weight:600' : ''}">${v == null ? '' : nf(v)}</td>`).join('')}<td>${c ? `<span class="chip ${c}">${l}</span>` : `<span class="muted small">${l}</span>`}</td><td class="n">${nf(x.ccs12)}</td><td class="n">${x.milk == null ? '—' : nf(x.milk, 1) + ' kg'}</td><td class="n">${x.impact == null ? '—' : nf(x.impact, 2) + '%'}</td></tr>`; }).join('')}</table></div>
          ${r.rows.length > 500 ? '<p class="small muted">Mostrando as primeiras 500.</p>' : ''}${r.rows.length ? '' : '<p class="muted">Nenhuma vaca neste filtro.</p>'}</div>`}`;
      if (!r.latest) return;
      $('#g').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.ctl.group = v; draw(); } };
      $('#s').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.ctl.status = v; draw(); } };
    } catch (e) { $('main').innerHTML = err(e); }
  };
  draw();
}

// ---------------- tanque / laticínio ----------------
async function viewTanque() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Resultado de análises do tanque</h1><div class="muted">Carregando…</div>', 'tanque');
  try {
    const [rows, all] = await Promise.all([api('/api/tank'), api('/api/analysis-types')]);
    const types = all.filter((t) => t.active && t.scale !== 'animal');
    $('main').innerHTML = `<h1>Resultado de análises do tanque</h1>
      <div class="card"><h2>Novo resultado</h2><form id="f"><div class="row"><div><label>Data</label><input id="d" type="date" required value="${today()}"></div></div>
        <div class="grid">${types.map((t) => `<div><label for="t_${t.code}">${esc(t.code === 'CBT' ? 'CBT / CPP' : t.name)} <span class="muted small">${esc(t.unit)}</span></label><input id="t_${t.code}" data-code="${t.code}" inputmode="decimal" autocomplete="off"></div>`).join('')}</div>
        <div id="e"></div><div style="margin-top:14px"><button class="primary">Salvar resultado</button></div></form></div>
      <div class="card"><h2>Resultados (${rows.length})</h2>${rows.length ? `<div class="scroll"><table><tr><th>Data</th>${types.map((t) => `<th class="n">${esc(shortName(t))}</th>`).join('')}${can('apagar') ? '<th></th>' : ''}</tr>
        ${rows.map((r) => `<tr><td>${fdate(r.date)}</td>${types.map((t) => { const v = r.values[t.code]; const st = v == null ? 'ok' : statusClient(t, v); return `<td class="n" style="${st === 'alerta' ? 'color:var(--bad);font-weight:600' : st === 'atencao' ? 'color:var(--warn);font-weight:600' : ''}">${v == null ? '' : nf(v, t.decimals)}</td>`; }).join('')}${can('apagar') ? `<td><button class="small danger" data-del="${r.date}">Apagar</button></td>` : ''}</tr>`).join('')}</table></div>` : '<p class="muted">Nenhum resultado ainda. Preencha acima ou importe o mapa do leite em <a href="#/importar">Importar</a>.</p>'}</div>`;
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const items = [...document.querySelectorAll('[data-code]')].filter((i) => i.value.trim()).map((i) => ({ client_uuid: uuid(), scope: 'tank', date: $('#d').value, type: i.dataset.code, value: i.value.trim() }));
      if (!items.length) { $('#e').innerHTML = err('Preencha ao menos um valor.'); return; }
      setQueue([...getQueue(), ...items]); toast(navigator.onLine ? 'Salvo. Enviando…' : 'Salvo no aparelho. Envia quando voltar o sinal.');
      await syncQueue(); viewTanque();
    };
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm(`Apagar o resultado de ${fdate(b.dataset.del)}?`)) return; try { await api(`/api/tank/${b.dataset.del}`, { method: 'DELETE' }); viewTanque(); } catch (e) { toast(e.message); } }));
  } catch (e) { $('main').innerHTML = err(e); }
}
const SHORT = { CBT: 'CBT/CPP', SOLIDOS_TOTAIS: 'Sól. totais', PRODUCAO_TOTAL: 'Produção (L)', UREIA: 'Uréia', PROTEINA: 'Proteína' };
const shortName = (t) => SHORT[t.code] || (t.code.length <= 8 ? t.code : t.name);
const statusClient = (t, v) => {
  const hi = (t.tank_alert_high != null && v > t.tank_alert_high) || (t.tank_alert_low != null && v < t.tank_alert_low);
  const wa = (t.tank_warn_high != null && v > t.tank_warn_high) || (t.tank_warn_low != null && v < t.tank_warn_low);
  return hi ? 'alerta' : wa ? 'atencao' : 'ok';
};

// ---------------- rotas ----------------
function route() {
  killCharts();
  if (!S.user) return viewLogin();
  const [path] = location.hash.slice(2).split('?'); const [page, arg] = path.split('/');
  if (S.user.must_change_password && page !== 'senha') return viewPassword(true);
  const views = { painel: viewPainel, animais: viewAnimais, animal: () => viewAnimal(arg), lancar: viewLancar, importar: viewImportar, controle: viewControle, tanque: viewTanque, mais: viewMais, senha: () => viewPassword(false), config: viewConfig, usuarios: viewUsuarios, auditoria: viewAuditoria };
  (views[page] || (can('relatorios') ? viewPainel : viewAnimais))();
}
addEventListener('hashchange', route);

(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.farm = await api('/api/farm'); localStorage.setItem('farm', JSON.stringify(S.farm)); }
  catch { S.farm = JSON.parse(localStorage.getItem('farm') || 'null') || { name: 'Gestão do Rebanho', slug: 'x' }; }
  document.title = S.farm.name;
  if (S.token) { try { S.user = await api('/api/me'); } catch { if (navigator.onLine === false) S.user = JSON.parse(localStorage.getItem('user') || 'null'); } }
  if (S.user) localStorage.setItem('user', JSON.stringify(S.user));
  route(); syncQueue();
})();
