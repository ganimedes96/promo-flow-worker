# PromoFlow Worker — Windows

Worker local integrado à API NestJS: conexão por QR Code, sessão em disco, restauração após reinício e sincronização de grupos. A publicação de ofertas não faz parte desta etapa.

## Instalação

Use Node.js 22 ou superior. Na pasta promo-flow-worker:

    npm install
    Copy-Item .env.example .env

Configure API_URL e WORKER_API_TOKEN no .env. O token deve ser igual ao configurado na API e ter pelo menos 32 caracteres. Não compartilhe o token ou a pasta data, que contém a autenticação do WhatsApp.

Se preferir usar o Chrome instalado, configure CHROME_PATH. A instalação normalmente baixa o Chromium pelo Puppeteer.

Na pasta promo-flow-api, configure .env seguindo .env.example e execute:

    npm install --package-lock=false
    npm run prisma:generate
    npm run prisma:deploy
    npm run dev

O banco deve estar disponível. O módulo usa o schema existente, sem nova migration.

Em outro terminal, na pasta promo-flow-worker:

    npm run build
    npm start

## Conectar

Faça login em POST /api/auth/login. Use o JWT retornado em Authorization: Bearer TOKEN nos endpoints:

- POST /api/whatsapp/connect: solicita conexão.
- GET /api/whatsapp/session: consulta estado e QR Code bruto, quando válido.
- GET /api/whatsapp/groups: lista grupos sincronizados.
- POST /api/whatsapp/disconnect: solicita desvinculação do cliente em execução.

O QR Code aparece no terminal. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho. Leia o código e aguarde READY.

O worker consulta a API a cada cinco segundos. Os endpoints /api/internal/whatsapp exigem x-worker-token. Uma API remota deve usar HTTPS.

Ctrl+C fecha o navegador e preserva LocalAuth. Ao iniciar novamente, o worker restaura sessões CONNECTING, WAITING_QR, AUTHENTICATED e READY. Após ERROR, solicite /connect novamente.

## Operação

Use apenas um worker para esta API. O arquivo data/sessions/worker.lock impede duas instâncias usando a mesma pasta. Ao iniciar, locks de PIDs encerrados são recuperados automaticamente. Uma trava do sistema operacional impede duas instâncias durante essa recuperação. Use pnpm start e encerre com Ctrl+C; aguarde a mensagem "Worker encerrado. Sessão preservada e lock liberado." antes de iniciar novamente. O worker conclui a operação atual e fecha o Chrome sem deslogar o WhatsApp.

Mantenha o Windows ligado e sem suspensão. Evite salvar sessões no OneDrive. A biblioteca usa WhatsApp Web e não é uma API oficial.

A próxima etapa é integrar as ofertas à publicação com reserva de jobs no Postgres, intervalo de 2 minutos e confirmação do envio.


## Organização do código

- src/index.ts: composição das dependências e sinais de encerramento.
- src/config: leitura e validação das variáveis de ambiente.
- src/api: cliente HTTP e validação das respostas recebidas.
- src/types: estados, mensagens e contratos do worker.
- src/whatsapp: criação de clientes, eventos de sessão e sincronização de grupos.
- src/runtime: consultas periódicas, início, encerramento e lock de instância.
- src/utils: tratamento de mensagens de erro.

As atualizações de sessão usam uma união discriminada: WAITING_QR exige qrCode, READY exige connectedPhone e ERROR exige errorMessage. A resposta de sessões é validada em tempo de execução antes do processamento.

Para compilar e executar os testes sem conectar ao WhatsApp:

    npm test

Na validação local, whatsapp-web.js 1.34.7 falhou ao executar getChats. O group-reader mantém a chamada padrão e, quando ela falha, consulta apenas IDs e nomes na coleção de chats do WhatsApp Web, validando os dados antes da sincronização. Esse fallback depende de estruturas internas do WhatsApp e deve ser revisto quando a biblioteca corrigir a incompatibilidade.

A lista de grupos também é sincronizada automaticamente a cada 60 segundos enquanto a sessão está pronta, e ao receber eventos group_join ou group_leave. Falhas temporárias são tentadas novamente após 15 segundos, sem executar sincronizações concorrentes. A home consulta a lista salva periodicamente; não é necessário ler outro QR Code para receber grupos novos.

## Publicação de ofertas pelo worker

A publicação real vem desativada por padrão. Para usar, configure ENABLE_PUBLISHING=true no .env do worker e reinicie-o com npm start. Essa opção habilita o consumo de todas as ofertas agendadas e vencidas das sessões conectadas a esse worker; confira seus grupos e ofertas antes de ativar. Com ENABLE_PUBLISHING=false, as sessões e a sincronização dos grupos continuam funcionando.

O worker solicita uma oferta por vez por grupo à API, baixa a imagem e envia imagem com legenda em uma única operação. Os formatos aceitos são PNG, JPEG, WebP e GIF, até 10 MB. O download exige endereço HTTP(S) público com IPv4, valida redirecionamentos e não aceita destinos locais/privados. A legenda usa apenas os dados cadastrados e preserva o link de compra; links longos demais são rejeitados antes do envio.

Os resultados são guardados em data/publication-receipts, ou no PUBLICATION_RECEIPTS_PATH configurado, antes da confirmação com a API. Se a confirmação falhar, o worker repete somente o registro do resultado. Preserve essa pasta entre reinícios. Ela não deve ser publicada nem removida enquanto houver confirmações pendentes.

Falhas ocorridas antes de chamar o WhatsApp são marcadas como FAILED e podem ser reagendadas pelo frontend. Se sendMessage falhar ou encerrar sem identificador, o resultado é considerado incerto: a oferta permanece PUBLISHING com uma observação, bloqueando outros envios para o mesmo grupo até revisão manual. Uma interrupção após a reserva e antes de gravar o recibo também exige revisão. Não há reenvio automático nesses casos, pois o WhatsApp não oferece garantia de envio exatamente uma vez por esta integração.

Ao encerrar o worker, aguarde a conclusão do envio ou confirmação que estiver em andamento. A implementação foi verificada por tipagem; nenhum envio real foi executado nesta etapa.

Compatibilidade do whatsapp-web.js 1.34.7: o pnpm aplica patches/whatsapp-web.js@1.34.7.patch para impedir que o ID interno da mídia sobrescreva o ID da mensagem (upstream #201923). Instale com pnpm install para preservar o patch. Após alterações, reinicie o worker. Resultados UNKNOWN continuam bloqueados para conferência manual; o patch não reenvia ofertas anteriores.

O worker envia heartbeat independente a cada 10 segundos, inclusive durante publicações, com um identificador novo por execução. Ao encerrar, informa STOPPED após concluir as operações e fechar as sessões. Reinicie API e worker juntos após atualizar esta versão, pois a reserva de jobs passou a exigir workerInstanceId e heartbeat. Se o processo cair, a API encaminha tentativas sem confirmação para conferência manual; recibos locais continuam sendo reapresentados sem reenviar mensagens.

Operação contínua local: consulte ../ops/README.md. No modo supervisionado, use ops/stop.ps1 para encerrar o worker e ops/start.ps1 para iniciar. O supervisor recebe confirmação de inicialização e envia shutdown para encerramento gracioso no Windows. Backups completos pausam o worker e o retomam ao concluir.

## Múltiplos números por usuário

O worker agora identifica cada sessão pelo connectionId da API, em vez de userId. A pasta LocalAuth usa authKey; a migration mantém authKey=userId para as conexões antigas, preservando os arquivos já existentes. Novas conexões usam uma chave própria. Não mover nem apagar as pastas de autenticação e recibos durante a atualização.

Atualize a API junto com o worker: pending exige o protocolo connections-v1, sincronização usa /internal/whatsapp/connections/:connectionId e claim usa connectionId. O worker só publica com o cliente da conexão retornada pelo claim e rejeita um resultado com outra conexão.

Pausar envios na interface não encerra o navegador: a API bloqueia novas reservas e preserva a fila. Suspensão por acesso vencido e erros de autenticação encerram o cliente preservando o armazenamento local quando possível. Desconectar pelo painel solicita logout somente da conexão escolhida.

MAX_CONCURRENT_SESSIONS (padrão 5) é o total de conexões simultâneas neste processo. A operação continua local e com uma única instância ativa. Esta alteração não instala wacli.


## Coleta opcional de promoções

`src/collection/collector.client.ts` encaminha mensagens recebidas de grupos habilitados para o coletor compartilhado na pasta irmã `promo-flow-telegram`. Configurar `COLLECTOR_URL=http://127.0.0.1:3344` e `COLLECTOR_LOCAL_TOKEN` igual ao coletor. O destino fica restrito a loopback. Desabilite removendo `COLLECTOR_URL`. Não altera o intervalo de publicação de dois minutos nem cria uma segunda sessão WhatsApp.

Publique primeiro a API com a migration 20261031060000_whatsapp_promotion_collection e o frontend. Execute ambos os processos e ative os grupos em Fontes de promoções → WhatsApp. Apenas contas de administrador podem servir de fonte. Mensagens próprias são ignoradas para evitar ciclos. A ponte é de mensagens novas, com fila em memória limitada e três tentativas; não substitui um histórico persistente. Veja o README do coletor para limites e rotas Fastify.


## Imagens WhatsApp — atualização de captura

O worker tenta baixar novamente a mídia até três vezes (tempo total máximo de 15 segundos), atualizando somente a mensagem que acabou de receber pelo SDK. Trata foto anexada, documento com MIME JPEG/PNG/WebP e prévias de imagem embutidas no próprio conteúdo recebido. Não segue URLs remotas de thumbnails. Prefere o arquivo completo; usa a prévia disponível como alternativa e informa isso no log. Prévia pode ter resolução menor. Falha definitiva preserva o rascunho e exibe aviso sem registrar o texto da mensagem, número ou conteúdo da imagem. O coletor informa se a normalização rejeitou o arquivo. Reinicie worker e coletor para carregar o código novo. Não precisa de migration nem novo login. Capturas antigas sem foto não são preenchidas automaticamente por este ajuste.


## Correção de download WhatsApp: MIME declarado

A validação real em 31/10/2026 identificou InvalidMediaFileType no DownloadManager: whatsapp-web.js 1.34.7 omitia mimetype e fotos não cacheadas eram tratadas como application/octet-stream. O patch pnpm existente agora também passa `mimetype: msg.mimetype`, preservando as correções de identificadores. O arquivo patches/whatsapp-web.js@1.34.7.patch e o pnpm-lock.yaml precisam acompanhar o projeto; uma instalação normal mantém a correção. Regressão executa o método real do SDK em contexto isolado com um gerenciador que rejeita MIME ausente. Três fotos reais foram recuperadas e conferidas pela API, sem publicação. Reinicie o worker para carregar a biblioteca corrigida. Não precisa de migration nem novo QR Code. Referência: https://github.com/wwebjs/whatsapp-web.js/issues/201908

## Recuperacao segura de publicacoes

Antes de chamar o WhatsApp, o worker grava em disco um recibo UNKNOWN com a intencao de envio, com flush e substituicao atomica. Ao obter o resultado, substitui esse recibo por SUCCESS, FAILED ou UNKNOWN. Na inicializacao, apenas repassa os recibos a API; nunca repete o envio para recuperar uma confirmacao perdida. Se nao conseguir persistir a intencao, nao envia a mensagem.

O envio tem limite de 90 segundos para confirmar o resultado. Um timeout nao comprova falha: a tentativa fica sem confirmacao, bloqueia esse grupo na API e exige conferir a conversa antes de qualquer reenvio. Ctrl+C impede novas reservas e conclui a tentativa atual antes de fechar as sessoes. Nenhum mecanismo garante entrega exatamente uma vez pelo WhatsApp Web; resultados ambiguos nunca sao reenviados automaticamente.

Validacao sem WhatsApp: pnpm build e node --test test/publication-recovery.test.cjs. Os testes usam clientes simulados e diretorios temporarios, sem rede externa. Mantenha data/receipts entre reinicios. Nao remova recibos para liberar a fila.

## Logs de operacao

As falhas de consulta e heartbeat usam eventos JSON com time, event, errorType, statusCode e requestId quando a API fornece uma referencia. O resultado de publicacao registra attemptId, offerId e outcome, sem texto, imagem ou telefone. Procure a referencia no log da API da Vercel para correlacionar a falha. Nao compartilhe o token nem os arquivos de autenticacao.

A pagina Operacao e exclusiva do administrador e mostra o ultimo contato e se a publicacao esta habilitada. Reinicie o worker com o codigo atualizado apos publicar a API e o frontend. Os indicadores de comunicacao nao substituem a conferencia de mensagens sem confirmacao.

## Personalizacao das mensagens

O job recebido inclui messageTemplate e messageHeadline. O worker aplica apenas os campos selecionados; cupons e descontos ausentes sao omitidos. Uma frase individual substitui a chamada padrao. Descricao e limitada a 300 caracteres, chamada a 80, rodape a 200 e legenda/texto a 1000. Opcoes invalidas, texto vazio sem imagem e mensagem acima do limite falham antes de enviar.

Com showImage=false, nao baixa a imagem e envia texto com linkPreview=false. Sem configuracao no job, mantem o formato anterior. A reserva anuncia x-worker-features: message-template-v1. Publique a API com a migracao de templates e reinicie o worker atualizado; a API recusa workers antigos para evitar mensagens fora do padrao escolhido.

Testes sem WhatsApp real: pnpm build e node --test test/message-template.test.cjs. As verificacoes usam somente clientes simulados.

## Monitoramento de grupos
Atualize a API e aplique `20261101050000_group_growth`, depois reinicie o worker. A sincronização inclui contagem de participantes quando disponível. Entradas/saídas recebidas pelo SDK são persistidas em `data/sessions/group-activity` (ou SESSION_PATH configurado), reenviadas após falhas e deduplicadas na API. Não exclua esse diretório durante reinícios. Pendências expiram após 72 horas. O histórico começa na ativação; períodos offline podem não ser recuperados. Não armazenamos IDs de participantes.
