# Aplicativos Purp

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

O pacote mobile contém cópia dos arquivos web e redireciona chamadas `/api` e Socket.IO para o backend HTTPS. Áudio precisa de permissão de microfone. O projeto contém o plugin Capacitor Push Notifications, mas a entrega de push requer um projeto Firebase, `google-services.json` no projeto Android e a configuração do servidor abaixo.

**Pendente:** a captura de tela Android ainda precisa de uma implementação nativa com MediaProjection integrada a uma trilha WebRTC. O controle de compartilhar fica indisponível onde `getDisplayMedia` não existe. Um APK gerado não comprova esse recurso.

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

A migração `prisma/migrations/20261025000000_native_push_devices` adiciona somente a tabela de tokens dos dispositivos. Execute `npx prisma migrate deploy` no servidor antes de habilitar o recurso. Não inclua credenciais nos aplicativos.

- Android: configure `FIREBASE_SERVICE_ACCOUNT_JSON` no servidor e `google-services.json` apenas no projeto Android. O servidor usa FCM.
- iOS: configure `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` e `APNS_ENV` no servidor. Habilite Push Notifications e assinatura no Xcode.
- Em **Notificações → Preferências e dispositivos**, o usuário habilita o dispositivo e escolhe as categorias com Push. As notificações Web Push existentes permanecem para navegadores.

## Página de downloads do site

A página pública `/downloads.html` mostra Android, Windows e iPhone. Android e Windows só habilitam o botão quando o servidor encontra o APK/instalador local ou quando `PURP_ANDROID_DOWNLOAD_URL` / `PURP_WINDOWS_DOWNLOAD_URL` apontam para arquivos publicados por HTTPS. Os arquivos de build não entram no Git nem são enviados automaticamente ao Render. Publique-os em um serviço de distribuição e configure essas variáveis no servidor para oferecer downloads no site hospedado. iPhone permanece marcado como **Em breve** até existir uma versão iOS assinada e distribuível. Ao atualizar o código do servidor, reinicie o processo Node para carregar a rota nova.

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
| Automatizado | `npm test` na raiz | 34 aprovados, 0 falhas, 12 ignorados por dependerem de serviços ou banco de teste |
| Automatizado | `npx prisma validate` e `npx prisma generate` | Aprovados; a migração de push não foi aplicada ao banco hospedado |
| Automatizado | Electron em modo smoke com backend local | Janela, cliente Socket.IO, APIs WebRTC e captura presentes; API respondeu 400 a login vazio, conforme esperado |
| Manual assistido por navegador | Pacote web do mobile servido localmente | Página de login abriu, API remota respondeu 400 a login vazio e o cliente Socket.IO apontou para o backend remoto |
| Compilação | `npm run dist:win` | Instalador `desktop/dist/Purp Setup 0.1.0.exe` produzido, 106.209.535 bytes, sem assinatura de código |
| Compilação | `npm run sync` e `gradlew assembleDebug` | APK `mobile/android/app/build/outputs/apk/debug/app-debug.apk` produzido, 9.664.846 bytes; manifesto inspecionado com `aapt` |
| Manual | Instalação e abertura Windows | Uma versão anterior do instalador foi instalada e passou no smoke. A validação do instalador final foi bloqueada pela revisão automática da ferramenta; o código final passou no smoke de desenvolvimento |
| Manual | Android e iPhone | Não executados: nenhum Android apareceu em `adb devices`, e este ambiente Windows não possui macOS, Xcode ou iPhone |
| Manual | Mensagens entre dispositivos, chamadas, tela e notificações | Não executados de ponta a ponta. Exigem dois clientes reais, permissões, rede e credenciais de push configuradas |
| Manual | Queda e restauração de conexão | Não executado em dispositivos instalados |

O APK é de depuração e o instalador Windows não é assinado. Android e iOS ainda exigem a integração nativa de captura de tela descrita acima. Não distribua esses arquivos como versão final com todos os recursos anunciados antes da validação manual.
