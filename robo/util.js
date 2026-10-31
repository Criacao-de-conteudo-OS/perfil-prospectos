export const FUSO = 'America/Sao_Paulo';

export function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

const formatador = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatarDataHora(data) {
  return formatador.format(new Date(data));
}

// O repositório é público: nada que vá para log ou para a fila pode conter o token.
export function esconderSegredos(texto, segredos = []) {
  let resultado = String(texto ?? '');
  for (const segredo of segredos) {
    if (segredo && segredo.length >= 8) resultado = resultado.split(segredo).join('***');
  }
  return resultado.replace(/access_token=[^&\s"']+/gi, 'access_token=***');
}

// O Instagram manda datas como "2026-11-03T15:00:12+0000"; o JavaScript entende "+00:00".
export function lerDataInstagram(texto) {
  return Date.parse(String(texto ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}
