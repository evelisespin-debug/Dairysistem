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
  if (can('relatorios')) items.push(['painel', '📊', 'Painel'], ['gestao', '📈', 'Gestão']);
  items.push(['animais', '🐄', 'Animais'], ['lancar', '➕', 'Lançar']);
  if (can('importar')) items.push(['importar', '📥', 'Importar']);
  const reports = can('relatorios') ? [['anual', 'Painel anual'], ['controle', 'Controle leiteiro'], ['tanque', 'Tanque / laticínio'], ['genetica', 'Genética']] : [];
  const more = [];
  if (can('config')) more.push(['config', 'Tipos de análise e limites'], ['metas', 'Metas da fazenda']);
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
          <div class="kpi ${c.status_herd}"><div class="l">${esc(c.name)}</div>
            <div class="v">${nf(c.value, c.decimals)} <span class="u">${esc(c.unit)}</span></div>${delta(c)}
            <div class="d muted">${c.n} vacas · controle de ${fdate(c.date)}${c.basis ? ` · ${c.basis}` : ''}</div>
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
      <div id="editbox"></div><div id="gen"></div>
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
    api(`/api/animals/${a.id}/genomics`).then((g) => {
      const tr = Object.entries(g.traits || {}).map(([k, v]) => `<div><div class="muted small">${esc(k)}</div><b>${typeof v === 'number' ? nf(v, Math.abs(v) < 10 ? 2 : 0) : esc(v)}</b></div>`).join('');
      $('#gen').innerHTML = `<div class="card"><h2>Genômica</h2><div class="grid"><div><div class="muted small">TPI</div><b>${nf(g.tpi)}</b></div><div><div class="muted small">NM$</div><b>${nf(g.nm)}</b></div><div><div class="muted small">Leite</div><b>${nf(g.milk)}</b></div><div><div class="muted small">DPR</div><b>${nf(g.dpr, 2)}</b></div>
        <div><div class="muted small">Pai</div><b>${esc(g.sire_name || '—')}</b></div><div><div class="muted small">Beta / Kappa-caseína</div><b>${esc(g.beta_casein || '—')} · ${esc(g.kappa_casein || '—')}</b></div>
        <div><div class="muted small">Haplótipos</div><b>${g.haplotypes.length ? esc(g.haplotypes.join(', ')) : 'livre'}</b></div></div>
        <details><summary class="small">Todos os índices</summary><div class="grid">${tr}</div></details></div>`;
    }).catch(() => {});
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
    <label>Se for uma planilha comum, o que ela contém?</label><select id="sc"><option value="animal">Análises por vaca (controle leiteiro)</option><option value="tank">Mapa do leite (tanque / laticínio)</option><option value="genomics">Resultado genômico (TPI, pais, haplótipos…)</option></select>
    <label>Arquivo</label><input id="file" type="file" accept=".xlsx,.csv,.txt" required>
    <label>Data padrão (só se a planilha não tiver coluna de data)</label><input id="dd" type="date">
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)" id="cml"><input id="cm" type="checkbox" checked style="width:auto;min-height:0"> Cadastrar automaticamente os brincos que ainda não existem</label>
    <div id="e"></div><div style="margin-top:14px"><button class="primary">Ver prévia</button></div></form><div id="prev"></div>
    <div class="card"><h2>Importações anteriores</h2><div id="hist" class="scroll muted">Carregando…</div></div>`, 'importar');
  $('#sc').onchange = () => { $('#cml').style.display = $('#sc').value === 'tank' ? 'none' : 'flex'; };
  const sendGen = (commit) => { const fd = new FormData(); fd.append('commit', commit ? '1' : '0'); fd.append('create_missing', $('#cm').checked ? '1' : '0'); fd.append('file', $('#file').files[0]); return api('/api/import/genomics', { method: 'POST', form: fd }); };
  const genFlow = async () => {
    const p = await sendGen(false);
    $('#prev').innerHTML = `<div class="card"><h2>Prévia — nada foi gravado ainda</h2><p><b>Resultado genômico</b></p>
      <p>${nf(p.animals)} animais no arquivo · <b>${nf(p.animals_missing)}</b> ainda não cadastrados${p.missing_sample.length ? ` (ex.: ${p.missing_sample.map(esc).join(', ')})` : ''} · ${nf(p.haplotype_carriers)} portador(es) de haplótipo</p>
      ${p.errors_total ? `<div class="msg info"><b>${p.errors_total}</b> linhas sem ID serão ignoradas.</div>` : ''}
      <button class="primary" id="go">Confirmar importação</button></div>`;
    $('#go').onclick = async () => {
      $('#go').disabled = true;
      try { const r = await sendGen(true); $('#prev').innerHTML = `<div class="msg okm">Importado: <b>${r.matched}</b> animais atualizados${r.created ? `, <b>${r.created}</b> cadastrados` : ''}${r.skipped ? `, ${r.skipped} ignorados (brinco não cadastrado)` : ''}. <a href="#/genetica">Ver painel de genética</a></div>`; $('#f').reset(); }
      catch (e) { $('#prev').innerHTML = err(e); }
    };
  };
  const send = (commit) => { const fd = new FormData(); fd.append('scope', $('#sc').value); fd.append('commit', commit ? '1' : '0'); fd.append('create_missing', $('#cm').checked ? '1' : '0'); if ($('#dd').value) fd.append('default_date', $('#dd').value); fd.append('file', $('#file').files[0]); return api('/api/import', { method: 'POST', form: fd }); };
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); $('#e').innerHTML = ''; const btn = $('#f button'); btn.disabled = true;
    try {
      if ($('#sc').value === 'genomics') { await genFlow(); return; }
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

// ---------------- genética ----------------
async function viewGenetica() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Genética do rebanho</h1><p class="muted">Carregando…</p>', 'genetica');
  let g; try { g = await api('/api/dashboard/genetics'); } catch (e) { return shell(`<h1>Genética do rebanho</h1>${err(e)}`, 'genetica'); }
  if (!g.total) return shell('<h1>Genética do rebanho</h1><div class="card"><p>Nenhum resultado genômico ainda. Envie o arquivo em <a href="#/importar">Importar</a> → Resultado genômico.</p></div>', 'genetica');
  const dist = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: <b>${nf(v)}</b> (${nf(v / g.total * 100, 0)}%)`).join(' · ');
  shell(`<div class="gray"><h1>Genética do rebanho</h1>
    <div class="card"><p><b>${nf(g.total)}</b> animais genotipados · TPI médio <b>${nf(g.tpi_avg)}</b> · Leite (PTA) <b>${nf(g.milk_avg)}</b> · DPR <b>${nf(g.dpr_avg, 2)}</b></p></div>
    <div class="card"><h2>Evolução por ano de nascimento</h2><div style="height:240px"><canvas id="cy"></canvas></div>
      <div class="scroll"><table><tr><th>Ano</th><th class="n">Animais</th><th class="n">TPI</th><th class="n">Leite</th><th class="n">%Gor</th><th class="n">DPR</th></tr>${g.by_year.map((y) => `<tr><td>${y.year}</td><td class="n">${y.n}</td><td class="n">${nf(y.tpi)}</td><td class="n">${nf(y.milk)}</td><td class="n">${nf(y.fat_pct, 3)}</td><td class="n">${nf(y.dpr, 2)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>Haplótipos e caseínas</h2>
      ${g.haplotypes.length ? g.haplotypes.map((h) => `<p><b>${esc(h.code)}</b>: ${h.n} portador(es) <span class="small muted">(ex.: ${h.sample.map(esc).join(', ')})</span></p>`).join('') : '<p class="muted">Nenhum portador.</p>'}
      <p class="small">Beta-caseína: ${dist(g.beta_casein)}</p><p class="small">Kappa-caseína: ${dist(g.kappa_casein)}</p></div>
    <div class="card"><h2>Conferência de paternidade</h2>
      <p>${g.sire_mismatch ? `<b>${g.sire_mismatch}</b> animal(is) com touro diferente do informado` : 'Nenhuma divergência de touro.'}${g.sire_not_found ? ` · ${g.sire_not_found} sem touro identificado` : ''}</p>
      ${g.sire_mismatch_list.length ? `<div class="scroll"><table><tr><th>Animal</th><th>Informado</th><th>Correto</th></tr>${g.sire_mismatch_list.map((m) => `<tr><td><a href="#/animal/${m.id}">${esc(m.tag)}</a></td><td>${esc(m.sent)}</td><td>${esc(m.correct)}</td></tr>`).join('')}</table></div>` : ''}</div>
    <div class="card"><h2>Pais mais usados</h2><div class="scroll"><table><tr><th>Touro</th><th class="n">Filhas</th><th class="n">TPI médio</th><th class="n">Leite</th><th class="n">DPR</th></tr>${g.sires.map((s) => `<tr><td>${esc(s.sire)}</td><td class="n">${s.n}</td><td class="n">${nf(s.tpi)}</td><td class="n">${nf(s.milk)}</td><td class="n">${nf(s.dpr, 2)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>Melhores animais (TPI)</h2><div class="scroll"><table><tr><th>Animal</th><th>Pai</th><th class="n">TPI</th><th class="n">Leite</th><th class="n">DPR</th></tr>${g.top.map((a) => `<tr><td><a href="#/animal/${a.id}">${esc(a.tag)}</a></td><td>${esc(a.sire || '—')}</td><td class="n">${nf(a.tpi)}</td><td class="n">${nf(a.milk)}</td><td class="n">${nf(a.dpr, 2)}</td></tr>`).join('')}</table></div></div></div>`, 'genetica');
  chart($('#cy'), { type: 'line', data: { labels: g.by_year.map((y) => y.year), datasets: [{ label: 'TPI médio', data: g.by_year.map((y) => y.tpi), borderColor: '#555', backgroundColor: '#888', tension: .2 }] }, options: { plugins: { legend: { display: false } } } });
}

// ---------------- mais / configurações ----------------
function viewMais() {
  shell(`<h1>Mais</h1><div class="card list">
    <div class="item"><span><b>${esc(S.user.name)}</b><br><span class="muted small">${esc(S.user.email)} · ${ROLE[S.user.role]}</span></span></div>
    <a class="item" href="#/senha"><span>Trocar senha / PIN</span><span>›</span></a>
    ${can('relatorios') ? '<a class="item" href="#/anual"><span>Painel de gestão anual</span><span>›</span></a><a class="item" href="#/controle"><span>Controle leiteiro (por vaca)</span><span>›</span></a><a class="item" href="#/tanque"><span>Tanque / laticínio</span><span>›</span></a><a class="item" href="#/genetica"><span>Genética do rebanho</span><span>›</span></a>' : ''}
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


// ---------------- metas ----------------
const TARGET_FIELDS = [['pct_healthy', '% de vacas com CCS abaixo da meta (sadias)', '%'], ['pct_high', '% de vacas com CCS alta (prevalência)', '%'], ['high_early', '% com CCS alta até 45 dias em lactação', '%'],
  ['high_late', '% com CCS alta após 45 dias em lactação', '%'], ['incidence', 'Incidência de novos casos', '%'], ['chronic', 'Vacas crônicas', '%'], ['cured', 'Vacas curadas', '%'],
  ['clinical_mastitis', 'Mastite clínica', '%'], ['tank_ccs', 'CCS do tanque (objetivo)', 'mil cél/mL'], ['tank_cbt', 'CPP / CBT do tanque (objetivo)', 'mil UFC/mL']];
async function viewMetas() {
  if (!can('config')) return (location.hash = '#/mais');
  shell('<div class="muted">Carregando…</div>', 'mais');
  try {
    const T = await api('/api/targets');
    $('main').innerHTML = `<p><a href="#/mais">← Mais</a></p><h1>Metas da fazenda</h1><form id="f" class="card"><p class="small muted">As metas aparecem nos indicadores (verde quando a meta é cumprida) e como linha verde nos gráficos. Os valores iniciais são os do sistema DairyUp em uso; ajuste para a realidade da fazenda.</p>
      <div class="grid">${TARGET_FIELDS.map(([k, l, u]) => `<div><label for="t_${k}">${esc(l)} <span class="muted small">${esc(u)}</span></label><input id="t_${k}" data-k="${k}" inputmode="decimal" value="${T[k] ?? ''}"></div>`).join('')}</div>
      <div id="e"></div><div style="margin-top:14px"><button class="primary">Salvar metas</button></div></form>`;
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); const body = {}; document.querySelectorAll('[data-k]').forEach((i) => (body[i.dataset.k] = i.value.trim().replace(',', '.'))); try { await api('/api/targets', { method: 'PUT', body }); toast('Metas salvas.'); } catch (e) { $('#e').innerHTML = err(e); } };
  } catch (e) { $('main').innerHTML = err(e); }
}

// ---------------- painel anual (mês a mês, com metas) ----------------
async function viewAnual() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Painel de gestão anual</h1><div class="muted">Carregando…</div>', 'anual');
  try {
    S.anual ||= {};
    const probe = await api('/api/dashboard/management?controls=3');
    if (probe.empty) { $('main').innerHTML = '<h1>Painel de gestão anual</h1><div class="msg info">Ainda não há controles enviados.</div>'; return; }
    const years = []; for (let y = +probe.available_from.slice(0, 4); y <= +probe.available_to.slice(0, 4); y++) years.push(y);
    const year = S.anual.year && years.includes(S.anual.year) ? S.anual.year : +probe.available_to.slice(0, 4);
    const lot = sessionStorage.getItem('lot') || '';
    const [m, tank] = await Promise.all([api(`/api/dashboard/management?group=mensal&from=${year}-01&to=${year}-12${lot ? '&lot=' + encodeURIComponent(lot) : ''}`), api('/api/tank')]);
    const T = m.targets; const goal = nf(m.goal); const MES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const byM = (fn) => MES.map((_, i) => { const k = `${year}-${String(i + 1).padStart(2, '0')}`; const r = m.series.find((x) => x.key === k); return r ? fn(r) : null; });
    const tk = (code) => MES.map((_, i) => { const k = `${year}-${String(i + 1).padStart(2, '0')}`; const day = tank.find((r) => r.date.startsWith(k) && r.values[code] != null); return day ? day.values[code] : null; });
    const row = (label, vals, o = {}) => ({ label, vals, dec: o.dec ?? 1, meta: o.meta, unit: o.unit || '', last: !!o.last, better: o.better });
    const sections = [
      ['DADOS GERAIS', [row('Média vaca/dia (kg)', byM((r) => r.milk_avg)), row('% Gordura (tanque)', tk('GORDURA'), { dec: 2 }), row('% Proteína (tanque)', tk('PROTEINA'), { dec: 2 }), row('NUL (mg/dL)', tk('UREIA'), { dec: 1 }), row('Produção total do tanque (L)', tk('PRODUCAO_TOTAL'), { dec: 0 })]],
      ['SAÚDE DE ÚBERE', [row('CPP (mil UFC/mL)', tk('CBT'), { dec: 0, meta: T.tank_cbt, better: 'low' }), row('CCS Tanque (laboratório)', tk('CCS'), { dec: 0, last: true }), row('CCS Controle (tanque pelas vacas)', byM((r) => r.tank_calc), { dec: 0, meta: T.tank_ccs, last: true, better: 'low' }),
        row(`% de vacas com CCS abaixo de ${goal}`, byM((r) => r.pct_healthy), { unit: '%', meta: T.pct_healthy, better: 'high' }), row(`% de vacas com CCS ${goal} ou mais`, byM((r) => r.pct_high), { unit: '%', meta: T.pct_high, better: 'low' }),
        row('% com CCS alta até 45 DEL', byM((r) => r.high_early), { unit: '%', meta: T.high_early, better: 'low' }), row('% com CCS alta após 45 DEL', byM((r) => r.high_late), { unit: '%', meta: T.high_late, better: 'low' }),
        row('Incidência de novos casos', byM((r) => r.incidence), { unit: '%', meta: T.incidence, better: 'low' }), row('Vacas crônicas', byM((r) => r.pct_cronica), { unit: '%', meta: T.chronic, better: 'low' }), row('Vacas curadas', byM((r) => r.pct_curada), { unit: '%', meta: T.cured, better: 'high' }),
        row('Nº de casos de mastite clínica', MES.map(() => null), { dec: 0 }), row('Incidência de mastite clínica', MES.map(() => null), { unit: '%', meta: T.clinical_mastitis })]],
      ['REPRODUTIVO', [row('DEL médio', byM((r) => r.del_mean), { dec: 0 }), row('% de vacas prenhes', MES.map(() => null)), row('Taxa de concepção geral', MES.map(() => null))]],
    ];
    const cell = (v, r) => (v == null ? '<span class="muted">–</span>' : `${nf(v, r.dec)}${r.unit}`);
    const mean = (r) => { const v = r.vals.filter((x) => x != null); if (!v.length) return null; return r.last ? v[v.length - 1] : v.reduce((a, b) => a + b, 0) / v.length; };
    $('main').innerHTML = `<h1>Painel de gestão anual</h1>
      <div class="row" style="margin-bottom:10px"><div><label for="yr" class="sr">Ano</label><select id="yr">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <div class="card"><div class="scroll"><table class="annual"><tr><th style="text-align:left">Indicador</th>${MES.map((x) => `<th class="n">${x}</th>`).join('')}<th class="n">Média</th><th class="n">Meta</th></tr>
        ${sections.map(([title, rows]) => `<tr class="sec"><td colspan="15">${title}</td></tr>${rows.map((r) => { const mv = mean(r); const good = r.meta != null && mv != null ? (r.better === 'high' ? mv >= r.meta : mv <= r.meta) : null; return `<tr><td>${esc(r.label)}</td>${r.vals.map((v) => `<td class="n">${cell(v, r)}</td>`).join('')}<td class="n"><b style="${good === false ? 'color:var(--bad)' : good ? 'color:var(--ok)' : ''}">${cell(mv, r)}</b>${r.last && mv != null ? '<div class="small muted">último</div>' : ''}</td><td class="n">${r.meta == null ? '<span class="muted">–</span>' : nf(r.meta, 0) + r.unit}</td></tr>`; }).join('')}`).join('')}
      </table></div>
      <p class="small muted">A CCS nunca é média: na coluna "Média", as linhas de CCS mostram o valor do último mês. Linhas com "–" dependem de módulos ainda não implantados (mastite clínica, reprodutivo). As metas são editáveis em <a href="#/metas">Metas</a>.</p></div>`;
    $('#yr').onchange = (e) => { S.anual.year = +e.target.value; viewAnual(); };
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



// ---------------- dashboard de gestão da qualidade do leite ----------------
const mlab = (d) => monthLabel(d.slice(0, 7));
const plabel = (k) => (/^\d{4}-\d{2}$/.test(k) ? monthLabel(k) : /-T\d$/.test(k) ? `${k.slice(5)}/${k.slice(2, 4)}` : /-S\d$/.test(k) ? `${k.slice(5)}/${k.slice(2, 4)}` : k);
const ptn = (v, d = 1) => (v == null ? '—' : nf(v, d) + '%');
const arrow = (cur, prev, worseUp = true, unit = 'pp') => {
  if (cur == null || prev == null) return '';
  const diff = cur - prev; if (Math.abs(diff) < 0.05) return '<div class="d muted">= igual ao período anterior</div>';
  const bad = worseUp ? diff > 0 : diff < 0;
  return `<div class="d" style="color:var(--${bad ? 'bad' : 'ok'})">${diff > 0 ? '▲' : '▼'} ${nf(Math.abs(diff), 1)} ${unit} vs. anterior</div>`;
};
// escreve o valor em cima de cada barra/ponto, como nos gráficos do sistema atual
const valueLabels = { id: 'valueLabels', afterDatasetsDraw(c) {
  const ctx = c.ctx; ctx.save(); ctx.font = '600 10px system-ui, sans-serif'; ctx.fillStyle = css('--ink'); ctx.textAlign = 'center';
  c.data.datasets.forEach((ds, i) => { if (!ds.showValues) return; c.getDatasetMeta(i).data.forEach((el, j) => { const v = ds.data[j]; if (v == null) return; ctx.fillText(ds.labelFmt ? ds.labelFmt(v) : nf(v, 0), el.x, el.y - 5); }); });
  ctx.restore(); } };
const monthInput = (v) => (v ? v.slice(0, 7) : '');
async function viewGestao() {
  if (!can('relatorios')) return (location.hash = '#/animais');
  shell('<h1>Gestão da qualidade do leite</h1><div class="muted">Calculando indicadores…</div>', 'gestao');
  S.gest ||= { group: 'mensal', filter: 'todas', from: '', to: '' };
  const draw = async () => {
    try {
      killCharts();
      const lot = sessionStorage.getItem('lot') || '';
      const q = new URLSearchParams({ group: S.gest.group, filter: S.gest.filter });
      if (S.gest.from) q.set('from', S.gest.from); if (S.gest.to) q.set('to', S.gest.to); if (!S.gest.from && !S.gest.to) q.set('controls', 12); if (lot) q.set('lot', lot);
      const [m, lots, tankTrend] = await Promise.all([api(`/api/dashboard/management?${q}`), api('/api/dashboard/lots'), api('/api/dashboard/trend?scope=tank&months=36')]);
      if (m.empty || !m.series.length) { $('main').innerHTML = `<h1>Gestão da qualidade do leite</h1>${m.controls_available ? `<div class="msg info">Nenhum controle nesse período. Há controles de ${esc(m.available_from)} a ${esc(m.available_to)}.</div>` : '<div class="msg info">Ainda não há controles enviados. Importe os relatórios do controle leiteiro em <b>Importar</b>.</div>'}`; return; }
      if (!S.gest.from) { S.gest.from = m.dates[0].slice(0, 7); S.gest.to = m.latest.slice(0, 7); }
      const L = m.last; const P = m.prev; const goal = nf(m.goal); const T = m.targets; const first = m.series[0];
      const ok = (v, meta, higherBetter) => (v == null || meta == null ? '' : (higherBetter ? v >= meta : v <= meta) ? 'ok' : 'bad');
      const tile = (l, v, sub, delta, meta, cls) => `<div class="tile"><div class="tl">${l}</div><div class="tv ${cls || ''}">${v}</div>${sub ? `<div class="ts">${sub}</div>` : ''}${meta != null ? `<div class="tm">Meta ${meta}</div>` : ''}${delta || ''}</div>`;
      const per = m.series.length > 1 && P ? 'período' : 'controle';
      const bullets = [];
      bullets.push(`<b>${ptn(L.pct_high)}</b> das vacas testadas (${nf(L.high)} de ${nf(L.tested)}) estão com CCS de ${goal} mil ou mais${first !== L ? `; no primeiro ${per} exibido eram ${ptn(first.pct_high)}` : ''}.`);
      bullets.push(`Todo mês, em média, <b>${ptn(m.avg.incidence)}</b> das vacas testadas são novas infecções (estavam abaixo de ${goal} mil e passaram a ${goal} mil ou mais) e <b>${ptn(m.avg.cure_rate)}</b> das vacas que estavam altas voltam para baixo.`);
      if (L.early_n) bullets.push(`Vacas com até 45 dias em lactação e CCS alta são <b>${ptn(L.high_early)}</b> do rebanho testado; depois de 45 dias, <b>${ptn(L.high_late)}</b>. Meta: ${T.high_early}% e ${T.high_late}%.`);
      if (m.loss) bullets.push(`Vacas com CCS alta produzem <b>${nf(m.loss.diff, 1)} kg/dia a menos</b> (${nf(m.loss.avg_high, 1)} contra ${nf(m.loss.avg_low, 1)} kg): cerca de ${nf(m.loss.kg_day)} kg de leite por dia (${ptn(m.loss.share_of_milk)} da produção). É uma diferença observada, não uma prova de causa.`);
      if (m.impact.cows) bullets.push(`<b>${nf(m.impact.half_n)} vacas (${nf(m.impact.half_pct, 0)}%)</b> respondem por metade da CCS do tanque; as ${nf(m.impact.top10pct_n)} piores (10%) respondem por ${ptn(m.impact.top10pct_share, 0)}.`);
      if (m.recurrent_total) bullets.push(`<b>${nf(m.recurrent_total)} vacas</b> estão com CCS alta há 3 controles seguidos ou mais: candidatas a exame, tratamento ou descarte.`);
      const seg = (id, opts, cur) => `<div class="tabs" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      $('main').innerHTML = `<h1>Gestão da qualidade do leite</h1>
        <p class="muted" style="margin:-6px 0 10px">Último controle enviado: <b>${fdate(m.latest)}</b> · ${m.dates.length} controle(s) exibido(s) · sadia = CCS abaixo de ${goal} mil</p>
        <div class="filter-panel"><div class="row">
          <div><label for="fr">De</label><input id="fr" type="month" value="${esc(S.gest.from)}" min="${esc(m.available_from)}" max="${esc(m.available_to)}"></div>
          <div><label for="to">Até</label><input id="to" type="month" value="${esc(S.gest.to)}" min="${esc(m.available_from)}" max="${esc(m.available_to)}"></div>
          <div><label for="lot">Lote</label><select id="lot"><option value="">Todo o rebanho</option>${lots.map((l) => `<option ${l.lot === lot ? 'selected' : ''} value="${esc(l.lot)}">Lote ${esc(l.lot)} (${l.n})</option>`).join('')}</select></div></div>
          <div class="row" style="margin-top:8px"><div><div class="muted small" style="color:#cfe3e8">Grupo</div>${seg('flt', [['todas', 'Todas'], ['paridas', 'Paridas (até 45 DEL)'], ['primiparas', 'Primíparas']], S.gest.filter)}</div>
          <div><div class="muted small" style="color:#cfe3e8">Período</div>${seg('grp', [['mensal', 'Mensal'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['anual', 'Anual']], S.gest.group)}</div></div></div>
        <div class="kpi-panel"><div class="tiles">
          ${tile('% de vacas com CCS abaixo de ' + goal, ptn(L.pct_healthy, 0), `${nf(L.healthy)} vacas`, arrow(L.pct_healthy, P?.pct_healthy, false), T.pct_healthy + '%', ok(L.pct_healthy, T.pct_healthy, true))}
          ${tile('% de vacas com CCS de ' + goal + ' ou mais', ptn(L.pct_high, 0), `${nf(L.high)} vacas`, arrow(L.pct_high, P?.pct_high), T.pct_high + '%', ok(L.pct_high, T.pct_high, false))}
          ${tile('% com CCS alta até 45 dias', ptn(L.high_early, 0), `${nf(L.high_early_n)} vacas`, arrow(L.high_early, P?.high_early), T.high_early + '%', ok(L.high_early, T.high_early, false))}
          ${tile('% com CCS alta após 45 dias', ptn(L.high_late, 0), `${nf(L.high_late_n)} vacas`, arrow(L.high_late, P?.high_late), T.high_late + '%', ok(L.high_late, T.high_late, false))}
          ${tile('Incidência de novos casos', ptn(L.incidence, 0), `${nf(L.nova)} vacas`, arrow(L.incidence, P?.incidence), T.incidence + '%', ok(L.incidence, T.incidence, false))}
          ${tile('Vacas crônicas', ptn(L.pct_cronica, 0), `${nf(L.cronica)} vacas`, arrow(L.pct_cronica, P?.pct_cronica), T.chronic + '%', ok(L.pct_cronica, T.chronic, false))}
          ${tile('Vacas curadas', ptn(L.pct_curada, 0), `${nf(L.curada)} vacas`, arrow(L.pct_curada, P?.pct_curada, false), T.cured + '%', ok(L.pct_curada, T.cured, true))}
          ${tile(`CCS acima de ${nf(m.severe)} mil`, ptn(L.pct_high400, 0), `${nf(L.high400)} vacas`, arrow(L.pct_high400, P?.pct_high400))}
          ${tile('Litros a mais em vacas com CCS abaixo de ' + goal, L.milk_diff == null ? '—' : `${nf(L.milk_diff, 1)} L`, L.milk_low != null ? `${nf(L.milk_low, 1)} contra ${nf(L.milk_high, 1)} L por vaca` : '', '')}
          ${tile('CCS do tanque (controle)', L.tank_calc == null ? '—' : nf(L.tank_calc), L.tank_lab != null ? `laboratório: ${nf(L.tank_lab)} mil` : 'mil cél/mL', arrow(L.tank_calc, P?.tank_calc), T.tank_ccs, ok(L.tank_calc, T.tank_ccs, false))}
        </div></div>
        <div class="card"><h2>Leitura deste ${per}</h2><ul class="reading">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
          <p class="small muted">Situação da vaca: a CCS de cada controle contra a última medição anterior dela. Nova infecção: estava abaixo de ${goal} mil e passou a ${goal} mil ou mais. Crônica: ${goal} mil ou mais nas duas. Curada: estava alta e voltou para baixo. Os percentuais usam como divisor todas as vacas testadas. Nos períodos trimestral, semestral e anual, as contagens são somadas e a CCS é a do último controle (sem média).</p></div>
        <div class="grid two">
          <div class="card"><h2>Perfil de CCS</h2><div class="chart"><canvas id="g1"></canvas></div><p class="small muted">CCS Controle = tanque calculado pelas vacas (CCS × leite ÷ leite). CCS Tanque = resultado do laboratório. Vale o último controle de cada período.</p></div>
          <div class="card" id="cpp-card"><h2>Perfil de CPP</h2><div class="chart"><canvas id="g2"></canvas></div><p class="small muted">Contagem bacteriana do tanque (mil UFC/mL), do Tanque / laticínio.</p></div>
          <div class="card"><h2>Produção de vacas com CCS acima x abaixo de ${goal}</h2><div class="chart"><canvas id="g3"></canvas></div><p class="small muted">Kg de leite por vaca no controle; as barras são a diferença.</p></div>
          <div class="card"><h2>Vacas com maior impacto no tanque</h2><div class="chart"><canvas id="g4"></canvas></div><p class="small muted">Parte de cada vaca na CCS do tanque: CCS × leite ÷ soma de (CCS × leite) do rebanho, no último controle.</p></div>
          <div class="card"><h2>% de vacas se contaminando por período de lactação</h2><div class="chart"><canvas id="g5"></canvas></div><p class="small muted">Barras: como as novas infecções se distribuem nas fases da lactação. Linha: % das vacas sadias da fase que se infectaram. DEL conhecido em ${nf(m.del_coverage, 0)}% dos testes.</p></div>
          <div class="card"><h2>% de vacas por status (média no período)</h2><div class="chart"><canvas id="g6"></canvas></div><p class="small muted">Sobre as vacas com teste anterior.</p></div>
          <div class="card"><h2>Prevalência de vacas sadias</h2><div class="chart"><canvas id="g7"></canvas></div></div>
          <div class="card"><h2>Incidência de novos casos</h2><div class="chart"><canvas id="g8"></canvas></div></div>
          <div class="card"><h2>Prevalência de vacas curadas</h2><div class="chart"><canvas id="g9"></canvas></div></div>
          <div class="card"><h2>Prevalência CCS ${goal} mil ou mais até 45 DEL</h2><div class="chart"><canvas id="g10"></canvas></div></div>
          <div class="card"><h2>Prevalência CCS ${goal} mil ou mais após 45 DEL</h2><div class="chart"><canvas id="g11"></canvas></div></div>
          <div class="card"><h2>Prevalência CCS ${goal} mil ou mais</h2><div class="chart"><canvas id="g12"></canvas></div></div>
          <div class="card"><h2>Prevalência de vacas crônicas</h2><div class="chart"><canvas id="g13"></canvas></div></div>
          <div class="card"><h2>Prevalência por ordem de lactação</h2><div class="chart"><canvas id="g14"></canvas></div><p class="small muted">Último controle; entre parênteses, o nº de vacas testadas.</p></div>
        </div>
        <div class="card"><h2>Vacas recorrentes (${nf(m.recurrent_total)})</h2>${m.recurrent.length ? `<div class="scroll"><table><tr><th>Brinco</th><th>Lote</th><th>LAC</th><th>DEL</th><th>Controles ≥ ${goal}</th>${m.dates.slice(-6).map((d) => `<th class="n">${mlab(d)}</th>`).join('')}<th class="n">Leite</th></tr>
          ${m.recurrent.map((r) => `<tr><td><a href="#/animal/${r.id}">${esc(r.tag)}</a></td><td>${esc(r.lot || '')}</td><td>${r.lac ?? '—'}</td><td>${r.del ?? '—'}</td><td>${r.consecutive} seguidos (${r.high_of})</td>${r.values.map((v) => `<td class="n" style="${v != null && v >= m.goal ? 'color:var(--bad);font-weight:600' : ''}">${v == null ? '' : nf(v)}</td>`).join('')}<td class="n">${r.milk == null ? '—' : nf(r.milk, 1) + ' kg'}</td></tr>`).join('')}</table></div>
          <p class="small muted">CCS alta em 3 controles seguidos ou mais (ou 4 dos últimos 6). Mostrando ${m.recurrent.length} de ${nf(m.recurrent_total)}.</p>` : '<p class="muted">Nenhuma vaca recorrente. 👍</p>'}</div>`;
      const reload = () => { S.gest.from = $('#fr').value; S.gest.to = $('#to').value; draw(); };
      $('#fr').onchange = reload; $('#to').onchange = reload;
      $('#lot').onchange = (e) => { sessionStorage.setItem('lot', e.target.value); draw(); };
      $('#grp').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.gest.group = v; draw(); } };
      $('#flt').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.gest.filter = v; draw(); } };

      const x = m.series.map((r) => plabel(r.key));
      const dl = (label, data, color, extra = {}) => ({ label, data, borderColor: css(color), backgroundColor: css(color), tension: 0.25, spanGaps: true, pointRadius: 3, showValues: true, ...extra });
      const legend = { plugins: { legend: { position: 'bottom', labels: { boxWidth: 14 } } } };
      const metaLine = (v, label) => (v == null ? null : { type: 'line', label: label || 'Meta', data: x.map(() => v), borderColor: css('--c1'), backgroundColor: css('--c1'), pointRadius: 0, borderWidth: 2, order: 0 });
      chart($('#g1'), { type: 'line', plugins: [valueLabels], data: { labels: x, datasets: [dl('CCS Controle', m.series.map((r) => r.tank_calc), '--c2'), dl('CCS Tanque', m.series.map((r) => r.tank_lab), '--muted', { borderDash: [] }), metaLine(T.tank_ccs, `Objetivo (${T.tank_ccs} mil)`)].filter(Boolean) }, options: { ...legend, scales: { y: { beginAtZero: true, title: { display: true, text: 'mil cél/mL' } } } } });
      const cpp = tankTrend.filter((r) => r.code === 'CBT').sort((a, b) => (a.month < b.month ? -1 : 1));
      if (cpp.length) chart($('#g2'), { type: 'line', plugins: [valueLabels], data: { labels: cpp.map((r) => monthLabel(r.month)), datasets: [dl('CPP', cpp.map((r) => r.value), '--c2'), { type: 'line', label: `Objetivo (${T.tank_cbt})`, data: cpp.map(() => T.tank_cbt), borderColor: css('--c1'), pointRadius: 0, borderWidth: 2 }] }, options: { ...legend, scales: { y: { beginAtZero: true, title: { display: true, text: 'mil UFC/mL' } } } } });
      else $('#cpp-card .chart').outerHTML = '<p class="muted">Ainda não há resultados de CPP (CBT) do tanque. Lance em <a href="#/tanque">Tanque / laticínio</a> ou importe o mapa do leite.</p>';
      chart($('#g3'), { type: 'bar', plugins: [valueLabels], data: { labels: x, datasets: [{ type: 'bar', label: 'Diferença de produção', data: m.series.map((r) => r.milk_diff), backgroundColor: css('--line'), order: 3, showValues: true, labelFmt: (v) => nf(v, 1) + ' L' }, dl(`CCS < ${goal}`, m.series.map((r) => r.milk_low), '--c2', { type: 'line', order: 1 }), dl(`CCS ≥ ${goal}`, m.series.map((r) => r.milk_high), '--bad', { type: 'line', order: 2 })] }, options: { ...legend, scales: { y: { title: { display: true, text: 'kg/vaca' } } } } });
      chart($('#g4'), { type: 'bar', data: { labels: m.impact.top.map((r) => r.tag), datasets: [{ label: '% da CCS do tanque', data: m.impact.top.map((r) => r.impact), backgroundColor: css('--c2') }] }, options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => { const r = m.impact.top[c.dataIndex]; return `CCS ${nf(r.ccs)} mil · ${nf(r.milk, 1)} kg`; } } } }, scales: { x: { title: { display: true, text: '% da CCS do tanque' } } } } });
      chart($('#g5'), { data: { labels: m.bands.map((b) => b.label), datasets: [{ type: 'bar', label: '% das novas infecções', data: m.bands.map((b) => b.share_new), backgroundColor: css('--c2'), showValues: true, labelFmt: (v) => nf(v, 0) + '%' }, { type: 'line', label: 'Incidência na fase (% das sadias)', data: m.bands.map((b) => b.incidence_rate), borderColor: css('--bad'), backgroundColor: css('--bad'), tension: 0.25 }] }, plugins: [valueLabels], options: { ...legend, scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } } } });
      if (m.pie) chart($('#g6'), { type: 'pie', data: { labels: ['Sadias', 'Curadas', 'Nova infecção', 'Crônicas'], datasets: [{ data: [m.pie.sadia, m.pie.curada, m.pie.nova, m.pie.cronica], backgroundColor: [css('--c1'), css('--c2'), css('--warn'), css('--bad')] }] }, options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${nf(c.parsed, 1)}%` } } } } });
      const barMeta = (id, key, meta, label, color = '--c2') => chart($(id), { type: 'bar', plugins: [valueLabels], data: { labels: x, datasets: [{ type: 'bar', label, data: m.series.map((r) => r[key]), backgroundColor: css(color), order: 2, showValues: true, labelFmt: (v) => nf(v, 0) + '%' }, metaLine(meta)].filter(Boolean) }, options: { ...legend, scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } } } });
      barMeta('#g7', 'pct_sadia', T.pct_healthy, 'Sadias'); barMeta('#g8', 'incidence', T.incidence, 'Novos casos', '--bad'); barMeta('#g9', 'pct_curada', T.cured, 'Curadas');
      barMeta('#g10', 'high_early', T.high_early, 'Até 45 DEL', '--warn'); barMeta('#g11', 'high_late', T.high_late, 'Após 45 DEL', '--warn'); barMeta('#g12', 'pct_high', T.pct_high, `CCS ≥ ${goal} mil`, '--warn'); barMeta('#g13', 'pct_cronica', T.chronic, 'Crônicas', '--bad');
      chart($('#g14'), { type: 'bar', plugins: [valueLabels], data: { labels: m.lactation.map((g) => `${g.label} (${g.n})`), datasets: [{ label: `% com CCS de ${goal} mil ou mais`, data: m.lactation.map((g) => g.pct), backgroundColor: css('--warn'), showValues: true, labelFmt: (v) => nf(v, 0) + '%' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '% das vacas' } } } } });
    } catch (e) { $('main').innerHTML = err(e); }
  };
  draw();
}

// ---------------- controle leiteiro (por vaca) ----------------
const QSTATUS = { sadia: ['ok', 'Sadia'], curada: ['curada', 'Curada'], nova: ['atencao', 'Nova infecção'], cronica: ['alerta', 'Crônica'], acima: ['atencao', 'Acima da meta'], sem_historico: ['', 'Sem histórico'] };
const PARIDA = { sadia: 'Parida sadia', curada: 'Parida curada', nova: 'Parida infectada', cronica: 'Parida crônica', acima: 'Parida infectada' };
const GROUPS = [['todas', 'Todas'], ['lactantes', 'Lactantes'], ['paridas', 'Paridas (até 45 DEL)'], ['primiparas', 'Primíparas'], ['novilhas', 'Novilhas']];
const STATUSES = [['todas', 'Todas'], ['sadias', 'Sadias'], ['curadas', 'Curadas'], ['nova', 'Novas infecções'], ['cronicas', 'Crônicas'], ['acima200', 'Acima da meta'],
  ['paridas_sadias', 'Paridas sadias'], ['paridas_curadas', 'Paridas curadas'], ['paridas_infectadas', 'Paridas infectadas'], ['paridas_cronicas', 'Paridas crônicas'], ['novilhas_paridas_sadias', 'Primíparas paridas sadias'], ['novilhas_paridas_infectadas', 'Primíparas paridas infectadas']];
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
          <p class="small muted">Meta de CCS: sadia = abaixo de ${nf(r.goal)} mil cél/mL · coleta mais recente: ${fdate(r.latest)}. Situação: CCS deste controle contra a última medição anterior da vaca. Paridas = vacas recém-paridas (até 45 dias em lactação); primíparas = 1ª lactação; lactantes = testadas no controle mais recente.</p></div>
        <div class="card"><h2>Vacas (${r.rows.length})</h2><div class="scroll"><table><tr><th>Brinco</th><th>LAC</th><th>DEL</th>${r.months.map((m) => `<th class="n">${mlabel(m)}</th>`).join('')}<th>Situação</th><th class="n">Produção</th><th class="n">Impacto tanque</th></tr>
          ${r.rows.slice(0, 500).map((x) => { const [c, l0] = QSTATUS[x.status] || ['', '—']; const l = x.parida ? (PARIDA[x.status] || l0) : l0; return `<tr><td><a href="#/animal/${x.id}">${esc(x.tag)}</a>${x.stale ? `<div class="small muted">${x.hint === 'pulou' ? 'pulou o último controle' : x.hint === 'seca' ? `sem teste há ${x.missed} controles: possível secagem` : `sem teste há ${x.missed} controles: saiu do rebanho?`}</div>` : ''}</td><td>${x.lac ?? '—'}</td><td>${x.del ?? '—'}</td>${x.months.map((v) => `<td class="n" style="${v != null && v >= r.goal ? 'color:var(--bad);font-weight:600' : ''}">${v == null ? '' : nf(v)}</td>`).join('')}<td>${c ? `<span class="chip ${c}">${l}</span>` : `<span class="muted small">${l}</span>`}</td><td class="n">${x.milk == null ? '—' : nf(x.milk, 1) + ' kg'}</td><td class="n">${x.impact == null ? '—' : nf(x.impact, 2) + '%'}</td></tr>`; }).join('')}</table></div>
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
  const views = { painel: viewPainel, animais: viewAnimais, animal: () => viewAnimal(arg), lancar: viewLancar, importar: viewImportar, gestao: viewGestao, anual: viewAnual, metas: viewMetas, controle: viewControle, tanque: viewTanque, genetica: viewGenetica, mais: viewMais, senha: () => viewPassword(false), config: viewConfig, usuarios: viewUsuarios, auditoria: viewAuditoria };
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
