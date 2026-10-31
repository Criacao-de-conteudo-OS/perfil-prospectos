import { execFileSync } from 'node:child_process';
import { lerFila, salvarFila } from './fila.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function configurarAutor(cwd) {
  git(['config', 'user.name', 'robo-prospectos'], cwd);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd);
}

// Uma rodada pode ter começado com uma cópia velha da fila (o GitHub enfileira
// rodadas). Antes de ler ou gravar, o robô sempre pega a versão mais nova.
export function sincronizar(cwd) {
  git(['fetch', '--quiet', 'origin', 'main'], cwd);
  git(['reset', '--hard', '--quiet', 'origin/main'], cwd);
}

// Reaplica a mudança sobre a fila mais recente e tenta enviar. Se alguém
// (a fábrica, por exemplo) enviou outra mudança no meio, tenta de novo.
export async function salvarComRetentativa({ cwd, caminhoFila, aplicar, mensagem, dormir, tentativas = 5 }) {
  for (let i = 1; i <= tentativas; i++) {
    sincronizar(cwd);
    const fila = lerFila(caminhoFila);
    if (!aplicar(fila)) return false; // o post saiu da fila nesse meio-tempo
    salvarFila(caminhoFila, fila);
    if (!git(['status', '--porcelain', '--', 'fila.json'], cwd)) return false;
    git(['add', 'fila.json'], cwd);
    git(['commit', '--quiet', '-m', mensagem], cwd);
    try {
      git(['push', '--quiet', 'origin', 'HEAD:main'], cwd);
      return true;
    } catch (erro) {
      if (i === tentativas) {
        throw new Error(`Não consegui salvar a fila no GitHub depois de ${tentativas} tentativas: ${erro.message}`);
      }
      await dormir(3_000 * i);
    }
  }
  return false;
}
