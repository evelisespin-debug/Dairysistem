import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { score, publicTest, TEST } from '../server/personality.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

// Fórmulas do OEJTS 1.2 escritas literalmente (independentes do arquivo JSON), para conferir o motor.
const ref = (Q) => {
  const q = (n) => Q[n - 1];
  const ie = 30 - q(3) - q(7) - q(11) + q(15) - q(19) + q(23) + q(27) - q(31);
  const sn = 12 + q(4) + q(8) + q(12) + q(16) + q(20) - q(24) - q(28) + q(32);
  const ft = 30 - q(2) + q(6) + q(10) - q(14) - q(18) + q(22) - q(26) - q(30);
  const jp = 18 + q(1) + q(5) - q(9) + q(13) - q(17) + q(21) - q(25) + q(29);
  return { ie, sn, ft, jp, type: `${ie > 24 ? 'E' : 'I'}${sn > 24 ? 'N' : 'S'}${ft > 24 ? 'T' : 'F'}${jp > 24 ? 'P' : 'J'}` };
};

test('o motor bate com as fórmulas publicadas do OEJTS em 2000 respostas aleatórias', () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const Q = Array.from({ length: 32 }, () => 1 + Math.floor(rnd() * 5));
    const r = score(Q); const e = ref(Q);
    assert.deepEqual([r.dims.IE.value, r.dims.SN.value, r.dims.FT.value, r.dims.JP.value], [e.ie, e.sn, e.ft, e.jp]);
    assert.equal(r.type, e.type); seen.add(r.type);
  }
  assert.equal(seen.size, 16, 'todos os 16 tipos aparecem');
});

test('notas fora da escala ou respostas faltando são recusadas', () => {
  assert.equal(score(Array(31).fill(3)), null);
  assert.equal(score(Array(32).fill(6)), null);
  assert.equal(score(Array(32).fill(2.5)), null);
  assert.equal(score('x'), null);
  assert.equal(TEST.items.length, 32);
  assert.equal(publicTest().items.length, 32);
});

test('meio da escala dá empate e segue a regra do teste (I, S, F, J)', () => {
  const r = score(Array(32).fill(3));
  assert.equal(r.type, 'ISFJ');
  assert.equal(r.dims.IE.pct_high, 50);
});

test('cadastro: nome, setor, resultado, lista e filtro por setor', async () => {
  const answers = Array(32).fill(3);
  assert.equal((await t.call('dono', 'POST', '/api/personality', { person_name: 'Ana', sector: '', answers })).status, 400);
  assert.equal((await t.call('dono', 'POST', '/api/personality', { person_name: 'Ana', sector: 'Ordenha', answers: [1, 2] })).status, 400);
  const ok = await t.call('encarregado', 'POST', '/api/personality', { person_name: 'Ana', sector: 'Ordenha', answers });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.type, 'ISFJ');
  assert.equal(ok.body.scores.IE.value, 24);
  await t.call('dono', 'POST', '/api/personality', { person_name: 'Beto', sector: 'ordenha', answers: Array(32).fill(5) });
  await t.call('dono', 'POST', '/api/personality', { person_name: 'Caio', sector: 'Bezerreiro', answers: Array(32).fill(1) });
  const all = await t.call('dono', 'GET', '/api/personality');
  assert.equal(all.body.length, 3);
  const ord = await t.call('dono', 'GET', '/api/personality?sector=ORDENHA');
  assert.deepEqual(ord.body.map((x) => x.person_name).sort(), ['Ana', 'Beto']);
  assert.deepEqual((await t.call('dono', 'GET', '/api/personality/sectors')).body, ['Bezerreiro', 'Ordenha']);
  const one = await t.call('dono', 'GET', `/api/personality/${ok.body.id}`);
  assert.equal(one.body.nickname, 'Defensor');
  assert.equal((await t.call('dono', 'GET', '/api/personality/test')).body.items.length, 32);
});

test('permissões: funcionário e veterinária não acessam; só o dono apaga; fica na auditoria', async () => {
  assert.equal((await t.call('funcionario', 'GET', '/api/personality')).status, 403);
  assert.equal((await t.call('veterinaria', 'POST', '/api/personality', { person_name: 'X', sector: 'Y', answers: Array(32).fill(3) })).status, 403);
  const list = (await t.call('dono', 'GET', '/api/personality')).body;
  assert.equal((await t.call('encarregado', 'DELETE', `/api/personality/${list[0].id}`)).status, 403);
  assert.equal((await t.call('dono', 'DELETE', `/api/personality/${list[0].id}`)).status, 200);
  assert.equal((await t.call('dono', 'GET', `/api/personality/${list[0].id}`)).status, 404);
  const acts = (await t.call('dono', 'GET', '/api/audit')).body.map((a) => `${a.action} ${a.entity}`);
  assert.ok(acts.includes('criar personality_test') && acts.includes('apagar personality_test'));
});

test('conclusão do perfil e resumo da equipe (acumulado por setor)', async () => {
  const t2 = await setup();
  try {
    const mk = (name, sector, v) => t2.call('dono', 'POST', '/api/personality', { person_name: name, sector, answers: Array(32).fill(v) });
    const r = await mk('Ana', 'Ordenha', 5);
    assert.equal(r.body.type, 'INFP');
    assert.equal(r.body.conclusion.headline, 'INFP — Mediador');
    assert.equal(r.body.conclusion.dimension_lines.length, 4);
    assert.ok(r.body.conclusion.strengths.length >= 2 && r.body.conclusion.tips.length >= 2);
    await mk('Beto', 'Ordenha', 5); await mk('Caio', 'Ordenha', 5); await mk('Dani', 'Ordenha', 1);
    await mk('Ana', 'Ordenha', 1);   // refez: vale o mais recente
    const team = (await t2.call('dono', 'GET', '/api/personality/team?sector=ordenha')).body;
    assert.equal(team.farm, 'Fazenda Teste');
    assert.equal(team.total, 4, 'Ana contada uma vez');
    assert.deepEqual(team.by_type.map((x) => [x.type, x.n]), [['ESTJ', 2], ['INFP', 2]]);
    assert.equal(team.dims.IE.n_high, 2);
    assert.equal(team.conclusion.length, 4);
    assert.ok(team.conclusion[0].startsWith('Equilíbrio entre'));
    const geral = (await t2.call('dono', 'GET', '/api/personality/team')).body;
    assert.equal(geral.total, 4);
  } finally { await t2.close(); }
});
