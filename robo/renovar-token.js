// Pede ao Instagram um token novo e grava num arquivo, para o workflow guardar nos segredos.
//   node robo/renovar-token.js <arquivo-de-saida>
import { appendFileSync, writeFileSync } from 'node:fs';
import { renovarToken } from './token.js';

async function principal() {
  const token = (process.env.IG_TOKEN ?? '').trim();
  const destino = process.argv[2];
  const saida = process.env.GITHUB_OUTPUT;
  const noGitHub = process.env.GITHUB_ACTIONS === 'true';

  if (!token) {
    console.log('O segredo IG_TOKEN ainda não foi configurado. Nada para renovar.');
    if (saida) appendFileSync(saida, 'renovado=false\n');
    return 0;
  }
  if (!destino) {
    console.error('Uso: node robo/renovar-token.js <arquivo-de-saida>');
    return 1;
  }
  if (noGitHub) console.log(`::add-mask::${token}`);

  const novo = await renovarToken(token);
  if (noGitHub) console.log(`::add-mask::${novo.token}`);
  writeFileSync(destino, novo.token, { mode: 0o600 });
  if (saida) appendFileSync(saida, 'renovado=true\n');
  console.log(`Token renovado. Vale por mais ${novo.dias} dias.`);
  return 0;
}

try {
  process.exitCode = await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
