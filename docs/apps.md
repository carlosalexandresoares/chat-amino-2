# Aplicativos Purp

## Beta 4: notificações Android

- O app Android `com.purp.app` foi registrado no projeto Firebase `purp-chat`. O build inclui `google-services.json` somente no diretório local ignorado pelo Git.
- O Render recebeu a credencial FCM como variável secreta `FIREBASE_SERVICE_ACCOUNT_JSON`; a implantação terminou com sucesso. A conta de serviço tem a função **Administrador da API Firebase Cloud Messaging**.
- Um teste com token fictício chegou à API do FCM e recebeu `messaging/invalid-argument` por token inválido, conforme esperado. Isso verifica a autenticação do servidor, sem comprovar entrega a um celular.
- `npm test`: 40 aprovados, 0 falhas, 12 ignorados. `npm --prefix mobile run sync` e `gradlew assembleDebug`: aprovados.
- APK beta 4: `versionCode` 4, 9.895.515 bytes, SHA-256 `248de55869af498be693b7edeb6c87a68aaf11fcb92b77852a70bf7de4af8196`. O build gerou os recursos do Firebase e contém o ícone de notificação Purp. `apksigner` confirmou a mesma assinatura da beta 3. O arquivo publicado no GitHub foi baixado e teve o mesmo tamanho e SHA-256 do build local.
- `adb devices` não encontrou celular. Instalação, permissão do Android e entrega real de mensagens gerais e privadas ainda precisam de teste em aparelho.

## Beta 3: atualização e ícone Android

- `npm test`: 37 aprovados, 0 falhas, 12 ignorados.
- `npm run sync` e `gradlew assembleDebug`: concluídos. APK versão 3, 9.888.598 bytes, SHA-256 `f2cf52261f871aa90ff6bd23d5f1c789b9937c59b46fb4bbe4f24332ff8a458b`.
- `aapt dump badging`: confirmou versão 3 e `REQUEST_INSTALL_PACKAGES` no manifesto.
- `apksigner verify --print-certs`: beta 2 e beta 3 têm a mesma assinatura SHA-256 `8a42be1cbb59e3e4fbd1b3e5d87fd502790414d505ad6ffca99413737521fc65`.
- Inspeção visual: o ícone mostra o mascote Purp nas versões padrão e adaptativa.
- Instalação e atualização em aparelho: pendentes; `adb devices` não listou aparelhos conectados.

Os aplicativos usam a interface de `public/` e o backend HTTP/Socket.IO existente. O servidor, PostgreSQL e os arquivos de mídia permanecem hospedados; não são incluídos nos instaladores. A URL padrão é `https://project-dacj.onrender.com` e pode ser substituída no build mobile ou na execução desktop com `PURP_SERVER_URL` (HTTPS em distribuição).

## Windows

Requisitos: Windows x64, Node.js 22+ para compilar e acesso ao backend.

```powershell
cd desktop
npm ci
npm run dist:win
```

O instalador NSIS sai em `desktop/dist/Purp Setup 0.1.0.exe`. Confirme o arquivo antes de distribuí-lo. Durante desenvolvimento, execute o backend na raiz com `npm start` e, em outro terminal:

```powershell
cd desktop
$env:PURP_SERVER_URL = 'http://localhost:3000'
npm start
```

O aplicativo serve os arquivos web empacotados por um servidor ligado somente a `127.0.0.1` e encaminha `/api` e Socket.IO ao backend. A janela mantém a conexão ao minimizar, possui bandeja do sistema e exibe notificações nativas quando não está em foco. Captura de tela usa a seleção explícita de janela ou monitor do Electron. O instalador de teste não é assinado; assinatura de código será necessária para uma distribuição confiável em larga escala.

## Android

Requisitos: JDK 21, Android SDK com API 36 e Build Tools, Node.js 22+, um dispositivo Android para validação real.

```powershell
cd mobile
npm ci
$env:PURP_SERVER_URL = 'https://seu-servidor.exemplo'
npm run sync
cd android
.\gradlew.bat assembleDebug
```

O APK de depuração é produzido em `mobile/android/app/build/outputs/apk/debug/app-debug.apk` quando o Gradle termina com sucesso. Verifique a existência e o tamanho do arquivo. Instale com `adb install -r` somente depois de conectar um aparelho e autorizar a depuração USB.

O pacote mobile contém cópia dos arquivos web e redireciona chamadas `/api` e Socket.IO para o backend HTTPS. Áudio precisa de permissão de microfone. A beta 4 inclui o plugin Capacitor Push Notifications e a configuração do Firebase; a entrega real ainda precisa de validação em aparelho.

**Pendente:** a captura de tela Android ainda precisa de uma implementação nativa com MediaProjection integrada a uma trilha WebRTC. O controle de compartilhar fica indisponível onde `getDisplayMedia` não existe. Um APK gerado não comprova esse recurso.

### Atualização do Android

O ícone do APK vem de `public/image/purp-mascot.png`. Depois de alterar essa imagem, execute `node mobile/generate-icons.js` na raiz antes de compilar.

Desde a beta 3, o aplicativo consulta `/api/app-updates/android` ao abrir e oferece **Atualizar agora** se houver uma versão mais nova. No perfil há **Verificar atualizações do app**. O APK é baixado no cache interno, limitado a 100 MB, verificado pelo SHA-256 publicado e enviado ao instalador do Android. Na primeira atualização, o Android pode pedir permissão para instalar pelo Purp; toda instalação exige confirmação do usuário. O APK novo precisa ter a mesma assinatura do app instalado. Quem tem a beta 2 precisa instalar a beta 3 manualmente uma vez pela página de downloads, pois aquela versão ainda não possuía o atualizador.

Para publicar uma versão futura, incremente `versionCode` e `versionName` em `mobile/android/app/build.gradle`, compile e publique o APK com a mesma chave, e atualize a versão, URL e SHA-256 em `src/config/androidRelease.json`. Teste a instalação em um dispositivo antes de anunciar suporte completo.

## iOS

O projeto Xcode está em `mobile/ios/`. Para compilar e testar são necessários macOS, Xcode, uma equipe Apple para assinatura e um iPhone para validar permissões e mídia.

```bash
cd mobile
npm ci
PURP_SERVER_URL=https://seu-servidor.exemplo npm run sync
npx cap open ios
```

Em Xcode, configure a equipe de assinatura, a capacidade **Push Notifications** e o identificador `com.purp.app`. O uso do microfone já tem descrição em `Info.plist`. O build iOS e os testes em iPhone não podem ser executados neste Windows.

**Pendente:** captura de tela iOS requer integração nativa da API de captura compatível com a versão mínima escolhida ao WebRTC. Valide ScreenCaptureKit ou ReplayKit em um Mac e em iPhone antes de anunciar suporte.

## Push nativo

### Avisos de mensagens no Android

O chat geral envia um aviso para cada usuário com aplicativo móvel registrado, exceto o autor e pessoas que já receberam aviso de menção ou resposta da mesma mensagem. O chat privado já envia um aviso ao destinatário, respeitando conversas silenciadas. Ao ativar o aparelho pela primeira vez, as categorias **Chat** e **Mensagens privadas** recebem Push por padrão; preferências existentes permanecem como estão. O app oferece a ativação após o login e permite controlar tudo em **Notificações → Preferências e dispositivos**. A notificação usa o ícone Purp e abre a conversa correspondente ao tocar nela.

Para habilitar a entrega real com o aplicativo fechado:

1. Crie ou use um projeto Firebase e registre um app Android com identificador **`com.purp.app`**. Baixe o `google-services.json` e coloque-o em `mobile/android/app/`. Esse arquivo é ignorado pelo Git.
2. No Firebase, crie uma credencial de conta de serviço para o FCM. No Render, configure o JSON completo na variável secreta `FIREBASE_SERVICE_ACCOUNT_JSON`. Nunca coloque a chave de serviço no APK ou no repositório.
3. Execute `npm --prefix mobile run sync` e compile um **novo APK** com `gradlew assembleDebug`. Publique-o com a mesma chave de assinatura e um `versionCode` maior; atualize `src/config/androidRelease.json` com URL e SHA-256.
4. No celular, instale a versão nova, entre na conta, toque **Ativar notificações** e permita avisos do Android. Com duas contas em dois aparelhos, envie mensagens no geral e no privado com o destinatário em segundo plano, toque os avisos e confirme que cada um abre a conversa correta. Teste também conversa silenciada e categorias desativadas.

As migrações `20261025000000_native_push_devices` e `20261025010000_chat_message_notifications` foram aplicadas ao PostgreSQL em 25/10/2026. As credenciais Firebase estão configuradas no servidor hospedado. Sem um aparelho real, a entrega push permanece **não validada**; os testes automatizados verificam a lógica de destinatários e preferências.

A migração `prisma/migrations/20261025000000_native_push_devices` adiciona somente a tabela de tokens dos dispositivos. Execute `npx prisma migrate deploy` no servidor antes de habilitar o recurso. Não inclua credenciais nos aplicativos.

- Android: configure `FIREBASE_SERVICE_ACCOUNT_JSON` no servidor e `google-services.json` apenas no projeto Android. O servidor usa FCM.
- iOS: configure `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` e `APNS_ENV` no servidor. Habilite Push Notifications e assinatura no Xcode.
- Em **Notificações → Preferências e dispositivos**, o usuário habilita o dispositivo e escolhe as categorias com Push. As notificações Web Push existentes permanecem para navegadores.

## Página de downloads do site

A página pública `/downloads.html` mostra Android, Windows e iPhone. No servidor local, Android e Windows servem os builds presentes. No site hospedado, o Android usa a [beta 7](https://github.com/carlosalexandresoares/chat-amino-2/releases/tag/v0.1.0-beta.7) e o Windows usa a [beta 1](https://github.com/carlosalexandresoares/chat-amino-2/releases/tag/v0.1.0-beta.1). Os arquivos de build não entram no Git nem são enviados ao Render. As variáveis `PURP_ANDROID_DOWNLOAD_URL` e `PURP_WINDOWS_DOWNLOAD_URL` permitem trocar os links por outras URLs HTTPS no futuro. iPhone permanece marcado como **Em breve** até existir uma versão iOS assinada e distribuível. Ao atualizar o código do servidor, reinicie o processo Node para carregar a rota nova.

Na beta 5, Fixadas, Enquetes, Busca e Voz da comunidade ficam no menu de três pontos do chat em telas de celular. O painel de live permanece visível. O campo de mensagem e a navegação inferior foram ajustados para ocupar melhor a tela.

Na beta 6, as janelas de resumo e histórico das projeções abrem menores e centralizadas no celular. Históricos longos rolam dentro da janela.

Na beta 7, o topo do perfil foi simplificado no celular: o link de download duplicado saiu e os demais controles usam ícones acessíveis. A navegação inferior do perfil carrega o espaçamento atualizado.

## Validação necessária antes da distribuição

| Cenário | Automatizado | Manual necessário |
| --- | --- | --- |
| Instalação e abertura | Verificar instalador/APK e teste de inicialização Windows | Instalar, abrir e fechar em Windows e Android; compilar/abrir no iPhone |
| Login | Testes HTTP de autenticação existentes | Entrar em cada aplicativo instalado |
| Mensagens e reconexão | Testes Socket.IO opcionais com banco isolado | Trocar mensagens entre web, Windows e celulares; desligar e restaurar a rede |
| Chamada e tela | Testes de sinalização opcionais | Microfone, áudio e captura com dois aparelhos em redes diferentes |
| Notificações | Testes de serviço e rotas | Confirmar entrega com janela minimizada e app móvel em segundo plano |
| Web | `npm test` e regressão das páginas | Navegação e fluxos principais em navegador |

Os testes de integração opcionais criam e removem registros: use um banco isolado. A chamada de voz P2P admite seis participantes; vídeo amplia o consumo de upload. Configure TURN para testar redes móveis e restritas. A distribuição iOS, a validação em aparelho Android e o compartilhamento nativo permanecem pendentes até haver ferramentas, credenciais e aparelhos compatíveis.

## Resultados obtidos em 25/10/2026

| Tipo | Verificação | Resultado |
| --- | --- | --- |
| Automatizado | `npm test` na raiz | 40 aprovados, 0 falhas, 12 ignorados por dependerem de serviços ou banco de teste |
| Automatizado | `npx prisma validate` e `npx prisma generate` | Aprovados; as migrações de push foram aplicadas ao banco hospedado em 25/10/2026 |
| Automatizado | Electron em modo smoke com backend local | Janela, cliente Socket.IO, APIs WebRTC e captura presentes; API respondeu 400 a login vazio, conforme esperado |
| Manual assistido por navegador | Pacote web do mobile servido localmente | Página de login abriu, API remota respondeu 400 a login vazio e o cliente Socket.IO apontou para o backend remoto |
| Compilação | `npm run dist:win` | Instalador `desktop/dist/Purp Setup 0.1.0.exe` produzido, 106.209.535 bytes, sem assinatura de código |
| Compilação | `npm --prefix mobile run sync` e `gradlew assembleDebug` | APK `mobile/android/app/build/outputs/apk/debug/app-debug.apk` produzido, 9.895.515 bytes, código de versão 4; recursos Firebase, permissões e assinatura inspecionados |
| Manual | Instalação e abertura Windows | Uma versão anterior do instalador foi instalada e passou no smoke. A validação do instalador final foi bloqueada pela revisão automática da ferramenta; o código final passou no smoke de desenvolvimento |
| Manual | Android e iPhone | Não executados: nenhum Android apareceu em `adb devices`, e este ambiente Windows não possui macOS, Xcode ou iPhone |
| Manual | Mensagens entre dispositivos, chamadas, tela e notificações | Não executados de ponta a ponta. Exigem dois clientes reais, permissões, rede e credenciais de push configuradas |
| Manual | Queda e restauração de conexão | Não executado em dispositivos instalados |

O APK é de depuração e o instalador Windows não é assinado. Android e iOS ainda exigem a integração nativa de captura de tela descrita acima. Não distribua esses arquivos como versão final com todos os recursos anunciados antes da validação manual.
