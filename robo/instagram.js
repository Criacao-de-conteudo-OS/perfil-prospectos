import { createHmac } from 'node:crypto';
import { HOST_API_PADRAO } from './config.js';
import { esperar, esconderSegredos } from './util.js';

export class ErroInstagram extends Error {
  constructor(mensagem, { codigo = null, tokenInvalido = false, temporario = false } = {}) {
    super(mensagem);
    this.name = 'ErroInstagram';
    this.codigo = codigo;
    this.tokenInvalido = tokenInvalido;
    this.temporario = temporario;
  }
}

const TENTATIVAS_REDE = 3;

// Quanto esperar o Instagram processar cada mídia antes de publicar.
const ESPERA_PADRAO = {
  video: { intervaloMs: 15_000, maximo: 40 }, // até 10 minutos
  imagem: { intervaloMs: 5_000, maximo: 24 }, // até 2 minutos
};

function traduzirErro(status, dados, texto, limpar) {
  const erro = dados?.error;
  const codigo = erro?.code ?? null;
  const detalhe = erro
    ? [erro.error_user_title, erro.error_user_msg || erro.message].filter(Boolean).join(': ')
    : texto.slice(0, 300);
  const sufixo = codigo ? ` (código ${codigo}${erro?.error_subcode ? `/${erro.error_subcode}` : ''})` : '';
  const tokenInvalido = codigo === 190 || status === 401;
  const temporario = !tokenInvalido && (status >= 500 || erro?.is_transient === true || codigo === 1 || codigo === 2);
  return new ErroInstagram(limpar(`O Instagram respondeu ${status}${sufixo}: ${detalhe}`), { codigo, tokenInvalido, temporario });
}

export function criarClienteInstagram({
  igUserId,
  token,
  versao,
  fetch = globalThis.fetch,
  dormir = esperar,
  espera = ESPERA_PADRAO,
  base = HOST_API_PADRAO,
  appSecret = '',
}) {
  const raiz = `${base}/${versao}`;
  const limpar = (texto) => esconderSegredos(texto, [token, appSecret]);
  const credenciais = { access_token: token };
  if (appSecret) credenciais.appsecret_proof = createHmac('sha256', appSecret).update(token).digest('hex');

  async function chamar(metodo, caminho, params = {}) {
    const corpo = new URLSearchParams({ ...params, ...credenciais });
    const url = metodo === 'GET' ? `${raiz}/${caminho}?${corpo}` : `${raiz}/${caminho}`;
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= TENTATIVAS_REDE; tentativa++) {
      if (tentativa > 1) await dormir(2_000 * (tentativa - 1));
      let resposta;
      try {
        resposta = await fetch(url, {
          method: metodo,
          body: metodo === 'GET' ? undefined : corpo,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (erro) {
        ultimoErro = new ErroInstagram(limpar(`Falha de rede ao falar com o Instagram: ${erro.message}`), { temporario: true });
        continue;
      }
      const texto = await resposta.text();
      let dados = null;
      try {
        dados = JSON.parse(texto);
      } catch {
        // resposta não é JSON; o texto vai para a mensagem de erro
      }
      if (resposta.ok && dados && !dados.error) return dados;
      ultimoErro = traduzirErro(resposta.status, dados, texto, limpar);
      if (!ultimoErro.temporario) throw ultimoErro;
    }
    throw ultimoErro;
  }

  async function criarContainer(params) {
    const resposta = await chamar('POST', `${igUserId}/media`, params);
    return resposta.id;
  }

  async function aguardarContainer(id, { video }) {
    const { intervaloMs, maximo } = video ? espera.video : espera.imagem;
    for (let i = 0; i < maximo; i++) {
      const resposta = await chamar('GET', id, { fields: 'status_code,status' });
      const estado = resposta.status_code;
      if (estado === 'FINISHED' || estado === 'PUBLISHED') return;
      if (estado === 'ERROR' || estado === 'EXPIRED') {
        throw new ErroInstagram(limpar(`O Instagram não conseguiu processar a mídia (${estado}): ${resposta.status ?? 'sem detalhe'}`));
      }
      await dormir(intervaloMs);
    }
    const minutos = Math.round((intervaloMs * maximo) / 60_000);
    throw new ErroInstagram(`O Instagram demorou mais de ${minutos} min para processar a mídia.`);
  }

  async function publicarContainer(id) {
    const resposta = await chamar('POST', `${igUserId}/media_publish`, { creation_id: id });
    return resposta.id;
  }

  async function buscarLink(idMidia) {
    try {
      const resposta = await chamar('GET', idMidia, { fields: 'permalink' });
      return resposta.permalink ?? null;
    } catch {
      return null; // o post já saiu; o link é só um extra
    }
  }

  async function mediasRecentes(limite = 10) {
    const resposta = await chamar('GET', `${igUserId}/media`, {
      fields: 'id,caption,timestamp,permalink',
      limit: String(limite),
    });
    return resposta.data ?? [];
  }

  return { criarContainer, aguardarContainer, publicarContainer, buscarLink, mediasRecentes };
}
