# Purpverse

Plataforma de comunidades com salas de conversa em tempo real, perfis sociais e projeções sincronizadas de vídeos do YouTube. A aplicação reúne interface web, API e Socket.IO em um servidor Node.js, com dados persistidos em PostgreSQL.

## Visão do produto

A identidade Purpverse usa o símbolo orbital fornecido nas versões [para fundos escuros](public/image/purpverse-dark.png) e [para fundos claros](public/image/purpverse-light.png). A navegação reúne chats, comunidades, projeções e perfil no celular e apresenta uma barra lateral no desktop.

As páginas existentes continuam disponíveis: [início](public/index.html), [feed](public/feed.html), [mensagens privadas](public/direct.html), [eventos](public/events.html) e [perfil](public/perfil.html).

## Funcionalidades

- **Contas e perfis:** cadastro, login com JWT, edição de perfil, avatar e banner.
- **Salas de chat:** criação e descoberta de salas públicas, presença online, histórico de mensagens e funções de proprietário, coadministrador e membro.
- **Conversas enriquecidas:** mensagens de texto e áudio, respostas, reações, figurinhas com biblioteca pessoal e fundos de chat por usuário e sala.
- **Projeções de vídeo:** sessões compartilhadas com playlist do YouTube, reprodução sincronizada, controles do anfitrião e resumo da sessão. Há recursos de miniplayer e janela flutuante conforme o suporte do navegador.
- **Comunidade e reputação:** posts, curtidas, seguidores, check-in, XP, níveis, ranking e recompensas por participação.
- **Administração:** gerenciamento de usuários e salas por contas com permissão de administrador do site.
- **Mensagens privadas:** conversas, solicitações, privacidade, bloqueios, mídia e leitura entre participantes.
- **Notificações:** central com filtros, avisos em tempo real, preferências por categoria e Web Push opcional.
- **Comunidades:** descoberta por categoria, popularidade e atividade, favoritos, interesses explícitos, mensagens fixadas e enquetes com votos em tempo real.
- **Busca no histórico:** filtros por texto, autor, período e tipo nas salas e conversas privadas às quais a conta tem acesso.
- **Feed social:** abas Seguindo, Para você e Salvos com paginação, posts em comunidades, comentários e respostas, compartilhamento interno, ocultação e denúncia de posts. As recomendações usam interesses escolhidos, relações e comunidades acompanhadas.
- **Gamificação:** conquistas e medalhas vinculadas a ações válidas, missões diárias e semanais, moedas virtuais com limites de ganho, loja de cosméticos, inventário e histórico de transações. A moeda não tem valor monetário.

## Arquitetura

```text
public/                Páginas HTML, estilos e JavaScript do navegador
src/server.js          Entrada do servidor HTTP, API e eventos Socket.IO
src/routes/            Endpoints REST de autenticação, salas, chat e comunidade
src/controllers/       Regras dos endpoints de autenticação e perfil
src/services/          Reputação, projeções, mensagens e armazenamento de mídia
src/middleware/        Autenticação e autorização
src/database/          Cliente Prisma
prisma/                Schema e migrações do PostgreSQL
test/                  Testes automatizados
```

O Express entrega os arquivos de `public/` e expõe a API em `/api`. O navegador usa requisições HTTP para operações persistentes e Socket.IO para chat, presença e sincronização das projeções. O Prisma acessa o PostgreSQL; o estado temporário das sessões de vídeo fica no processo do servidor. Arquivos do chat podem ser armazenados no Cloudinary, em um bucket S3 compatível ou, durante o desenvolvimento, em uma pasta local privada. Avatar e banner de perfil são armazenados no banco.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Interface | HTML, CSS e JavaScript sem framework; YouTube IFrame API |
| Servidor e tempo real | Node.js 22+, Express 5 e Socket.IO 4 |
| Dados | PostgreSQL, Prisma ORM e migrações |
| Autenticação | JWT e bcrypt |
| Mídia | Multer, Sharp, Cloudinary e AWS SDK para S3 compatível |
| Testes | `node:test` |

## Executar localmente

**Pré-requisitos:** Node.js 22 ou superior, npm e uma instância PostgreSQL acessível.

1. Instale as dependências:

   ```bash
   npm ci
   ```

2. Copie `.env.example` para `.env` e configure, no mínimo, `DATABASE_URL` e `JWT_SECRET`. Em PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Use uma chave JWT longa e aleatória. O `PORT` padrão é `3000`.

3. Aplique as migrações e gere o cliente Prisma:

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

4. Inicie a aplicação:

   ```bash
   npm start
   ```

5. Acesse **http://localhost:3000**. `/healthz` confirma que o processo HTTP está ativo; `/readyz` também verifica a conexão com o banco e a configuração de `JWT_SECRET`.

Para usar áudios, figurinhas e imagens de fundo localmente, mantenha `CHAT_STORAGE_DIR=.chat-uploads` no `.env`. Em produção, configure as três variáveis `CLOUDINARY_*` ou as credenciais `CHAT_S3_*` de um bucket privado; o armazenamento local é desativado quando `NODE_ENV=production`. O arquivo `.env` e a pasta `.chat-uploads/` são ignorados pelo Git. Consulte `.env.example` para todas as opções, incluindo limite de duração de áudio.

Para ativar o Web Push, gere um par VAPID estável (`npx web-push generate-vapid-keys`) e configure `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` e `WEB_PUSH_SUBJECT` no servidor. Use um endereço de contato real no `WEB_PUSH_SUBJECT`, como `mailto:contato@seudominio.com`. Configure as mesmas chaves em cada instância e preserve-as entre reinicializações; trocar as chaves exige que os usuários inscrevam o dispositivo novamente. A central continua funcionando sem essas variáveis, mas a opção de Push fica indisponível.

## Publicação

1. Configure `NODE_ENV=production`, `DATABASE_URL`, um `JWT_SECRET` longo e exclusivo e o `PORT` exigido pela hospedagem. Configure Cloudinary ou um bucket S3 privado para áudio, figurinhas e wallpapers; o armazenamento local fica desativado em produção.
2. Na implantação, execute `npm ci`, `npx prisma generate` e `npx prisma migrate deploy`, nesta ordem. Em seguida, inicie com `npm start`. As migrações são versionadas e devem acompanhar o código publicado.
3. Use `/readyz` para a verificação de prontidão e `/healthz` para verificar apenas se o processo HTTP responde. Uma falha temporária do Neon deixa `/readyz` com status 503 até a conexão voltar.
4. Antes de liberar tráfego, confirme login e cadastro, troca de mensagens entre duas contas, anexos, DMs, permissões de moderação e acesso pelo celular. Para chamadas de voz em redes móveis, configure STUN/TURN em `VOICE_ICE_SERVERS` e valide em Android e iOS reais.

Esta versão usa uma instância Node para presença, projeções, voz e limites em memória. A publicação com mais de uma instância requer estado compartilhado e um adaptador Socket.IO. O [aviso de privacidade](./public/privacy.html) ainda está marcado como rascunho: informe responsável, contato e prazos de retenção antes de publicar uma política definitiva.

## Demonstração

As capturas acima mostram a conta fictícia **DemoAmino2**, preparada com uma sala, mensagens e um post no banco deste ambiente. As credenciais ficam apenas no arquivo local `.env.demo`, ignorado pelo Git. Para acesso interativo de terceiros, publique a aplicação e compartilhe as credenciais por um canal apropriado.

Roteiro para verificar o fluxo principal após iniciar o servidor:

1. Abra `/cadastro.html`, crie uma conta e entre pela página `/login.html`.
2. Na página inicial, abra a sala **Geral** ou crie uma sala pública. Abra uma segunda sessão do navegador com outra conta para observar a presença e trocar mensagens em tempo real.
3. Envie uma mensagem, responda e reaja a ela. Com o armazenamento de mídia configurado, experimente gravar um áudio, criar uma figurinha e personalizar o fundo do chat.
4. Na sala criada, inicie uma projeção e adicione um link válido do YouTube à playlist. Observe a sincronização do vídeo na segunda sessão.
5. Abra `/perfil.html` para conferir posts, seguidores, check-in e progresso de reputação. Contas com permissão de administrador do site também podem acessar `/admin.html`.
6. Abra `/feed.html` para publicar, comentar, salvar ou compartilhar. Experimente as abas Seguindo, Para você e Salvos com duas contas.
7. Abra `/gamification.html` para acompanhar missões, coletar conquistas e equipar cosméticos no perfil.
8. Abra `/events.html` para ver os eventos das suas comunidades. Moderadores podem criar e reagendar eventos; participantes podem confirmar inscrição, escolher lembretes e marcar presença nas duas horas após o início. Eventos de projeção levam à sala existente para o anfitrião iniciar a sessão.

Os recursos de janela flutuante e reprodução incorporada dependem das permissões do navegador e da disponibilidade do vídeo no YouTube.

### Salas de voz

No chat de uma comunidade, abra **Voz da comunidade**. Moderadores podem criar e encerrar salas; membros podem entrar com permissão de microfone. O painel da chamada oferece mudo, volume individual e moderação. Se houver projeção ativa, uma nova sala pode ser vinculada a ela para controlar o volume do vídeo separadamente.

As chamadas usam WebRTC entre os navegadores e Socket.IO para sinalização. Cada comunidade pode ter até três salas abertas e cada sala aceita até seis participantes. A remoção de um participante impede seu retorno por cinco minutos. Usuários invisíveis não podem entrar. As salas persistem no banco; a participação termina ao reiniciar o processo Node ou fechar a página do chat.

Configure `VOICE_ICE_SERVERS` com seus servidores STUN e TURN em produção. O STUN público padrão serve para desenvolvimento, mas não garante conexão em redes celulares ou restritas. As credenciais TURN são enviadas aos participantes; prefira credenciais temporárias ou restritas. O microfone exige HTTPS em produção, permissão do usuário e suporte WebRTC. Para grupos maiores ou moderação de áudio resistente a clientes modificados, é necessário um servidor de mídia (SFU). A sinalização atual usa memória de uma única instância Node; várias instâncias exigem adaptador Socket.IO e estado compartilhado.

Na malha P2P, cada participante envia áudio a todos os demais: seis pessoas exigem até cinco conexões de saída por pessoa. O STUN público não cobra tráfego da aplicação, mas um TURN próprio ou contratado pode gerar custo de banda; SFU também acrescenta custo de hospedagem e tráfego. Meça uso de CPU, upload, latência e perdas em Android e iOS reais antes de aumentar esse limite.

### Moderação, segurança e privacidade

Denúncias de mensagens, perfis, comunidades, publicações, figurinhas e conversas privadas entram na mesma fila. Moderadores veem apenas denúncias ligadas à própria comunidade; a administração geral vê a fila completa e o histórico de ações. Advertências, silêncio e suspensão temporários são auditados. A suspensão impede entrada e acesso ao conteúdo da comunidade enquanto estiver ativa. Os controles de volume e bloqueio privado permanecem independentes. A proteção contra spam limita mensagens repetidas, volume de envio e links potencialmente enganosos; cadastros e tentativas de login têm limites por conexão e conta. Estes limites vivem na memória de uma instância Node e exigem armazenamento compartilhado em implantação com múltiplas instâncias.

O perfil oferece visibilidade pública ou privada e exclusão da própria conta com confirmação de senha. Se uma conta excluir uma comunidade sem coadministrador, a comunidade e seu conteúdo serão excluídos; havendo coadministrador, a propriedade é transferida. Contas de administração geral precisam transferir essa função antes da exclusão. Registros de denúncias e auditoria podem conservar um resumo para segurança. Veja as [regras](./public/rules.html) e o [aviso de privacidade em preparação](./public/privacy.html). Antes de publicar uma política definitiva, preencha a identidade e contato do responsável e defina prazos de retenção para cada categoria de dados; estes dados ainda não foram informados.

## Testes

```bash
npm test
```

Os testes usam o executor nativo do Node.js (`node --test`). A execução padrão cobre a lógica isolada e o armazenamento local. As integrações com banco e servidor são opcionais.

| Conjunto | O que verifica | Execução |
| --- | --- | --- |
| Chat e mídia | Mensagens, respostas, validação de áudio, imagens, figurinhas e arquivos locais privados | `npm test` |
| Reputação e projeções | Check-in, XP, limites, participantes e prevenção de ganhos duplicados | `npm test` |
| Chat com PostgreSQL | Histórico, autorização, reações, exclusão e personalização persistida | `RUN_CHAT_DB_TESTS=1 npm test` |
| Projeções com PostgreSQL | Estatísticas, coleta concorrente e limites de REP | `RUN_PROJECTION_DB_TESTS=1 npm test` |
| Cloudinary | Upload, leitura privada e remoção de áudio e figurinhas | `RUN_CLOUDINARY_TESTS=1 npm test` |
| Mensagens privadas com PostgreSQL | Solicitações, bloqueios, privacidade e mídia | `RUN_DIRECT_DB_TESTS=1 npm test` |
| Mensagens privadas em tempo real | Digitação, reconexão, leitura e menções | `RUN_DIRECT_LIVE_TESTS=1 npm test` |
| Notificações em tempo real | Seguir, curtir, DM, preferências, leitura e dispositivos | `RUN_NOTIFICATION_LIVE_TESTS=1 npm test` |
| Comunidades e busca | Descoberta, favoritos, interesses, fixação, votação e filtros com duas contas | `RUN_COMMUNITY_LIVE_TESTS=1 npm test` |
| Feed social | Paginação, posts de comunidades, comentários, compartilhamento, salvos, ocultação, denúncias e bloqueios | `RUN_SOCIAL_LIVE_TESTS=1 npm test` |
| Gamificação | Resgates idempotentes, limites de moedas, compras concorrentes, inventário e cosméticos equipados | `RUN_GAMIFICATION_LIVE_TESTS=1 npm test` |
| Eventos | Acesso por comunidade, lotação concorrente, lembretes, check-in, reagendamento e cancelamento | `RUN_EVENTS_LIVE_TESTS=1 npm test` |
| Salas de voz | Acesso, criação, sinalização isolada, moderação e limites | `RUN_VOICE_LIVE_TESTS=1 node --test test/voice.integration.test.js` |
| Moderação e privacidade | Escopo das denúncias, auditoria, restrições no chat, perfil privado e exclusão da conta | `RUN_MODERATION_LIVE_TESTS=1 node --test test/moderation.integration.test.js` |

As integrações são **opt-in**: sem as respectivas variáveis iguais a `1`, aparecem como puladas. Para executá-las, configure `DATABASE_URL` e `JWT_SECRET` em um banco com migrações aplicadas, preferencialmente isolado para testes. Os testes de integração criam e removem registros; o teste de Cloudinary também exige `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`.

Os comandos da tabela usam a sintaxe de Bash. No PowerShell, por exemplo:

```powershell
$env:RUN_CHAT_DB_TESTS = '1'
npm test
Remove-Item Env:RUN_CHAT_DB_TESTS
```
