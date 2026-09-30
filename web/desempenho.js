// Desempenho zootécnico: painel mensal de indicadores (resumo, tabela, curva de lactação, lançamento, importação).
// Recebe as ferramentas do app.js (api, shell, gráficos…) para não repetir código.
const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const TABS = [['resumo', 'Resumo'], ['tabela', 'Indicadores'], ['curva', 'Curva de lactação'], ['lancar', 'Lançar mês'], ['importar', 'Importar planilha']];

export function createPerformanceView(x) {
  const { $, esc, nf, api, shell, can, S, toast, chart, css, err, killCharts } = x;
  const st = (S.perf ||= { year: new Date().getFullYear(), tab: 'resumo', group: 'producao', code: 'prod_diaria', curveMonth: null, entryMonth: null });

  const fmt = (d, v) => (v == null ? '' : nf(v, d.dec));
  const pctTxt = (p) => (p == null ? '' : `${p > 0 ? '+' : ''}${nf(p, 1)}%`);
  // cor da variação: verde quando anda na direção boa do indicador
  const tone = (good, delta) => (!good || delta == null || Math.abs(delta) < 0.05 ? 'var(--muted)' : (delta > 0) === (good === 'up') ? 'var(--ok)' : 'var(--bad)');

  async function view() {
    if (!can('relatorios')) return (location.hash = '#/animais');
    shell('<h1>Desempenho zootécnico</h1><div class="muted">Carregando…</div>', 'desempenho');
    try {
      const [rep, ins] = await Promise.all([api(`/api/performance?year=${st.year}`), api(`/api/performance/insights?year=${st.year}`)]);
      const years = [...new Set([...rep.years, st.year, new Date().getFullYear()])].sort((a, b) => b - a);
      const head = `<h1>Desempenho zootécnico</h1>
        <div class="row" style="margin-bottom:8px"><div class="fit"><label for="py" class="sr">Ano</label><select id="py" style="width:auto;min-width:110px">${years.map((y) => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
        <div class="tabs" id="ptabs">${TABS.filter(([k]) => (k !== 'lancar' || can('corrigir')) && (k !== 'importar' || can('importar'))).map(([k, l]) => `<button data-t="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      const body = { resumo: () => resumo(rep, ins), tabela: () => tabela(rep), curva: () => curva(rep), lancar: () => lancar(rep), importar: () => importar(rep) }[st.tab]();
      killCharts();
      $('main').innerHTML = head + body.html;
      $('#py').onchange = (e) => { st.year = +e.target.value; st.entryMonth = null; st.curveMonth = null; view(); };
      $('#ptabs').onclick = (e) => { const t = e.target.dataset.t; if (t) { st.tab = t; view(); } };
      body.after?.();
    } catch (e) { $('main').innerHTML = err(e); }
  }

  // ---------------- resumo ----------------
  function resumo(rep, ins) {
    if (rep.latest_month == null) {
      return { html: `<div class="msg info">Ainda não há dados de ${rep.year}. ${can('importar') ? 'Use <b>Importar planilha</b> para trazer a planilha zootécnica, ou ' : ''}${can('corrigir') ? '<b>Lançar mês</b> para digitar os números.' : ''}</div>` };
    }
    const tile = (r) => {
      const d = rep.indicators.find((i) => i.code === r.code);
      const delta = r.yoy_pct ?? r.mom_pct;
      const sub = r.basis === 'ano' ? `vs ${MES[r.month - 1]}/${rep.year - 1}: ${fmt(d, r.last_year)}` : r.basis === 'mes' ? `vs mês anterior: ${fmt(d, r.last_month)}` : '';
      return `<div class="tile"><div class="tl">${esc(r.label)}</div><div class="tv">${fmt(d, r.value)}</div><div class="ts">${esc(r.unit === 'n' ? '' : r.unit)} · ${MES[r.month - 1]}</div>
        ${delta == null ? '' : `<div class="d" style="color:${tone(r.good, delta)};font-weight:600">${pctTxt(delta)} ${esc(sub)}</div>`}</div>`;
    };
    const line = (r) => {
      const d = rep.indicators.find((i) => i.code === r.code);
      const delta = r.yoy_pct ?? r.mom_pct;
      return `<li><a href="#" data-go="${r.code}"><b>${esc(r.label)}</b></a>: ${fmt(d, r.value)} ${esc(r.unit === 'n' ? '' : r.unit)} em ${MES[r.month - 1]}
        <span style="color:${tone(r.good, delta)};font-weight:600">(${pctTxt(delta)} ${r.basis === 'ano' ? `vs ${MES[r.month - 1]}/${rep.year - 1}` : 'vs mês anterior'})</span></li>`;
    };
    const targets = ins.off_target.length ? `<div class="card"><h2>Fora da meta</h2><ul class="reading">${ins.off_target.map((r) => {
      const d = rep.indicators.find((i) => i.code === r.code);
      return `<li><span class="chip ${r.target_status}">${r.target_status === 'atencao' ? 'Atenção' : 'Alerta'}</span> <b>${esc(r.label)}</b>: ${fmt(d, r.value)} (meta ${r.good === 'down' ? 'até' : 'mínimo'} ${fmt(d, r.target)})</li>`;
    }).join('')}</ul></div>` : '';
    return {
      html: `<p class="muted" style="margin:-6px 0 10px">Dados até <b>${MES[rep.latest_month - 1]}/${rep.year}</b>. Cada indicador mostra o último mês em que foi preenchido, comparado com o mesmo mês do ano anterior. Variações menores que 3% não são destacadas.</p>
        <div class="kpi-panel"><div class="tiles">${ins.headline.map(tile).join('')}</div></div>
        ${targets}
        <div class="grid two"><div class="card"><h2>Pontos de atenção (pioraram)</h2>${ins.worse.length ? `<ul class="reading">${ins.worse.map(line).join('')}</ul>` : '<p class="muted">Nada piorou de forma relevante.</p>'}</div>
        <div class="card"><h2>Melhoraram</h2>${ins.better.length ? `<ul class="reading">${ins.better.map(line).join('')}</ul>` : '<p class="muted">Nada melhorou de forma relevante.</p>'}</div></div>`,
      after() {
        document.querySelectorAll('[data-go]').forEach((a) => (a.onclick = (e) => {
          e.preventDefault(); const d = rep.indicators.find((i) => i.code === a.dataset.go);
          st.tab = 'tabela'; st.code = d.code; st.group = d.group; view();
        }));
      },
    };
  }

  // ---------------- tabela + gráfico ----------------
  function tabela(rep) {
    const inds = rep.indicators.filter((i) => i.group === st.group && !i.curve);
    if (!inds.some((i) => i.code === st.code)) st.code = inds[0]?.code;
    const sel = rep.indicators.find((i) => i.code === st.code);
    const cell = (d, v, prev) => `<td class="n" style="${v != null && prev != null && d.good ? `color:${tone(d.good, v - prev)}` : ''}">${fmt(d, v)}</td>`;
    const rows = inds.map((d) => `<tr data-c="${d.code}" style="cursor:pointer;${d.code === st.code ? 'background:var(--bg);font-weight:600' : ''}">
      <td>${esc(d.label)} <span class="muted small">${d.unit === 'n' ? '' : esc(d.unit)}</span>${d.kind === 'calc' ? ' <span class="muted small" title="calculado">ƒ</span>' : ''}</td>
      ${rep.values[d.code].map((v, i) => cell(d, v, rep.prev[d.code][i])).join('')}
      <td class="n muted">${fmt(d, rep.avg[d.code].prev)}</td><td class="n"><b>${fmt(d, rep.avg[d.code].current)}</b></td></tr>`).join('');
    const groups = rep.groups.filter((g) => g.code !== 'curva');
    return {
      html: `<div class="tabs" id="pg">${groups.map((g) => `<button data-g="${g.code}" class="${st.group === g.code ? 'on' : ''}">${g.label}</button>`).join('')}</div>
        ${sel ? `<div class="card"><h2>${esc(sel.label)} <span class="muted">${esc(sel.unit)}</span></h2><div class="chart"><canvas id="pc" aria-label="Gráfico de ${esc(sel.label)}"></canvas></div>
          <p class="small muted">Linha cheia: ${rep.year} · tracejada: ${rep.year - 1}.${sel.good ? ` Sentido bom: ${sel.good === 'up' ? 'quanto maior, melhor' : 'quanto menor, melhor'}.` : ''}${sel.kind === 'calc' ? ' Este indicador é calculado automaticamente.' : ''}</p>
          ${sel.good && can('config') ? `<div class="row"><div><label for="tg">Meta (${sel.good === 'down' ? 'valor máximo' : 'valor mínimo'})</label><input id="tg" inputmode="decimal" value="${sel.target ?? ''}" placeholder="sem meta"></div><div class="fit"><button class="small" id="tgs">Salvar meta</button></div></div>` : (sel.target != null ? `<p class="small">Meta: ${sel.good === 'down' ? 'até' : 'mínimo'} <b>${fmt(sel, sel.target)}</b></p>` : '')}</div>` : ''}
        <div class="card"><h2>${groups.find((g) => g.code === st.group)?.label} · ${rep.year}</h2><div class="scroll"><table>
          <tr><th>Indicador</th>${MES.map((m) => `<th class="n">${m}</th>`).join('')}<th class="n">Média ${rep.year - 1}</th><th class="n">Média ${rep.year}</th></tr>${rows}</table></div>
          <p class="small muted">Toque numa linha para ver o gráfico. Cores comparam cada mês com o mesmo mês do ano anterior (verde = melhor). Médias são a média simples dos meses preenchidos.</p></div>`,
      after() {
        $('#pg').onclick = (e) => { const g = e.target.dataset.g; if (g) { st.group = g; st.code = null; view(); } };
        document.querySelectorAll('tr[data-c]').forEach((tr) => (tr.onclick = () => { st.code = tr.dataset.c; view(); }));
        if (sel) {
          const line = (data, color, dash, label) => ({ label, data, borderColor: color, backgroundColor: color, borderDash: dash, tension: .25, spanGaps: true, pointRadius: dash.length ? 0 : 3 });
          chart($('#pc'), { type: 'line', data: { labels: MES, datasets: [line(rep.values[sel.code].map((v) => (v == null ? null : +v.toFixed(sel.dec + 1))), css('--c2'), [], String(rep.year)), line(rep.prev[sel.code].map((v) => (v == null ? null : +v.toFixed(sel.dec + 1))), css('--c1'), [6, 4], String(rep.year - 1))] },
            options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { grace: '5%' } } } });
        }
        if ($('#tgs')) $('#tgs').onclick = async () => {
          try { await api(`/api/performance/targets/${sel.code}`, { method: 'PUT', body: { target: $('#tg').value.trim() || null } }); toast('Meta salva.'); view(); } catch (e) { toast(e.message); }
        };
      },
    };
  }

  // ---------------- curva de lactação ----------------
  function curva(rep) {
    const bands = rep.indicators.filter((i) => i.curve === 'prim').map((i) => i.band);
    const months = MES.map((m, i) => i).filter((i) => rep.indicators.some((d) => d.curve && rep.values[d.code][i] != null));
    if (!months.length) return { html: '<div class="msg info">Ainda não há dados de curva de lactação neste ano.</div>' };
    if (st.curveMonth == null || !months.includes(st.curveMonth)) st.curveMonth = months[months.length - 1];
    const m = st.curveMonth;
    const ser = (cat, src) => bands.map((_, i) => src[`curva_${cat}_${i}`]?.[m] ?? null);
    const prim = ser('prim', rep.values); const mult = ser('mult', rep.values);
    const primP = ser('prim', rep.prev); const multP = ser('mult', rep.prev);
    const hasPrev = [...primP, ...multP].some((v) => v != null);
    // pico e persistência: produção da faixa 60-89 (pico) e queda até 300+ (persistência)
    const peak = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const kpi = (l, v, u) => `<div class="tile"><div class="tl">${l}</div><div class="tv">${v == null ? '—' : nf(v, 1)}</div><div class="ts">${u}</div></div>`;
    const idxPeak = (a) => { const p = peak(a); return p == null ? '—' : bands[a.indexOf(p)]; };
    return {
      html: `<div class="row" style="margin-bottom:10px"><div><label for="cm">Mês</label><select id="cm">${months.map((i) => `<option value="${i}" ${i === m ? 'selected' : ''}>${MES[i]}/${rep.year}</option>`).join('')}</select></div></div>
        <div class="kpi-panel"><div class="tiles">${kpi('Pico primíparas', peak(prim), `kg/d · faixa ${idxPeak(prim)} DEL`)}${kpi('Pico multíparas', peak(mult), `kg/d · faixa ${idxPeak(mult)} DEL`)}
          ${kpi('Pico multíparas ÷ primíparas', peak(prim) ? (peak(mult) / peak(prim)) * 100 : null, '%')}</div></div>
        <div class="card"><h2>Produção média por faixa de DEL · ${MES[m]}/${rep.year}</h2><div class="chart" style="height:320px"><canvas id="cc" aria-label="Curva de lactação"></canvas></div>
          <p class="small muted">Linha cheia: ${rep.year} · tracejada: mesmo mês de ${rep.year - 1}${hasPrev ? '' : ' (sem dados)'}. DEL = dias em lactação. Uma curva com pico baixo e queda rápida aponta problema de transição, conforto ou nutrição no início da lactação.</p></div>`,
      after() {
        $('#cm').onchange = (e) => { st.curveMonth = +e.target.value; view(); };
        const ds = (label, data, color, dash) => ({ label, data: data.map((v) => (v == null ? null : +v.toFixed(1))), borderColor: color, backgroundColor: color, borderDash: dash, tension: .3, spanGaps: true, pointRadius: dash.length ? 0 : 3 });
        chart($('#cc'), { type: 'line', data: { labels: bands, datasets: [ds('Multíparas', mult, css('--c2'), []), ds('Primíparas', prim, css('--c1'), []),
          ...(hasPrev ? [ds(`Multíparas ${rep.year - 1}`, multP, css('--c2'), [6, 4]), ds(`Primíparas ${rep.year - 1}`, primP, css('--c1'), [6, 4])] : [])] },
          options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { title: { display: true, text: 'kg/vaca/dia' } }, x: { title: { display: true, text: 'Dias em lactação (DEL)' } } } } });
      },
    };
  }

  // ---------------- lançar mês ----------------
  function lancar(rep) {
    if (!can('corrigir')) return { html: '<div class="msg err">Seu perfil não pode lançar dados.</div>' };
    if (st.entryMonth == null) st.entryMonth = rep.latest_month ? Math.min(rep.latest_month + 1, 12) : new Date().getMonth() + 1;
    const m = st.entryMonth - 1;
    const inputs = rep.indicators.filter((i) => i.kind === 'input');
    const groups = rep.groups.filter((g) => g.code !== 'curva');
    const field = (d) => {
      const v = rep.values[d.code][m]; const ly = rep.prev[d.code][m];
      return `<div><label for="f_${d.code}">${esc(d.label)} <span class="muted small">${d.unit === 'n' ? '' : esc(d.unit)}</span></label><input id="f_${d.code}" data-code="${d.code}" inputmode="decimal" autocomplete="off" value="${v == null ? '' : +v.toFixed(3)}" ${ly != null ? `placeholder="${MES[m]}/${rep.year - 1}: ${fmt(d, ly)}"` : ''}></div>`;
    };
    const block = (title, list) => (list.length ? `<details ${title === 'Dados de entrada' || title === 'Produção' ? 'open' : ''} style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600;padding:8px 0">${title}</summary><div class="grid">${list.map(field).join('')}</div></details>` : '');
    return {
      html: `<div class="card"><h2>Lançar dados do mês</h2>
        <p class="small muted">Digite só os números de entrada. Percentuais, taxas e projeções (ex.: % prenhes, mastite tratada, RMCA) são calculados sozinhos. Campo vazio = sem dado. Em cinza aparece o valor do mesmo mês do ano anterior.</p>
        <div class="row"><div><label for="em">Mês</label><select id="em">${MES.map((n, i) => `<option value="${i + 1}" ${i === m ? 'selected' : ''}>${n}/${rep.year}</option>`).join('')}</select></div></div>
        <form id="pf">${groups.map((g) => block(g.label, inputs.filter((i) => i.group === g.code))).join('')}${block('Curva de lactação (kg/vaca/dia por faixa de DEL)', rep.indicators.filter((i) => i.curve))}
          <div id="pe"></div><div style="margin-top:14px"><button class="primary">Salvar ${MES[m]}/${rep.year}</button></div></form></div>`,
      after() {
        $('#em').onchange = (e) => { st.entryMonth = +e.target.value; view(); };
        $('#pf').onsubmit = async (ev) => {
          ev.preventDefault();
          const values = {};
          for (const i of document.querySelectorAll('[data-code]')) {
            const cur = rep.values[i.dataset.code][m]; const now = i.value.trim();
            // só envia o que mudou (não regrava o que o cálculo derivou, como "3+ crias")
            if ((cur == null && now === '') || (cur != null && now !== '' && Number(now.replace(',', '.')) === +cur.toFixed(3))) continue;
            values[i.dataset.code] = now === '' ? null : now;
          }
          if (!Object.keys(values).length) { $('#pe').innerHTML = '<div class="msg info">Nada mudou.</div>'; return; }
          try { const r = await api(`/api/performance/${rep.year}/${st.entryMonth}`, { method: 'PUT', body: { values } }); toast(`Salvo: ${r.saved} valor(es)${r.removed ? `, ${r.removed} removido(s)` : ''}.`); view(); }
          catch (e) { $('#pe').innerHTML = err(e); }
        };
      },
    };
  }

  // ---------------- importar planilha ----------------
  function importar() {
    if (!can('importar')) return { html: '<div class="msg err">Seu perfil não pode importar.</div>' };
    return {
      html: `<div class="card"><h2>Importar planilha zootécnica (.xlsx)</h2>
        <p class="small muted">Use a planilha "Zootécnico" da fazenda: uma aba por ano (2025, 2026…), meses Jan a Dez nas colunas e os indicadores nas linhas. O sistema lê só os números digitados; o que é calculado ele recalcula. Reenviar a mesma planilha atualiza os valores, sem duplicar. Abas de gráficos e impressão são ignoradas.</p>
        <label for="pfile">Arquivo</label><input id="pfile" type="file" accept=".xlsx"><div id="pi" style="margin-top:12px"></div></div>`,
      after() {
        const send = async (commit) => {
          const f = $('#pfile').files[0]; if (!f) { $('#pi').innerHTML = err('Escolha o arquivo.'); return; }
          const form = new FormData(); form.append('commit', commit ? '1' : '0'); form.append('file', f);
          $('#pi').innerHTML = '<div class="muted">Lendo a planilha…</div>';
          try {
            const r = await api('/api/performance/import', { method: 'POST', form });
            $('#pi').innerHTML = `<table><tr><th>Ano</th><th class="n">Meses</th><th class="n">Valores</th><th class="n">Comparativo ano anterior</th></tr>
              ${r.years.map((y) => `<tr><td>${y.year}</td><td class="n">${y.months}</td><td class="n">${nf(y.values)}</td><td class="n">${nf(y.comparison)}</td></tr>`).join('')}</table>
              ${r.ignored.length ? `<p class="small muted">Abas ignoradas: ${r.ignored.map(esc).join(', ')}.</p>` : ''}
              ${r.unknown.length ? `<div class="msg info">Linhas que não reconheci (não importadas): ${r.unknown.map(esc).join('; ')}.</div>` : ''}
              ${r.committed ? `<div class="msg okm">Importado: ${nf(r.saved)} valores gravados.</div>` : '<div style="margin-top:12px"><button class="primary" id="pgo">Confirmar importação</button></div>'}`;
            if ($('#pgo')) $('#pgo').onclick = () => send(true);
            if (r.committed) { st.year = Math.max(...r.years.map((y) => y.year)); toast('Planilha importada.'); setTimeout(() => { st.tab = 'resumo'; view(); }, 900); }
          } catch (e) { $('#pi').innerHTML = err(e); }
        };
        $('#pfile').onchange = () => send(false);
      },
    };
  }

  return view;
}
