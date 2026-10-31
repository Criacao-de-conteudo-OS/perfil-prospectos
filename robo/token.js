import { esconderSegredos } from './util.js';

const URL_RENOVAR = 'https://graph.instagram.com/refresh_access_token';

// O token do Instagram vale 60 dias. Renovar troca por um novo, com mais 60 dias.
export async function renovarToken(token, fetch = globalThis.fetch) {
  const url = `${URL_RENOVAR}?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`;
  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (erro) {
    throw new Error(esconderSegredos(`Falha de rede ao renovar o token: ${erro.message}`, [token]));
  }
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    // resposta não é JSON
  }
  if (!resposta.ok || !dados?.access_token) {
    const detalhe = dados?.error?.message ?? texto.slice(0, 300);
    throw new Error(esconderSegredos(`O Instagram não renovou o token (HTTP ${resposta.status}): ${detalhe}`, [token]));
  }
  return { token: dados.access_token, dias: Math.floor((dados.expires_in ?? 0) / 86_400) };
}
