import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esconderSegredos, formatarDataHora, lerDataInstagram } from '../util.js';

test('esconde o token e qualquer access_token em URL', () => {
  const texto = 'erro com ABCDEFGH12345 em https://x/y?a=1&access_token=OUTRO&b=2';
  assert.equal(esconderSegredos(texto, ['ABCDEFGH12345']), 'erro com *** em https://x/y?a=1&access_token=***&b=2');
});

test('ignora segredos vazios ou curtos demais', () => {
  assert.equal(esconderSegredos('abc', ['', 'a']), 'abc');
});

test('entende datas no formato do Instagram', () => {
  assert.equal(lerDataInstagram('2026-11-03T15:00:12+0000'), Date.parse('2026-11-03T15:00:12Z'));
});

test('formata no horário de Brasília', () => {
  assert.equal(formatarDataHora('2026-11-03T15:00:00Z'), '03/11, 12:00');
});
