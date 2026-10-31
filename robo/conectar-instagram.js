// Liga a conta do Instagram ao robô: confere a chave de acesso e grava a chave
// e o id da conta nos segredos do GitHub. A chave nunca é mostrada.
//
// Jeito principal: chave gerada no portfólio da Meta (business.facebook.com →
// Usuários do sistema → Gerar token) e salva num arquivo de texto no PC.
//   node robo/conectar-instagram.js --arquivo-token=<arquivo> --app-id=<id> [--arquivo-chave=<arquivo>] [--perfil=<usuario>] [--ig-id=<id>] [--ensaio]
//
// Jeito alternativo: código do login unificado, mostrado pela página conectar.html.
//   node robo/conectar-instagram.js <codigo> --app-id=<id> --arquivo-chave=<arquivo> [--perfil=<usuario>] [--ensaio]
//
// --arquivo-token: arquivo de texto com a chave de acesso (um texto longo que começa com "EAA").
// --arquivo-chave: arquivo de texto com a "Chave secreta do aplicativo" (32 caracteres).
//   Obrigatório com o código do login; opcional com --arquivo-token.
// --perfil: usuário do Instagram esperado, para escolher a conta certa se houver mais de uma.
// --ig-id: id da conta do Instagram, se a Meta não informar sozinha.
// --ensaio: confere tudo, mas não grava os segredos.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_API_PADRAO, VERSAO_API_PADRAO } from './config.js';
import { esconderSegredos } from './util.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = `${HOST_API_PADRAO}/${VERSAO_API_PADRAO}`;

// Tudo o que é secreto entra aqui, para nunca aparecer em mensagem de erro.
const segredos = [];
const limpar = (texto) => esconderSegredos(texto, segredos);

function lerArgs(argv) {
  const args = { codigo: null, arquivoToken: null, appId: null, arquivoChave: null, perfil: null, igId: null, ensaio: false };
  for (const arg of argv) {
    if (arg === '--ensaio') args.ensaio = true;
    else if (arg.startsWith('--app-id=')) args.appId = arg.slice(9).trim();
    else if (arg.startsWith('--arquivo-chave=')) args.arquivoChave = arg.slice(16).trim();
    else if (arg.startsWith('--arquivo-token=')) args.arquivoToken = arg.slice(16).trim();
    else if (arg.startsWith('--perfil=')) args.perfil = arg.slice(9).trim().replace(/^@/, '').toLowerCase();
    else if (arg.startsWith('--ig-id=')) args.igId = arg.slice(8).trim();
    else if (!arg.startsWith('--') && !args.codigo) args.codigo = arg.trim();
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!args.codigo && !args.arquivoToken) throw new Error('Falta a chave: use --arquivo-token=<arquivo com a chave> (ou o código do login).');
  if (args.codigo && args.arquivoToken) throw new Error('Use só um: --arquivo-token ou o código do login.');
  if (!args.appId || !/^\d{10,20}$/.test(args.appId)) throw new Error('Falta --app-id=<id do app na Meta>.');
  if (args.codigo && !args.arquivoChave) throw new Error('Com o código do login, falta --arquivo-chave=<arquivo com a chave secreta do app>.');
  if (args.igId && !/^\d{5,25}$/.test(args.igId)) throw new Error('--ig-id deve ter só números.');
  return args;
}

function lerChaveSecreta(caminho) {
  const achada = readFileSync(caminho, 'utf8').match(/\b[0-9a-f]{32}\b/i);
  if (!achada) throw new Error(`Não achei uma chave secreta (32 caracteres) em ${caminho}.`);
  return achada[0];
}

function lerToken(caminho) {
  const achado = readFileSync(caminho, 'utf8').match(/\bEAA[A-Za-z0-9]{40,}/);
  if (!achado) throw new Error(`Não achei a chave de acesso em ${caminho}. Ela é um texto longo que começa com "EAA".`);
  return achado[0];
}

function repoDoGitHub() {
  const remoto = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: RAIZ, encoding: 'utf8' }).trim();
  const achado = remoto.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  if (!achado) throw new Error(`Não reconheci o repositório do GitHub em ${remoto}.`);
  return { repo: `${achado[1]}/${achado[2]}`, site: `https://${achado[1].toLowerCase()}.github.io/${achado[2]}` };
}

async function pedir(caminho, params) {
  const url = `${API}/${caminho}?${new URLSearchParams(params)}`;
  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (erro) {
    throw new Error(limpar(`Falha de rede ao falar com a Meta: ${erro.message}`));
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || dados.error) {
    const detalhe = dados?.error ? `${dados.error.message} (código ${dados.error.code})` : `HTTP ${resposta.status}`;
    throw new Error(limpar(detalhe));
  }
  return dados;
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const segredo = args.arquivoChave ? lerChaveSecreta(args.arquivoChave) : null;
  segredos.push(segredo, args.codigo);
  const { repo, site } = repoDoGitHub();

  // 1. A chave: lida do arquivo, ou trocada pelo código do login.
  let token;
  if (args.arquivoToken) {
    token = lerToken(args.arquivoToken);
  } else {
    // A documentação do login unificado não pede o redirect_uri nessa troca;
    // o fluxo manual clássico pede. Tenta os dois jeitos.
    const parametrosTroca = { client_id: args.appId, client_secret: segredo, code: args.codigo };
    const troca = await pedir('oauth/access_token', { ...parametrosTroca, redirect_uri: `${site}/conectar.html` })
      .catch((erro) => {
        if (!/redirect|191/i.test(erro.message)) throw erro;
        return pedir('oauth/access_token', parametrosTroca);
      })
      .catch((erro) => {
        throw new Error(`A Meta não aceitou o código: ${erro.message}. Códigos valem poucos minutos; faça o login de novo e mande o código novo.`);
      });
    token = troca.access_token;
  }
  segredos.push(token);

  // Chamadas com a chave. Se o app exigir a prova da chave secreta, passa a mandá-la.
  let precisaProva = false;
  async function consultar(caminho, params = {}) {
    const comChave = { ...params, access_token: token };
    if (!precisaProva) {
      try {
        return await pedir(caminho, comChave);
      } catch (erro) {
        if (!/appsecret_proof/i.test(erro.message)) throw erro;
        if (!segredo) throw new Error('O app exige a chave secreta em cada chamada. Rode de novo com --arquivo-chave=<arquivo com a chave secreta do app>.');
        precisaProva = true;
      }
    }
    return pedir(caminho, { ...comChave, appsecret_proof: createHmac('sha256', segredo).update(token).digest('hex') });
  }

  // 2. O que essa chave pode fazer.
  const conferencia = segredo
    ? pedir('debug_token', { input_token: token, access_token: `${args.appId}|${segredo}` })
    : consultar('debug_token', { input_token: token });
  const { data: info } = await conferencia.catch((erro) => {
    const dica = segredo ? '' : ' Se continuar, salve também a chave secreta do app e rode com --arquivo-chave.';
    throw new Error(`Não consegui conferir a chave: ${erro.message}.${dica}`);
  });
  if (!info?.is_valid) {
    const motivo = info?.error?.message ? `: ${limpar(info.error.message)}` : '';
    throw new Error(`A Meta diz que a chave não é válida${motivo}.`);
  }
  if (info.app_id && String(info.app_id) !== args.appId) {
    throw new Error(`Essa chave foi gerada para outro app (id ${info.app_id}), não para o ${args.appId}. Gere de novo escolhendo o app certo.`);
  }
  const escopos = info.granular_scopes ?? [];
  const permissoes = [...new Set([...(info.scopes ?? []), ...escopos.map((e) => e.scope)])];
  if (!permissoes.includes('instagram_content_publish')) {
    throw new Error(`A chave não tem a permissão de publicar (instagram_content_publish). Permissões recebidas: ${permissoes.join(', ') || 'nenhuma'}. Gere a chave de novo marcando essa permissão.`);
  }

  // 3. Qual conta do Instagram a chave alcança.
  const idsDe = (escopo) => escopos.find((e) => e.scope === escopo)?.target_ids ?? [];
  let candidatos = args.igId
    ? [args.igId]
    : [...new Set([...idsDe('instagram_content_publish'), ...idsDe('instagram_basic')])];
  if (candidatos.length === 0) {
    // Contas ligadas a uma Página do Facebook aparecem pela Página.
    const paginas = await consultar('me/accounts', { fields: 'instagram_business_account', limit: '100' }).catch(() => null);
    candidatos = [...new Set((paginas?.data ?? []).map((p) => p.instagram_business_account?.id).filter(Boolean))];
  }
  if (candidatos.length === 0) {
    throw new Error('A Meta não informou qual conta do Instagram a chave alcança. No business.facebook.com, abra Configurações → Contas → Contas do Instagram, copie o número de identificação da conta e rode de novo com --ig-id=<número>.');
  }
  const contas = [];
  for (const id of candidatos) {
    const conta = await consultar(id, { fields: 'id,username' }).catch((erro) => {
      throw new Error(`Não consegui abrir a conta ${id} com essa chave: ${erro.message}`);
    });
    contas.push(conta);
  }
  const escolhida = args.perfil
    ? contas.find((c) => String(c.username ?? '').toLowerCase() === args.perfil)
    : contas.length === 1
      ? contas[0]
      : null;
  if (!escolhida) {
    throw new Error(`Não consegui escolher a conta. Contas que a chave alcança: ${contas.map((c) => `@${c.username} (${c.id})`).join(', ')}. Use --perfil=<usuario>.`);
  }

  // 4. Testa a permissão de publicar nessa conta, sem publicar nada.
  const limite = await consultar(`${escolhida.id}/content_publishing_limit`, { fields: 'quota_usage,config' }).catch((erro) => {
    throw new Error(`A chave abre a conta @${escolhida.username}, mas a Meta não deixou consultar as publicações: ${erro.message}`);
  });
  const cota = limite.data?.[0] ?? {};

  const validade = info.expires_at === 0
    ? 'nunca expira'
    : info.expires_at
      ? `vence em ${new Date(info.expires_at * 1000).toLocaleDateString('pt-BR')}`
      : 'validade não informada';
  console.log(`Conta conectada: @${escolhida.username} (id ${escolhida.id}).`);
  console.log(`Chave: ${info.type ?? 'tipo não informado'}, ${validade}.`);
  console.log(`Permissões: ${permissoes.join(', ')}.`);
  console.log(`Publicação liberada: ${cota.quota_usage ?? 0} de ${cota.config?.quota_total ?? 100} posts usados nas últimas 24 horas.`);
  if (precisaProva) console.log('O app exige a chave secreta em cada chamada; ela também vai para os segredos (IG_APP_SECRET).');

  if (args.ensaio) {
    console.log('Ensaio: não gravei nada no GitHub.');
    return 0;
  }

  // 5. Guarda nos segredos do repositório. A chave vai pela entrada padrão, nunca na linha de comando.
  const gravar = (nome, valor) =>
    execFileSync('gh', ['secret', 'set', nome, '--repo', repo], { input: valor, stdio: ['pipe', 'ignore', 'pipe'] });
  gravar('IG_TOKEN', token);
  gravar('IG_USER_ID', String(escolhida.id));
  if (precisaProva) gravar('IG_APP_SECRET', segredo);
  console.log(`Segredos gravados em ${repo}: IG_TOKEN, IG_USER_ID${precisaProva ? ', IG_APP_SECRET' : ''}.`);
  if (args.arquivoToken) console.log('A chave já está guardada no GitHub. O arquivo com ela no PC pode ser apagado.');
  return 0;
}

try {
  process.exitCode = await principal();
} catch (erro) {
  console.error(limpar(erro.message));
  process.exitCode = 1;
}
