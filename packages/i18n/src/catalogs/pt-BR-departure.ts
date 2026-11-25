/**
 * The departure checklists' wording (ADR-0038), apart from the main catalog: it carries the deadlines
 * and thresholds the reviewed file's sources back, so a change here goes to the same reviewers and
 * needs a new numbered checklist file (`wordingSha256`).
 */
export const departure = {
  title: 'Saída do país',
  lead: 'O que resolver ao deixar o país e os papéis que mostram de onde veio o dinheiro. Cada item cita a página oficial: abra a fonte antes de agir, porque prazos e regras mudam. Planejamento de impostos fica de fora.',
  signIn: 'Entre para ver o que resolver antes de sair do país.',
  loading: 'Carregando a lista…',
  failed: 'Não deu para carregar a lista agora. Tente de novo em instantes.',
  retry: 'Tentar de novo',
  empty: 'Ainda não há lista de saída para nenhum país.',
  source: 'Fonte: {host} · conferida em {date}',
  section: {
    tax: 'Receita Federal',
    money: 'Bancos e bens no exterior',
    'social-security': 'Previdência',
    family: 'Documentos da família',
    'source-of-funds': 'Origem do dinheiro da venda do imóvel',
  },
  item: {
    'exit-notice': {
      title: 'Comunicar a saída definitiva à Receita',
      body: 'Faça a Comunicação de Saída Definitiva do País a partir do dia em que sair e até o último dia de fevereiro do ano seguinte. Sem ela, a Receita passa a tratar você como não residente só depois de 12 meses seguidos fora.',
    },
    'exit-return': {
      title: 'Entregar a Declaração de Saída Definitiva',
      body: 'No ano seguinte à mudança, no mesmo prazo do imposto de renda anual. Ela cobre o que você ganhou e tinha de 1º de janeiro até o dia da saída. O imposto que der vai em cota única até esse prazo, e declarações de anos anteriores que faltarem continuam devidas.',
    },
    'paying-sources': {
      title: 'Avisar quem paga você no Brasil',
      body: 'Informe a empregador, bancos, corretoras, inquilinos e qualquer outra fonte pagadora que você virou não residente, com a data da saída. É isso que faz o imposto ser retido do jeito certo.',
    },
    mei: {
      title: 'Encerrar o MEI, se tiver um',
      body: 'Quem passa a ser não residente não pode continuar como MEI: o regime é só para quem mora no Brasil.',
    },
    'cpf-address': {
      title: 'Pôr o endereço novo no CPF',
      body: 'Com o endereço no exterior em mãos, atualize o CPF. Endereço e contato mudam direto na Receita, mesmo para quem já tem a Carteira de Identidade Nacional.',
    },
    'tax-proxy': {
      title: 'Dar procuração no e-CAC',
      body: 'Com a conta gov.br prata ou ouro, você passa uma procuração eletrônica para outra pessoa usar os serviços digitais da Receita em seu nome. Sai na hora, sem abrir processo.',
    },
    'bank-accounts': {
      title: 'Contar aos bancos que mudou de país',
      body: 'Bancos e corretoras precisam saber que você virou não residente. Contas em reais de quem mora fora seguem regras próprias do Banco Central.',
    },
    'foreign-assets': {
      title: 'Declarar bens no exterior ao Banco Central',
      body: 'Vale enquanto você for residente no Brasil. Se em 31 de dezembro tiver US$ 1 milhão ou mais em bens e valores fora do país, entregue a declaração de Capitais Brasileiros no Exterior entre 15 de fevereiro e 5 de abril do ano seguinte.',
    },
    'social-security-agreement': {
      title: 'Ver se o destino tem acordo de previdência',
      body: 'O Brasil tem acordo com Portugal, Espanha, Estados Unidos, Itália, Japão e outros países. O acordo soma o tempo de contribuição nos dois países, e os benefícios cobertos mudam de um acordo para outro. Morando fora, o pedido é feito no órgão do país onde você mora.',
    },
    passports: {
      title: 'Passaporte para cada pessoa',
      body: 'Peça na Polícia Federal o passaporte de quem vai se mudar: é o documento que identifica o brasileiro em outro país. Para tirá-lo, a situação eleitoral precisa estar em dia.',
    },
    'minors-travel': {
      title: 'Autorização de viagem das crianças',
      body: 'Viajando com pai e mãe juntos, crianças e adolescentes não precisam de autorização. Se só um dos dois for com eles, precisa de autorização escrita do outro, com firma reconhecida. Ela pode ficar registrada no passaporte, se pedida na emissão.',
    },
    'voter-registration': {
      title: 'Levar o título de eleitor para o exterior',
      body: 'Morando fora, quem tem de 18 a 70 anos continua obrigado a votar, mas só para presidente, na embaixada ou no consulado. A transferência é feita online, pelo Título Net Exterior, e o cadastro fecha 150 dias antes do primeiro turno.',
    },
    'funds-why': {
      title: 'Por que guardar essa trilha',
      body: 'No EB-5, dos Estados Unidos, o investidor prova que o dinheiro é dele, que veio de fonte lícita e o caminho que fez até o investimento. Os papéis abaixo montam esse caminho para a venda de um imóvel no Brasil. Guarde cada um no Cofre.',
    },
    'sale-deed': {
      title: 'Escritura pública da venda',
      body: 'A venda de imóvel acima de 30 salários mínimos exige escritura pública, lavrada em cartório de notas. Guarde uma cópia.',
    },
    'property-registry': {
      title: 'Matrícula com a venda registrada',
      body: 'O imóvel só passa para o comprador quando a escritura é registrada no Registro de Imóveis. A certidão da matrícula com esse registro mostra que a venda se completou.',
    },
    'capital-gain': {
      title: 'Ganho de capital e o DARF pago',
      body: 'O programa GCAP, da Receita, calcula o imposto sobre o ganho na venda e gera o DARF. Guarde o demonstrativo e o comprovante de pagamento. No ano seguinte, os dados entram na declaração de imposto de renda.',
    },
    'tax-returns': {
      title: 'Declarações de imposto de renda dos últimos 7 anos',
      body: 'O EB-5 pede as declarações dos últimos 7 anos (pedidos feitos desde 14 de maio de 2022). Baixe as cópias em PDF no serviço da Receita, com a conta gov.br prata ou ouro.',
    },
    'bank-trail': {
      title: 'Extratos que ligam a venda ao destino',
      body: 'Guarde os extratos que mostram o dinheiro do comprador entrando na sua conta e cada transferência depois dele, até onde o dinheiro chegar.',
    },
    'exchange-records': {
      title: 'Comprovante de cada remessa ao exterior',
      body: 'Toda operação de câmbio passa por uma instituição autorizada pelo Banco Central. Guarde o comprovante de cada remessa: é mais um elo do caminho do dinheiro.',
    },
  },
} as const;
