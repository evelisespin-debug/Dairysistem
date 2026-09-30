import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { setup } from './helpers.js';
import { allocateCosts, chaveDigitOk, extractChave, parseChave, parseNfeXml } from '../server/estoque/nfe.js';
import { normalizeOcr } from '../server/estoque/compras.js';

// ---------- fixture: NF-e fictícia com chave válida ----------
function makeChave({ cnpj = '11222333000181', nnf = 1234, serie = 1 } = {}) {
  const base = `35${'2609'}${cnpj}55${String(serie).padStart(3, '0')}${String(nnf).padStart(9, '0')}1${'12345678'}`;
  let s = 0; let w = 2;
  for (let i = base.length - 1; i >= 0; i--) { s += +base[i] * w; w = w === 9 ? 2 : w + 1; }
  const r = s % 11;
  return base + (r < 2 ? 0 : 11 - r);
}
function makeXml({ nnf = 1234, cnpj = '11222333000181', frete = 100, lote = null } = {}) {
  const chave = makeChave({ nnf, cnpj });
  const rastro = lote ? `<rastro><nLote>${lote}</nLote><qLote>10.000</qLote><dFab>2026-01-10</dFab><dVal>2028-01-10</dVal></rastro>` : '';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>${nnf}</nNF><dhEmi>2026-09-25T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>${cnpj}</CNPJ><xNome>COOPERATIVA AGRO TESTE LTDA</xNome><xFant>Agro Teste</xFant><enderEmit><UF>SP</UF></enderEmit></emit>
<det nItem="1"><prod><cProd>RAC22</cProd><cEAN>SEM GTIN</cEAN><xProd>RACAO LACTACAO 22% SACO 25KG</xProd><NCM>23099090</NCM><uCom>SC</uCom>
  <qCom>40.0000</qCom><vUnCom>80.000000</vUnCom><vProd>3200.00</vProd><vDesc>200.00</vDesc></prod>
  <imposto><ICMS><ICMS00><vICMS>0.00</vICMS></ICMS00></ICMS><IPI><IPITrib><vIPI>0.00</vIPI></IPITrib></IPI></imposto></det>
<det nItem="2"><prod><cProd>IVER1</cProd><cEAN>7891234567895</cEAN><xProd>IVERMECTINA 1% FRASCO 500ML</xProd><NCM>30049099</NCM><uCom>UN</uCom>
  <qCom>10.0000</qCom><vUnCom>60.000000</vUnCom><vProd>600.00</vProd>${rastro}</prod>
  <imposto><ICMS><ICMS10><vICMSST>30.00</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>10.00</vIPI></IPITrib></IPI></imposto></det>
<total><ICMSTot><vBC>0</vBC><vICMS>0</vICMS><vST>30.00</vST><vProd>3800.00</vProd><vFrete>${frete.toFixed(2)}</vFrete><vSeg>0.00</vSeg><vDesc>200.00</vDesc><vIPI>10.00</vIPI><vOutro>0.00</vOutro><vNF>${(3800 + frete - 200 + 10 + 30).toFixed(2)}</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-10-25</dVenc><vDup>1870.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-11-25</dVenc><vDup>1870.00</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>3740.00</vPag></detPag></pag></infNFe></NFe>
<protNFe><infProt><nProt>135260000000001</nProt><chNFe>${chave}</chNFe></infProt></protNFe></nfeProc>`;
  return { xml, chave };
}

// ---------- funções puras ----------
test('chave de acesso: dígito verificador, extração de URL de QR code e dados embutidos', () => {
  const { chave } = makeXml();
  assert.ok(chaveDigitOk(chave));
  assert.ok(!chaveDigitOk(chave.slice(0, 43) + ((+chave[43] + 1) % 10)));
  const k = parseChave(chave);
  assert.equal(k.cnpj, '11222333000181'); assert.equal(k.number, '1234'); assert.equal(k.uf, 'SP'); assert.equal(k.year_month, '2026-09');
  assert.equal(extractChave(`https://www.exemplo.gov.br/qrcode?p=${chave}|2|1|1|ABCDEF`), chave);
  assert.equal(extractChave(chave.match(/.{4}/g).join(' ')), chave);
  assert.equal(extractChave('nada aqui'), null);
});

test('XML: lê cabeçalho, itens, parcelas, impostos e rastro', () => {
  const p = parseNfeXml(makeXml({ lote: 'L77' }).xml);
  assert.equal(p.number, '1234'); assert.equal(p.issue_date, '2026-09-25'); assert.equal(p.supplier.doc, '11222333000181');
  assert.equal(p.items.length, 2); assert.equal(p.items[0].nf_unit, 'SC'); assert.equal(p.items[0].ean, '');
  assert.equal(p.items[1].ean, '7891234567895'); assert.equal(p.items[1].st, 30); assert.equal(p.items[1].ipi, 10);
  assert.deepEqual(p.items[1].lots.map((l) => [l.lot_code, l.expiry]), [['L77', '2028-01-10']]);
  assert.equal(p.installments.length, 2); assert.equal(p.payment_method, 'Boleto bancário'); assert.equal(p.totals.invoice, 3740);
  assert.throws(() => parseNfeXml('<cteProc><CTe/></cteProc>'), /CT-e/);
  assert.throws(() => parseNfeXml('isto não é xml <<'), /XML|NF-e/);
});

test('custo: frete rateado e soma dos itens fecha com o total da nota', () => {
  const p = parseNfeXml(makeXml().xml);
  const a = allocateCosts(p.items, p.header);
  assert.equal(a.total, 3740);
  // item 1: 3000 + parte de 100 de frete (3000/3600)
  assert.ok(Math.abs(a.lines[0].landed_total - (3000 + 83.33)) < 0.02);
  const odd = allocateCosts([{ total: 10, discount: 0 }, { total: 10, discount: 0 }, { total: 10, discount: 0 }], { freight: 10 });
  assert.equal(odd.total, 40);
});

test('OCR: marca baixa confiança e divergência de totais', () => {
  const f = (v, c = 0.95) => ({ v, c });
  const r = normalizeOcr({
    chave: f('123', 0.4), numero: f('55'), serie: f('1'), data_emissao: f('2026-09-01'), fornecedor_doc: f('11222333000181'), fornecedor_nome: f('X', 0.6),
    total_nota: f(999), itens: [{ codigo: f('A'), descricao: f('Sal mineral'), unidade: f('SC'), quantidade: f(2), valor_unitario: f(50), valor_total: f(100) }],
  });
  assert.equal(r.source, 'danfe'); assert.equal(r.chave, null);
  assert.ok(r.low.includes('chave') && r.low.includes('supplier.name') && r.low.includes('totals.invoice'));
  assert.ok(r.warnings.length);
});

// ---------- API ----------
let t; let cats; let locs; let ccs;
const services = { provider: null, ocr: null };
before(async () => {
  t = await setup({ services });
  cats = (await t.call('dono', 'GET', '/api/estoque/categorias')).body;
  locs = (await t.call('dono', 'GET', '/api/estoque/locais')).body;
  ccs = (await t.call('dono', 'GET', '/api/estoque/setores')).body;
});
after(async () => { await t.close(); });

test('cadastros iniciais e permissões por perfil', async () => {
  assert.ok(cats.length >= 12 && locs.length === 7 && ccs.length === 8);
  assert.equal((await t.call('funcionario', 'GET', '/api/estoque/itens')).status, 403);
  assert.equal((await t.call('encarregado', 'GET', '/api/estoque/itens')).status, 200);
  assert.equal((await t.call('encarregado', 'POST', '/api/estoque/itens', { name: 'X', unit: 'kg' })).status, 403);
  assert.equal((await t.call('almoxarife', 'POST', '/api/estoque/itens', { name: 'X', unit: 'kg' })).status, 403);
  assert.equal((await t.call('gerente', 'POST', '/api/estoque/setores', { name: 'Reprodução' })).status, 200);
  const nfeRole = async (role) => (await t.call(role, 'POST', '/api/estoque/nfe/chave', { text: makeChave() })).status;
  assert.equal(await nfeRole('encarregado'), 403);       // encarregado de setor não dá entrada por nota
  assert.equal(await nfeRole('almoxarife'), 200);
  assert.equal(await nfeRole('gerente'), 200);
});

let racao; let ivermectina;
test('itens: cria, valida unidade e não repete código', async () => {
  const r = await t.call('gerente', 'POST', '/api/estoque/itens', { name: 'Ração lactação 22%', code: 'RAC001', unit: 'kg', pack_unit: 'saco', pack_factor: 25, category_id: cats[0].id, default_location_id: locs[1].id, min_stock: 500 });
  assert.equal(r.status, 200); racao = r.body;
  assert.equal((await t.call('gerente', 'POST', '/api/estoque/itens', { name: 'Outro', code: 'rac001', unit: 'kg' })).status, 409);
  assert.equal((await t.call('gerente', 'POST', '/api/estoque/itens', { name: 'Ruim', unit: 'galão' })).status, 400);
  const iv = await t.call('gerente', 'POST', '/api/estoque/itens', { name: 'Ivermectina 1% 500 mL', unit: 'unidade', barcode: '7891234567895', controls_lot: true, default_location_id: locs[2].id });
  ivermectina = iv.body; assert.match(ivermectina.code, /^IT\d{5}$/);
});

test('ler XML: rascunho com fornecedor novo, de-para sugerido e nada gravado', async () => {
  const { xml } = makeXml({ lote: 'L77' });
  const r = await t.files('almoxarife', '/api/estoque/nfe/ler', [{ name: 'nota.xml', type: 'text/xml', data: xml }]);
  assert.equal(r.status, 200); assert.equal(r.body.errors.length, 0);
  const d = r.body.drafts[0];
  assert.equal(d.supplier.existing, null); assert.equal(d.items.length, 2);
  assert.equal(d.items[0].suggestion.item_id, racao.id);        // por descrição parecida
  assert.equal(d.items[0].factor, 25);                          // SC -> 25 kg
  assert.equal(d.items[1].suggestion.reason, 'ean'); assert.equal(d.items[1].needs_lot, true);
  assert.equal(d.totals.computed, 3740); assert.equal(d.warnings.length, 0);
  assert.equal((await t.pool.query('select count(*)::int n from purchases')).rows[0].n, 0);
  assert.equal((await t.pool.query('select count(*)::int n from suppliers')).rows[0].n, 0);
});

test('dar entrada: exige lote/validade, grava tudo e barra duplicidade', async () => {
  const { xml, chave } = makeXml({ lote: 'L77' });
  const lines = (lots) => [
    { n: 1, item_id: racao.id, factor: 25 },
    { n: 2, item_id: ivermectina.id, factor: 1, lots },
  ];
  const noLot = await t.call('almoxarife', 'POST', '/api/estoque/compras', { source: 'xml', xml, entry_date: '2026-09-26', items: lines([]) });
  assert.equal(noLot.status, 400); assert.match(noLot.body.error, /lote/i);
  const noExp = await t.call('almoxarife', 'POST', '/api/estoque/compras', { source: 'xml', xml, entry_date: '2026-09-26', items: lines([{ lot_code: 'L77' }]) });
  assert.equal(noExp.status, 400); assert.match(noExp.body.error, /validade/i);

  const ok = await t.call('almoxarife', 'POST', '/api/estoque/compras', { source: 'xml', xml, entry_date: '2026-09-26', items: lines([{ lot_code: 'L77', expiry: '2028-01-10', qty: 10 }]) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.total, 3740);

  const p = (await t.call('gerente', 'GET', `/api/estoque/compras/${ok.body.id}`)).body;
  assert.equal(p.supplier, 'COOPERATIVA AGRO TESTE LTDA'); assert.equal(p.chave_acesso, chave); assert.equal(p.installments.length, 2);
  assert.equal(p.payment_method, 'Boleto bancário'); assert.equal(p.items[0].stock_qty, 1000);
  const it = (await t.call('gerente', 'GET', `/api/estoque/itens/${racao.id}`)).body;
  assert.equal(it.stock, 1000);
  assert.ok(Math.abs(it.avg_cost - 3083.33 / 1000) < 0.001);
  const iv = (await t.call('gerente', 'GET', `/api/estoque/itens/${ivermectina.id}`)).body;
  assert.equal(iv.stock, 10); assert.equal(iv.balances[0].lot_code, 'L77');
  const sum = (await t.pool.query('select sum(total_cost)::numeric(14,2) s from stock_movements')).rows[0].s;
  assert.ok(Math.abs(sum - 3740) < 0.05);                        // custo do estoque fecha com a nota

  const dup = await t.call('almoxarife', 'POST', '/api/estoque/compras', { source: 'xml', xml, entry_date: '2026-09-26', items: lines([{ lot_code: 'L77', expiry: '2028-01-10', qty: 10 }]) });
  assert.equal(dup.status, 409);
  const again = await t.files('almoxarife', '/api/estoque/nfe/ler', [{ name: 'nota.xml', data: xml }]);
  assert.match(again.body.drafts[0].warnings[0], /já foi lançada/);
  assert.ok(again.body.drafts[0].supplier.existing);              // fornecedor foi criado pela nota
});

test('de-para aprendido: próxima nota do mesmo fornecedor já vem mapeada (por código)', async () => {
  const { xml } = makeXml({ nnf: 2000, frete: 0 });
  const d = (await t.files('almoxarife', '/api/estoque/nfe/ler', [{ name: 'n.xml', data: xml }])).body.drafts[0];
  assert.equal(d.items[0].suggestion.reason, 'mapa'); assert.equal(d.items[0].factor, 25);
  assert.equal(d.items[1].suggestion.reason, 'mapa');
});

test('vários XMLs de uma vez e .zip', async () => {
  const a = makeXml({ nnf: 3001 }); const b = makeXml({ nnf: 3002 });
  const zip = zipSync({ 'a.xml': Buffer.from(a.xml), 'pasta/b.xml': Buffer.from(b.xml), 'leia.txt': Buffer.from('oi') });
  const z = await t.files('almoxarife', '/api/estoque/nfe/ler', [{ name: 'notas.zip', type: 'application/zip', data: zip }]);
  assert.equal(z.body.drafts.length, 2);
  const m = await t.files('almoxarife', '/api/estoque/nfe/ler', [{ name: '1.xml', data: a.xml }, { name: '2.xml', data: b.xml }, { name: 'ruim.xml', data: '<x/>' }, { name: 'a.doc', data: 'zzz' }]);
  assert.equal(m.body.drafts.length, 2); assert.equal(m.body.errors.length, 2);
});

test('foto/PDF: sem serviço configurado avisa; com serviço lê e marca baixa confiança', async () => {
  const file = [{ name: 'nota.jpg', type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]) }];
  const off = await t.files('almoxarife', '/api/estoque/nfe/ler', file);
  assert.match(off.body.errors[0].error, /não está configurada/);
  const f = (v, c = 0.95) => ({ v, c });
  services.ocr = { read: async () => ({
    chave: f(''), numero: f('77'), serie: f('1'), data_emissao: f('2026-09-20'), fornecedor_doc: f('11222333000181'), fornecedor_nome: f('COOPERATIVA AGRO TESTE LTDA'),
    total_nota: f(100), forma_pagamento: f(''), itens: [{ codigo: f('RAC22'), descricao: f('RACAO LACTACAO 22%', 0.5), unidade: f('SC'), quantidade: f(2), valor_unitario: f(50), valor_total: f(100) }],
  }) };
  const on = await t.files('almoxarife', '/api/estoque/nfe/ler', file);
  const d = on.body.drafts[0];
  assert.equal(d.source, 'danfe'); assert.ok(d.low.includes('items.0.description')); assert.equal(d.supplier.existing.name, 'COOPERATIVA AGRO TESTE LTDA');
  assert.equal(d.items[0].suggestion.reason, 'mapa');
  services.ocr = null;
});

test('chave: sem serviço só preenche o cabeçalho; com serviço traz o XML', async () => {
  const { xml, chave } = makeXml({ nnf: 4001 });
  const r = await t.call('almoxarife', 'POST', '/api/estoque/nfe/chave', { text: `https://sefaz.exemplo/nfce?p=${chave}|2|1|1|hash` });
  assert.equal(r.body.xml_found, false); assert.equal(r.body.draft.number, '4001'); assert.equal(r.body.draft.header_only, true);
  assert.ok(r.body.draft.supplier.existing);                       // CNPJ já conhecido
  assert.equal((await t.call('almoxarife', 'POST', '/api/estoque/nfe/chave', { text: chave.slice(0, 43) + '0' + '' })).status, 400);
  services.provider = { fetchXml: async () => ({ xml, parsed: parseNfeXml(xml) }) };
  const r2 = await t.call('almoxarife', 'POST', '/api/estoque/nfe/chave', { text: chave });
  assert.equal(r2.body.xml_found, true); assert.equal(r2.body.draft.items.length, 2);
  services.provider = null;
});

test('entrada manual: item novo criado na hora, frete rateado e cancelamento com estorno', async () => {
  const body = {
    source: 'manual', number: 'R-15', entry_date: '2026-09-27', default_location_id: locs[0].id, supplier: { name: 'Sítio do Zé (produtor rural)', doc: '' },
    header: { freight: 20 }, payment_method: 'Dinheiro', payment_terms: 'à vista',
    items: [{ description: 'Feno de tifton', nf_unit: 'fardo', qty: 10, unit_price: 30, total: 300, factor: 1, new_item: { name: 'Feno tifton (fardo)', unit: 'unidade' } }],
  };
  const r = await t.call('almoxarife', 'POST', '/api/estoque/compras', body);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.total, 320);
  const it = (await t.call('almoxarife', 'GET', '/api/estoque/itens?q=feno')).body[0];
  assert.equal(it.stock, 10); assert.equal(it.avg_cost, 32);
  assert.equal((await t.call('almoxarife', 'POST', `/api/estoque/compras/${r.body.id}/cancelar`, {})).status, 403);
  const c = await t.call('gerente', 'POST', `/api/estoque/compras/${r.body.id}/cancelar`, { reason: 'lançada errada' });
  assert.equal(c.status, 200);
  assert.equal((await t.call('gerente', 'GET', `/api/estoque/itens/${it.id}`)).body.stock, 0);
  assert.equal((await t.call('gerente', 'POST', `/api/estoque/compras/${r.body.id}/cancelar`, {})).status, 400);
  assert.equal((await t.call('gerente', 'DELETE', `/api/estoque/itens/${it.id}`)).status, 409);   // tem movimentação: só inativar
});

test('importar itens por planilha: prévia, criação e atualização', async () => {
  const csv = 'Nome;Código;Categoria;Unidade;Fator;Embalagem;Estoque mínimo;Controla lote;Local;Setor\n'
    + 'Sal mineral 80P;SAL01;Núcleo mineral;kg;25;saco;300;não;Depósito de ração;Rebanho em lactação\n'
    + 'Vacina Brucelose;VAC01;Vacina;dose;;;20;sim;Farmácia/geladeira de medicamentos;\n'
    + 'Ração lactação 22%;RAC001;Ração/concentrado;kg;25;saco;800;não;Depósito de ração;\n'
    + 'Erro;ERR1;Outros;galao;;;;;;\n';
  const prev = await t.files('gerente', '/api/estoque/itens/importar', [{ name: 'itens.csv', data: csv }], { commit: '0' });
  assert.equal(prev.status, 200); assert.equal(prev.body.to_create, 2); assert.equal(prev.body.to_update, 1); assert.equal(prev.body.errors_total, 1);
  assert.equal((await t.call('gerente', 'GET', '/api/estoque/itens?q=sal mineral')).body.length, 0);
  const done = await t.files('gerente', '/api/estoque/itens/importar', [{ name: 'itens.csv', data: csv }], { commit: '1' });
  assert.equal(done.body.inserted, 2); assert.equal(done.body.updated, 1);
  const r = (await t.call('gerente', 'GET', `/api/estoque/itens/${racao.id}`)).body;
  assert.equal(r.min_stock, 800);
  assert.equal((await t.files('encarregado', '/api/estoque/itens/importar', [{ name: 'i.csv', data: csv }])).status, 403);
});

test('resumo e novos perfis no login', async () => {
  const s = (await t.call('gerente', 'GET', '/api/estoque/resumo')).body;
  assert.ok(s.items >= 4 && s.value > 0);
  assert.equal((await t.call('almoxarife', 'GET', '/api/estoque/resumo')).body.value, null);   // almoxarife não vê valores
  const me = (await t.call('almoxarife', 'GET', '/api/me')).body;
  assert.ok(me.permissions.includes('estoque_entrada') && !me.permissions.includes('estoque_cadastros'));
});
