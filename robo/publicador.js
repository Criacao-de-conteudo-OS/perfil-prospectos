import { JANELA_ESPERA_MIN, MAX_TENTATIVAS } from './config.js';
import { MODOS_TESTE, postsDevidos, proximoPendente, tentativasDe } from './fila.js';
import { ErroInstagram } from './instagram.js';
import { formatarDataHora, lerDataInstagram } from './util.js';

const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
const RE_VIDEO = /\.mp4$/i;

export function urlDaMidia(urlSite, post, arquivo) {
  return `${urlSite}/midia/${post.id}/${encodeURIComponent(arquivo)}`;
}

// Todas as mídias do post, incluindo a capa do reel.
export function urlsDoPost(post, urlSite) {
  const arquivos = [...post.midias, ...(post.capa ? [post.capa] : [])];
  return arquivos.map((arquivo) => urlDaMidia(urlSite, post, arquivo));
}

export async function urlNoAr(url, fetch = globalThis.fetch) {
  try {
    const resposta = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    return resposta.ok;
  } catch {
    return false;
  }
}

const normalizarLegenda = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

// Se uma rodada anterior publicou e caiu antes de salvar a fila, o post já está no
// Instagram. Procurar a mesma legenda nos posts recentes evita publicar duas vezes.
// Posts que a fila já registrou (idsUsados) não contam: duas versões de um teste
// têm a mesma legenda e são posts diferentes.
async function procurarJaPublicado(post, { api, agora, log, idsUsados }) {
  let recentes;
  try {
    recentes = await api.mediasRecentes();
  } catch (erro) {
    if (erro.tokenInvalido) throw erro;
    log(`Aviso: não consegui conferir os posts recentes (${erro.message}). Sigo com a publicação.`);
    return null;
  }
  const legenda = normalizarLegenda(post.legenda);
  const desde = agora.getTime() - TRES_DIAS_MS;
  const achado = recentes.find(
    (midia) =>
      !idsUsados.has(midia.id) && normalizarLegenda(midia.caption) === legenda && lerDataInstagram(midia.timestamp) >= desde,
  );
  return achado ? { idPublicado: achado.id, link: achado.permalink ?? null } : null;
}

// Rótulo "Informações de IA" (is_ai_generated). Se o Instagram recusar o campo, publica
// sem o rótulo e avisa no registro, em vez de perder o post.
async function criarComRotuloIa(api, params, post, log) {
  if (!post.ia) return api.criarContainer(params);
  try {
    return await api.criarContainer({ ...params, is_ai_generated: 'true' });
  } catch (erro) {
    if (erro.tokenInvalido || !/is_ai_generated/i.test(erro.message)) throw erro;
    log(`Aviso: o Instagram recusou o rótulo de IA em "${post.id}" (${erro.message}). Publicando sem o rótulo.`);
    return api.criarContainer(params);
  }
}

// Reel de teste (Reels de teste do Instagram): vai só para quem não segue a conta.
// Conta nova ou com poucos seguidores pode não ter o recurso. Se o Instagram recusar,
// o robô publica o reel normal, como o plano da semana pede ("se a conta tiver").
// Falha de rede ou de processamento do vídeo não conta como recusa: ali o reel
// normal falharia igual, e a próxima rodada tenta de novo do jeito certo.
function recusouModoTeste(erro) {
  if (erro.tokenInvalido || erro.temporario) return false;
  return erro.codigo !== null || /trial/i.test(erro.message);
}

async function criarReel(api, post, { url, urlSite, log, teste }) {
  const params = { media_type: 'REELS', video_url: url, caption: post.legenda };
  if (teste) {
    params.trial_params = JSON.stringify({ graduation_strategy: MODOS_TESTE[post.teste] });
  } else {
    params.share_to_feed = 'true';
  }
  if (post.capa) params.cover_url = urlDaMidia(urlSite, post, post.capa);
  const container = await criarComRotuloIa(api, params, post, log);
  await api.aguardarContainer(container, { video: true });
  return container;
}

async function publicarContainerComLink(api, container) {
  const idPublicado = await api.publicarContainer(container);
  const link = await api.buscarLink(idPublicado);
  return { idPublicado, link, recuperado: false };
}

async function publicarReelDeTeste(post, { api, url, urlSite, log }) {
  try {
    return await publicarContainerComLink(api, await criarReel(api, post, { url, urlSite, log, teste: true }));
  } catch (erro) {
    if (!recusouModoTeste(erro)) throw erro;
    log(`Aviso: o Instagram recusou o reel de teste "${post.id}" (${erro.message}). Publicando como reel normal.`);
  }
  const resultado = await publicarContainerComLink(api, await criarReel(api, post, { url, urlSite, log, teste: false }));
  return { ...resultado, testeRecusado: true };
}

export async function publicarPost(post, { api, urlSite, verificarUrl, agora, log = () => {}, idsUsados = new Set() }) {
  const existente = await procurarJaPublicado(post, { api, agora, log, idsUsados });
  if (existente) return { ...existente, recuperado: true };

  for (const url of urlsDoPost(post, urlSite)) {
    if (!(await verificarUrl(url))) throw new ErroInstagram(`A mídia não está no ar: ${url}`);
  }

  const urls = post.midias.map((arquivo) => urlDaMidia(urlSite, post, arquivo));
  let container;
  if (post.tipo === 'imagem') {
    container = await api.criarContainer({ image_url: urls[0], caption: post.legenda });
    await api.aguardarContainer(container, { video: false });
  } else if (post.tipo === 'reel') {
    if (post.teste) return publicarReelDeTeste(post, { api, url: urls[0], urlSite, log });
    container = await criarReel(api, post, { url: urls[0], urlSite, log, teste: false });
  } else if (post.tipo === 'carrossel') {
    const filhos = [];
    for (const url of urls) {
      const video = RE_VIDEO.test(url);
      const params = video
        ? { media_type: 'VIDEO', video_url: url, is_carousel_item: 'true' }
        : { image_url: url, is_carousel_item: 'true' };
      filhos.push({ id: await api.criarContainer(params), video });
    }
    for (const filho of filhos) await api.aguardarContainer(filho.id, { video: filho.video });
    container = await criarComRotuloIa(api, {
      media_type: 'CAROUSEL',
      children: filhos.map((filho) => filho.id).join(','),
      caption: post.legenda,
    }, post, log);
    await api.aguardarContainer(container, { video: false });
  } else {
    throw new ErroInstagram(`Tipo de post desconhecido: ${post.tipo}`);
  }

  return publicarContainerComLink(api, container);
}

async function ensaiar(post, { urlSite, verificarUrl, log }) {
  const faltando = [];
  if (urlSite) {
    for (const url of urlsDoPost(post, urlSite)) {
      if (!(await verificarUrl(url))) faltando.push(url);
    }
  }
  let situacao = ' (sem URL_SITE, não conferi as mídias)';
  if (urlSite) situacao = faltando.length ? `, mas faltam no ar: ${faltando.join(', ')}` : ', com todas as mídias no ar';
  log(`ENSAIO: publicaria ${post.tipo}${post.teste ? ' de teste' : ''} "${post.id}" (${post.midias.length} mídia(s))${situacao}.`);
  return { id: post.id, faltando, conferido: Boolean(urlSite) };
}

const resumirProximo = (post) => (post ? { id: post.id, quando: post.agendado_para } : null);

export async function executar({
  carregarFila,
  salvarMudanca,
  api,
  urlSite,
  verificarUrl = urlNoAr,
  relogio = () => new Date(),
  dormir,
  soId = null,
  ensaio = false,
  log = console.log,
  janelaMinutos = JANELA_ESPERA_MIN,
}) {
  const resumo = { publicados: [], recuperados: [], falhas: [], ensaio: [], proximo: null, interrompido: null };
  const jaTratados = new Set();
  const idsUsados = new Set(); // ids do Instagram que já pertencem a algum post da fila

  for (let rodada = 1; ; rodada++) {
    const fila = await carregarFila();
    for (const p of fila.posts) if (p.instagram?.id_publicado) idsUsados.add(p.instagram.id_publicado);
    const devidos = postsDevidos(fila, relogio(), { soId }).filter((post) => !jaTratados.has(post.id));

    if (soId && rodada === 1 && devidos.length === 0) {
      resumo.interrompido = `Não achei na fila um post "${soId}" pendente ou com falha.`;
      log(resumo.interrompido);
      return resumo;
    }

    for (const post of devidos) {
      jaTratados.add(post.id);
      if (ensaio) {
        resumo.ensaio.push(await ensaiar(post, { urlSite, verificarUrl, log }));
        continue;
      }

      log(`Publicando ${post.tipo}${post.teste ? ' de teste' : ''} "${post.id}" (agendado para ${formatarDataHora(post.agendado_para)})...`);
      let resultado;
      try {
        resultado = await publicarPost(post, { api, urlSite, verificarUrl, agora: relogio(), log, idsUsados });
      } catch (erro) {
        if (erro.tokenInvalido) {
          resumo.interrompido = `O Instagram recusou a chave de acesso: ${erro.message}. Conecte a conta de novo (node robo/conectar-instagram.js) para gerar uma chave nova.`;
          log(resumo.interrompido);
          return resumo;
        }
        const tentativas = tentativasDe(post) + 1;
        const status = tentativas >= MAX_TENTATIVAS ? 'falhou' : 'pendente';
        await salvarMudanca(
          post.id,
          { status, tentativas, ultimo_erro: erro.message, ultima_tentativa_em: relogio().toISOString() },
          `robô: falha em ${post.id} (tentativa ${tentativas} de ${MAX_TENTATIVAS})`,
        );
        resumo.falhas.push({ id: post.id, tentativas, status, erro: erro.message });
        log(`Falhou "${post.id}" (tentativa ${tentativas} de ${MAX_TENTATIVAS}): ${erro.message}`);
        continue;
      }

      // Fora do try: se salvar a fila falhar, o post continua publicado e a
      // próxima rodada o reconhece pela legenda, em vez de contar como falha.
      const { idPublicado, link, recuperado, testeRecusado } = resultado;
      idsUsados.add(idPublicado);
      await salvarMudanca(
        post.id,
        {
          status: 'publicado',
          tentativas: tentativasDe(post) + (recuperado ? 0 : 1),
          id_publicado: idPublicado,
          link,
          publicado_em: relogio().toISOString(),
          ultimo_erro: null,
          // Saiu como reel normal porque o Instagram recusou o modo teste.
          ...(testeRecusado ? { teste_recusado: true } : {}),
        },
        recuperado ? `robô: ${post.id} já estava publicado` : `robô: publicou ${post.id}`,
      );
      (recuperado ? resumo.recuperados : resumo.publicados).push({ id: post.id, link, ...(testeRecusado ? { testeRecusado } : {}) });
      log(recuperado ? `"${post.id}" já estava no Instagram; só atualizei a fila.` : `Publicado: ${link ?? idPublicado}`);
    }

    if (soId) break;
    const filaAtual = ensaio ? fila : await carregarFila();
    const proximo = proximoPendente(filaAtual, relogio());
    resumo.proximo = resumirProximo(proximo);
    if (ensaio || !proximo) break;

    const faltaMs = Date.parse(proximo.agendado_para) - relogio().getTime();
    if (faltaMs > janelaMinutos * 60_000) break;
    log(`Próximo post ("${proximo.id}") em ${Math.ceil(faltaMs / 60_000)} min. Esperando para publicar na hora certa...`);
    await dormir(faltaMs + 5_000);
  }
  return resumo;
}

export function resumoEmMarkdown(resumo) {
  const linhas = [];
  if (resumo.interrompido) linhas.push(`**Parei:** ${resumo.interrompido}`, '');
  for (const p of resumo.publicados) {
    const aviso = p.testeRecusado ? ' — saiu como reel normal: o Instagram recusou o modo teste' : '';
    linhas.push(`- ✅ Publicado: \`${p.id}\`${p.link ? ` ([ver no Instagram](${p.link}))` : ''}${aviso}`);
  }
  for (const p of resumo.recuperados) linhas.push(`- ✅ Já estava publicado: \`${p.id}\``);
  for (const f of resumo.falhas) {
    const destino = f.status === 'falhou' ? 'desisti deste post' : 'tento de novo na próxima rodada';
    linhas.push(`- ❌ \`${f.id}\` (tentativa ${f.tentativas} de ${MAX_TENTATIVAS}, ${destino}): ${f.erro}`);
  }
  for (const e of resumo.ensaio) {
    const extra = e.faltando.length ? `, mas faltam ${e.faltando.length} mídia(s) no ar` : '';
    linhas.push(`- 🧪 Ensaio: publicaria \`${e.id}\`${extra}`);
  }
  if (linhas.length === 0) linhas.push('Nada para publicar agora.');
  linhas.push(
    '',
    resumo.proximo
      ? `Próximo: \`${resumo.proximo.id}\` em ${formatarDataHora(resumo.proximo.quando)} (horário de Brasília).`
      : 'Nenhum post pendente na fila.',
  );
  return `### Robô do Instagram\n\n${linhas.join('\n')}\n`;
}

export function deuErrado(resumo) {
  return Boolean(resumo.interrompido) || resumo.falhas.length > 0 || resumo.ensaio.some((e) => e.faltando.length > 0);
}
