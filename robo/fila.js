import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_TENTATIVAS } from './config.js';

export const TIPOS = ['reel', 'carrossel', 'imagem'];
export const STATUS = ['pendente', 'publicado', 'falhou', 'pausado'];
// Reel de teste: o Instagram mostra primeiro só para quem não segue a conta.
// "manual": continua só para não seguidores até alguém liberar no app.
// "automatico": o Instagram libera para os seguidores se o reel for bem.
export const MODOS_TESTE = { manual: 'MANUAL', automatico: 'SS_PERFORMANCE' };

const RE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const RE_ARQUIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RE_IMAGEM = /\.jpe?g$/i;
const RE_VIDEO = /\.mp4$/i;
const RE_HASHTAG = /#[\p{L}\p{N}_]+/gu;

export function lerFila(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8'));
}

export function salvarFila(caminho, fila) {
  writeFileSync(caminho, `${JSON.stringify(fila, null, 2)}\n`, 'utf8');
}

export const statusDe = (post) => post?.instagram?.status ?? 'pendente';
export const tentativasDe = (post) => post?.instagram?.tentativas ?? 0;
export const horarioDe = (post) => Date.parse(post.agendado_para);
const porHorario = (a, b) => horarioDe(a) - horarioDe(b);
const podeTentar = (post) => statusDe(post) === 'pendente' && tentativasDe(post) < MAX_TENTATIVAS;

// Posts que já passaram da hora e ainda não saíram, do mais antigo para o mais novo.
// Com soId, publica só aquele post, fora da agenda (serve também para tentar de novo um que falhou).
export function postsDevidos(fila, agora, { soId = null } = {}) {
  if (soId) {
    const post = fila.posts.find((p) => p.id === soId);
    return post && ['pendente', 'falhou'].includes(statusDe(post)) ? [post] : [];
  }
  const limite = agora.getTime();
  return fila.posts.filter((p) => podeTentar(p) && horarioDe(p) <= limite).sort(porHorario);
}

export function proximoPendente(fila, agora) {
  const limite = agora.getTime();
  return fila.posts.filter((p) => podeTentar(p) && horarioDe(p) > limite).sort(porHorario)[0] ?? null;
}

export function aplicarMudanca(fila, id, mudanca) {
  const post = fila.posts.find((p) => p.id === id);
  if (!post) return false;
  post.instagram = { ...(post.instagram ?? {}), ...mudanca };
  return true;
}

export function validarFila(fila) {
  const erros = [];
  const avisos = [];
  if (!fila || typeof fila !== 'object' || !Array.isArray(fila.posts)) {
    return { erros: ['O arquivo precisa ter o formato { "posts": [ ... ] }.'], avisos };
  }
  const vistos = new Set();
  fila.posts.forEach((post, indice) => {
    const onde = typeof post?.id === 'string' ? `Post "${post.id}"` : `Post nº ${indice + 1}`;
    if (!post || typeof post !== 'object') {
      erros.push(`${onde}: não é um objeto.`);
      return;
    }
    if (typeof post.id !== 'string' || !RE_ID.test(post.id)) {
      erros.push(`${onde}: o id precisa ter só letras minúsculas, números e hífens (3 a 80 caracteres).`);
    } else if (vistos.has(post.id)) {
      erros.push(`${onde}: id repetido.`);
    } else {
      vistos.add(post.id);
    }
    if (!TIPOS.includes(post.tipo)) erros.push(`${onde}: o tipo precisa ser ${TIPOS.join(', ')}.`);
    if (typeof post.agendado_para !== 'string' || !RE_DATA.test(post.agendado_para) || Number.isNaN(Date.parse(post.agendado_para))) {
      erros.push(`${onde}: agendado_para precisa ter data, hora e fuso, por exemplo 2026-11-03T12:00:00-03:00.`);
    }
    validarLegenda(post, onde, erros, avisos);
    validarMidias(post, onde, erros);
    validarTeste(post, onde, erros);
    validarEstado(post, onde, erros);
  });
  return { erros, avisos };
}

function validarLegenda(post, onde, erros, avisos) {
  if (typeof post.legenda !== 'string' || !post.legenda.trim()) {
    erros.push(`${onde}: legenda vazia.`);
    return;
  }
  if (post.legenda.length > 2200) erros.push(`${onde}: legenda com ${post.legenda.length} caracteres (o máximo é 2200).`);
  const hashtags = post.legenda.match(RE_HASHTAG)?.length ?? 0;
  if (hashtags > 30) erros.push(`${onde}: ${hashtags} hashtags (o Instagram aceita no máximo 30).`);
  else if (hashtags > 5) avisos.push(`${onde}: ${hashtags} hashtags; o manual pede de 3 a 5.`);
}

function validarMidias(post, onde, erros) {
  const { midias } = post;
  if (!Array.isArray(midias) || midias.length === 0) {
    erros.push(`${onde}: a lista de mídias está vazia.`);
    return;
  }
  const invalido = midias.find((m) => typeof m !== 'string' || !RE_ARQUIVO.test(m));
  if (invalido !== undefined) {
    erros.push(`${onde}: nome de arquivo inválido: ${JSON.stringify(invalido)} (use letras, números, ponto, hífen e sublinhado).`);
    return;
  }
  if (post.tipo === 'reel' && !(midias.length === 1 && RE_VIDEO.test(midias[0]))) {
    erros.push(`${onde}: reel precisa de exatamente 1 vídeo .mp4.`);
  }
  if (post.tipo === 'imagem' && !(midias.length === 1 && RE_IMAGEM.test(midias[0]))) {
    erros.push(`${onde}: imagem precisa de exatamente 1 arquivo .jpg (o Instagram só aceita JPEG).`);
  }
  if (post.tipo === 'carrossel') {
    if (midias.length < 2 || midias.length > 20) erros.push(`${onde}: carrossel precisa de 2 a 20 mídias.`);
    const outros = midias.filter((m) => !RE_IMAGEM.test(m) && !RE_VIDEO.test(m));
    if (outros.length) erros.push(`${onde}: carrossel aceita só .jpg e .mp4 (${outros.join(', ')}).`);
  }
  if (post.capa !== undefined) {
    if (post.tipo !== 'reel') erros.push(`${onde}: capa só vale para reel.`);
    else if (typeof post.capa !== 'string' || !RE_ARQUIVO.test(post.capa) || !RE_IMAGEM.test(post.capa)) {
      erros.push(`${onde}: a capa precisa ser um arquivo .jpg.`);
    }
  }
}

function validarTeste(post, onde, erros) {
  if (post.ia !== undefined && typeof post.ia !== 'boolean') erros.push(`${onde}: "ia" (rótulo de conteúdo de IA) precisa ser true ou false.`);
  if (post.teste === undefined) return;
  if (post.tipo !== 'reel') erros.push(`${onde}: "teste" (reel de teste) só vale para reel.`);
  else if (!Object.hasOwn(MODOS_TESTE, post.teste)) {
    erros.push(`${onde}: "teste" precisa ser ${Object.keys(MODOS_TESTE).join(' ou ')}.`);
  }
}

function validarEstado(post, onde, erros) {
  const ig = post.instagram;
  if (ig === undefined) return;
  if (ig === null || typeof ig !== 'object') {
    erros.push(`${onde}: "instagram" precisa ser um objeto.`);
    return;
  }
  if (!STATUS.includes(ig.status)) erros.push(`${onde}: status "${ig.status}" inválido (use ${STATUS.join(', ')}).`);
  if (ig.tentativas !== undefined && !(Number.isInteger(ig.tentativas) && ig.tentativas >= 0)) {
    erros.push(`${onde}: tentativas precisa ser um número inteiro a partir de 0.`);
  }
}
