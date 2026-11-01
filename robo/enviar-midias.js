// Coloca no ar (branch "site", servida pelo GitHub Pages) as páginas de site/
// e as mídias dos posts que ainda vão sair. Usado pela fábrica toda semana.
//
//   node robo/enviar-midias.js [pasta-com-midias] [--ensaio]
//
// A pasta tem uma subpasta por post, com o mesmo id da fila:
//   pasta/2026-11-03-reel-cliente-sumiu/video.mp4
//   pasta/2026-11-04-carrossel-follow-up/01.jpg ...
//
// A branch "site" é refeita do zero a cada envio, com um único commit. As mídias
// de posts publicados ficam lá por DIAS_DEPOIS_DE_PUBLICAR dias (para o painel
// mostrar o que já saiu) e depois saem, para o repositório não inchar.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerFila, statusDe, validarFila } from './fila.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANTER = new Set(['pendente', 'falhou', 'pausado']);
const DIAS_DEPOIS_DE_PUBLICAR = 14;

function publicadoHaPouco(post, agora = Date.now()) {
  if (statusDe(post) !== 'publicado') return false;
  const quando = Date.parse(post.instagram?.publicado_em ?? post.agendado_para);
  return Number.isFinite(quando) && agora - quando <= DIAS_DEPOIS_DE_PUBLICAR * 86_400_000;
}

function arquivosEm(pasta) {
  const lista = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) lista.push(...arquivosEm(caminho));
    else lista.push(caminho);
  }
  return lista;
}

const posix = (caminho) => caminho.split(sep).join('/');

function urlDoSite(git) {
  try {
    const remoto = git(['remote', 'get-url', 'origin']);
    const achado = remoto.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    return achado ? `https://${achado[1].toLowerCase()}.github.io/${achado[2]}` : null;
  } catch {
    return null;
  }
}

function principal(argv) {
  const ensaio = argv.includes('--ensaio');
  const pastaArg = argv.find((arg) => !arg.startsWith('--'));
  const pasta = pastaArg ? resolve(pastaArg) : null;

  const fila = lerFila(join(RAIZ, 'fila.json'));
  const { erros } = validarFila(fila);
  if (erros.length) {
    console.error(`Corrija a fila antes de enviar as mídias:\n- ${erros.join('\n- ')}`);
    return 1;
  }
  const manter = new Map(fila.posts.filter((p) => MANTER.has(statusDe(p))).map((p) => [p.id, p]));
  const recentes = new Set(fila.posts.filter((p) => publicadoHaPouco(p)).map((p) => p.id));
  const arquivosDoPost = (post) => [...post.midias, ...(post.capa ? [post.capa] : [])];

  const temporario = mkdtempSync(join(tmpdir(), 'site-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporario, 'index') };
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: RAIZ,
      env,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  const guardar = (arquivo) => git(['hash-object', '-w', '--no-filters', arquivo]);

  try {
    try {
      git(['config', 'user.name']);
    } catch {
      Object.assign(env, {
        GIT_AUTHOR_NAME: 'fabrica',
        GIT_AUTHOR_EMAIL: 'fabrica@localhost',
        GIT_COMMITTER_NAME: 'fabrica',
        GIT_COMMITTER_EMAIL: 'fabrica@localhost',
      });
    }

    const entradas = new Map(); // caminho no site -> [modo, sha]

    // 1. As páginas (status etc.).
    const pastaSite = join(RAIZ, 'site');
    for (const arquivo of arquivosEm(pastaSite)) {
      entradas.set(posix(relative(pastaSite, arquivo)), ['100644', guardar(arquivo)]);
    }
    entradas.set('.nojekyll', ['100644', git(['hash-object', '-w', '--stdin'], '')]);

    // 2. Mídias que já estão no ar e ainda vão ser usadas (ou que saíram há pouco, para o painel).
    let temSite = true;
    try {
      git(['fetch', '--quiet', 'origin', 'site']);
    } catch {
      temSite = false; // primeira vez: a branch ainda não existe
    }
    if (temSite) {
      for (const linha of git(['ls-tree', '-r', 'FETCH_HEAD', '--', 'midia']).split('\n').filter(Boolean)) {
        const [info, caminho] = linha.split('\t');
        const [modo, , sha] = info.split(' ');
        const id = caminho.split('/')[1];
        if (manter.has(id) || recentes.has(id)) entradas.set(caminho, [modo, sha]);
      }
    }

    // 3. Mídias novas da pasta (substituem as antigas do mesmo post).
    let novas = 0;
    if (pasta) {
      for (const id of readdirSync(pasta)) {
        const pastaPost = join(pasta, id);
        if (!statSync(pastaPost).isDirectory()) continue;
        const post = manter.get(id);
        if (!post) {
          console.log(`Aviso: a pasta "${id}" não é de nenhum post pendente da fila; ignorei.`);
          continue;
        }
        for (const caminho of [...entradas.keys()]) {
          if (caminho.startsWith(`midia/${id}/`)) entradas.delete(caminho);
        }
        const usados = new Set(arquivosDoPost(post));
        for (const nome of readdirSync(pastaPost)) {
          if (!usados.has(nome)) {
            console.log(`Aviso: "${id}/${nome}" não está na fila; não enviei.`);
            continue;
          }
          entradas.set(`midia/${id}/${nome}`, ['100644', guardar(join(pastaPost, nome))]);
          novas += 1;
        }
      }
    }

    // 4. Todo post que ainda vai sair precisa ter todas as mídias.
    const faltando = [];
    for (const post of manter.values()) {
      for (const arquivo of arquivosDoPost(post)) {
        if (!entradas.has(`midia/${post.id}/${arquivo}`)) faltando.push(`${post.id}/${arquivo}`);
      }
    }
    if (faltando.length) {
      console.error(`Faltam mídias de posts da fila (nada foi enviado):\n- ${faltando.join('\n- ')}`);
      return 1;
    }

    // 5. Monta um commit novo, sem histórico, e envia para a branch "site".
    git(['read-tree', '--empty']);
    const indice = [...entradas].map(([caminho, [modo, sha]]) => `${modo} ${sha}\t${caminho}`).join('\n');
    git(['update-index', '--add', '--index-info'], `${indice}\n`);
    const arvore = git(['write-tree']);
    const commit = git(['commit-tree', arvore, '-m', `site: páginas e mídias de ${manter.size} post(s) da fila`]);

    const url = urlDoSite(git);
    console.log(`Site montado: ${entradas.size} arquivo(s), ${novas} mídia(s) nova(s), ${manter.size} post(s) na fila, ${recentes.size} publicado(s) nos últimos ${DIAS_DEPOIS_DE_PUBLICAR} dias.`);
    if (ensaio) {
      console.log('Ensaio: montei o site, mas não enviei.');
      return 0;
    }
    git(['push', '--force', '--quiet', 'origin', `${commit}:refs/heads/site`]);
    console.log('Enviado. O GitHub Pages leva cerca de 1 minuto para atualizar.');
    if (url) console.log(`Painel: ${url}/status.html`);
    return 0;
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }
}

try {
  process.exitCode = principal(process.argv.slice(2));
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
