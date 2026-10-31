// Confere se a fila está no formato certo, sem publicar nada.
//   node robo/verificar-fila.js [caminho/da/fila.json]
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerFila, proximoPendente, statusDe, validarFila } from './fila.js';
import { formatarDataHora } from './util.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminho = process.argv[2] ? resolve(process.argv[2]) : join(RAIZ, 'fila.json');

function principal() {
  let fila;
  try {
    fila = lerFila(caminho);
  } catch (erro) {
    console.error(`Não consegui ler ${caminho}: ${erro.message}`);
    return 1;
  }
  const { erros, avisos } = validarFila(fila);
  for (const aviso of avisos) console.log(`Aviso: ${aviso}`);
  if (erros.length) {
    console.error(`A fila tem ${erros.length} problema(s):\n- ${erros.join('\n- ')}`);
    return 1;
  }

  const contagem = {};
  for (const post of fila.posts) contagem[statusDe(post)] = (contagem[statusDe(post)] ?? 0) + 1;
  const partes = Object.entries(contagem).map(([status, n]) => `${n} ${status}`);
  console.log(`Fila OK: ${fila.posts.length} post(s)${partes.length ? ` (${partes.join(', ')})` : ''}.`);
  const proximo = proximoPendente(fila, new Date());
  if (proximo) console.log(`Próximo: "${proximo.id}" em ${formatarDataHora(proximo.agendado_para)} (horário de Brasília).`);
  return 0;
}

process.exitCode = principal();
