import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { criarClienteInstagram } from '../instagram.js';

const TOKEN = 'TOKEN-SECRETO-1234567890';

function fetchFalso(respostas) {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    chamadas.push({
      url: String(url),
      metodo: opcoes.method ?? 'GET',
      corpo: opcoes.body ? Object.fromEntries(opcoes.body) : null,
    });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return new Response(JSON.stringify(proxima.corpo), { status: proxima.status ?? 200 });
  };
  return { fetch, chamadas };
}

const cliente = (fetch, extra = {}) =>
  criarClienteInstagram({ igUserId: '1789', token: TOKEN, versao: 'v26.0', fetch, dormir: async () => {}, ...extra });

test('cria container com POST no endereço certo e manda o token no corpo', async () => {
  const { fetch, chamadas } = fetchFalso([{ corpo: { id: 'c1' } }]);
  const id = await cliente(fetch).criarContainer({ image_url: 'https://x/a.jpg', caption: 'oi' });
  assert.equal(id, 'c1');
  assert.equal(chamadas[0].url, 'https://graph.facebook.com/v26.0/1789/media');
  assert.equal(chamadas[0].metodo, 'POST');
  assert.equal(chamadas[0].corpo.image_url, 'https://x/a.jpg');
  assert.equal(chamadas[0].corpo.access_token, TOKEN);
  assert.equal(chamadas[0].corpo.appsecret_proof, undefined);
});

test('com a chave secreta do app, manda o appsecret_proof', async () => {
  const { fetch, chamadas } = fetchFalso([{ corpo: { id: 'c1' } }]);
  await cliente(fetch, { appSecret: 'SEGREDO-DO-APP-123' }).criarContainer({});
  const esperado = createHmac('sha256', 'SEGREDO-DO-APP-123').update(TOKEN).digest('hex');
  assert.equal(chamadas[0].corpo.appsecret_proof, esperado);
});

test('dá para usar o host do login do Instagram', async () => {
  const { fetch, chamadas } = fetchFalso([{ corpo: { id: 'c1' } }]);
  await cliente(fetch, { base: 'https://graph.instagram.com' }).criarContainer({});
  assert.equal(chamadas[0].url, 'https://graph.instagram.com/v26.0/1789/media');
});

test('publica o container pelo media_publish', async () => {
  const { fetch, chamadas } = fetchFalso([{ corpo: { id: 'midia-9' } }]);
  assert.equal(await cliente(fetch).publicarContainer('c1'), 'midia-9');
  assert.equal(chamadas[0].url, 'https://graph.facebook.com/v26.0/1789/media_publish');
  assert.equal(chamadas[0].corpo.creation_id, 'c1');
});

test('token inválido (código 190) vira erro especial, sem vazar o token', async () => {
  const { fetch } = fetchFalso([
    { status: 400, corpo: { error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190 } } },
  ]);
  await assert.rejects(cliente(fetch).criarContainer({}), (erro) => {
    assert.equal(erro.tokenInvalido, true);
    assert.ok(!erro.message.includes(TOKEN));
    assert.match(erro.message, /código 190/);
    return true;
  });
});

test('erro temporário (500) tenta de novo e segue', async () => {
  const { fetch, chamadas } = fetchFalso([
    { status: 500, corpo: { error: { message: 'Service unavailable', code: 2 } } },
    { corpo: { id: 'c2' } },
  ]);
  assert.equal(await cliente(fetch).criarContainer({}), 'c2');
  assert.equal(chamadas.length, 2);
});

test('erro definitivo não repete a chamada', async () => {
  const { fetch, chamadas } = fetchFalso([
    { status: 400, corpo: { error: { message: 'Invalid parameter', code: 100, error_subcode: 2207052 } } },
  ]);
  await assert.rejects(cliente(fetch).criarContainer({}), /código 100\/2207052/);
  assert.equal(chamadas.length, 1);
});

test('falha de rede não vaza o token na mensagem', async () => {
  const falha = () => new Error(`connect ECONNRESET https://graph.facebook.com/v26.0/x?access_token=${TOKEN}`);
  const { fetch, chamadas } = fetchFalso([falha(), falha(), falha()]);
  await assert.rejects(cliente(fetch).mediasRecentes(), (erro) => {
    assert.ok(!erro.message.includes(TOKEN));
    assert.equal(erro.temporario, true);
    return true;
  });
  assert.equal(chamadas.length, 3);
});

test('espera o container ficar pronto', async () => {
  const { fetch, chamadas } = fetchFalso([
    { corpo: { status_code: 'IN_PROGRESS' } },
    { corpo: { status_code: 'FINISHED' } },
  ]);
  await cliente(fetch).aguardarContainer('c1', { video: true });
  assert.equal(chamadas.length, 2);
  assert.match(chamadas[0].url, /\/c1\?fields=status_code%2Cstatus&access_token=/);
});

test('container com erro de processamento vira falha com o detalhe', async () => {
  const { fetch } = fetchFalso([
    { corpo: { status_code: 'ERROR', status: 'Error: Media upload has failed with error code 2207026' } },
  ]);
  await assert.rejects(cliente(fetch).aguardarContainer('c1', { video: true }), /ERROR.*2207026/);
});

test('desiste se o Instagram demora demais para processar', async () => {
  const { fetch } = fetchFalso([{ corpo: { status_code: 'IN_PROGRESS' } }, { corpo: { status_code: 'IN_PROGRESS' } }]);
  const api = cliente(fetch, { espera: { imagem: { intervaloMs: 60_000, maximo: 2 }, video: { intervaloMs: 1, maximo: 1 } } });
  await assert.rejects(api.aguardarContainer('c1', { video: false }), /demorou mais de 2 min/);
});

test('lista os posts recentes com o token na URL', async () => {
  const { fetch, chamadas } = fetchFalso([{ corpo: { data: [{ id: '1', caption: 'oi' }] } }]);
  assert.deepEqual(await cliente(fetch).mediasRecentes(), [{ id: '1', caption: 'oi' }]);
  assert.match(chamadas[0].url, /^https:\/\/graph\.facebook\.com\/v26\.0\/1789\/media\?fields=/);
});
