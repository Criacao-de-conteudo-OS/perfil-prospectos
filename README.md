# perfil-prospectos

Robô que publica sozinho, na hora marcada, os posts do Instagram **@_prospectos**.

Os posts são produzidos toda semana pela fábrica (repositório privado `fabrica`). Este repositório guarda a fila, as mídias e o robô que publica.

**Painel:** https://criacao-de-conteudo-os.github.io/perfil-prospectos/status.html

## Como funciona

```
fábrica (segunda-feira)
  ├─ envia as mídias da semana  → branch "site" (GitHub Pages, link público)
  └─ adiciona os posts na fila  → fila.json (branch main)

robô (GitHub Actions, toda hora)
  ├─ pega os posts que passaram da hora
  ├─ manda para o Instagram (API oficial, com o link público da mídia)
  └─ anota o resultado na fila: publicado, ou o erro e a tentativa
```

- Roda **de hora em hora**, aos 7 minutos. Se o próximo post sai em até 75 minutos, o robô espera por ele e publica na hora certa.
- Se der erro, tenta de novo na rodada seguinte. Depois de **3 tentativas**, desiste e o post aparece em "Com problema" no painel.
- Antes de publicar, confere se o mesmo post já está no Instagram. Isso evita publicar duas vezes se uma rodada cair no meio.
- A chave de acesso vem do **login unificado** da Meta: é de usuário do sistema e **não expira**.

## A fila (`fila.json`)

```json
{
  "posts": [
    {
      "id": "2026-11-03-reel-cliente-sumiu",
      "tipo": "reel",
      "agendado_para": "2026-11-03T12:00:00-03:00",
      "legenda": "Seu cliente não sumiu.\n\n...\n\n#followup #vendasb2b",
      "midias": ["video.mp4"],
      "capa": "capa.jpg",
      "instagram": { "status": "pendente", "tentativas": 0 }
    }
  ]
}
```

| Campo | O que é |
|---|---|
| `id` | Nome único do post: letras minúsculas, números e hífens. As mídias ficam em `midia/<id>/` no site. |
| `tipo` | `reel` (1 vídeo .mp4), `carrossel` (2 a 20 arquivos .jpg ou .mp4) ou `imagem` (1 .jpg). O Instagram só aceita imagem em JPEG. |
| `agendado_para` | Data e hora **com fuso**. Brasília é `-03:00`. |
| `legenda` | Até 2200 caracteres. O manual pede de 3 a 5 hashtags. |
| `midias` | Nomes dos arquivos, na ordem. |
| `capa` | Opcional, só para reel: imagem .jpg da capa. |
| `instagram.status` | `pendente`, `publicado`, `falhou` ou `pausado`. O robô preenche o resto: `tentativas`, `link`, `ultimo_erro`... |

## No dia a dia

- **Pausar um post:** mude o `status` dele para `pausado` em `fila.json`.
- **Tentar de novo um post que falhou:** aba **Actions** → *Publicar no Instagram* → *Run workflow* → coloque o id em "Publicar agora só este post".
- **Ver o que o robô faria, sem publicar:** mesmo caminho, marcando "Ensaio".
- **Ver o que aconteceu:** o painel, ou a aba **Actions**. Cada rodada deixa um resumo em português.

## Configuração (uma vez)

### Conectar a conta do Instagram

1. No app da Meta: caso de uso do Instagram → **API setup with Unified login** → crie uma configuração com chave de **usuário do sistema**, expiração **Nunca**, ativo **Conta do Instagram** e as permissões `instagram_basic` e `instagram_content_publish`.
2. Registre o URL de redirecionamento `https://criacao-de-conteudo-os.github.io/perfil-prospectos/conectar.html`.
3. Abra o **URL de login**, entre com a conta do Instagram e autorize. A página `conectar.html` mostra um código.
4. Em até poucos minutos, rode no PC (com o `gh` logado):

```bash
node robo/conectar-instagram.js <codigo> --app-id=<id do app> --arquivo-chave=<arquivo com a chave secreta do app> --perfil=_prospectos
```

O script troca o código pela chave e grava os segredos no repositório, sem mostrar a chave.

### Segredos e variáveis

Em **Settings → Secrets and variables → Actions**:

| Nome | Tipo | O que é |
|---|---|---|
| `IG_USER_ID` | segredo | Id da conta do Instagram (gravado pelo script) |
| `IG_TOKEN` | segredo | Chave de acesso, de usuário do sistema, sem validade (gravada pelo script) |
| `IG_APP_SECRET` | segredo (opcional) | Só se o app exigir `appsecret_proof`; o script grava quando precisa |
| `URL_SITE` | variável | `https://criacao-de-conteudo-os.github.io/perfil-prospectos` |
| `IG_API_HOST` | variável (opcional) | Padrão `https://graph.facebook.com`. Use `https://graph.instagram.com` para apps com login do Instagram |
| `IG_API_VERSION` | variável (opcional) | Versão da API. Padrão: `v26.0` |

O GitHub Pages serve a branch `site`.

## Para quem mexe no código

Node 22 ou mais novo. Sem dependências externas.

```bash
npm test                                   # testes
node robo/verificar-fila.js                # confere a fila
node robo/publicar.js --ensaio             # mostra o que publicaria
node robo/enviar-midias.js <pasta> --ensaio  # monta o site sem enviar
```

| Arquivo | Função |
|---|---|
| `robo/publicar.js` | Ponto de entrada do robô (usado pelo workflow) |
| `robo/publicador.js` | Regras: o que publicar, tentativas, espera pelo próximo post |
| `robo/instagram.js` | Conversa com a API do Instagram |
| `robo/fila.js` | Lê, valida e atualiza a fila |
| `robo/git.js` | Salva a fila no GitHub, tentando de novo se houver conflito |
| `robo/enviar-midias.js` | Refaz a branch `site` com as páginas e as mídias dos posts que ainda vão sair |
| `robo/conectar-instagram.js` | Conecta a conta: troca o código do login pela chave e grava os segredos |
| `site/status.html` | Painel de status |
| `site/conectar.html` | Página de retorno do login da Meta (mostra o código) |
