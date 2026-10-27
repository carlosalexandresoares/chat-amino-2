# Distribuição dos aplicativos

Quando uma mudança afetar a interface ou uma função usada pelos aplicativos, entregue também versões novas para Android e Windows. Atualize os números de versão, gere `npm --prefix mobile run sync`, o APK Android e o instalador Windows, confira a assinatura e os hashes, publique os dois arquivos na mesma versão do GitHub e atualize os manifestos e links de download do servidor. Verifique que os links publicados funcionam antes de anunciar a atualização. Se a publicação ou compilação falhar, informe claramente quais plataformas ainda não receberam a versão.
