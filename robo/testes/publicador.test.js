import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarMudanca } from '../fila.js';
import { ErroInstagram } from '../instagram.js';
import { deuErrado, executar, resumoEmMarkdown } from '../publicador.js';

const URL_SITE = 'https://exemplo.github.io/perfil';
const LINK = 'https://www.instagram.com/p/xyz/';

function apiFalsa({ recentes = [], erro = null, erroEm = null } = {}) {
  const chamadas = [];
  let contador = 0;
  return {
    chamadas,
    async mediasRecentes() {
      chamadas.push(['recentes']);
      if (erroEm === 'recentes') throw erro;
      return recentes;
    },
    async criarContainer(params) {
      chamadas.push(['criar', params]);
      if (erroEm === 'criar') throw erro;
      contador += 1;
      return `c${contador}`;
    },
    async aguardarContainer(id, { video }) {
      chamadas.push(['aguardar', id, video]);
      if (erroEm === 'aguardar') throw erro;
    },
    async publicarContainer(id) {
      chamadas.push(['publicar', id]);
      return 'midia-1';
    },
    async buscarLink() {
      return LINK;
    },
  };
}

function filaNaMemoria(posts) {
  const estado = { posts: structuredClone(posts) };
  const commits = [];
  return {
    estado,
    commits,
    carregarFila: async () => structuredClone(estado),
    salvarMudanca: async (id, mudanca, mensagem) => {
      aplicarMudanca(estado, id, mudanca);
      commits.push(mensagem);
    },
  };
}

function relogioFalso(inicio) {
  let agora = new Date(inicio).getTime();
  const sonos = [];
  return {
    sonos,
    relogio: () => new Date(agora),
    dormir: async (ms) => {
      sonos.push(ms);
      agora += ms;
    },
  };
}

const post = (extra = {}) => ({
  id: 'reel-1',
  tipo: 'reel',
  agendado_para: '2026-11-03T12:00:00-03:00',
  legenda: 'Seu cliente não sumiu.\n\n#followup',
  midias: ['video.mp4'],
  ...extra,
});

// 12h01 em Brasília: o post das 12h já passou da hora.
const DEPOIS_DO_HORARIO = '2026-11-03T15:01:00Z';

function rodar({ posts, api, inicio = DEPOIS_DO_HORARIO, verificarUrl = async () => true, ...extra }) {
  const fila = filaNaMemoria(posts);
  const tempo = relogioFalso(inicio);
  const resultado = executar({
    carregarFila: fila.carregarFila,
    salvarMudanca: fila.salvarMudanca,
    api,
    urlSite: URL_SITE,
    verificarUrl,
    relogio: tempo.relogio,
    dormir: tempo.dormir,
    log: () => {},
    ...extra,
  });
  return { fila, tempo, resultado };
}

test('publica um reel na hora e marca na fila', async () => {
  const api = apiFalsa();
  const { fila, resultado } = rodar({ posts: [post({ capa: 'capa.jpg' })], api });
  const resumo = await resultado;

  assert.deepEqual(resumo.publicados, [{ id: 'reel-1', link: LINK }]);
  const ig = fila.estado.posts[0].instagram;
  assert.equal(ig.status, 'publicado');
  assert.equal(ig.tentativas, 1);
  assert.equal(ig.id_publicado, 'midia-1');
  assert.equal(ig.link, LINK);
  assert.deepEqual(fila.commits, ['robô: publicou reel-1']);

  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.equal(params.media_type, 'REELS');
  assert.equal(params.video_url, `${URL_SITE}/midia/reel-1/video.mp4`);
  assert.equal(params.cover_url, `${URL_SITE}/midia/reel-1/capa.jpg`);
  assert.equal(params.share_to_feed, 'true');
  assert.deepEqual(api.chamadas.find(([tipo]) => tipo === 'aguardar'), ['aguardar', 'c1', true]);
  assert.deepEqual(api.chamadas.at(-1), ['publicar', 'c1']);
  assert.equal(deuErrado(resumo), false);
});

test('carrossel cria um item por slide e depois o carrossel', async () => {
  const api = apiFalsa();
  const { resultado } = rodar({
    posts: [post({ id: 'carrossel-1', tipo: 'carrossel', midias: ['01.jpg', '02.jpg', '03.mp4'] })],
    api,
  });
  await resultado;
  const criados = api.chamadas.filter(([tipo]) => tipo === 'criar').map(([, params]) => params);
  assert.deepEqual(criados[0], { image_url: `${URL_SITE}/midia/carrossel-1/01.jpg`, is_carousel_item: 'true' });
  assert.deepEqual(criados[2], { media_type: 'VIDEO', video_url: `${URL_SITE}/midia/carrossel-1/03.mp4`, is_carousel_item: 'true' });
  assert.equal(criados[3].media_type, 'CAROUSEL');
  assert.equal(criados[3].children, 'c1,c2,c3');
  assert.deepEqual(api.chamadas.at(-1), ['publicar', 'c4']);
});

test('imagem simples', async () => {
  const api = apiFalsa();
  const { resultado } = rodar({ posts: [post({ id: 'imagem-1', tipo: 'imagem', midias: ['a.jpg'] })], api });
  await resultado;
  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.deepEqual(params, { image_url: `${URL_SITE}/midia/imagem-1/a.jpg`, caption: post().legenda });
});

test('falha conta tentativa; na terceira, desiste', async () => {
  const erro = new ErroInstagram('O Instagram não conseguiu processar a mídia (ERROR): codec');

  const primeira = rodar({ posts: [post()], api: apiFalsa({ erroEm: 'aguardar', erro }) });
  const resumo1 = await primeira.resultado;
  assert.equal(primeira.fila.estado.posts[0].instagram.status, 'pendente');
  assert.equal(primeira.fila.estado.posts[0].instagram.tentativas, 1);
  assert.match(primeira.fila.estado.posts[0].instagram.ultimo_erro, /codec/);
  assert.equal(deuErrado(resumo1), true);

  const terceira = rodar({
    posts: [post({ instagram: { status: 'pendente', tentativas: 2 } })],
    api: apiFalsa({ erroEm: 'aguardar', erro }),
  });
  const resumo3 = await terceira.resultado;
  assert.equal(terceira.fila.estado.posts[0].instagram.status, 'falhou');
  assert.equal(terceira.fila.estado.posts[0].instagram.tentativas, 3);
  assert.match(resumoEmMarkdown(resumo3), /desisti/);
});

test('token inválido para tudo sem gastar tentativa', async () => {
  const erro = new ErroInstagram('Token expirou', { tokenInvalido: true });
  const { fila, resultado } = rodar({
    posts: [post(), post({ id: 'reel-2' })],
    api: apiFalsa({ erroEm: 'recentes', erro }),
  });
  const resumo = await resultado;
  assert.match(resumo.interrompido, /conectar-instagram/);
  assert.deepEqual(fila.commits, []);
  assert.equal(fila.estado.posts[0].instagram, undefined);
});

test('reconhece post que já tinha saído e não publica de novo', async () => {
  const api = apiFalsa({
    recentes: [{ id: 'antigo', caption: 'Seu cliente não sumiu.  #followup', timestamp: '2026-11-03T15:00:30+0000', permalink: LINK }],
  });
  const { fila, resultado } = rodar({ posts: [post()], api });
  const resumo = await resultado;
  assert.deepEqual(resumo.recuperados, [{ id: 'reel-1', link: LINK }]);
  assert.equal(api.chamadas.some(([tipo]) => tipo === 'criar'), false);
  assert.equal(fila.estado.posts[0].instagram.status, 'publicado');
  assert.equal(fila.estado.posts[0].instagram.id_publicado, 'antigo');
});

test('legenda igual de semanas atrás não conta como já publicado', async () => {
  const api = apiFalsa({
    recentes: [{ id: 'velho', caption: 'Seu cliente não sumiu.\n\n#followup', timestamp: '2026-10-01T15:00:00+0000' }],
  });
  const { resultado } = rodar({ posts: [post()], api });
  assert.equal((await resultado).publicados.length, 1);
});

test('se não der para conferir os recentes, publica mesmo assim', async () => {
  const api = apiFalsa({ erroEm: 'recentes', erro: new ErroInstagram('sem permissão', { codigo: 10 }) });
  const { resultado } = rodar({ posts: [post()], api });
  assert.equal((await resultado).publicados.length, 1);
});

test('mídia fora do ar vira falha clara, sem chamar o Instagram', async () => {
  const api = apiFalsa();
  const { fila, resultado } = rodar({ posts: [post()], api, verificarUrl: async () => false });
  const resumo = await resultado;
  assert.match(resumo.falhas[0].erro, /não está no ar/);
  assert.equal(api.chamadas.some(([tipo]) => tipo === 'criar'), false);
  assert.equal(fila.estado.posts[0].instagram.tentativas, 1);
});

test('espera o próximo post se ele sai em menos de 5h20', async () => {
  const api = apiFalsa();
  // 11h20 em Brasília; o post é às 12h.
  const { tempo, resultado } = rodar({ posts: [post()], api, inicio: '2026-11-03T14:20:00Z' });
  const resumo = await resultado;
  assert.deepEqual(resumo.publicados.map((p) => p.id), ['reel-1']);
  assert.equal(tempo.sonos.length, 1);
  assert.ok(tempo.relogio() >= new Date('2026-11-03T15:00:00Z'));
  assert.equal(resumo.proximo, null);
});

test('espera horas pelo post da janela seguinte', async () => {
  const api = apiFalsa();
  // 8h em Brasília; o post é às 12h.
  const { tempo, resultado } = rodar({ posts: [post()], api, inicio: '2026-11-03T11:00:00Z' });
  const resumo = await resultado;
  assert.deepEqual(resumo.publicados.map((p) => p.id), ['reel-1']);
  assert.equal(tempo.sonos.length, 1);
  assert.ok(tempo.relogio() >= new Date('2026-11-03T15:00:00Z'));
});

test('não espera se o próximo post está longe', async () => {
  const api = apiFalsa();
  // 6h em Brasília; o post é às 12h (6 horas depois).
  const { tempo, resultado } = rodar({ posts: [post()], api, inicio: '2026-11-03T09:00:00Z' });
  const resumo = await resultado;
  assert.deepEqual(resumo.publicados, []);
  assert.deepEqual(tempo.sonos, []);
  assert.equal(resumo.proximo.id, 'reel-1');
  assert.match(resumoEmMarkdown(resumo), /Nada para publicar agora/);
});

test('ensaio não chama o Instagram nem mexe na fila', async () => {
  const { fila, resultado } = rodar({ posts: [post()], api: null, ensaio: true });
  const resumo = await resultado;
  assert.deepEqual(resumo.ensaio, [{ id: 'reel-1', faltando: [], conferido: true }]);
  assert.deepEqual(fila.commits, []);
  assert.equal(fila.estado.posts[0].instagram, undefined);
});

test('ensaio avisa quando falta mídia no ar', async () => {
  const { resultado } = rodar({ posts: [post()], api: null, ensaio: true, verificarUrl: async () => false });
  const resumo = await resultado;
  assert.equal(resumo.ensaio[0].faltando.length, 1);
  assert.equal(deuErrado(resumo), true);
});

test('so_id publica um post fora da agenda', async () => {
  const api = apiFalsa();
  const { resultado } = rodar({
    posts: [post({ agendado_para: '2030-01-01T12:00:00-03:00' })],
    api,
    soId: 'reel-1',
  });
  assert.deepEqual((await resultado).publicados.map((p) => p.id), ['reel-1']);
});

test('so_id que não existe para com aviso', async () => {
  const { resultado } = rodar({ posts: [post()], api: apiFalsa(), soId: 'nao-existe' });
  assert.match((await resultado).interrompido, /nao-existe/);
});

test('se salvar a fila falhar depois de publicar, não marca como falha', async () => {
  const api = apiFalsa();
  const fila = filaNaMemoria([post()]);
  const tempo = relogioFalso(DEPOIS_DO_HORARIO);
  await assert.rejects(
    executar({
      carregarFila: fila.carregarFila,
      salvarMudanca: async () => {
        throw new Error('push recusado');
      },
      api,
      urlSite: URL_SITE,
      verificarUrl: async () => true,
      relogio: tempo.relogio,
      dormir: tempo.dormir,
      log: () => {},
    }),
    /push recusado/,
  );
  assert.equal(fila.estado.posts[0].instagram, undefined);
});

test('reel de teste vai com trial_params e sem share_to_feed', async () => {
  const api = apiFalsa();
  const { resultado } = rodar({ posts: [post({ teste: 'manual' })], api });
  assert.equal((await resultado).publicados.length, 1);
  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.equal(params.media_type, 'REELS');
  assert.deepEqual(JSON.parse(params.trial_params), { graduation_strategy: 'MANUAL' });
  assert.equal('share_to_feed' in params, false);
});

test('reel de teste automático usa SS_PERFORMANCE', async () => {
  const api = apiFalsa();
  await rodar({ posts: [post({ teste: 'automatico' })], api }).resultado;
  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.deepEqual(JSON.parse(params.trial_params), { graduation_strategy: 'SS_PERFORMANCE' });
});

test('duas versões com a mesma legenda: a segunda não é confundida com a primeira', async () => {
  const legenda = 'Seu cliente não sumiu.\n\n#followup';
  // A versão A já saiu (está na fila com o id do Instagram) e aparece nos recentes.
  const api = apiFalsa({
    recentes: [{ id: 'versao-a', caption: legenda, timestamp: '2026-11-03T15:00:30+0000', permalink: LINK }],
  });
  const posts = [
    post({ id: 'teste-a', teste: 'manual', instagram: { status: 'publicado', tentativas: 1, id_publicado: 'versao-a' } }),
    post({ id: 'teste-b', teste: 'manual' }),
  ];
  const { fila, resultado } = rodar({ posts, api });
  const resumo = await resultado;
  assert.deepEqual(resumo.recuperados, []);
  assert.deepEqual(resumo.publicados.map((p) => p.id), ['teste-b']);
  assert.equal(fila.estado.posts[1].instagram.id_publicado, 'midia-1');
});

test('duas versões na mesma rodada: publica as duas', async () => {
  const legenda = 'Seu cliente não sumiu.\n\n#followup';
  let n = 0;
  const api = apiFalsa();
  // Depois de publicar a primeira, ela passa a aparecer nos recentes com a mesma legenda.
  api.publicarContainer = async () => `midia-${++n}`;
  api.mediasRecentes = async () =>
    n ? [{ id: 'midia-1', caption: legenda, timestamp: '2026-11-03T15:01:30+0000' }] : [];
  const posts = [post({ id: 'teste-a', teste: 'manual' }), post({ id: 'teste-b', teste: 'manual' })];
  const { fila, resultado } = rodar({ posts, api });
  const resumo = await resultado;
  assert.deepEqual(resumo.publicados.map((p) => p.id), ['teste-a', 'teste-b']);
  assert.deepEqual(fila.estado.posts.map((p) => p.instagram.id_publicado), ['midia-1', 'midia-2']);
});

test('reel com "ia" leva o rótulo is_ai_generated', async () => {
  const api = apiFalsa();
  await rodar({ posts: [post({ ia: true })], api }).resultado;
  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.equal(params.is_ai_generated, 'true');
});

test('sem "ia", não manda o rótulo', async () => {
  const api = apiFalsa();
  await rodar({ posts: [post()], api }).resultado;
  const [, params] = api.chamadas.find(([tipo]) => tipo === 'criar');
  assert.equal('is_ai_generated' in params, false);
});

test('se o Instagram recusar o rótulo de IA, publica sem ele e avisa', async () => {
  const api = apiFalsa();
  const criar = api.criarContainer;
  api.criarContainer = async (params) => {
    if (params.is_ai_generated) throw new ErroInstagram('O Instagram respondeu 400: Invalid parameter is_ai_generated');
    return criar(params);
  };
  const avisos = [];
  const { resultado } = rodar({ posts: [post({ ia: true })], api, log: (m) => avisos.push(m) });
  assert.equal((await resultado).publicados.length, 1);
  assert.ok(avisos.some((m) => m.includes('rótulo de IA')));
});
