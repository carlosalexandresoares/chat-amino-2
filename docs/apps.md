# Aplicativos Purp

## Beta 14: atualizações do perfil e chat privado (27/10/2026)

Android beta 14 e Windows 0.1.7 incluem a edição do nome do perfil e o novo visual do chat privado. A lista de mensagens agora rola dentro da conversa, sem deslocar o campo de digitação. O Android consulta o manifesto da beta 14 e oferece a instalação dentro do app. A partir do Windows 0.1.7, o aplicativo consulta a versão publicada ao abrir e a cada seis horas; quando há uma versão nova, oferece o download do instalador. Quem usa uma versão Windows anterior precisa instalar a 0.1.7 manualmente uma vez para receber esses avisos.

Arquivos: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (58.264.080 bytes; SHA-256 `bfd188b6b85c6748bdab1fd4583c4318eab1405abeb1d6cf0f118524d8e44d2a`) e `desktop/dist/Purp Setup 0.1.7.exe` (106.445.026 bytes; SHA-256 `9966db5671065638e5d99698c8433026610c2db5012b31d8773d3daa633eed71`). A assinatura Android continua `8a42be1cbb59e3e4fbd1b3e5d87fd502790414d505ad6ffca99413737521fc65`. O instalador Windows não é assinado. `npm test`: 44 aprovados, 0 falhas, 12 integrações opcionais ignoradas. A compilação Android, a criação do instalador e o smoke do Windows passaram. A instalação Android em aparelho real permanece sem teste neste ambiente.

Publicação: [beta 14](https://github.com/carlosalexandresoares/chat-amino-2/releases/tag/v0.1.0-beta.14). Os dois arquivos da versão são usados pelos links da página de downloads. O servidor deve carregar os manifestos novos antes de oferecer a atualização dentro dos aplicativos.

## Beta 13: áudio do compartilhamento de tela (27/10/2026)

Web e Windows agora enviam o áudio da fonte quando ele é fornecido pela captura. No navegador, o usuário precisa habilitar **Compartilhar áudio** no seletor quando a opção aparecer. No Windows, selecionar um monitor inclui o áudio do sistema; selecionar uma janela não inclui todo o som do computador. A voz do microfone continua em uma trilha independente.

No Android 10 ou superior, a captura nativa usa a mesma autorização de projeção da tela para obter áudio de apps que permitem captura. O app pede também a permissão de microfone exigida pelo Android para capturar a reprodução. O áudio segue em pacotes PCM pela conexão WebRTC da tela, separado do microfone da chamada. O Android permite capturar mídia e jogos, mas não a voz de chamadas. Android 9 ou anterior, apps com captura bloqueada, áudio fora dessas categorias e permissões recusadas podem resultar em vídeo sem som. O painel informa quando a captura de áudio não pôde iniciar. A captura usa 48 kHz mono, cerca de 768 kbit/s adicionais por espectador. O teste automatizado verifica o transporte e a reprodução simulada, mas ainda é necessário testar a captura real em um aparelho Android.

`npm test`: 42 aprovados, 0 falhas, 12 integrações opcionais ignoradas. `npm --prefix desktop run test:voice`: aprovado com quatro clientes, áudio web e Android simulado. A compilação Android `:app:assembleDebug` e a criação do instalador Windows passaram. Nenhum aparelho apareceu em `adb devices`, portanto a captação Android real e o áudio loopback do Windows ainda precisam ser conferidos manualmente. A atualização automática Android continua oferecendo a beta 8; esta beta é de instalação manual.

Arquivos gerados: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (58.282.095 bytes; SHA-256 `481da245bd469209f2d25edcc862c9480e372052ec87ce5d9014b3b75e14ffcf`) e `desktop/dist/Purp Setup 0.1.6.exe` (106.443.888 bytes; SHA-256 `1b8c62a438d666f5c1cc9091fa9f46255543049d8cec171c3494dc7c2e3e1b5d`). O APK mantém a assinatura debug das betas anteriores; o instalador Windows não tem assinatura de código.

## Beta 12: transmissão de tela até 1080p

Web/Windows agora solicitam captura de até 1920×1080 a 30 FPS. A captura Android com `MediaProjection` preserva a proporção do aparelho e limita o quadro ao lado longo de 1920 e ao curto de 1080, sem ampliar telas menores. O teto de envio WebRTC subiu de 2,2 para 5 Mbit/s **por espectador**. No navegador, a preferência de degradação prioriza preservar a resolução e pode reduzir quadros quando a rede está limitada. A voz continua em trilhas separadas. A resolução recebida não é garantida: depende da fonte, do dispositivo, do codificador e da conexão. Com cinco espectadores, o transmissor pode precisar de até cerca de 25 Mbit/s de upload só para o vídeo.

O teste automatizado com quatro clientes Electron verifica a solicitação de 1920×1080, áudio simultâneo, vários espectadores e reconexão. A compilação Android verifica que o código nativo compila; ainda é preciso medir a resolução e o bitrate recebidos em Android real e em redes diferentes. A beta 12 é experimental e de instalação manual. A atualização automática continua oferecendo a beta 8 enquanto o carregamento da beta 11/12 e a captura em aparelho não forem validados com mais abrangência.

Arquivos gerados: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (58.262.056 bytes; SHA-256 `247780012BE1527459A0FD5A646B043F78A55C02F5EC09BB66B3ABDAA35A68AB`) e `desktop/dist/Purp Setup 0.1.5.exe` (106.443.136 bytes; SHA-256 `37E3BA337068302C433720C9F82E1913CD073A04F7B35A699BE395DBA361E696`). A assinatura Android é a mesma das betas anteriores. `npm test`: 42 aprovados, 0 falhas, 12 ignorados. `npm --prefix desktop run test:voice`: aprovado. APK e instalador foram compilados, mas não havia Android conectado para teste de transmissão real.

## Beta 11: diagnóstico de carregamento Android (27/10/2026)

Após um teste bem sucedido de captura de tela no celular, foi relatado que o aplicativo permanecia em “Carregando...” e “Carregando chats...”. As sondas públicas de `/healthz`, `/readyz` e Socket.IO no servidor hospedado responderam normalmente, mas essas sondas não verificam consultas autenticadas nem o aparelho do usuário. Nenhum dispositivo estava conectado por ADB; a causa exata no celular continua sem confirmação.

A beta 11 remove a dependência de `AbortSignal.timeout` nas consultas iniciais e usa `AbortController` com temporizador, compatível com WebViews que não implementam aquela função. A consulta da conta começa sem esperar a consulta da sala. Em caso de falha ou demora, a tela mostra uma mensagem em vez de deixar o indicador de carregamento indefinidamente. O código compartilhado da web e do Windows contém a mesma correção. Não houve alteração no banco nem no fluxo de captura de tela.

O APK beta 11 precisa ser instalado manualmente pela página de downloads para este teste. O manifesto da atualização automática permanece na beta 8 até que o carregamento, login, mensagens e captura da beta 11 sejam confirmados em um Android real. Se a tela continuar carregando, registre a versão do Android, a tela afetada, a mensagem exibida e um log do WebView/ADB para identificar a falha concreta. Ao terminar os testes locais, encerre os processos iniciados para eles.

Arquivos gerados: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (58.267.647 bytes; SHA-256 `8ABF36E155D0618EF6457A445021EDF345EA54762D5A283972F6F87D6B67A602`) e `desktop/dist/Purp Setup 0.1.4.exe` (106.443.184 bytes; SHA-256 `8D8D8572DAB6998D7D1029D2B87D8D5595823DD80238DFC74F10C384A0D3D553`). `apksigner` confirmou a assinatura de atualização Android `8a42be1cbb59e3e4fbd1b3e5d87fd502790414d505ad6ffca99413737521fc65`. O instalador Windows continua sem assinatura de código.

| Tipo | Verificação | Resultado |
| --- | --- | --- |
| Automatizado | `npm test` | 42 aprovados, 0 falhas, 12 integrações opcionais ignoradas. Inclui o caso de requisição presa sem `AbortSignal.timeout`. |
| Automatizado | `npm --prefix desktop run test:voice` | Quatro clientes WebRTC e sinalização simulada: aprovado; não verifica API autenticada de produção. |
| Compilação | `npm --prefix mobile run build:web`, `npx cap sync android`, `gradlew assembleDebug` | APK `versionCode` 11 produzido; módulo JavaScript dentro do pacote e assinatura conferidos. |
| Compilação | `npm --prefix desktop run dist:win` | Instalador Windows 0.1.4 produzido; módulo JavaScript dentro do pacote. |
| Manual em dispositivo | Android beta 11 | Pendente: não havia aparelho conectado ao ADB. |

## Compartilhamento de tela Android (Etapa 3, beta 10)

Para encontrar o controle no celular: abra uma comunidade, toque em **⋮ → Voz e compartilhar tela**, crie ou entre em uma sala de voz e toque em **Compartilhar tela** no painel da chamada, mesmo quando ele estiver recolhido. Confirme a captura no diálogo do Android. Toque no mesmo botão para interromper. A beta 10 exige instalação manual do APK da página de downloads; o atualizador interno ainda oferece a beta 8.

O botão da chamada no APK beta 10 abre o consentimento de captura do Android. Após a autorização, um serviço em primeiro plano mostra uma notificação persistente com **Parar transmissão**. `MediaProjection` alimenta uma trilha de vídeo WebRTC nativa; a voz continua nas conexões existentes do WebView. Quando há microfone na chamada e a permissão foi concedida, o serviço declara também o tipo de microfone para ajudar a manter o áudio em segundo plano. A sinalização usa a mesma sala de voz e o servidor só encaminha ofertas de tela do participante que está compartilhando para membros daquela chamada. Até cinco espectadores recebem conexões P2P, com meta de 720p, 30 FPS e 2,2 Mbit/s por espectador. O usuário pode alternar para outros aplicativos enquanto o serviço e a chamada permanecerem ativos. Conteúdo protegido pelo Android pode aparecer preto.

O WebView não pode inserir diretamente uma trilha `MediaProjection` em seu `RTCPeerConnection`; por isso o vídeo nativo usa uma conexão adicional, sem substituir a chamada de áudio. O espectador usa o mesmo painel de vídeo no navegador, no Windows 0.1.3 e no Android. O aviso do sistema e o controle da chamada encerram a captura; a revogação pelo Android também a interrompe. Não há gravação nem armazenamento. O Android 14 ou superior pode oferecer a escolha entre um aplicativo e a tela inteira no diálogo do sistema.

**Beta experimental:** o APK foi compilado e a assinatura de atualização conferida, mas não havia celular em `adb devices`. Portanto, ainda faltam os testes reais Android→PC, Android→Android, troca de aplicativo, continuidade em segundo plano, rotação, permissão negada pelo sistema e redes móveis. O teste com quatro clientes Electron simula um emissor Android e verifica a sinalização e recepção WebRTC, mas não executa `MediaProjection`. O socket do WebView participa da sinalização; a continuidade ao sair da interface pode variar com as restrições de execução em segundo plano e precisa ser medida em aparelhos reais. Para redes restritas, configure TURN em `VOICE_ICE_SERVERS`.

O arquivo de teste está em `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (58.261.163 bytes; SHA-256 `93EE1311A98506E0D059624C6F013F6D17C0798676C72B64CC7E233442342532`). O instalador Windows complementar é `desktop/dist/Purp Setup 0.1.3.exe` (106.442.434 bytes; SHA-256 `4027DFBA8CAA7E5C04927E96042191223E7CE69FEE35362E505F66CC493EB12D`). Ambos são builds de teste; o Windows permanece sem assinatura de código. A beta 10 deve ser instalada manualmente pelo site para esta validação. O atualizador automático Android continua oferecendo a beta 8 até a transmissão ser confirmada em aparelho real, evitando atualizar toda a base para uma captura ainda não validada.

| Tipo | Verificação em 26/10/2026 | Resultado |
| --- | --- | --- |
| Automatizado | `npm test` | 41 aprovados, 0 falhas, 12 integrações opcionais ignoradas. |
| Automatizado | `npm --prefix desktop run test:voice` | Quatro clientes WebRTC; vídeo web e emissor Android simulado para três espectadores, áudio, entrada tardia, parada e reconexão: aprovado. |
| Compilação | `npm --prefix mobile run build:web`, `npx cap sync android`, `gradlew assembleDebug` | APK beta 10 produzido; versão e tamanho conferidos. |
| Compilação | `npm --prefix desktop run dist:win` | Instalador Windows 0.1.3 produzido e conferido. |
| Abertura do pacote | Windows 0.1.3 em modo smoke | `ready: true`; processos de teste encerrados. |
| Manual em dispositivo | `adb devices` | Nenhum aparelho conectado; instalação e captura nativa não testadas. |

## Compartilhamento de tela — web e Windows (Etapa 2)

O compartilhamento web solicita também o áudio da fonte. No seletor do navegador, habilite **Compartilhar áudio** quando essa opção aparecer; a disponibilidade depende da fonte, do navegador e do sistema. No aplicativo Windows, selecionar um monitor inclui o áudio reproduzido pelo sistema. Selecionar apenas uma janela transmite a imagem sem capturar todo o áudio do computador. Os espectadores recebem o som da tela em uma trilha separada do microfone. A captura de áudio Android está descrita acima.

O botão **Compartilhar tela** da chamada de voz usa `getDisplayMedia` no navegador e o seletor de monitor/janela do Electron no Windows. A captura exige escolha explícita do usuário. A trilha de vídeo segue pelas conexões WebRTC da chamada; o áudio do microfone permanece separado. Uma pessoa compartilha por sala de voz, com até seis participantes na sala. É possível entrar em **Só assistir** sem permitir o microfone. O espectador pode minimizar, ampliar em tela cheia, sair da visualização e reabri-la. Parar pelo botão, pelo controle de captura do sistema, ao sair da chamada ou ao perder a conexão interrompe a transmissão. Não há gravação nem armazenamento da tela.

A captura solicita no máximo 1920×1080 e 30 FPS, com bitrate de envio limitado a 5 Mbit/s por destinatário quando aceito pelo navegador. O WebRTC ajusta a qualidade conforme a rede. Cada espectador recebe uma conexão P2P; seis participantes podem exigir até cinco envios simultâneos do transmissor. Configure um TURN em `VOICE_ICE_SERVERS` para redes que não conseguem comunicação direta. O estado das salas de voz permanece em memória de uma instância Node; escalar para várias instâncias exige sincronizar esse estado e a sinalização.

Para testar o transporte sem contas ou banco de produção:

```powershell
npm test
npm --prefix desktop run test:voice
```

O segundo comando inicia quatro janelas Electron isoladas e um servidor local temporário. Usa identidades e sinalização simuladas, mas conexões WebRTC e trilhas reais de áudio e vídeo geradas em memória. Verifica múltiplos espectadores, entrada durante a transmissão, troca de transmissor, paradas, reconexão, visualização e permissão negada. O teste unitário verifica no serviço de voz que quem está fora da sala não pode receber sinalização nem compartilhar. Todos os processos do teste são encerrados ao terminar.

**Validação manual ainda necessária:** entrar com duas contas reais no navegador e no instalador Windows, escolher monitor, janela e aba quando oferecidos, falar enquanto transmite e repetir em redes diferentes. O teste automatizado substitui a janela de consentimento do sistema por uma captura de teste e não comprova a experiência do seletor nativo. O teste opcional `RUN_VOICE_LIVE_TESTS=1` usa banco de testes migrado e servidor local; não o execute contra o banco de produção. Receber a transmissão em Android/iPhone deve ser validado em aparelhos reais. A captura Android foi implementada como beta experimental na Etapa 3 e ainda precisa de teste em aparelho; a captura iOS segue pendente.

### Resultado da Etapa 2 em 26/10/2026

| Tipo | Verificação | Resultado |
| --- | --- | --- |
| Automatizado | `npm test` | 41 aprovados, 0 falhas, 12 ignorados por dependerem de serviços ou banco de testes. |
| Automatizado | `npm --prefix desktop run test:voice` | Quatro clientes Electron com WebRTC real: vídeo para vários espectadores, entrada tardia, áudio simultâneo, transmissão nos dois sentidos, parada manual e automática simulada, reconexão e permissão negada; aprovado. |
| Automatizado | Serviço de voz | Usuário fora da sala não entra, não compartilha e não encaminha sinal WebRTC; apenas um transmissor por sala; aprovado. |
| Compilação | `npm --prefix desktop run dist:win` | Instalador Windows 0.1.1 produzido e arquivo verificado. |
| Abertura do pacote | `Purp.exe` empacotado em modo smoke | Login abriu, API respondeu 400 ao envio vazio, cliente Socket.IO local respondeu 200, APIs WebRTC/captura presentes; `ready: true`. O processo foi encerrado após o teste. |
| Manual com contas reais | Web e Windows em duas máquinas/redes | Pendente: requer contas de teste, permissão real de microfone/captura e seleção de fonte pelo sistema. |

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

O instalador NSIS da versão atual sai em `desktop/dist/Purp Setup 0.1.3.exe`. Confirme o arquivo antes de distribuí-lo. Durante desenvolvimento, execute o backend na raiz com `npm start` e, em outro terminal:

```powershell
cd desktop
$env:PURP_SERVER_URL = 'http://localhost:3000'
npm start
```

O aplicativo serve os arquivos web empacotados por um servidor ligado somente a `127.0.0.1`, inclui o cliente JavaScript do Socket.IO no pacote e encaminha as conexões `/api` e Socket.IO ao backend. A janela mantém a conexão ao minimizar, possui bandeja do sistema e exibe notificações nativas quando não está em foco. Captura de tela usa a seleção explícita de janela ou monitor do Electron. O instalador de teste não é assinado; assinatura de código será necessária para uma distribuição confiável em larga escala.

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

**Em validação:** a beta 10 implementa captura nativa com MediaProjection e WebRTC. Um APK gerado não comprova a transmissão em aparelho; execute os cenários manuais da Etapa 3 acima antes de anunciar suporte estável.

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

### Validação da base iOS

`npm --prefix mobile run build:web` e `npx cap sync ios` concluíram no Windows em 27/10/2026. O workflow manual `.github/workflows/ios-build.yml` [compilou com sucesso](https://github.com/carlosalexandresoares/chat-amino-2/actions/runs/40500315796) o app para o simulador em um runner macOS, sem assinatura. Esse build verifica a estrutura do projeto e as dependências Capacitor, mas não testa login, chamadas, recepção de vídeo nem transmissão de tela em iPhone.

O projeto mantém iOS 15 como versão mínima. A amostra atual da Apple para captura da tela inteira com ScreenCaptureKit exige iOS 27; adotá-la como única implementação excluiria os iPhones com versões anteriores. Para iOS 15–26, a rota de captura fora do Purp exige uma extensão Broadcast Upload com ReplayKit, uma conexão WebRTC que sobreviva à suspensão do app principal e sinalização autenticada dentro da sala de voz. Isso requer implementação e teste em Xcode e em iPhone antes de disponibilizar o botão de transmissão. A interface iOS não deve oferecer um controle que apenas abra um seletor sem enviar vídeo.

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

A página pública `/downloads.html` mostra Android, Windows e iPhone. No servidor local, Android e Windows servem os builds presentes. No site hospedado, Android beta 12 e Windows 0.1.5 usam os arquivos da [versão experimental](https://github.com/carlosalexandresoares/chat-amino-2/releases/tag/v0.1.0-beta.12). Os arquivos de build não entram no Git nem são enviados ao Render. O manifesto do atualizador automático Android continua na beta 8 até o teste em aparelho real. As variáveis `PURP_ANDROID_DOWNLOAD_URL` e `PURP_WINDOWS_DOWNLOAD_URL` permitem trocar os links por outras URLs HTTPS no futuro. iPhone permanece marcado como **Em breve** até existir uma versão iOS assinada e distribuível. Ao atualizar o código do servidor, reinicie o processo Node para carregar a rota nova.

Na beta 5, Fixadas, Enquetes, Busca e Voz da comunidade ficam no menu de três pontos do chat em telas de celular. O painel de live permanece visível. O campo de mensagem e a navegação inferior foram ajustados para ocupar melhor a tela.

Na beta 6, as janelas de resumo e histórico das projeções abrem menores e centralizadas no celular. Históricos longos rolam dentro da janela.

Na beta 7, o topo do perfil foi simplificado no celular: o link de download duplicado saiu e os demais controles usam ícones acessíveis. A navegação inferior do perfil carrega o espaçamento atualizado.

Na beta 8, o carregamento inicial do chat não depende mais da consulta de categorias. Consultas lentas de comunidades, perfil e prévias da página inicial encerram após 20 segundos e exibem um estado de erro em vez de permanecerem carregando indefinidamente.

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
