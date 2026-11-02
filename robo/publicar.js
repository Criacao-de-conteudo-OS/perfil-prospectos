// Publica no Instagram os posts da fila que já passaram da hora.
//
//   node robo/publicar.js            publica o que está na hora
//   node robo/publicar.js --ensaio   só mostra o que faria
//   node robo/publicar.js --so=<id>  publica agora só esse post
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JANELA_ESPERA_MIN, configFaltando, lerConfig } from './config.js';
import { aplicarMudanca, lerFila, postsDevidos, proximoPendente, salvarFila, validarFila } from './fila.js';
import { configurarAutor, salvarComRetentativa, sincronizar } from './git.js';
import { criarClienteInstagram } from './instagram.js';
import { deuErrado, executar, resumoEmMarkdown } from './publicador.js';
import { esconderSegredos, esperar } from './util.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAMINHO_FILA = join(RAIZ, 'fila.json');

class ErroFila extends Error {}

function lerArgs(argv) {
  const args = { ensaio: false, so: null };
  for (const arg of argv) {
    if (arg === '--ensaio') args.ensaio = true;
    else if (arg.startsWith('--so=')) args.so = arg.slice('--so='.length).trim() || null;
    else throw new ErroFila(`Opção desconhecida: ${arg}`);
  }
  return args;
}

function escreverResumo(texto) {
  const destino = process.env.GITHUB_STEP_SUMMARY;
  if (destino) appendFileSync(destino, `${texto}\n`);
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const cfg = lerConfig();
  const ensaio = cfg.ensaio || args.ensaio;
  const soId = args.so ?? cfg.soId;

  const avisosMostrados = new Set();
  const carregarFila = () => {
    if (cfg.noGitHub) sincronizar(RAIZ);
    let fila;
    try {
      fila = lerFila(CAMINHO_FILA);
    } catch (erro) {
      throw new ErroFila(`O arquivo fila.json não é um JSON válido: ${erro.message}`);
    }
    const { erros, avisos } = validarFila(fila);
    for (const aviso of avisos) {
      if (!avisosMostrados.has(aviso)) console.log(`Aviso: ${aviso}`);
      avisosMostrados.add(aviso);
    }
    if (erros.length) throw new ErroFila(`A fila tem problemas e nada foi publicado:\n- ${erros.join('\n- ')}`);
    return fila;
  };

  const faltam = configFaltando(cfg);
  if (!ensaio && faltam.length) {
    // Antes de configurar o Instagram, as rodadas da agenda só conferem a fila.
    const fila = carregarFila();
    const agora = new Date();
    const proximo = proximoPendente(fila, agora);
    const emBreve = proximo && Date.parse(proximo.agendado_para) - agora.getTime() <= JANELA_ESPERA_MIN * 60_000;
    if (postsDevidos(fila, agora, { soId }).length === 0 && !emBreve) {
      const texto = 'Nada para publicar agora. (O Instagram ainda não foi configurado.)';
      console.log(texto);
      escreverResumo(`### Robô do Instagram\n\n${texto}\n`);
      return 0;
    }
    console.error(`Há posts para publicar, mas falta configurar: ${faltam.join(', ')}.`);
    return 1;
  }
  if (ensaio && !cfg.urlSite) console.log('Aviso: sem URL_SITE, o ensaio não confere se as mídias estão no ar.');

  if (cfg.noGitHub && !ensaio) configurarAutor(RAIZ);

  const salvarMudanca = async (id, mudanca, mensagem) => {
    if (cfg.noGitHub) {
      await salvarComRetentativa({
        cwd: RAIZ,
        caminhoFila: CAMINHO_FILA,
        aplicar: (fila) => aplicarMudanca(fila, id, mudanca),
        mensagem,
        dormir: esperar,
      });
    } else {
      const fila = lerFila(CAMINHO_FILA);
      aplicarMudanca(fila, id, mudanca);
      salvarFila(CAMINHO_FILA, fila);
    }
  };

  const api = ensaio
    ? null
    : criarClienteInstagram({
        igUserId: cfg.igUserId,
        token: cfg.igToken,
        versao: cfg.versaoApi,
        base: cfg.hostApi,
        appSecret: cfg.appSecret,
      });

  const resumo = await executar({
    carregarFila,
    salvarMudanca,
    api,
    urlSite: cfg.urlSite,
    dormir: esperar,
    soId,
    ensaio,
  });

  const texto = resumoEmMarkdown(resumo);
  console.log(`\n${texto}`);
  escreverResumo(texto);
  return deuErrado(resumo) ? 1 : 0;
}

try {
  process.exitCode = await principal();
} catch (erro) {
  const segredos = [process.env.IG_TOKEN, process.env.IG_APP_SECRET].map((s) => (s ?? '').trim());
  const mensagem = erro instanceof ErroFila ? erro.message : `Erro inesperado: ${erro.stack ?? erro}`;
  console.error(esconderSegredos(mensagem, segredos));
  escreverResumo(`### Robô do Instagram\n\n**Parei:** ${esconderSegredos(erro.message, segredos)}\n`);
  process.exitCode = 1;
}
