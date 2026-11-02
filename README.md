# perfil-prospectos

Robô que publica sozinho, na hora marcada, os posts do Instagram **@_prospectos**.

Os posts são produzidos toda semana pela fábrica (repositório privado `fabrica`). Este repositório guarda a fila, as mídias e o robô que publica.

**Painel:** https://criacao-de-conteudo-os.github.io/perfil-prospectos/status.html

## Como funciona

```
fábrica (segunda-feira)
  ├─ envia as mídias da semana  → branch "site" (GitHub Pages, link público)
  └─ adiciona os posts na fila  → fila.json (branch main)

robô (GitHub Actions, de dia)
  ├─ pega os posts que passaram da hora
  ├─ manda para o Instagram (API oficial, com o link público da mídia)
  └─ anota o resultado na fila: publicado, ou o erro e a tentativa
```

- Roda **só de dia**, das 5h às 21h de Brasília, quatro vezes por hora (aos 7, 22, 37 e 52 minutos). De madrugada não há posts, e o robô dorme.
- O GitHub costuma pular várias rodadas seguidas. Por isso, se o próximo post sai em até **5h20**, o robô espera por ele e publica na hora certa. Enquanto uma rodada espera, as outras da agenda veem isso e terminam na hora.
- Se der erro, tenta de novo na rodada seguinte. Depois de **3 tentativas**, desiste e o post aparece em "Com problema" no painel.
- Antes de publicar, confere se o mesmo post já está no Instagram. Isso evita publicar duas vezes se uma rodada cair no meio.
- A chave de acesso é de um **usuário do sistema** do portfólio da Meta e **não expira**.

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

A chave é gerada direto no portfólio da Meta, sem tela de login.

Tudo no **mesmo portfólio** do app (em business.facebook.com, logado com o Facebook que administra o app):

1. **Contas do Instagram:** a conta precisa estar no portfólio. Se ela for de outro portfólio, lá em "Atribua um parceiro" compartilhe-a com o ID deste portfólio, com controle total.
2. **Páginas:** a conta do Instagram precisa estar **ligada a uma Página do Facebook**. Sem Página, a API não enxerga a conta (erro 100, subcódigo 33). Crie uma Página e use "Conectar ativos" para ligar o Instagram a ela.
3. **Usuários do sistema:** crie um usuário (ex.: `robo-prospectos`). A função Funcionário basta.
4. **Atribuir ativos** a ele, com controle total: o app, a Página e a conta do Instagram.
5. **Gerar token:** escolha o app, expiração **Nunca** e as permissões `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` e `ads_read` (a Meta pede esta quando o acesso à Página vem pelo portfólio).
6. Cole a chave num arquivo de texto **fora deste repositório** e rode no PC (com o `gh` logado):

```bash
node robo/conectar-instagram.js --arquivo-token=<arquivo com a chave> --app-id=<id do app> --perfil=_prospectos
```

O script confere a chave, acha a conta, testa a permissão de publicar (sem publicar nada) e grava os segredos no repositório, sem mostrar a chave. Use `--ensaio` para conferir sem gravar.

Alternativa, pelo **login unificado** do app: a página `conectar.html` recebe o código do login, e o mesmo script troca o código pela chave (`node robo/conectar-instagram.js <codigo> --app-id=<id> --arquivo-chave=<arquivo com a chave secreta do app>`).

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
