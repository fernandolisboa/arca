/**
 * The recognition tracks' wording (ADR-0040), apart from the main catalog: it carries the deadlines,
 * thresholds and exam rules the reviewed file's sources back, so a change here goes to the same
 * reviewers and needs a new numbered tracks file (`wordingSha256`).
 */
export const recognition = {
  title: 'Revalidação profissional',
  lead: 'O caminho para exercer sua profissão em outro país, etapa por etapa, com a página oficial de cada uma. Abra a fonte antes de agir: prazos, taxas e provas mudam.',
  signIn: 'Entre para ver o caminho da revalidação em cada país.',
  loading: 'Carregando os caminhos…',
  failed: 'Não deu para carregar os caminhos agora. Tente de novo em instantes.',
  retry: 'Tentar de novo',
  empty: 'Ainda não há caminho de revalidação para nenhuma profissão.',
  holders: 'Na família: {names}',
  noHolders:
    'Ninguém da família tem esta profissão nas respostas. Responda nas perguntas guiadas sobre trabalho, oferta de emprego, registro profissional ou formação, e o Arca mostra aqui para quem é.',
  step: 'Etapa {number}',
  source: 'Fonte: {host} · conferida em {date}',
  track: {
    physician: 'Medicina',
  },
  item: {
    'es-language': {
      title: 'Espanhol nível B2',
      body: 'A Espanha pede espanhol B2 para homologar o diploma. Ficam de fora quem tem nacionalidade de um país de língua espanhola e quem cursou em espanhol pelo menos 75% da carga horária do curso, ou a formação anterior a ele. Fora esses casos, é preciso o certificado.',
    },
    'es-documents': {
      title: 'Diploma e histórico traduzidos e apostilados',
      body: 'Diploma e histórico com tradução oficial para o espanhol, legalizados e apostilados. O histórico mostra a duração oficial do curso e a carga horária de cada disciplina. Se mais de 15% dos créditos foram aproveitados de outra faculdade, junte o certificado dela. Inclua a prova de que você pode exercer no país do diploma (no Brasil, o registro no CRM).',
    },
    'es-homologation': {
      title: 'Pedir a homologação ao Ministério',
      body: 'O pedido é feito só no portal eletrônico do Ministério de Ciência, Inovação e Universidades, com a taxa paga online ou pelo modelo 790-107. A ANECA confere o curso por critérios como 5 anos de estudo e 1.350 horas de prática. A lei dá 6 meses para a decisão; sem resposta nesse prazo, o pedido pode ser considerado negado.',
    },
    'es-complementary-training': {
      title: 'Se a homologação vier com condição',
      body: 'O Ministério pode aprovar com a condição de você completar uma formação extra numa universidade espanhola à sua escolha: estágio, prova de aptidão, trabalho ou disciplinas. São 4 anos, contados da notificação, para cumprir. Depois disso, a homologação perde efeito e o mesmo diploma não pode ser homologado de novo.',
    },
    'es-college': {
      title: 'Inscrever-se no Colegio de Médicos',
      body: 'A lei espanhola mantém a inscrição obrigatória nos colégios profissionais que já existia, até outra lei listar as profissões. Antes de começar a atender, confirme no Colegio Oficial de Médicos de onde vai trabalhar o que ele pede. A taxa de inscrição não pode passar do custo do trâmite.',
    },
    'es-public-system': {
      title: 'Rede pública ou especialidade: MIR',
      body: 'Só com a homologação, você trabalha como médico de formação básica no setor privado. Para a rede pública ou para exercer uma especialidade, é preciso fazer o MIR (a residência médica espanhola) ou pedir ao Ministério da Saúde o reconhecimento de uma especialidade que você já tenha.',
    },
    'es-specialty-exam': {
      title: 'Prova do MIR',
      body: 'Para começar a residência em 2027, as inscrições foram de 1 a 14 de setembro de 2026 e a prova é em 23 de janeiro de 2027. Exige o diploma já homologado e espanhol C1, salvo para quem cursou a faculdade em espanhol num país de língua espanhola ou fez 2 anos de residência na Espanha. Quem não é da UE, não é familiar de cidadão da UE e não tem residência legal na Espanha só se inscreve se o país de origem tiver convênio de cooperação com a Espanha em vigor ou se estiver na Espanha com autorização legal de estadia. Quem não tem autorização de residência na Espanha disputa no máximo 968 das 9.676 vagas de Medicina.',
    },
    'pt-recognition-request': {
      title: 'Pedir o reconhecimento específico',
      body: 'Uma escola médica pública confere se o diploma equivale ao mestrado integrado em Medicina. O pedido é feito no formulário do Instituto para o Ensino Superior, com diploma, histórico com disciplinas e conteúdos, duração do curso, nota final e o trabalho de conclusão. Documentos de fora da UE precisam de apostila; em português, inglês, espanhol ou francês, não precisam de tradução. A taxa é a da escola escolhida. Quem é de país de língua oficial portuguesa não precisa de certificado de português.',
    },
    'pt-recognition-deadline': {
      title: 'Pedido completo até 1º de setembro',
      body: 'O exame acontece uma vez por ano, e só entra nele quem enviou o pedido até 1º de setembro, com documentos e taxa em dia. Pedido que chega depois ou incompleto fica para o ano seguinte.',
    },
    'pt-recognition-exam': {
      title: 'Exame em três partes',
      body: 'Prova escrita de 120 questões de múltipla escolha, na segunda quinzena de novembro; prova prática com um paciente, de preferência em março ou abril; e um trabalho final (dissertação ou monografia), entregue até 6 meses depois da prática e defendido oralmente. Cada parte pode ser feita no máximo duas vezes, e a aprovação vale no ano e nos dois seguintes. As datas exatas saem entre maio e junho no site de cada escola.',
    },
    'pt-board-registration': {
      title: 'Inscrever-se na Ordem dos Médicos',
      body: 'Só exerce medicina em Portugal quem está inscrito na Ordem. De quem não é da UE, ela pede o certificado de reconhecimento, a certidão de antecedentes criminais e a certidão de boa conduta do conselho onde você tem registro (no Brasil, o CRM), as duas emitidas há menos de 3 meses, além de currículo e NIF. Quem estudou numa faculdade com ensino em português não faz a prova de comunicação médica.',
    },
    'pt-supervised-practice': {
      title: 'Começo com supervisão',
      body: 'Logo depois da inscrição, você atende sem autonomia: sempre com um médico habilitado ao lado, que supervisiona e responde pelos atos. A autonomia vem com o ano de formação geral do internato ou quando a Ordem reconhece sua experiência, depois do parecer de um júri.',
    },
    'pt-specialty': {
      title: 'Especialidade: Internato Médico',
      body: 'A ACSS abre um único concurso por ano para o Internato Médico, para a formação geral e para a formação na especialidade.',
    },
    'us-school-listed': {
      title: 'Faculdade no World Directory',
      body: 'Para fazer o USMLE, a faculdade precisa constar no World Directory of Medical Schools como apta pelos critérios da ECFMG. Confira a sua antes de começar a estudar para as provas.',
    },
    'us-step-1-2': {
      title: 'USMLE Step 1 e Step 2 CK',
      body: 'As duas provas vêm primeiro. Quatro tentativas sem aprovação numa mesma etapa tiram você do USMLE, e cada etapa só pode ser feita três vezes em 12 meses. Muitos estados exigem terminar todas as etapas dentro de um prazo.',
    },
    'us-ecfmg-certificate': {
      title: 'Certificado da ECFMG',
      body: 'Com o Step 1 e o Step 2 CK aprovados, peça a certificação da ECFMG, que tem outros requisitos listados no site dela. O certificado válido é exigido para o Step 3, e é a ECFMG que patrocina o visto J-1 de residência médica.',
    },
    'us-residency-visa': {
      title: 'Residência e visto J-1',
      body: 'A residência médica é feita num programa de graduate medical education. No J-1, a ECFMG é a única patrocinadora e emite o DS-2019. É preciso uma declaração do governo do país da sua nacionalidade ou da sua última residência permanente (para quem vem do Brasil, o governo brasileiro) de que o país precisa da sua especialidade e o compromisso de voltar ao fim do treinamento. Cônjuge e filhos menores solteiros podem ir com J-2.',
    },
    'us-step-3-license': {
      title: 'Step 3 e licença do estado',
      body: 'O Step 3 é a última prova do USMLE, a que leva à licença para atender sem supervisão. O USMLE recomenda fazê-lo perto do fim do primeiro ano de residência. A licença é dada pelo conselho de cada estado, com regras próprias.',
    },
  },
};
