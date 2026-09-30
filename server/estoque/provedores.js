import { parseNfeXml, chaveDigitOk } from './nfe.js';

// ---------------------------------------------------------------------------
// 1) Busca do XML completo pela chave de acesso (serviço externo)
// ---------------------------------------------------------------------------
// Adaptador genérico por HTTP. Configure no .env (nada de segredo no código):
//   NFE_PROVIDER_URL    ex.: https://api.exemplo.com/nfe/{chave}/xml   ({chave} é trocado pelos 44 números)
//   NFE_PROVIDER_TOKEN  token do provedor
//   NFE_PROVIDER_HEADER nome do cabeçalho do token (padrão: Authorization; valor enviado: "Bearer <token>",
//                       ou só o token se o cabeçalho não for Authorization)
// A resposta pode ser o XML puro ou um JSON com o XML em um dos campos: xml, xmlNfe, nfeProc.
// Cada provedor tem seu formato: confirme na documentação dele e, se preciso, ajuste só esta função.
export function configuredProvider(env = process.env) {
  if (!env.NFE_PROVIDER_URL) return null;
  return {
    async fetchXml(chave, { fetchFn = fetch } = {}) {
      if (!chaveDigitOk(chave)) throw new Error('Chave inválida.');
      const headers = { accept: 'application/xml, application/json' };
      const name = env.NFE_PROVIDER_HEADER || 'Authorization';
      if (env.NFE_PROVIDER_TOKEN) headers[name] = name.toLowerCase() === 'authorization' ? `Bearer ${env.NFE_PROVIDER_TOKEN}` : env.NFE_PROVIDER_TOKEN;
      const res = await fetchFn(env.NFE_PROVIDER_URL.replace('{chave}', chave), { headers, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;                       // nota ainda não disponível no provedor
      if (!res.ok) throw new Error(`O serviço de consulta respondeu com erro ${res.status}.`);
      const text = await res.text();
      let xml = text;
      if (text.trim().startsWith('{')) { const j = JSON.parse(text); xml = j.xml || j.xmlNfe || j.nfeProc || ''; }
      if (!xml) return null;
      const parsed = parseNfeXml(xml);
      if (parsed.chave !== chave) throw new Error('O serviço devolveu uma nota diferente da consultada.');
      return { xml, parsed };
    },
  };
}

// ---------------------------------------------------------------------------
// 2) Leitura de foto/PDF do DANFE por IA (visão)
// ---------------------------------------------------------------------------
// Usa a API de mensagens da Anthropic. Configure ANTHROPIC_API_KEY (e, se quiser, DANFE_OCR_MODEL).
const campo = (tipo, desc) => ({
  type: 'object', description: desc, required: ['v', 'c'],
  properties: { v: { type: tipo }, c: { type: 'number', description: 'confiança de 0 a 1 na leitura deste campo' } },
});
const SCHEMA = {
  type: 'object',
  required: ['chave', 'numero', 'serie', 'data_emissao', 'fornecedor_doc', 'fornecedor_nome', 'itens', 'total_nota'],
  properties: {
    chave: campo('string', 'Chave de acesso, 44 números, sem espaços ("" se não legível)'),
    numero: campo('string', 'Número da nota'), serie: campo('string', 'Série'),
    data_emissao: campo('string', 'Data de emissão em AAAA-MM-DD'),
    fornecedor_doc: campo('string', 'CNPJ/CPF do emitente, só números'), fornecedor_nome: campo('string', 'Razão social do emitente'),
    total_nota: campo('number', 'Valor total da nota'), total_produtos: campo('number', 'Valor total dos produtos'),
    frete: campo('number', 'Frete'), seguro: campo('number', 'Seguro'), desconto: campo('number', 'Desconto total'),
    outras_despesas: campo('number', 'Outras despesas acessórias'), ipi: campo('number', 'Valor total do IPI'),
    forma_pagamento: campo('string', 'Forma de pagamento, se constar'),
    parcelas: {
      type: 'array', description: 'Duplicatas/parcelas, se constarem',
      items: { type: 'object', required: ['vencimento', 'valor'], properties: { numero: { type: 'string' }, vencimento: { type: 'string', description: 'AAAA-MM-DD' }, valor: { type: 'number' }, c: { type: 'number' } } },
    },
    itens: {
      type: 'array',
      items: {
        type: 'object', required: ['descricao', 'quantidade', 'valor_total'],
        properties: {
          codigo: campo('string', 'Código do produto no fornecedor'), descricao: campo('string', 'Descrição'), ncm: campo('string', 'NCM'),
          unidade: campo('string', 'Unidade comercial (UN, KG, SC, L, CX...)'), quantidade: campo('number', 'Quantidade'),
          valor_unitario: campo('number', 'Valor unitário'), valor_total: campo('number', 'Valor total do item'),
          lote: campo('string', 'Lote, se constar'), validade: campo('string', 'Validade AAAA-MM-DD, se constar'),
        },
      },
    },
  },
};
const PROMPT = 'Você lê DANFEs (notas fiscais brasileiras de compra de uma fazenda). Extraia os dados da nota da imagem/PDF chamando a ferramenta registrar_nota. '
  + 'Regras: números com ponto decimal (ex.: 1234.56); datas AAAA-MM-DD; CNPJ só dígitos; se um campo não estiver legível, deixe v vazio/0 e c baixo. '
  + 'Não invente valores. c reflete sua certeza real (menos de 0.8 se o texto estava borrado, cortado ou ambíguo). Liste todos os itens da tabela de produtos.';

export function configuredOcr(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const model = env.DANFE_OCR_MODEL || 'claude-sonnet-5-5';
  return {
    async read({ buffer, mime }, { fetchFn = fetch } = {}) {
      const isPdf = mime === 'application/pdf';
      const block = { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
      const res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 8000,
          tools: [{ name: 'registrar_nota', description: 'Registra os dados lidos do DANFE', input_schema: SCHEMA }],
          tool_choice: { type: 'tool', name: 'registrar_nota' },
          messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
        }),
      });
      if (!res.ok) throw new Error(`A leitura automática falhou (erro ${res.status}). Tente de novo ou use o XML.`);
      const j = await res.json();
      const out = j.content?.find((b) => b.type === 'tool_use')?.input;
      if (!out) throw new Error('A leitura automática não devolveu dados. Tente uma foto mais nítida ou use o XML.');
      return out;
    },
  };
}
