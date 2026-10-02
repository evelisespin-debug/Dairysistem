// Teste de personalidade (16 tipos). O banco de perguntas e as fórmulas ficam em server/personality/*.json:
// para trocar de teste basta trocar o arquivo (mesma estrutura). A conta é feita só no servidor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'personality', 'oejts-1.2.pt.json');
export const TEST = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const DIMS = Object.keys(TEST.dimensions);
const N = TEST.items.length;

export const TYPES = {
  INTJ: ['Arquiteto', 'Estratégico(a) e independente; enxerga o conjunto e monta planos de longo prazo.'],
  INTP: ['Lógico', 'Curioso(a) e analítico(a); gosta de entender como as coisas funcionam.'],
  ENTJ: ['Comandante', 'Líder decidido(a) e objetivo(a); organiza pessoas e recursos para atingir metas.'],
  ENTP: ['Inovador', 'Criativo(a) e questionador(a); gosta de debater ideias e achar jeitos novos.'],
  INFJ: ['Advogado', 'Reservado(a), mas idealista; busca sentido e quer ajudar os outros a crescer.'],
  INFP: ['Mediador', 'Sensível e fiel aos próprios valores; busca autenticidade e harmonia.'],
  ENFJ: ['Protagonista', 'Carismático(a) e acolhedor(a); motiva e reúne as pessoas em torno de um objetivo.'],
  ENFP: ['Ativista', 'Entusiasmado(a) e criativo(a); contagia o grupo e vê possibilidades por toda parte.'],
  ISTJ: ['Logístico', 'Responsável, metódico(a) e confiável; cumpre o combinado e valoriza regras claras.'],
  ISFJ: ['Defensor', 'Dedicado(a) e cuidadoso(a); atento(a) às necessidades dos outros e aos detalhes.'],
  ESTJ: ['Executivo', 'Organizado(a) e direto(a); gosta de ordem, processos definidos e de fazer acontecer.'],
  ESFJ: ['Cônsul', 'Sociável e prestativo(a); cuida do bem-estar do grupo e mantém o ambiente unido.'],
  ISTP: ['Virtuoso', 'Calmo(a) e prático(a); resolve problemas na hora, com as próprias mãos.'],
  ISFP: ['Aventureiro', 'Gentil e flexível; vive o momento e mostra mais pelo que faz do que pelo que diz.'],
  ESTP: ['Empreendedor', 'Ágil e ousado(a); age rápido e gosta de desafios e de resultado imediato.'],
  ESFP: ['Animador', 'Espontâneo(a) e alegre; leva energia ao grupo e aprende fazendo.'],
};
export const POLE = { E: 'Extroversão', I: 'Introversão', S: 'Sensação', N: 'Intuição', T: 'Pensamento', F: 'Sentimento', J: 'Julgamento', P: 'Percepção' };

// Itens enviados ao site: só os textos (esquerda = nota 1, direita = nota 5).
export const publicTest = () => ({
  key: TEST.key, title: TEST.title, credit: TEST.credit, scale: TEST.scale,
  items: TEST.items.map(([, , left, right], i) => ({ n: i + 1, left, right })),
});

// answers: array de 32 notas inteiras (1..5). Retorna null se faltar ou houver nota inválida.
export function score(answers) {
  const { min, max, threshold } = TEST.scale;
  if (!Array.isArray(answers) || answers.length !== N) return null;
  if (!answers.every((a) => Number.isInteger(a) && a >= min && a <= max)) return null;
  const dims = {}; let type = '';
  for (const d of DIMS) {
    const { base, terms, low, high } = TEST.dimensions[d];
    const value = base + Object.entries(terms).reduce((s, [q, w]) => s + w * answers[+q - 1], 0);   // 8..40
    const letter = value > threshold ? high : low;
    const span = 4 * Object.keys(terms).length;                                                      // 32
    const pctHigh = Math.round(((value - 8) / span) * 100);
    dims[d] = { value, letter, low, high, pct_low: 100 - pctHigh, pct_high: pctHigh, strength: Math.abs(value - threshold) };
    type += letter;
  }
  const [nickname, description] = TYPES[type];
  return { type, nickname, description, dims };
}

// ---------- conclusão do perfil ----------
// [pontos fortes | pontos de atenção | como trabalhar melhor] separados por "|"
const PROFILE = {
  INTJ: ['visão de longo prazo|planejamento e estratégia|autonomia e foco', 'pode parecer distante ou crítico(a) demais|dificuldade de delegar o que não confia', 'explique o "porquê" das mudanças|dê autonomia e metas claras'],
  INTP: ['análise de problemas|curiosidade e raciocínio lógico|ideias originais', 'pode adiar a execução|esquece prazos e rotinas', 'combine prazos curtos e visíveis|valorize a análise sem deixar travar a ação'],
  ENTJ: ['liderança e iniciativa|organização de pessoas e metas|decisão rápida', 'pode ser duro(a) ou impaciente|pouca escuta quando está com pressa', 'peça resultados com metas claras|reserve tempo para ouvir a equipe'],
  ENTP: ['criatividade e improviso|boa comunicação|enxerga alternativas', 'pode abandonar tarefas rotineiras|discute demais por prazer', 'varie as tarefas|combine quem fecha o que foi começado'],
  INFJ: ['empatia e visão de futuro|dedicação a propósitos|escuta atenta', 'pode se sobrecarregar e guardar problemas|perfeccionismo', 'ofereça conversas individuais|reconheça o esforço, não só o resultado'],
  INFP: ['valores firmes e sinceridade|criatividade|cuidado com as pessoas', 'sensível a críticas|pode evitar conflitos necessários', 'dê feedback com respeito e exemplos|alinhe o sentido do trabalho'],
  ENFJ: ['motiva e une o grupo|boa comunicação|acolhimento', 'pode assumir o problema de todos|dificuldade com críticas duras', 'dê espaço para liderar e treinar colegas|ajude a separar o pessoal do trabalho'],
  ENFP: ['entusiasmo e energia|criatividade|facilidade de se relacionar', 'dispersão e dificuldade com rotina|começa mais do que termina', 'use checklists simples|alterne tarefas e contato com pessoas'],
  ISTJ: ['responsabilidade e confiabilidade|atenção a detalhes e protocolos|constância', 'resistência a mudanças repentinas|pode ser rígido(a)', 'avise mudanças com antecedência|ofereça instruções claras e padronizadas'],
  ISFJ: ['dedicação e cuidado|memória para detalhes|lealdade ao grupo', 'dificuldade de dizer não|pode guardar incômodos', 'reconheça o trabalho com frequência|incentive a falar quando algo incomoda'],
  ESTJ: ['organização e disciplina|clareza de regras e prazos|capacidade de fazer acontecer', 'pode ser inflexível|pouca paciência com improviso', 'defina responsabilidades e metas|peça opinião antes de mudar processos'],
  ESFJ: ['trabalho em equipe e cooperação|atenção às pessoas|senso de dever', 'sensível a conflitos e a críticas|busca aprovação', 'valorize em público o que fez bem|dê feedback com cuidado'],
  ISTP: ['praticidade e calma sob pressão|resolve problemas na hora|autonomia', 'pode ser reservado(a) demais|pouca paciência com burocracia', 'dê tarefas práticas e autonomia|combine registros de forma simples'],
  ISFP: ['gentileza e sensibilidade|flexibilidade|bom com animais e pessoas no dia a dia', 'evita conflitos e fala pouco o que pensa|pode adiar planejamento', 'pergunte diretamente como está|dê feedback individual e tranquilo'],
  ESTP: ['ação rápida e coragem|bom em emergências|energia', 'impulsividade|pouca paciência com planejamento e registros', 'dê desafios e resultados imediatos|combine rotinas curtas de registro'],
  ESFP: ['alegria e energia para o grupo|aprende fazendo|boa relação com todos', 'distração e dificuldade com rotina rígida|evita conflitos', 'torne a rotina dinâmica|reconheça e dê retorno com frequência'],
};
const LEVEL = (s) => (s <= 1 ? 'equilibrada' : s <= 3 ? 'leve' : s <= 7 ? 'moderada' : 'forte');

export function conclusion(type, dims) {
  const [nickname, description] = TYPES[type];
  const [f, a, t] = PROFILE[type].map((x) => x.split('|'));
  const lines = DIMS.map((k) => dims[k]).map((d) => {
    const lvl = LEVEL(d.strength);
    return lvl === 'equilibrada'
      ? `${POLE[d.low]} / ${POLE[d.high]}: preferência equilibrada (a letra ${d.letter} é por margem mínima).`
      : `${POLE[d.letter]}: preferência ${lvl}.`;
  });
  return {
    headline: `${type} — ${nickname}`,
    summary: `${description} Resultado de uma autoavaliação: mostra como a pessoa se descreve hoje, não o que ela é capaz de fazer.`,
    dimension_lines: lines,
    strengths: f, attention: a, tips: t,
    note: 'Este perfil serve para autoconhecimento e para melhorar a convivência e a organização do trabalho. Não deve ser usado, sozinho, para contratar, promover ou demitir.',
  };
}

// ---------- apresentação da equipe (resultados acumulados) ----------
const TEAM_TEXT = {
  E: ['grupo comunicativo, que se energiza no contato com os outros', 'dar espaço a quem prefere trabalhar em silêncio'],
  I: ['grupo reflexivo, que trabalha bem de forma independente', 'estimular a troca de informações entre pessoas e turnos'],
  S: ['grupo prático, atento a detalhes e rotinas (bom para protocolos de ordenha e manejo)', 'manter abertura a mudanças e novas ideias'],
  N: ['grupo voltado a ideias e melhorias', 'manter a disciplina nos detalhes e nos registros do dia a dia'],
  T: ['grupo que decide com critérios objetivos', 'cuidar do acolhimento e da forma de dar feedback'],
  F: ['grupo acolhedor e cooperativo', 'cobrar resultados e tratar conflitos com franqueza'],
  J: ['grupo organizado, que cumpre horários e planos', 'ter flexibilidade diante de imprevistos'],
  P: ['grupo adaptável, ágil diante de imprevistos', 'reforçar prazos, registros e rotinas padronizadas'],
};
export function teamSummary(people) {
  const n = people.length;
  const byType = {};
  for (const p of people) byType[p.type] = (byType[p.type] || 0) + 1;
  const dims = {}; const bullets = [];
  for (const d of DIMS) {
    const { low, high } = TEST.dimensions[d];
    const nHigh = people.filter((p) => p.scores[d].letter === high).length;
    const avgHigh = n ? Math.round(people.reduce((s, p) => s + p.scores[d].pct_high, 0) / n) : 0;
    dims[d] = { low, high, n_low: n - nHigh, n_high: nHigh, avg_pct_high: avgHigh };
    if (!n) continue;
    const share = Math.max(nHigh, n - nHigh) / n; const lead = nHigh >= n - nHigh ? high : low;
    bullets.push(n >= 3 && share >= 0.65
      ? `Predomínio de ${POLE[lead]} (${Math.round(share * 100)}%): ${TEAM_TEXT[lead][0]}. Ponto de atenção: ${TEAM_TEXT[lead][1]}.`
      : `Equilíbrio entre ${POLE[low]} e ${POLE[high]}: grupo diverso, que combina os dois jeitos de trabalhar. Vale alinhar combinados para aproveitar a diferença.`);
  }
  return {
    total: n,
    by_type: Object.entries(byType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, c]) => ({ type, nickname: TYPES[type][0], n: c })),
    dims, conclusion: bullets,
    note: n < 3 ? 'Poucas pessoas avaliadas: as conclusões do grupo ainda são pouco confiáveis.' : 'Conclusões do grupo a partir de autoavaliações; use para conversar e organizar o trabalho, nunca para classificar pessoas.',
  };
}
