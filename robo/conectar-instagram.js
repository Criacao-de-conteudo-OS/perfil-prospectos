// Troca o código do login unificado da Meta pela chave de acesso do robô e
// guarda a chave e o id da conta nos segredos do GitHub. A chave nunca é mostrada.
//
//   node robo/conectar-instagram.js <codigo> --app-id=<id> --arquivo-chave=<arquivo> [--perfil=<usuario>] [--ensaio]
//
// --arquivo-chave: arquivo de texto com a "Chave secreta do aplicativo" (32 caracteres).
// --perfil: usuário do Instagram esperado, para escolher a conta certa se houver mais de uma.
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

function lerArgs(argv) {
  const args = { codigo: null, appId: null, arquivoChave: null, perfil: null, ensaio: false };
  for (const arg of argv) {
    if (arg === '--ensaio') args.ensaio = true;
    else if (arg.startsWith('--app-id=')) args.appId = arg.slice(9).trim();
    else if (arg.startsWith('--arquivo-chave=')) args.arquivoChave = arg.slice(16).trim();
    else if (arg.startsWith('--perfil=')) args.perfil = arg.slice(9).trim().replace(/^@/, '').toLowerCase();
    else if (!arg.startsWith('--') && !args.codigo) args.codigo = arg.trim();
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!args.codigo) throw new Error('Falta o código que a página de retorno mostrou.');
  if (!args.appId || !/^\d{10,20}$/.test(args.appId)) throw new Error('Falta --app-id=<id do app na Meta>.');
  if (!args.arquivoChave) throw new Error('Falta --arquivo-chave=<arquivo com a chave secreta do app>.');
  return args;
}

function lerChaveSecreta(caminho) {
  const achada = readFileSync(caminho, 'utf8').match(/\b[0-9a-f]{32}\b/i);
  if (!achada) throw new Error(`Não achei uma chave secreta (32 caracteres) em ${caminho}.`);
  return achada[0];
}

function repoDoGitHub() {
  const remoto = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: RAIZ, encoding: 'utf8' }).trim();
  const achado = remoto.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  if (!achado) throw new Error(`Não reconheci o repositório do GitHub em ${remoto}.`);
  return { repo: `${achado[1]}/${achado[2]}`, site: `https://${achado[1].toLowerCase()}.github.io/${achado[2]}` };
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const segredo = lerChaveSecreta(args.arquivoChave);
  const { repo, site } = repoDoGitHub();
  const redirecionamento = `${site}/conectar.html`;
  const segredos = [segredo, args.codigo];
  const limpar = (texto) => esconderSegredos(texto, segredos);

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
      const erro = new Error(limpar(detalhe));
      erro.dados = dados?.error;
      throw erro;
    }
    return dados;
  }

  // 1. Código -> chave de acesso. A documentação do login unificado não pede o
  // redirect_uri nessa troca; o fluxo manual clássico pede. Tenta os dois jeitos.
  const parametrosTroca = { client_id: args.appId, client_secret: segredo, code: args.codigo };
  const troca = await pedir('oauth/access_token', { ...parametrosTroca, redirect_uri: redirecionamento })
    .catch((erro) => {
      if (!/redirect|191/i.test(erro.message)) throw erro;
      return pedir('oauth/access_token', parametrosTroca);
    })
    .catch((erro) => {
      throw new Error(`A Meta não aceitou o código: ${erro.message}. Códigos valem poucos minutos; faça o login de novo e mande o código novo.`);
    });
  const token = troca.access_token;
  segredos.push(token);

  // 2. O que essa chave pode fazer e em quais contas.
  const { data: info } = await pedir('debug_token', { input_token: token, access_token: `${args.appId}|${segredo}` });
  if (!info?.is_valid) throw new Error('A Meta diz que a chave gerada não é válida.');
  const escopos = info.granular_scopes ?? [];
  const publicar = escopos.find((e) => e.scope === 'instagram_content_publish');
  if (!publicar) {
    throw new Error(`A chave não tem a permissão de publicar (instagram_content_publish). Permissões recebidas: ${escopos.map((e) => e.scope).join(', ') || 'nenhuma'}. Confira a configuração do login no app.`);
  }
  const candidatos = publicar.target_ids ?? escopos.find((e) => e.scope === 'instagram_basic')?.target_ids ?? [];
  if (candidatos.length === 0) throw new Error('A Meta não informou qual conta do Instagram foi autorizada.');

  // 3. Descobre o usuário de cada conta (e se o app exige appsecret_proof).
  const prova = createHmac('sha256', segredo).update(token).digest('hex');
  let precisaProva = false;
  const contas = [];
  for (const id of candidatos) {
    let conta;
    try {
      conta = await pedir(id, { fields: 'id,username', access_token: token });
    } catch (erro) {
      if (!/appsecret_proof/i.test(erro.message)) throw erro;
      precisaProva = true;
      conta = await pedir(id, { fields: 'id,username', access_token: token, appsecret_proof: prova });
    }
    contas.push(conta);
  }
  const escolhida = args.perfil
    ? contas.find((c) => String(c.username ?? '').toLowerCase() === args.perfil)
    : contas.length === 1
      ? contas[0]
      : null;
  if (!escolhida) {
    throw new Error(`Não consegui escolher a conta. Contas autorizadas: ${contas.map((c) => `@${c.username} (${c.id})`).join(', ')}. Use --perfil=<usuario>.`);
  }

  const validade = info.expires_at === 0 ? 'nunca expira' : `vence em ${new Date(info.expires_at * 1000).toLocaleDateString('pt-BR')}`;
  console.log(`Conta conectada: @${escolhida.username} (id ${escolhida.id}).`);
  console.log(`Chave: ${info.type ?? 'tipo não informado'}, ${validade}.`);
  console.log(`Permissões: ${escopos.map((e) => e.scope).join(', ')}.`);
  if (precisaProva) console.log('O app exige a chave secreta em cada chamada; ela também vai para os segredos (IG_APP_SECRET).');

  if (args.ensaio) {
    console.log('Ensaio: não gravei nada no GitHub.');
    return 0;
  }

  // 4. Guarda nos segredos do repositório. A chave vai pela entrada padrão, nunca na linha de comando.
  const gravar = (nome, valor) =>
    execFileSync('gh', ['secret', 'set', nome, '--repo', repo], { input: valor, stdio: ['pipe', 'ignore', 'pipe'] });
  gravar('IG_TOKEN', token);
  gravar('IG_USER_ID', String(escolhida.id));
  if (precisaProva) gravar('IG_APP_SECRET', segredo);
  console.log(`Segredos gravados em ${repo}: IG_TOKEN, IG_USER_ID${precisaProva ? ', IG_APP_SECRET' : ''}.`);
  return 0;
}

try {
  process.exitCode = await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
