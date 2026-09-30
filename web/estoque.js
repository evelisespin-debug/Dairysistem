// Módulo de estoque (Fase 1). Somente online: se a conexão cair, avisa e mantém em tela o que foi digitado.
// Recebe do app.js os utilitários comuns (S, $, esc, nf, fdate, today, toast, shell, err, can, scanCode).
export function estoqueViews(ctx) {
  const { S, $, esc, nf, fdate, today, toast, shell, err, can, scanCode } = ctx;
  const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const qty = (v) => nf(v, 3).replace(/,?0+$/, '');
  const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const toNum = (s) => { const n = Number(String(s ?? '').trim().replace(/\./g, (m, i, str) => (str.includes(',') ? '' : m)).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const UNITS = ['kg', 't', 'L', 'dose', 'unidade', 'saco', 'caixa'];
  const UA = { kg: 'kg', kgs: 'kg', t: 't', ton: 't', l: 'L', lt: 'L', lts: 'L', litro: 'L', dose: 'dose', ds: 'dose', un: 'unidade', und: 'unidade', unid: 'unidade', pc: 'unidade', sc: 'saco', sac: 'saco', saco: 'saco', cx: 'caixa', caixa: 'caixa' };
  const canonUnit = (u) => UA[String(u || '').trim().toLowerCase()] || null;
  const opts = (rows, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + rows.map((r) => `<option value="${r.id}" ${String(r.id) === String(sel) ? 'selected' : ''}>${esc(r.name)}</option>`).join('');

  // ---------- rede: avisa e nunca apaga o que está na tela ----------
  let bar = null;
  const netBar = (show) => {
    if (!bar) { bar = document.createElement('div'); bar.className = 'netbar'; bar.setAttribute('role', 'alert'); document.body.prepend(bar); }
    bar.innerHTML = show ? '<b>Sem conexão com a internet.</b> O que você digitou continua aqui na tela. Quando a conexão voltar, toque no botão de novo.' : '';
    bar.style.display = show ? 'block' : 'none';
  };
  addEventListener('offline', () => netBar(true)); addEventListener('online', () => netBar(false));
  async function call(path, { method = 'GET', body, form } = {}) {
    const headers = {}; if (S.token) headers.authorization = `Bearer ${S.token}`; if (body) headers['content-type'] = 'application/json';
    let res;
    try { res = await fetch(`/api/estoque${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) }); } catch {
      netBar(true); const e = new Error('Sem conexão com a internet. Nada foi perdido: tente de novo quando a conexão voltar.'); e.network = true; throw e;
    }
    netBar(false);
    if (res.status === 401) throw new Error('Sua sessão expirou. Abra o sistema em outra aba, entre de novo e volte aqui: o que você digitou continua nesta tela.');
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.blob();
    if (!res.ok) { const e = new Error(data.error || 'Não foi possível concluir.'); e.data = data; throw e; }
    return data;
  }
  const guardView = (perm) => { if (!can(perm)) { location.hash = '#/estoque'; return false; } return true; };
  const back = (to = '#/estoque', label = 'Estoque') => `<p><a href="${to}">← ${label}</a></p>`;

  // ---------------------------------------------------------------- painel do estoque
  async function viewEstoque() {
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const [sum, list] = await Promise.all([call('/resumo'), call('/itens?limit=2000')]);
      let q = ''; let onlyLow = false;
      const draw = () => {
        const rows = list.filter((i) => (!q || `${i.name} ${i.code} ${i.barcode || ''}`.toLowerCase().includes(q)) && (!onlyLow || (i.min_stock > 0 && i.stock <= i.min_stock)));
        $('#lista').innerHTML = rows.length ? `<table><tr><th>Item</th><th class="n">Saldo</th><th class="n">Mínimo</th></tr>${rows.slice(0, 300).map((i) => {
          const low = i.min_stock > 0 && i.stock <= i.min_stock;
          return `<tr><td><a href="#/estoque/item/${i.id}">${esc(i.name)}</a><div class="small muted">${esc(i.code)}${i.category ? ` · ${esc(i.category)}` : ''}</div></td>
            <td class="n">${qty(i.stock)} ${esc(i.unit)} ${low ? '<div><span class="chip alerta">Baixo</span></div>' : ''}</td><td class="n">${i.min_stock ? nf(i.min_stock, 0) : '—'}</td></tr>`;
        }).join('')}</table>${rows.length > 300 ? '<p class="small muted">Mostrando 300 itens. Refine a busca.</p>' : ''}` : '<p class="muted">Nenhum item encontrado.</p>';
      };
      $('main').innerHTML = `<h1>Estoque</h1>
        <div class="grid"><div class="kpi"><div class="l">Itens ativos</div><div class="v">${sum.items}</div></div>
          <div class="kpi ${sum.below_min ? 'alerta' : 'ok'}"><div class="l">Abaixo do mínimo</div><div class="v">${sum.below_min}</div></div>
          ${sum.value != null ? `<div class="kpi"><div class="l">Valor em estoque (custo médio)</div><div class="v" style="font-size:1.35rem">${brl(sum.value)}</div></div>` : ''}</div>
        <div class="row" style="margin:14px 0">${can('estoque_entrada') ? '<a class="btn primary" href="#/estoque/entrada">📄 Nova entrada por nota</a>' : ''}
          <a class="btn" href="#/estoque/notas">Notas lançadas</a>${can('estoque_cadastros') ? '<a class="btn" href="#/estoque/itens">Cadastro de itens</a><a class="btn" href="#/estoque/cadastros">Fornecedores e listas</a>' : ''}</div>
        ${sum.expiring.length ? `<div class="card"><h2>Validade nos próximos 60 dias</h2><table>${sum.expiring.map((e) => `<tr><td>${esc(e.item)}<div class="small muted">Lote ${esc(e.lot_code)}</div></td><td class="n">${nf(e.qty, 0)}</td><td class="n ${e.expiry < today() ? 'bad' : ''}">${fdate(e.expiry)}</td></tr>`).join('')}</table></div>` : ''}
        <div class="card"><div class="row"><div><label for="q">Buscar item</label><input id="q" type="search" placeholder="Nome, código ou código de barras"></div>
          <label class="fit" style="display:flex;gap:6px;align-items:center;color:var(--ink)"><input id="lo" type="checkbox" style="width:auto;min-height:0"> Só abaixo do mínimo</label></div><div id="lista" class="scroll" style="margin-top:8px"></div></div>`;
      $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
      $('#lo').onchange = (e) => { onlyLow = e.target.checked; draw(); };
      draw();
    } catch (e) { $('main').innerHTML = err(e); }
  }

  async function viewItemDetalhe(id) {
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const [it, mv] = await Promise.all([call(`/itens/${id}`), call(`/movimentos?item_id=${id}&limit=40`)]);
      $('main').innerHTML = `${back()}<h1>${esc(it.name)}</h1>
        <div class="card"><p class="muted small">${esc(it.code)}${it.category ? ` · ${esc(it.category)}` : ''}${it.supplier ? ` · Fornecedor padrão: ${esc(it.supplier)}` : ''}</p>
          <div class="grid"><div class="kpi"><div class="l">Saldo</div><div class="v">${qty(it.stock)}</div><div class="u">${esc(it.unit)}</div></div>
          <div class="kpi"><div class="l">Mínimo</div><div class="v">${nf(it.min_stock, 0)}</div></div>
          ${can('estoque_cadastros') ? `<div class="kpi"><div class="l">Custo médio</div><div class="v" style="font-size:1.3rem">${brl(it.avg_cost)}</div><div class="u">por ${esc(it.unit)}</div></div>` : ''}</div>
          ${it.has_photo ? `<img alt="" id="ph" style="max-width:220px;border-radius:10px;margin-top:10px">` : ''}
          ${can('estoque_cadastros') ? `<p style="margin-top:12px"><a class="btn" href="#/estoque/itens?edit=${it.id}">Editar cadastro</a></p>` : ''}</div>
        <div class="card"><h2>Onde está</h2>${it.balances.length ? `<table><tr><th>Local</th><th>Lote</th><th>Validade</th><th class="n">Qtd.</th></tr>${it.balances.map((b) => `<tr><td>${esc(b.location)}</td><td>${esc(b.lot_code || '—')}</td><td>${b.expiry ? fdate(b.expiry) : '—'}</td><td class="n">${qty(b.qty)}</td></tr>`).join('')}</table>` : '<p class="muted">Sem saldo.</p>'}</div>
        <div class="card"><h2>Últimos movimentos</h2><div class="scroll">${mv.length ? `<table><tr><th>Data</th><th>Tipo</th><th class="n">Qtd.</th><th class="n">Custo</th></tr>${mv.map((m) => `<tr><td>${fdate(m.occurred_on)}</td><td>${{ entrada: 'Entrada', saida: 'Saída', estorno: 'Estorno', ajuste: 'Ajuste' }[m.kind] || esc(m.kind)}${m.purchase_id ? ` <a href="#/estoque/nota/${m.purchase_id}">nota</a>` : ''}</td><td class="n">${qty(m.qty)}</td><td class="n">${can('estoque_cadastros') ? brl(m.total_cost) : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Sem movimentos.</p>'}</div></div>`;
      if (it.has_photo) { const blob = await call(`/itens/${id}/foto`); $('#ph').src = URL.createObjectURL(blob); }
    } catch (e) { $('main').innerHTML = err(e); }
  }

  // ---------------------------------------------------------------- entrada por nota
  async function viewEntrada() {
    if (!guardView('estoque_entrada')) return;
    shell('<div class="muted">Carregando…</div>', 'estoque');
    let rec; let items; let refs;
    try {
      [rec, items, refs] = await Promise.all([call('/nfe/recursos'), call('/itens?limit=2000'),
        Promise.all([call('/locais'), call('/categorias')]).then(([locs, cats]) => ({ locs, cats }))]);
    } catch (e) { $('main').innerHTML = err(e); return; }
    let tab = 'xml';
    const tabs = [['xml', '📄 XML da nota'], ['foto', '📷 Foto ou PDF'], ['chave', '🔎 QR code / chave'], ['manual', '✍️ Manual']];
    const drawTabs = () => {
      $('main').innerHTML = `${back()}<h1>Nova entrada por nota</h1>
        <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="painel"></div>`;
      document.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; drawTabs(); }));
      ({ xml: tabXml, foto: tabFoto, chave: tabChave, manual: tabManual })[tab]();
    };
    const send = async (fileList, label) => {
      const fd = new FormData(); for (const f of fileList) fd.append('file', f);
      $('#st').innerHTML = `<div class="msg info">${label}</div>`;
      try {
        const r = await call('/nfe/ler', { method: 'POST', form: fd });
        $('#st').innerHTML = r.errors.map((x) => `<div class="msg err"><b>${esc(x.file)}:</b> ${esc(x.error)}</div>`).join('');
        if (r.drafts.length) conferencia(r.drafts, { items, refs, index: 0, exit: viewEntrada });
      } catch (e) { $('#st').innerHTML = err(e); }
    };
    function tabXml() {
      $('#painel').innerHTML = `<div class="card"><div id="dz" class="dropzone" tabindex="0"><b>Arraste os XMLs (ou um .zip) para cá</b><div class="muted small">ou toque para escolher os arquivos</div>
        <input id="fx" type="file" accept=".xml,.zip,text/xml,application/zip" multiple class="sr"></div><div id="st"></div>
        <p class="small muted">Pode enviar várias notas de uma vez. Nada entra no estoque antes de você conferir e tocar em “Dar entrada”.</p></div>`;
      const dz = $('#dz'); const fi = $('#fx');
      dz.onclick = () => fi.click(); dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); };
      fi.onchange = () => fi.files.length && send([...fi.files], 'Lendo as notas…');
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files.length) send([...e.dataTransfer.files], 'Lendo as notas…'); };
    }
    function tabFoto() {
      $('#painel').innerHTML = `<div class="card"><p>Tire uma foto do DANFE (a nota impressa) ou escolha o PDF. O sistema lê os dados e mostra tudo para você conferir; campos com leitura duvidosa aparecem marcados.</p>
        ${rec.danfe ? '' : '<div class="msg info">A leitura automática ainda não foi ativada nesta fazenda (falta configurar). Use o XML ou o lançamento manual.</div>'}
        <div class="row"><label class="btn primary" style="cursor:pointer">📷 Tirar foto<input id="fc" type="file" accept="image/*" capture="environment" class="sr"></label>
        <label class="btn" style="cursor:pointer">Escolher foto ou PDF<input id="ff" type="file" accept="image/*,application/pdf" class="sr"></label></div><div id="st"></div>
        <p class="small muted">Dica: se a chave de acesso (44 números) estiver legível e a busca de XML estiver ativa, o sistema usa o XML oficial no lugar da leitura da foto.</p></div>`;
      for (const id of ['fc', 'ff']) $(`#${id}`).onchange = (e) => e.target.files.length && send([...e.target.files], 'Lendo a nota… isso leva alguns segundos.');
    }
    function tabChave() {
      $('#painel').innerHTML = `<div class="card"><button class="primary" id="sc" style="width:100%">📷 Ler QR code / código de barras da nota</button>
        <label for="ch">Ou cole/digite a chave de acesso (44 números)</label><input id="ch" inputmode="numeric" autocomplete="off" placeholder="0000 0000 0000 …">
        <div style="margin-top:12px"><button class="primary" id="go">Buscar nota</button></div><div id="st"></div>
        <p class="small muted">${rec.chave_xml ? 'A nota completa é buscada automaticamente.' : 'A busca do XML pela chave ainda não está ativada: o sistema preenche fornecedor, número e série; os itens você envia pelo XML ou digita.'}</p></div>`;
      const go = async (text) => {
        $('#go').disabled = true; $('#st').innerHTML = '<div class="msg info">Buscando…</div>';
        try {
          const r = await call('/nfe/chave', { method: 'POST', body: { text } });
          $('#st').innerHTML = r.note ? `<div class="msg info">${esc(r.note)}</div>` : '';
          conferencia([r.draft], { items, refs, index: 0, exit: viewEntrada });
        } catch (e) { $('#st').innerHTML = err(e); } finally { if ($('#go')) $('#go').disabled = false; }
      };
      $('#go').onclick = () => go($('#ch').value);
      $('#sc').onclick = async () => { const v = await scanCode('Aponte para o QR code ou código de barras da nota'); if (v) { $('#ch').value = v; go(v); } };
    }
    function tabManual() {
      conferencia([{
        source: 'manual', chave: null, number: '', series: '', issue_date: null, supplier: { doc: '', name: '', existing: null }, items: [], header: {}, totals: {},
        installments: [], payment_method: '', warnings: [], low: [], notes: '',
      }], { items, refs, index: 0, exit: viewEntrada });
    }
    drawTabs();
  }

  // ---------------------------------------------------------------- tela de conferência
  function conferencia(drafts, { items, refs, index, exit }) {
    const D = drafts[index]; const editable = D.source !== 'xml';
    const supExisting = D.supplier.existing;
    D.entry_date ||= today();
    D.default_location_id ||= '';
    D.items.forEach((l) => {
      l.choice ||= { item_id: l.suggestion?.item_id || null, factor: l.factor || 1, location_id: '', lots: (l.lots || []).map((x) => ({ ...x })), new_item: null, save_map: true };
    });
    const itemById = (id) => items.find((i) => i.id === +id);
    const label = (i) => `${i.name} (${i.code})`;
    const isLow = (p) => D.low?.includes(p);
    const lowCls = (p) => (isLow(p) ? ' low' : '');
    const lowTip = (p) => (isLow(p) ? ' title="Leitura com baixa confiança: confira este campo"' : '');
    const unitFactor = (item, nfUnit) => {
      const cu = canonUnit(nfUnit); if (!item || !cu || cu === item.unit) return 1;
      if (item.pack_factor && canonUnit(item.pack_unit) === cu) return Number(item.pack_factor);
      if (cu === 't' && item.unit === 'kg') return 1000; if (cu === 'kg' && item.unit === 't') return 0.001;
      return 1;
    };
    const calc = () => {   // mesma regra do servidor: frete/seguro/outras rateados pelo valor; IPI e ST entram no custo
      const base = D.items.map((l) => money(l.total) - money(l.discount));
      const sum = base.reduce((a, b) => a + b, 0); const h = D.header || {};
      const itemDisc = D.items.reduce((a, l) => a + money(l.discount), 0);
      const ipi = D.items.reduce((a, l) => a + money(l.ipi), 0); const st = D.items.reduce((a, l) => a + money(l.st), 0);
      const extra = money(h.freight) + money(h.insurance) + money(h.other) + Math.max(0, money(h.ipi) - ipi) + Math.max(0, money(h.st) - st) - Math.max(0, money(h.discount) - itemDisc);
      return { sum, total: money(sum + extra + ipi + st), extra, ipi, st };
    };

    const head = drafts.length > 1 ? `<div class="msg info">Nota ${index + 1} de ${drafts.length}${D.file ? ` — ${esc(D.file)}` : ''}</div>` : '';
    const dupBlock = !!D.duplicate;
    const supHtml = supExisting
      ? `<p><span class="chip ok">Fornecedor cadastrado</span> <b>${esc(supExisting.name)}</b></p>`
      : `<div class="msg info">Fornecedor novo: será cadastrado ao dar entrada. Confira os dados.</div>
         <div class="row"><div><label>CNPJ/CPF</label><input id="sdoc" inputmode="numeric" value="${esc(D.supplier.doc)}"${editable ? '' : ' readonly'}></div>
         <div style="flex:2"><label>Nome / razão social</label><input id="snm" value="${esc(D.supplier.name)}" class="${lowCls('supplier.name').trim()}"${lowTip('supplier.name')}></div></div>`;

    const itemCard = (l, i) => {
      const c = l.choice; const it = c.item_id ? itemById(c.item_id) : null; const ctl = it ? it.controls_lot : c.new_item?.controls_lot;
      const uHint = canonUnit(l.nf_unit) || 'unidade';
      const field = (k, txt, extra = '') => (editable
        ? `<input data-f="${k}" data-i="${i}" ${extra} class="${lowCls(`items.${i}.${k}`).trim()}" value="${esc(txt)}"${lowTip(`items.${i}.${k}`)}>`
        : `<b>${brl(txt)}</b>`);
      return `<div class="card line" data-line="${i}">
        <div class="row" style="align-items:flex-start"><div style="flex:3;min-width:220px"><div class="small muted">Item ${i + 1}${l.supplier_code ? ` · cód. ${esc(l.supplier_code)}` : ''}${l.ncm ? ` · NCM ${esc(l.ncm)}` : ''}</div>
          ${editable ? `<input data-f="description" data-i="${i}" value="${esc(l.description)}" placeholder="Descrição na nota" class="${lowCls(`items.${i}.description`).trim()}"${lowTip(`items.${i}.description`)}>` : `<b>${esc(l.description)}</b>`}</div>
          <div><div class="small muted">Qtd. na nota</div>${editable ? `<div class="row" style="gap:4px"><input data-f="qty" data-i="${i}" inputmode="decimal" value="${l.qty ?? ''}" class="${lowCls(`items.${i}.qty`).trim()}" style="min-width:70px"><input data-f="nf_unit" data-i="${i}" value="${esc(l.nf_unit)}" placeholder="un." style="min-width:56px;flex:.6"></div>` : `<b>${qty(l.qty)} ${esc(l.nf_unit)}</b>`}</div>
          <div><div class="small muted">Valor unit.</div>${field('unit_price', l.unit_price ?? '', 'inputmode="decimal"')}</div>
          <div><div class="small muted">Total do item</div>${field('total', l.total ?? '', 'inputmode="decimal"')}</div></div>
        <label>Item do estoque</label>
        <div class="row"><div style="flex:3"><input list="itemlist" data-pick="${i}" value="${it ? esc(label(it)) : c.new_item ? `＋ ${esc(c.new_item.name)}` : ''}" placeholder="Digite para buscar o item…" autocomplete="off"></div>
          <div class="fit"><button class="small" data-new="${i}">＋ Novo item</button></div></div>
        ${l.suggestion && it && c.item_id === l.suggestion.item_id ? `<div class="small muted">${{ mapa: 'Sugerido pelo histórico deste fornecedor', ean: 'Sugerido pelo código de barras', descricao: 'Sugerido pela descrição parecida — confira' }[l.suggestion.reason]}</div>` : ''}
        ${!it && !c.new_item ? '<div class="small" style="color:var(--bad)">Escolha o item ou crie um novo.</div>' : ''}
        ${it || c.new_item ? `<div class="row"><div><label>Conversão${l.factor_guess ? ' (confira)' : ''}</label><div class="row nowrap" style="gap:6px;align-items:center"><span class="small">1 ${esc(l.nf_unit || 'un.')} =</span>
          <input data-fac="${i}" inputmode="decimal" value="${c.factor}" style="min-width:70px"><span class="small">${esc(it ? it.unit : c.new_item.unit)}</span></div></div>
          <div><label>Local</label><select data-loc="${i}" class="${c.location_id || D.default_location_id || it?.default_location_id ? '' : 'low'}">${opts(refs.locs, c.location_id || D.default_location_id || it?.default_location_id || '', 'Escolha o local…')}</select></div></div>` : ''}
        ${ctl ? `<div class="lots"><label>Lotes e validade (obrigatório)</label>${c.lots.map((x, k) => `<div class="row nowrap" style="align-items:center"><input data-lot="${i}:${k}:lot_code" value="${esc(x.lot_code || '')}" placeholder="Lote">
          <input type="date" data-lot="${i}:${k}:expiry" value="${x.expiry || ''}"><input data-lot="${i}:${k}:qty" inputmode="decimal" value="${x.qty ?? ''}" placeholder="Qtd." style="max-width:90px"><button class="small fit" data-rmlot="${i}:${k}">✕</button></div>`).join('')}
          <button class="small" data-addlot="${i}">＋ Adicionar lote</button></div>` : ''}
        ${editable ? `<button class="small danger" data-rm="${i}" style="margin-top:8px">Remover item</button>` : ''}
      </div>`;
    };

    const t = calc();
    const H = D.header || {};
    const view = () => `<p><a href="#" id="bk">← Voltar (descarta esta conferência)</a></p><h1>Conferir nota</h1>${head}
      ${(D.warnings || []).map((w) => `<div class="msg ${dupBlock ? 'err' : 'info'}">${esc(w)}</div>`).join('')}
      ${D.source === 'danfe' && D.low?.length ? '<div class="msg info">Os campos em amarelo foram lidos com pouca certeza: confira com a nota antes de dar entrada.</div>' : ''}
      <datalist id="itemlist">${items.filter((i) => i.active).map((i) => `<option value="${esc(label(i))}"></option>`).join('')}</datalist>
      <div class="card"><h2>Fornecedor</h2>${supHtml}</div>
      <div class="card"><h2>Nota</h2><div class="row"><div><label>Número</label><input id="hn" value="${esc(D.number)}"${editable ? '' : ' readonly'} class="${lowCls('number').trim()}"></div>
        <div><label>Série</label><input id="hs" value="${esc(D.series)}"${editable ? '' : ' readonly'}></div>
        <div><label>Emissão</label><input id="hd" type="date" value="${D.issue_date || ''}"${editable ? '' : ' readonly'} class="${lowCls('issue_date').trim()}"></div>
        <div><label>Data de entrada</label><input id="he" type="date" value="${D.entry_date}" max="${today()}"></div></div>
        ${D.chave || editable ? `<label>Chave de acesso</label><input id="hk" inputmode="numeric" value="${esc(D.chave || '')}"${editable ? '' : ' readonly'} class="${lowCls('chave').trim()}">` : ''}
        <label>Local padrão dos itens</label><select id="hl">${opts(refs.locs, D.default_location_id, 'Usar o local padrão de cada item')}</select></div>
      <div id="linhas">${D.items.map(itemCard).join('')}</div>
      ${editable ? '<button id="addl" style="margin-bottom:14px">＋ Adicionar item</button>' : ''}
      <div class="card"><h2>Totais e custo</h2>
        <table><tr><td>Produtos</td><td class="n">${brl(t.sum + D.items.reduce((a, l) => a + money(l.discount), 0))}</td></tr>
          ${editable ? `<tr><td>Frete</td><td class="n"><input data-h="freight" inputmode="decimal" value="${H.freight || ''}" style="max-width:120px;text-align:right"></td></tr>
          <tr><td>Seguro</td><td class="n"><input data-h="insurance" inputmode="decimal" value="${H.insurance || ''}" style="max-width:120px;text-align:right"></td></tr>
          <tr><td>Outras despesas</td><td class="n"><input data-h="other" inputmode="decimal" value="${H.other || ''}" style="max-width:120px;text-align:right"></td></tr>
          <tr><td>Desconto</td><td class="n"><input data-h="discount" inputmode="decimal" value="${H.discount || ''}" style="max-width:120px;text-align:right"></td></tr>`
    : `<tr><td>Frete + seguro + outras</td><td class="n">${brl(money(H.freight) + money(H.insurance) + money(H.other))}</td></tr><tr><td>Desconto</td><td class="n">− ${brl(H.discount)}</td></tr><tr><td>IPI + ICMS-ST (entram no custo)</td><td class="n">${brl(money(H.ipi) + money(H.st))}</td></tr>`}
          <tr><th>Total que compõe o custo</th><th class="n" id="tot">${brl(t.total)}</th></tr>
          ${D.totals?.invoice && D.source !== 'manual' ? `<tr><td class="small muted">Total informado na nota</td><td class="n small ${Math.abs(D.totals.invoice - t.total) > 0.05 ? 'bad' : ''}">${brl(D.totals.invoice)}</td></tr>` : ''}</table></div>
      <div class="card"><h2>Pagamento (guardado para o financeiro)</h2><div class="row"><div><label>Forma de pagamento</label><input id="pm" value="${esc(D.payment_method || '')}" placeholder="Boleto, PIX, à vista…"></div>
        <div><label>Condições</label><input id="pt" value="${esc(D.payment_terms || supExisting?.payment_terms || '')}" placeholder="Ex.: 30/60 dias"></div></div>
        <div id="parc">${(D.installments || []).map((p, k) => `<div class="row nowrap" style="align-items:center"><input data-p="${k}:number" value="${esc(p.number || '')}" placeholder="Nº" style="max-width:70px"><input type="date" data-p="${k}:due_date" value="${p.due_date || ''}">
          <input data-p="${k}:amount" inputmode="decimal" value="${p.amount ?? ''}" placeholder="Valor"><button class="small fit" data-rmp="${k}">✕</button></div>`).join('')}</div>
        <button class="small" id="addp">＋ Parcela</button></div>
      <div id="msg"></div>
      <div class="stickybar"><button id="skip">${drafts.length > 1 ? 'Pular esta nota' : 'Cancelar'}</button><button class="primary" id="ok" ${dupBlock ? 'disabled' : ''} style="flex:2">Dar entrada</button></div>`;

    const redraw = () => {   // mantém o que foi digitado: o estado já está em D
      const y = scrollY; shell(view(), 'estoque'); bind(); scrollTo(0, y);
    };
    const fields = ['description', 'nf_unit', 'qty', 'unit_price', 'total'];
    function bind() {
      const q = (s) => document.querySelectorAll(s);
      const retotal = () => { const x = calc(); $('#tot').textContent = brl(x.total); };
      if ($('#sdoc')) $('#sdoc').oninput = (e) => { D.supplier.doc = e.target.value; };
      if ($('#snm')) $('#snm').oninput = (e) => { D.supplier.name = e.target.value; };
      $('#hn').oninput = (e) => { D.number = e.target.value; }; $('#hs').oninput = (e) => { D.series = e.target.value; };
      $('#hd').onchange = (e) => { D.issue_date = e.target.value || null; }; $('#he').onchange = (e) => { D.entry_date = e.target.value; };
      if ($('#hk')) $('#hk').oninput = (e) => { D.chave = e.target.value.replace(/\D/g, '') || null; };
      $('#hl').onchange = (e) => { D.default_location_id = e.target.value; };
      $('#pm').oninput = (e) => { D.payment_method = e.target.value; }; $('#pt').oninput = (e) => { D.payment_terms = e.target.value; };
      q('[data-f]').forEach((el) => (el.oninput = () => {
        const l = D.items[+el.dataset.i]; const k = el.dataset.f; l[k] = ['description', 'nf_unit'].includes(k) ? el.value : toNum(el.value);
        if (k === 'qty' || k === 'unit_price') { l.total = money(l.qty * l.unit_price); const tt = document.querySelector(`[data-f=total][data-i="${el.dataset.i}"]`); if (tt) tt.value = l.total; }
        if (k === 'nf_unit') { const it = l.choice.item_id ? itemById(l.choice.item_id) : null; if (it) { l.choice.factor = unitFactor(it, l.nf_unit); const fe = document.querySelector(`[data-fac="${el.dataset.i}"]`); if (fe) fe.value = l.choice.factor; } }
        retotal();
      }));
      q('[data-h]').forEach((el) => (el.oninput = () => { D.header[el.dataset.h] = toNum(el.value); retotal(); }));
      q('[data-pick]').forEach((el) => (el.onchange = () => {
        const l = D.items[+el.dataset.pick]; const it = items.find((x) => label(x) === el.value);
        if (it) { l.choice.item_id = it.id; l.choice.new_item = null; l.choice.factor = unitFactor(it, l.nf_unit); l.factor_guess = false; if (it.controls_lot && !l.choice.lots.length) l.choice.lots = [{ lot_code: '', expiry: '', qty: l.qty }]; redraw(); }
        else if (!el.value.startsWith('＋')) { l.choice.item_id = null; redraw(); }
      }));
      q('[data-fac]').forEach((el) => (el.oninput = () => { D.items[+el.dataset.fac].choice.factor = toNum(el.value); }));
      q('[data-loc]').forEach((el) => (el.onchange = () => { D.items[+el.dataset.loc].choice.location_id = el.value; el.classList.toggle('low', !el.value); }));
      q('[data-lot]').forEach((el) => (el.oninput = el.onchange = () => { const [i, k, f] = el.dataset.lot.split(':'); const x = D.items[+i].choice.lots[+k]; x[f] = f === 'qty' ? toNum(el.value) : el.value; }));
      q('[data-addlot]').forEach((el) => (el.onclick = () => { D.items[+el.dataset.addlot].choice.lots.push({ lot_code: '', expiry: '', qty: '' }); redraw(); }));
      q('[data-rmlot]').forEach((el) => (el.onclick = () => { const [i, k] = el.dataset.rmlot.split(':'); D.items[+i].choice.lots.splice(+k, 1); redraw(); }));
      q('[data-rm]').forEach((el) => (el.onclick = () => { D.items.splice(+el.dataset.rm, 1); redraw(); }));
      q('[data-p]').forEach((el) => (el.oninput = el.onchange = () => { const [k, f] = el.dataset.p.split(':'); D.installments[+k][f] = f === 'amount' ? toNum(el.value) : el.value; }));
      q('[data-rmp]').forEach((el) => (el.onclick = () => { D.installments.splice(+el.dataset.rmp, 1); redraw(); }));
      $('#addp').onclick = () => { (D.installments ||= []).push({ number: String(D.installments.length + 1), due_date: '', amount: '' }); redraw(); };
      if ($('#addl')) $('#addl').onclick = () => { D.items.push({ n: D.items.length + 1, description: '', nf_unit: '', qty: 1, unit_price: 0, total: 0, discount: 0, ipi: 0, st: 0, lots: [], candidates: [], choice: { item_id: null, factor: 1, location_id: '', lots: [], new_item: null, save_map: true } }); redraw(); };
      q('[data-new]').forEach((el) => (el.onclick = () => newItemForm(+el.dataset.new)));
      const leave = (e) => { e?.preventDefault(); if (confirm('Descartar esta conferência? Nada foi lançado no estoque.')) exit(); };
      $('#bk').onclick = leave;
      $('#skip').onclick = () => (drafts.length > 1 ? next() : leave());
      $('#ok').onclick = confirmar;
    }
    function newItemForm(i) {
      const l = D.items[i]; const modal = document.createElement('div'); modal.className = 'modal light';
      modal.innerHTML = `<form class="card" style="width:100%;max-width:440px;max-height:90vh;overflow:auto"><h2>Novo item de estoque</h2>
        <label>Nome</label><input id="nn" required value="${esc(l.description || '')}"><div class="row"><div><label>Unidade de medida</label><select id="nu">${UNITS.map((u) => `<option ${u === (canonUnit(l.nf_unit) || 'unidade') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div><label>Categoria</label><select id="nc">${opts(refs.cats, '', 'Sem categoria')}</select></div></div>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input id="nl" type="checkbox" style="width:auto;min-height:0"> Controla lote e validade</label>
        <div style="margin-top:12px" class="row"><button type="button" id="nx">Cancelar</button><button class="primary">Usar este item</button></div></form>`;
      document.body.append(modal); $('#nn', modal).focus();
      $('#nx', modal).onclick = () => modal.remove();
      $('form', modal).onsubmit = (e) => {
        e.preventDefault();
        l.choice.new_item = { name: $('#nn', modal).value.trim(), unit: $('#nu', modal).value, category_id: $('#nc', modal).value || null, controls_lot: $('#nl', modal).checked, pack_unit: canonUnit(l.nf_unit) && canonUnit(l.nf_unit) !== $('#nu', modal).value ? canonUnit(l.nf_unit) : null, pack_factor: null };
        l.choice.item_id = null; l.choice.factor = 1; l.factor_guess = canonUnit(l.nf_unit) !== $('#nu', modal).value;
        if (l.choice.new_item.controls_lot && !l.choice.lots.length) l.choice.lots = [{ lot_code: '', expiry: '', qty: l.qty }];
        modal.remove(); redraw();
      };
    }
    async function confirmar() {
      const btn = $('#ok'); $('#msg').innerHTML = '';
      const body = {
        source: D.source, xml: D.source === 'xml' ? D.xml : undefined, chave: D.chave, model: D.model, series: D.series, number: D.number, issue_date: D.issue_date,
        entry_date: D.entry_date, default_location_id: D.default_location_id || null, header: D.header, payment_method: D.payment_method, payment_terms: D.payment_terms,
        installments: (D.installments || []).filter((p) => p.due_date && toNum(p.amount) > 0).map((p) => ({ ...p, amount: toNum(p.amount) })),
        supplier: D.supplier.existing ? { id: D.supplier.existing.id } : { doc: D.supplier.doc, name: D.supplier.name, trade_name: D.supplier.trade_name },
        items: D.items.map((l) => ({
          n: l.n, supplier_code: l.supplier_code, description: l.description, ncm: l.ncm, ean: l.ean, nf_unit: l.nf_unit, qty: l.qty, unit_price: l.unit_price, total: l.total, discount: l.discount, ipi: l.ipi, st: l.st,
          item_id: l.choice.item_id, new_item: l.choice.new_item, factor: l.choice.factor, location_id: l.choice.location_id || null, lots: l.choice.lots, save_map: true,
        })),
      };
      if (!confirm(`Dar entrada em ${D.items.length} item(ns), total ${brl(calc().total)}?`)) return;
      btn.disabled = true; btn.textContent = 'Gravando…';
      try {
        const r = await call('/compras', { method: 'POST', body });
        toast(`Entrada feita: ${brl(r.total)}.`);
        if (drafts.length > 1) next(); else location.hash = `#/estoque/nota/${r.id}`;
      } catch (e) {
        $('#msg').innerHTML = err(e); btn.disabled = false; btn.textContent = 'Dar entrada';   // a tela e os dados continuam como estavam
        $('#msg').scrollIntoView({ block: 'center' });
      }
    }
    function next() {
      if (index + 1 < drafts.length) conferencia(drafts, { items, refs, index: index + 1, exit });
      else { toast('Todas as notas foram conferidas.'); location.hash = '#/estoque/notas'; }
    }
    shell(view(), 'estoque'); bind();
  }

  // ---------------------------------------------------------------- notas lançadas
  async function viewNotas() {
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const rows = await call('/compras?limit=200');
      $('main').innerHTML = `${back()}<h1>Notas lançadas</h1><div class="card scroll">${rows.length ? `<table><tr><th>Entrada</th><th>Fornecedor</th><th>Nota</th><th class="n">Total</th></tr>
        ${rows.map((p) => `<tr><td>${fdate(p.entry_date)}</td><td><a href="#/estoque/nota/${p.id}">${esc(p.supplier)}</a>${p.status === 'cancelada' ? ' <span class="chip alerta">Cancelada</span>' : ''}</td>
          <td>${esc(p.number || '—')}<div class="small muted">${{ xml: 'XML', danfe: 'Foto/PDF', chave: 'Chave', manual: 'Manual' }[p.source]} · ${p.items} it.</div></td><td class="n">${can('estoque_cadastros') ? brl(p.total_invoice) : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhuma nota ainda.</p>'}</div>`;
    } catch (e) { $('main').innerHTML = err(e); }
  }
  async function viewNota(id) {
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const p = await call(`/compras/${id}`); const money2 = can('estoque_cadastros');
      $('main').innerHTML = `${back('#/estoque/notas', 'Notas')}<h1>Nota ${esc(p.number || '')} ${p.status === 'cancelada' ? '<span class="chip alerta">Cancelada</span>' : '<span class="chip ok">Entrada feita</span>'}</h1>
        <div class="card"><p><b>${esc(p.supplier)}</b>${p.supplier_doc ? `<br><span class="muted small">${esc(p.supplier_doc)}</span>` : ''}</p>
          <p class="small">Emissão ${p.issue_date ? fdate(p.issue_date) : '—'} · Entrada ${fdate(p.entry_date)} · por ${esc(p.created_by || '—')} · ${{ xml: 'XML', danfe: 'foto/PDF', chave: 'chave', manual: 'manual' }[p.source]}</p>
          ${p.chave_acesso ? `<p class="small muted" style="word-break:break-all">Chave: ${esc(p.chave_acesso)}</p>` : ''}${p.cancel_reason ? `<p class="small">Motivo do cancelamento: ${esc(p.cancel_reason)}</p>` : ''}</div>
        <div class="card scroll"><table><tr><th>Item</th><th class="n">Qtd. estoque</th>${money2 ? '<th class="n">Custo un.</th><th class="n">Custo total</th>' : ''}</tr>
          ${p.items.map((i) => `<tr><td><a href="#/estoque/item/${i.item_id}">${esc(i.item_name)}</a><div class="small muted">${esc(i.description)} · ${qty(i.qty)} ${esc(i.nf_unit || '')}</div></td><td class="n">${qty(i.stock_qty)} ${esc(i.item_unit)}</td>${money2 ? `<td class="n">${brl(i.unit_cost)}</td><td class="n">${brl(i.landed_total)}</td>` : ''}</tr>`).join('')}
          ${money2 ? `<tr><th colspan="3">Total</th><th class="n">${brl(p.total_invoice)}</th></tr>` : ''}</table></div>
        ${p.installments.length ? `<div class="card"><h2>Vencimentos</h2>${p.payment_method ? `<p class="small muted">${esc(p.payment_method)}</p>` : ''}<table>${p.installments.map((x) => `<tr><td>${esc(x.number || '')}</td><td>${fdate(x.due_date)}</td><td class="n">${brl(x.amount)}</td></tr>`).join('')}</table></div>` : ''}
        <div class="row">${can('estoque_entrada') && p.source === 'xml' ? '<a class="btn" id="dlx" href="#">Baixar XML</a>' : ''}${can('estoque_cadastros') && p.status === 'confirmada' ? '<button class="danger" id="cn">Cancelar entrada</button>' : ''}</div><div id="msg"></div>`;
      if ($('#dlx')) $('#dlx').onclick = async (e) => { e.preventDefault(); try { const b = await call(`/compras/${id}/xml`); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `nfe-${p.number || id}.xml`; a.click(); } catch (x) { toast(x.message); } };
      if ($('#cn')) $('#cn').onclick = async () => {
        const reason = prompt('Motivo do cancelamento (o estoque desta nota será estornado):'); if (reason === null) return;
        try { await call(`/compras/${id}/cancelar`, { method: 'POST', body: { reason } }); toast('Entrada cancelada.'); viewNota(id); } catch (e) { $('#msg').innerHTML = err(e); }
      };
    } catch (e) { $('main').innerHTML = err(e); }
  }

  // ---------------------------------------------------------------- cadastro de itens
  async function viewItens() {
    if (!guardView('estoque_cadastros')) return;
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const [items, cats, locs, ccs, sups] = await Promise.all([call('/itens?active=all&limit=2000'), call('/categorias'), call('/locais'), call('/setores'), call('/fornecedores')]);
      const editId = +(new URLSearchParams(location.hash.split('?')[1] || '').get('edit')) || null;
      const form = (it = {}) => `<form id="f" class="card"><h2>${it.id ? 'Editar item' : 'Novo item'}</h2>
        <div class="row"><div style="flex:2"><label>Nome</label><input id="n" required value="${esc(it.name || '')}"></div><div><label>Código interno (vazio = automático)</label><input id="c" value="${esc(it.code || '')}"></div></div>
        <div class="row"><div><label>Categoria</label><select id="cat">${opts(cats, it.category_id, 'Sem categoria')}</select></div>
          <div><label>Unidade de medida</label><select id="u">${UNITS.map((u) => `<option ${u === it.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          <div><label>Código de barras/QR (opcional)</label><input id="bc" value="${esc(it.barcode || '')}"></div></div>
        <div class="row"><div><label>Embalagem de compra (ex.: saco)</label><input id="pu" value="${esc(it.pack_unit || '')}"></div><div><label>Quanto tem em cada embalagem (ex.: 25)</label><input id="pf" inputmode="decimal" value="${it.pack_factor ?? ''}"></div>
          <div><label>Estoque mínimo</label><input id="mn" inputmode="decimal" value="${it.min_stock ?? 0}"></div></div>
        <div class="row"><div><label>Fornecedor padrão</label><select id="sp">${opts(sups, it.supplier_id, '—')}</select></div><div><label>Local padrão</label><select id="lp">${opts(locs, it.default_location_id, '—')}</select></div>
          <div><label>Setor padrão sugerido</label><select id="cc">${opts(ccs, it.default_cost_center_id, '—')}</select></div></div>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input id="cl" type="checkbox" style="width:auto;min-height:0" ${it.controls_lot ? 'checked' : ''}> Controla lote e validade</label>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input id="rc" type="checkbox" style="width:auto;min-height:0" ${it.require_cost_center ? 'checked' : ''}> Exigir setor nas saídas</label>
        ${it.id ? `<label>Foto (opcional)</label><input id="ph" type="file" accept="image/*">` : ''}<div id="e"></div>
        <div class="row" style="margin-top:12px"><button class="primary">Salvar</button>${it.id ? `<button type="button" id="ia">${it.active ? 'Inativar' : 'Reativar'}</button>` : ''}<a class="btn" href="#/estoque/itens">Fechar</a></div></form>`;
      $('main').innerHTML = `${back()}<h1>Itens de estoque</h1>
        <div id="formbox"></div>
        <div class="card"><div class="row"><button class="primary" id="nw">＋ Novo item</button><a class="btn" href="#" id="mod">Baixar modelo de planilha</a></div>
          <details style="margin-top:10px"><summary><b>Importar itens por planilha (Excel/CSV)</b></summary><form id="imp"><p class="small muted">Colunas: Nome, Código, Código de barras, Categoria, Unidade, Embalagem, Fator, Fornecedor, Local, Estoque mínimo, Controla lote, Setor, Exige setor. Itens com o mesmo código (ou nome) são atualizados.</p>
          <input id="fi" type="file" accept=".xlsx,.csv,.txt" required><div style="margin-top:8px"><button class="primary">Ver prévia</button></div></form><div id="prev"></div></details></div>
        <div class="card"><label for="q">Buscar</label><input id="q" type="search" placeholder="Nome ou código"><div id="lista" class="scroll" style="margin-top:8px"></div></div>`;
      const draw = (q = '') => {
        const rows = items.filter((i) => !q || `${i.name} ${i.code}`.toLowerCase().includes(q));
        $('#lista').innerHTML = `<table><tr><th>Item</th><th>Unid.</th><th class="n">Saldo</th><th></th></tr>${rows.slice(0, 300).map((i) => `<tr class="${i.active ? '' : 'inativo'}"><td>${esc(i.name)}<div class="small muted">${esc(i.code)}${i.active ? '' : ' · inativo'}</div></td><td>${esc(i.unit)}</td><td class="n">${nf(i.stock, 2)}</td><td><button class="small" data-e="${i.id}">Editar</button></td></tr>`).join('')}</table>`;
        document.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => open(items.find((x) => x.id === +b.dataset.e))));
      };
      const open = (it) => {
        $('#formbox').innerHTML = form(it); $('#formbox').scrollIntoView();
        $('#f').onsubmit = async (ev) => {
          ev.preventDefault(); $('#e').innerHTML = '';
          const body = { name: $('#n').value, code: $('#c').value, category_id: $('#cat').value, unit: $('#u').value, barcode: $('#bc').value, pack_unit: $('#pu').value, pack_factor: $('#pf').value, min_stock: $('#mn').value,
            supplier_id: $('#sp').value, default_location_id: $('#lp').value, default_cost_center_id: $('#cc').value, controls_lot: $('#cl').checked, require_cost_center: $('#rc').checked };
          try {
            await call(it.id ? `/itens/${it.id}` : '/itens', { method: it.id ? 'PUT' : 'POST', body });
            if (it.id && $('#ph')?.files[0]) { const fd = new FormData(); fd.append('file', $('#ph').files[0]); await call(`/itens/${it.id}/foto`, { method: 'POST', form: fd }); }
            toast('Item salvo.'); viewItens();
          } catch (e) { $('#e').innerHTML = err(e); }
        };
        if ($('#ia')) $('#ia').onclick = async () => { try { await call(`/itens/${it.id}`, { method: 'PUT', body: { active: !it.active } }); viewItens(); } catch (e) { $('#e').innerHTML = err(e); } };
      };
      $('#nw').onclick = () => open({});
      $('#q').oninput = (e) => draw(e.target.value.trim().toLowerCase());
      $('#mod').onclick = async (e) => { e.preventDefault(); try { const b = await call('/itens/modelo.csv'); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'modelo-itens.csv'; a.click(); } catch (x) { toast(x.message); } };
      const sendImp = (commit) => { const fd = new FormData(); fd.append('file', $('#fi').files[0]); fd.append('commit', commit ? '1' : '0'); return call('/itens/importar', { method: 'POST', form: fd }); };
      $('#imp').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const p = await sendImp(false); const news = [['categorias', p.new_categories], ['locais', p.new_locations], ['setores', p.new_cost_centers], ['fornecedores', p.new_suppliers]].filter(([, a]) => a?.length);
          $('#prev').innerHTML = `<div class="card">${(p.problems || []).map((x) => `<div class="msg err">${esc(x)}</div>`).join('')}<p>${p.rows_read} linhas · <b>${p.to_create || 0}</b> itens novos · <b>${p.to_update || 0}</b> atualizados</p>
            ${news.map(([n, a]) => `<div class="msg info">Novos(as) ${n} que serão criados(as): ${a.map(esc).join(', ')}</div>`).join('')}
            ${p.errors_total ? `<div class="msg err">${p.errors_total} linhas com problema serão ignoradas:<br>${p.errors.slice(0, 8).map((x) => `Linha ${x.line}: ${esc(x.error)}`).join('<br>')}</div>` : ''}
            ${!(p.problems || []).length && (p.to_create || p.to_update) ? '<button class="primary" id="go">Confirmar importação</button>' : ''}</div>`;
          if ($('#go')) $('#go').onclick = async () => { $('#go').disabled = true; try { const r = await sendImp(true); toast(`${r.inserted} criados, ${r.updated} atualizados.`); viewItens(); } catch (e) { $('#prev').innerHTML = err(e); } };
        } catch (e) { $('#prev').innerHTML = err(e); }
      };
      draw(); if (editId) open(items.find((x) => x.id === editId) || {});
    } catch (e) { $('main').innerHTML = err(e); }
  }

  // ---------------------------------------------------------------- fornecedores e listas
  async function viewCadastros() {
    if (!guardView('estoque_cadastros')) return;
    shell('<div class="muted">Carregando…</div>', 'estoque');
    try {
      const [sups, ccs, locs, cats] = await Promise.all([call('/fornecedores?all=1'), call('/setores?all=1'), call('/locais?all=1'), call('/categorias?all=1')]);
      const simple = (title, path, rows) => `<div class="card"><h2>${title}</h2><table>${rows.map((r) => `<tr class="${r.active ? '' : 'inativo'}"><td><input data-ren="${path}:${r.id}" value="${esc(r.name)}" style="min-height:38px"></td>
        <td class="fit"><button class="small" data-tg="${path}:${r.id}:${!r.active}">${r.active ? 'Inativar' : 'Reativar'}</button></td></tr>`).join('')}</table>
        <form data-add="${path}" class="row" style="margin-top:8px"><input placeholder="Novo nome" required><button class="fit">Adicionar</button></form></div>`;
      $('main').innerHTML = `${back()}<h1>Fornecedores e listas</h1>
        <div class="card"><h2>Fornecedores</h2><div class="scroll"><table><tr><th>Nome</th><th>CNPJ/CPF</th><th></th></tr>${sups.map((s) => `<tr class="${s.active ? '' : 'inativo'}"><td>${esc(s.name)}<div class="small muted">${esc(s.contact || '')} ${esc(s.payment_terms ? `· ${s.payment_terms}` : '')}</div></td><td class="small">${esc(s.doc || '—')}</td><td><button class="small" data-se="${s.id}">Editar</button></td></tr>`).join('')}</table></div>
          <button class="primary" id="ns" style="margin-top:8px">＋ Novo fornecedor</button><div id="sf"></div></div>
        ${simple('Setores / centros de custo', 'setores', ccs)}${simple('Locais de armazenamento', 'locais', locs)}${simple('Categorias de itens', 'categorias', cats)}`;
      document.querySelectorAll('[data-ren]').forEach((el) => (el.onchange = async () => { const [p, id] = el.dataset.ren.split(':'); try { await call(`/${p}/${id}`, { method: 'PUT', body: { name: el.value } }); toast('Nome alterado.'); } catch (e) { toast(e.message); } }));
      document.querySelectorAll('[data-tg]').forEach((el) => (el.onclick = async () => { const [p, id, a] = el.dataset.tg.split(':'); try { await call(`/${p}/${id}`, { method: 'PUT', body: { active: a === 'true' } }); viewCadastros(); } catch (e) { toast(e.message); } }));
      document.querySelectorAll('[data-add]').forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); try { await call(`/${f.dataset.add}`, { method: 'POST', body: { name: f.firstElementChild.value } }); viewCadastros(); } catch (e) { toast(e.message); } }));
      const supForm = (s = {}) => {
        $('#sf').innerHTML = `<form id="sfm" class="card" style="margin-top:10px"><div class="row"><div style="flex:2"><label>Nome / razão social</label><input id="sn" required value="${esc(s.name || '')}"></div><div><label>CNPJ/CPF</label><input id="sd" inputmode="numeric" value="${esc(s.doc || '')}"></div></div>
          <div class="row"><div><label>Contato</label><input id="sc" value="${esc(s.contact || '')}"></div><div><label>Condições de pagamento</label><input id="sp" value="${esc(s.payment_terms || '')}"></div></div><div id="se"></div>
          <div class="row" style="margin-top:10px"><button class="primary">Salvar</button>${s.id ? `<button type="button" id="sa">${s.active ? 'Inativar' : 'Reativar'}</button>` : ''}</div></form>`;
        $('#sfm').onsubmit = async (ev) => { ev.preventDefault(); try { await call(s.id ? `/fornecedores/${s.id}` : '/fornecedores', { method: s.id ? 'PUT' : 'POST', body: { name: $('#sn').value, doc: $('#sd').value, contact: $('#sc').value, payment_terms: $('#sp').value } }); viewCadastros(); } catch (e) { $('#se').innerHTML = err(e); } };
        if ($('#sa')) $('#sa').onclick = async () => { await call(`/fornecedores/${s.id}`, { method: 'PUT', body: { active: !s.active } }); viewCadastros(); };
      };
      $('#ns').onclick = () => supForm();
      document.querySelectorAll('[data-se]').forEach((b) => (b.onclick = () => supForm(sups.find((x) => x.id === +b.dataset.se))));
    } catch (e) { $('main').innerHTML = err(e); }
  }

  return { estoque: viewEstoque, 'estoque/entrada': viewEntrada, 'estoque/notas': viewNotas, 'estoque/nota': viewNota, 'estoque/item': viewItemDetalhe, 'estoque/itens': viewItens, 'estoque/cadastros': viewCadastros };
}
