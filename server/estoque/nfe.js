import { XMLParser } from 'fast-xml-parser';

// ---------- utilidades ----------
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
const cents = (v) => Math.round((Number(v) || 0) * 100);
const fromCents = (c) => c / 100;
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

export function cnpjValid(v) {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (len) => {
    let s = 0; let p = len - 7;
    for (let i = 0; i < len; i++) { s += +d[i] * p--; if (p < 2) p = 9; }
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === +d[12] && dv(13) === +d[13];
}
export function cpfValid(v) {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (len) => { let s = 0; for (let i = 0; i < len; i++) s += +d[i] * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
export const docValid = (v) => { const n = digits(v).length; return n === 14 ? cnpjValid(v) : n === 11 ? cpfValid(v) : false; };

// ---------- chave de acesso (44 dígitos) ----------
export function chaveDigitOk(chave) {
  const k = digits(chave);
  if (k.length !== 44) return false;
  let s = 0; let w = 2;
  for (let i = 42; i >= 0; i--) { s += +k[i] * w; w = w === 9 ? 2 : w + 1; }
  const r = s % 11; const dv = r < 2 ? 0 : 11 - r;
  return dv === +k[43];
}

const UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };

// A própria chave já traz UF, mês/ano, CNPJ do emitente, modelo, série e número.
export function parseChave(raw) {
  const k = digits(raw);
  if (k.length !== 44) return { error: 'A chave de acesso tem 44 números.' };
  if (!chaveDigitOk(k)) return { error: 'Chave inválida: o dígito verificador não confere. Confira se digitou todos os números.' };
  const aa = k.slice(2, 4); const mm = k.slice(4, 6);
  return {
    chave: k, uf: UF[+k.slice(0, 2)] || null, year_month: `20${aa}-${mm}`,
    cnpj: k.slice(6, 20), model: k.slice(20, 22), series: String(+k.slice(22, 25)), number: String(+k.slice(25, 34)),
  };
}

// Acha uma chave dentro de um texto (URL do QR code da NFC-e, texto de PDF, chave com espaços...).
export function extractChave(text) {
  const t = String(text ?? '');
  const candidates = [];
  for (const m of t.matchAll(/(?<!\d)\d{44}(?!\d)/g)) candidates.push(m[0]);
  for (const m of t.matchAll(/(?:\d{4}[ .-]){10}\d{4}/g)) candidates.push(digits(m[0]));
  const compact = digits(t);
  if (compact.length === 44) candidates.push(compact);
  return candidates.find(chaveDigitOk) || candidates[0] || null;
}

// ---------- leitura do XML ----------
const PAGAMENTO = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja',
  '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente', '13': 'Vale combustível', '15': 'Boleto bancário',
  '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência', '19': 'Programa de fidelidade', '90': 'Sem pagamento', '99': 'Outros' };

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false,
  trimValues: true, processEntities: true,
  isArray: (name) => ['det', 'dup', 'rastro', 'detPag'].includes(name),
});

const isoDate = (s) => { const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

export function parseNfeXml(xml) {
  let doc;
  try { doc = parser.parse(String(xml)); } catch { throw new Error('O arquivo não é um XML válido.'); }
  if (doc.cteProc || doc.CTe) throw new Error('Este XML é de um CT-e (conhecimento de transporte), não de uma NF-e de compra.');
  if (doc.procEventoNFe || doc.evento || doc.retEvento) throw new Error('Este XML é um evento (cancelamento/carta de correção), não a nota fiscal.');
  const nfe = doc.nfeProc?.NFe || doc.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('Não encontrei uma NF-e neste XML.');
  const chave = digits(inf['@_Id']) || digits(doc.nfeProc?.protNFe?.infProt?.chNFe);
  const ide = inf.ide || {}; const emit = inf.emit || {}; const tot = inf.total?.ICMSTot || {};
  const supplier = {
    doc: digits(emit.CNPJ || emit.CPF), name: emit.xNome || '', trade_name: emit.xFant || '',
    uf: emit.enderEmit?.UF || null, phone: emit.enderEmit?.fone || null,
  };
  const items = arr(inf.det).map((d, i) => {
    const p = d.prod || {}; const imp = d.imposto || {};
    const icms = imp.ICMS ? Object.values(imp.ICMS)[0] || {} : {};
    const ean = [p.cEAN, p.cEANTrib].map((x) => digits(x)).find((x) => x.length >= 8 && /^\d+$/.test(x)) || '';
    const lots = arr(p.rastro).map((r) => ({ lot_code: r.nLote || '', qty: num(r.qLote), expiry: isoDate(r.dVal), made: isoDate(r.dFab) }));
    return {
      n: +d['@_nItem'] || i + 1, supplier_code: p.cProd || '', description: p.xProd || '', ncm: p.NCM || '', ean,
      nf_unit: p.uCom || '', qty: num(p.qCom), unit_price: num(p.vUnCom), total: num(p.vProd),
      discount: num(p.vDesc), ipi: num(imp.IPI?.IPITrib?.vIPI), st: num(icms.vICMSST) + num(icms.vFCPST),
      lots: lots.filter((l) => l.lot_code),
    };
  });
  const installments = arr(inf.cobr?.dup).map((d, i) => ({ number: d.nDup || String(i + 1), due_date: isoDate(d.dVenc), amount: num(d.vDup) }));
  const pays = arr(inf.pag?.detPag);
  const payment_method = [...new Set(pays.map((p) => PAGAMENTO[p.tPag]).filter(Boolean))].join(' + ') || null;
  return {
    source: 'xml', chave: chave.length === 44 ? chave : null, model: ide.mod || '55', series: ide.serie != null ? String(+ide.serie) : '',
    number: ide.nNF != null ? String(+ide.nNF) : '', issue_date: isoDate(ide.dhEmi || ide.dEmi), nature: ide.natOp || '',
    supplier, items,
    header: { freight: num(tot.vFrete), insurance: num(tot.vSeg), other: num(tot.vOutro), discount: num(tot.vDesc), ipi: num(tot.vIPI), st: num(tot.vST) + num(tot.vFCPST) },
    totals: { products: num(tot.vProd), invoice: num(tot.vNF) },
    taxes: { icms: num(tot.vICMS), icms_bc: num(tot.vBC), pis: num(tot.vPIS), cofins: num(tot.vCOFINS), ii: num(tot.vII), aprox: num(tot.vTotTrib) },
    installments: installments.filter((x) => x.due_date), payment_method, notes: inf.infAdic?.infCpl || '',
    protocolo_ok: !!doc.nfeProc?.protNFe?.infProt?.nProt,
  };
}

// ---------- composição do custo ----------
// Custo de cada item = valor do item − desconto + parte do frete/seguro/outras despesas + IPI + ICMS-ST.
// Frete, seguro e outras despesas do cabeçalho são rateados pelo valor do item; a soma dos itens fecha
// com o total da nota (centavo a centavo).
export function allocateCosts(items, header = {}) {
  const base = items.map((it) => cents(it.total) - cents(it.discount));
  const baseSum = base.reduce((a, b) => a + b, 0);
  const itemDisc = items.reduce((a, it) => a + cents(it.discount), 0);
  const itemIpi = items.reduce((a, it) => a + cents(it.ipi), 0);
  const itemSt = items.reduce((a, it) => a + cents(it.st), 0);
  // valores do cabeçalho que não vieram item a item
  const extraDisc = Math.max(0, cents(header.discount) - itemDisc);
  const extraIpi = Math.max(0, cents(header.ipi) - itemIpi);
  const extraSt = Math.max(0, cents(header.st) - itemSt);
  const pool = cents(header.freight) + cents(header.insurance) + cents(header.other) + extraIpi + extraSt - extraDisc;
  const share = items.map((_, i) => (baseSum > 0 ? Math.round((pool * base[i]) / baseSum) : Math.round(pool / (items.length || 1))));
  const drift = pool - share.reduce((a, b) => a + b, 0);
  if (items.length) share[share.indexOf(Math.max(...share))] += drift;
  const lines = items.map((it, i) => {
    const landed = base[i] + share[i] + cents(it.ipi) + cents(it.st);
    return { landed_total: fromCents(landed), extra_share: fromCents(share[i]) };
  });
  const total = lines.reduce((a, l) => a + cents(l.landed_total), 0);
  return { lines, total: fromCents(total), extras: { discount: fromCents(extraDisc + itemDisc), ipi: fromCents(extraIpi + itemIpi), st: fromCents(extraSt + itemSt) } };
}

// ---------- similaridade de descrição (sem depender de extensão do banco) ----------
const STOP = new Set(['de', 'da', 'do', 'com', 'para', 'em', 'e', 'a', 'o', 'un', 'kg', 'sc', 'cx', 'pc', 'lt', 'l']);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const tokens = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)));
export function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const UNIT_ALIASES = { kg: 'kg', kgs: 'kg', quilo: 'kg', t: 't', ton: 't', tn: 't', l: 'L', lt: 'L', lts: 'L', litro: 'L', dose: 'dose', ds: 'dose',
  un: 'unidade', und: 'unidade', unid: 'unidade', pc: 'unidade', pç: 'unidade', pca: 'unidade', unidade: 'unidade', sc: 'saco', sac: 'saco', saco: 'saco', sacos: 'saco',
  cx: 'caixa', caixa: 'caixa' };
export const canonUnit = (u) => UNIT_ALIASES[norm(u).trim()] || null;
