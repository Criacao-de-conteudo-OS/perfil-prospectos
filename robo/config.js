export const MAX_TENTATIVAS = 3;

// Se o próximo post sai em até 75 minutos, o robô espera por ele em vez de
// depender da próxima rodada de hora em hora (que o GitHub costuma atrasar).
export const JANELA_ESPERA_MIN = 75;

export const VERSAO_API_PADRAO = 'v26.0';

// Apps novos da Meta usam o "login unificado": a chave é de usuário do sistema,
// não expira e as chamadas vão para graph.facebook.com.
export const HOST_API_PADRAO = 'https://graph.facebook.com';

const VERDADEIRO = new Set(['true', '1', 'sim', 'yes']);

export function lerConfig(env = process.env) {
  return {
    igUserId: (env.IG_USER_ID ?? '').trim(),
    igToken: (env.IG_TOKEN ?? '').trim(),
    urlSite: (env.URL_SITE ?? '').trim().replace(/\/+$/, ''),
    versaoApi: (env.IG_API_VERSION ?? '').trim() || VERSAO_API_PADRAO,
    hostApi: (env.IG_API_HOST ?? '').trim().replace(/\/+$/, '') || HOST_API_PADRAO,
    // Só é preciso se o app exigir "appsecret_proof" nas chamadas.
    appSecret: (env.IG_APP_SECRET ?? '').trim(),
    ensaio: VERDADEIRO.has(String(env.ENSAIO ?? '').trim().toLowerCase()),
    soId: (env.SO_ID ?? '').trim() || null,
    noGitHub: env.GITHUB_ACTIONS === 'true',
  };
}

export function configFaltando(cfg) {
  const faltam = [];
  if (!cfg.igUserId) faltam.push('IG_USER_ID (segredo)');
  if (!cfg.igToken) faltam.push('IG_TOKEN (segredo)');
  if (!cfg.urlSite) faltam.push('URL_SITE (variável)');
  return faltam;
}
