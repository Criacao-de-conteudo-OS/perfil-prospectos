import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarMudanca, postsDevidos, proximoPendente, validarFila } from '../fila.js';

const post = (extra = {}) => ({
  id: 'reel-teste',
  tipo: 'reel',
  agendado_para: '2026-11-03T12:00:00-03:00',
  legenda: 'Seu cliente não sumiu.\n\nTexto do post. #prospeccao #vendasb2b',
  midias: ['video.mp4'],
  ...extra,
});
const fila = (...posts) => ({ posts });

test('fila válida passa sem erros nem avisos', () => {
  const resultado = validarFila(
    fila(
      post(),
      post({ id: 'carrossel-1', tipo: 'carrossel', midias: ['01.jpg', '02.jpg', '03.mp4'] }),
      post({ id: 'imagem-1', tipo: 'imagem', midias: ['a.jpeg'] }),
      post({ id: 'reel-com-capa', capa: 'capa.jpg', instagram: { status: 'publicado', tentativas: 1 } }),
    ),
  );
  assert.deepEqual(resultado, { erros: [], avisos: [] });
});

test('aponta os erros comuns, em português', () => {
  const casos = [
    [post({ id: 'Com Espaço' }), /id precisa/],
    [post({ agendado_para: '2026-11-03 12:00' }), /fuso/],
    [post({ agendado_para: '2026-11-03T12:00:00' }), /fuso/],
    [post({ midias: ['capa.jpg'] }), /reel precisa/],
    [post({ tipo: 'imagem', midias: ['a.png'] }), /JPEG/],
    [post({ tipo: 'carrossel', midias: ['a.jpg'] }), /2 a 20/],
    [post({ tipo: 'carrossel', midias: ['a.jpg', 'b.gif'] }), /só \.jpg e \.mp4/],
    [post({ tipo: 'story' }), /tipo precisa/],
    [post({ legenda: 'x'.repeat(2201) }), /2200/],
    [post({ legenda: '   ' }), /legenda vazia/],
    [post({ midias: ['../segredo.mp4'] }), /nome de arquivo inválido/],
    [post({ tipo: 'carrossel', midias: ['a.jpg', 'b.jpg'], capa: 'c.jpg' }), /capa só vale/],
    [post({ capa: 'capa.png' }), /capa precisa/],
    [post({ instagram: { status: 'feito' } }), /status "feito"/],
    [post({ instagram: { status: 'pendente', tentativas: -1 } }), /tentativas/],
  ];
  for (const [p, padrao] of casos) {
    const { erros } = validarFila(fila(p));
    assert.ok(erros.some((e) => padrao.test(e)), `esperava ${padrao} em ${JSON.stringify(erros)}`);
  }
});

test('id repetido e formato errado', () => {
  assert.match(validarFila(fila(post(), post())).erros[0], /id repetido/);
  assert.match(validarFila({}).erros[0], /"posts"/);
  assert.match(validarFila(null).erros[0], /"posts"/);
});

test('mais de 5 hashtags é aviso; mais de 30 é erro', () => {
  const tags = (n) => Array.from({ length: n }, (_, i) => `#tag${i}`).join(' ');
  const seis = validarFila(fila(post({ legenda: `Texto ${tags(6)}` })));
  assert.equal(seis.erros.length, 0);
  assert.match(seis.avisos[0], /6 hashtags/);
  assert.match(validarFila(fila(post({ legenda: `Texto ${tags(31)}` }))).erros[0], /31 hashtags/);
});

test('postsDevidos pega só os pendentes que passaram da hora, do mais antigo ao mais novo', () => {
  const f = fila(
    post({ id: 'meio-dia', agendado_para: '2026-11-03T12:00:00-03:00' }),
    post({ id: 'onze-horas', agendado_para: '2026-11-03T11:00:00-03:00' }),
    post({ id: 'noite', agendado_para: '2026-11-03T19:00:00-03:00' }),
    post({ id: 'ja-saiu', agendado_para: '2026-11-03T10:00:00-03:00', instagram: { status: 'publicado', tentativas: 1 } }),
    post({ id: 'pausado', agendado_para: '2026-11-03T10:00:00-03:00', instagram: { status: 'pausado', tentativas: 0 } }),
    post({ id: 'esgotado', agendado_para: '2026-11-03T10:00:00-03:00', instagram: { status: 'pendente', tentativas: 3 } }),
  );
  const agora = new Date('2026-11-03T15:30:00Z'); // 12h30 em Brasília
  assert.deepEqual(postsDevidos(f, agora).map((p) => p.id), ['onze-horas', 'meio-dia']);
  assert.equal(proximoPendente(f, agora).id, 'noite');
  assert.equal(proximoPendente(fila(), agora), null);
});

test('com so_id publica fora da agenda, inclusive um post que falhou', () => {
  const f = fila(
    post({ id: 'futuro', agendado_para: '2030-01-01T12:00:00-03:00' }),
    post({ id: 'falhou-antes', instagram: { status: 'falhou', tentativas: 3 } }),
    post({ id: 'ja-saiu', instagram: { status: 'publicado', tentativas: 1 } }),
  );
  const agora = new Date('2026-11-03T15:30:00Z');
  assert.deepEqual(postsDevidos(f, agora, { soId: 'futuro' }).map((p) => p.id), ['futuro']);
  assert.deepEqual(postsDevidos(f, agora, { soId: 'falhou-antes' }).map((p) => p.id), ['falhou-antes']);
  assert.deepEqual(postsDevidos(f, agora, { soId: 'ja-saiu' }), []);
  assert.deepEqual(postsDevidos(f, agora, { soId: 'nao-existe' }), []);
});

test('aplicarMudanca junta os campos e ignora post que sumiu', () => {
  const f = fila(post({ instagram: { status: 'pendente', tentativas: 1, ultimo_erro: 'x' } }));
  assert.equal(aplicarMudanca(f, 'reel-teste', { status: 'publicado', ultimo_erro: null }), true);
  assert.deepEqual(f.posts[0].instagram, { status: 'publicado', tentativas: 1, ultimo_erro: null });
  assert.equal(aplicarMudanca(f, 'outro', { status: 'publicado' }), false);
});

test('reel de teste: aceita manual ou automatico, só em reel', () => {
  assert.deepEqual(validarFila(fila(post({ teste: 'manual' }), post({ id: 'outro', teste: 'automatico' }))).erros, []);
  assert.match(validarFila(fila(post({ teste: 'sim' }))).erros.join(), /"teste" precisa ser manual ou automatico/);
  assert.match(
    validarFila(fila(post({ tipo: 'carrossel', midias: ['01.jpg', '02.jpg'], teste: 'manual' }))).erros.join(),
    /só vale para reel/,
  );
});

test('"ia" precisa ser true ou false', () => {
  assert.deepEqual(validarFila(fila(post({ ia: true }))).erros, []);
  assert.match(validarFila(fila(post({ ia: 'sim' }))).erros.join(), /"ia"/);
});
