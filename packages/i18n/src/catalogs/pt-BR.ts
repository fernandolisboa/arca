/**
 * The pt-BR catalog, in ICU message format. Domain terms use the labels in CONTEXT.md.
 */
export const ptBR = {
  app: {
    name: 'Arca',
    description: 'Assessoria de imigração para a sua família, do planejamento até a chegada.',
  },
  shell: {
    skipToContent: 'Pular para o conteúdo',
    navigation: 'Navegação principal',
    openMenu: 'Abrir menu',
    closeMenu: 'Fechar menu',
    navigationGroup: 'Navegar',
    accountGroup: 'Sua conta',
    nav: {
      home: 'Início',
      family: 'Família',
      vault: 'Cofre',
      compare: 'Comparar',
      knowledge: 'Regras',
      settings: 'Configurações',
    },
  },
  /** The Settings page (spec 0006, R9). Option labels follow the axis identifiers. */
  settings: {
    title: 'Configurações',
    /** The page's categories, in its side menu on wide screens and on top on phones. */
    sections: {
      label: 'Categorias',
      appearance: 'Aparência',
      navigation: 'Navegação',
      accessibility: 'Acessibilidade',
      account: 'Conta',
      knowledge: 'Base de conhecimento',
      help: 'Ajuda',
      signIn:
        'Entre na sua conta para ver os avisos de segurança, baixar seus dados ou excluir a conta.',
      loadFailure: 'Não deu para carregar sua conta agora.',
      retry: 'Tentar de novo',
    },
    /** The account's notification channels (spec 0005, R7). */
    notifications: {
      title: 'Avisos de segurança',
      intro:
        'O Arca avisa quando algo muda na segurança da sua conta, como uma entrada nova ou uma chave de acesso removida. Os avisos sempre chegam por email e também podem aparecer nos seus dispositivos.',
      email: 'Email da conta',
      emailNote: 'Sempre ligado. Os avisos de segurança não podem ser desligados.',
      device: '{browser} · {os}',
      thisDevice: 'Este dispositivo',
      lastSuccess: 'Último aviso entregue em {date}',
      noneYet: 'Nenhum aviso entregue ainda',
      enable: 'Receber avisos neste dispositivo',
      remove: 'Parar os avisos',
      enabling: 'Permita as notificações na janela do navegador.',
      waiting: 'Confirme no seu dispositivo para continuar.',
      done: '{done, select, enabled {Pronto. Os avisos vão aparecer neste dispositivo.} removed {Pronto. Esse dispositivo não recebe mais avisos.} other {}}',
      unavailable:
        '{reason, select, install {Para receber avisos aqui, adicione o Arca à tela de início e abra o app por lá.} unsupported {Este navegador não mostra avisos do Arca. Eles continuam chegando por email.} not_set_up {Os avisos nos dispositivos ainda não estão disponíveis. Por enquanto, eles chegam por email.} denied {As notificações do Arca estão bloqueadas neste navegador. Para receber avisos aqui, libere as notificações do site nas configurações do navegador.} other {}}',
      failure:
        '{reason, select, denied {As notificações não foram liberadas, então este dispositivo não vai receber avisos.} cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} too_many {Sua conta já recebe avisos em {max} dispositivos. Pare os avisos em um deles antes de ligar outro.} not_found {Isso não está mais na sua lista. Atualize a página.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
      listFailure: 'Não conseguimos carregar a lista agora. Tente de novo em instantes.',
    },
    dataExport: {
      title: 'Seus dados',
      intro:
        'A exportação dos dados gera um arquivo com tudo o que o Arca guarda sobre a sua conta.',
      start: 'Baixar meus dados',
      confirmLead:
        'O arquivo traz seu email, suas chaves de acesso, seus dispositivos e o histórico de segurança da conta. Guarde em um lugar seguro e não mande para ninguém. Para baixar, confirme com sua chave de acesso.',
      confirm: 'Confirmar e baixar',
      cancel: 'Agora não',
      waiting: 'Confirme no seu dispositivo para continuar.',
      done: 'Pronto. O arquivo está nos seus downloads.',
      failure:
        '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
      fileName: 'arca-meus-dados-{date}.json',
    },
    accountDeletion: {
      title: 'Excluir conta',
      intro:
        'A conta e os dados dela são apagados 7 dias depois do pedido. Nesse meio-tempo, dá para cancelar.',
      start: 'Excluir minha conta',
      confirmLead:
        'Todos os dispositivos serão desconectados agora. Passados 7 dias, a conta e os dados dela serão apagados de vez, sem volta. Se quiser guardar uma cópia, baixe seus dados antes. Para continuar, confirme com sua chave de acesso.',
      keptPeople:
        'Os dados de {names} também serão apagados do caso, porque quem cuida deles é você. Para que outra pessoa da família continue cuidando desses dados, passe os cuidados para ela antes de excluir a conta.',
      keptPeopleUnknown:
        'Não conseguimos ver agora de quem você cuida no caso. As pessoas de quem você cuida são apagadas junto com a conta, então confira na área da família antes de excluir.',
      handOver: 'Abrir a área da família',
      confirm: 'Confirmar exclusão',
      cancel: 'Agora não',
      waiting: 'Confirme no seu dispositivo para continuar.',
      done: 'Pedido recebido. A conta será apagada a partir de {dueAt}. Até lá, é só entrar de novo para cancelar.',
      failure:
        '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} tooLate {O prazo para cancelar acabou, e a conta já está sendo apagada.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    /** Replaying the guided tour (#123). */
    help: {
      intro:
        'O tour mostra onde fica cada coisa. As dicas aparecem na primeira vez que você abre uma tela.',
      replayTour: 'Ver o tour de novo',
      replayHints: 'Mostrar as dicas de novo',
      unavailable:
        'O tour aparece para quem entrou em uma conta confirmada e sem aviso de segurança pendente.',
      hintsBack: 'Pronto. Cada dica volta a aparecer quando você abrir a tela dela.',
    },
    appearance: {
      title: 'Aparência',
      intro: 'As mudanças valem na hora e ficam salvas neste aparelho.',
      useDefault: 'Padrão ({value})',
      clearSection: 'Voltar estas opções ao padrão',
      cleared: 'Estas opções voltaram ao padrão.',
      theme: {
        legend: 'Cores',
        paper: 'Papel',
        notebook: 'Caderno',
        serene: 'Sereno',
        panel: 'Painel',
      },
      mode: {
        legend: 'Claro ou escuro',
        dark: 'Escuro',
        light: 'Claro',
        system: 'Igual ao aparelho',
      },
      font: {
        legend: 'Fontes',
        sample: 'Aa',
        retro: 'Retrô',
        expressive: 'Expressiva',
        editorial: 'Editorial',
        elegant: 'Elegante',
        geometric: 'Geométrica',
        friendly: 'Amigável',
        readable: 'Leitura fácil',
        dyslexic: 'OpenDyslexic',
        clean: 'Limpa',
        technical: 'Técnica',
      },
      corners: {
        legend: 'Cantos',
        square: 'Retos',
        soft: 'Suaves',
        round: 'Arredondados',
      },
      navNarrow: {
        legend: 'Navegação no celular',
        menu: 'Menu',
        'fixed-dock': 'Barra fixa embaixo',
        'floating-dock': 'Barra flutuante',
      },
      navWide: {
        legend: 'Navegação em telas grandes',
        menu: 'Menu',
        top: 'Barra no topo',
        side: 'Coluna lateral',
        'floating-dock': 'Barra flutuante',
      },
      dockEdge: {
        legend: 'Lado da barra flutuante',
        description: 'Também dá para arrastar a barra pela alça.',
        bottom: 'Embaixo',
        left: 'Esquerda',
        right: 'Direita',
      },
      textSize: {
        legend: 'Tamanho do texto',
        '75': '75%',
        '90': '90%',
        '100': '100%',
        '112': '112%',
        '125': '125%',
        '150': '150%',
      },
      contrast: {
        legend: 'Contraste',
        standard: 'Normal',
        high: 'Alto',
      },
      motion: {
        legend: 'Animações',
        on: 'Ligadas',
        off: 'Desligadas',
        reduced: 'Seu aparelho está com movimento reduzido, então as animações ficam desligadas.',
      },
    },
  },
  /** The guided tour (#123): `tour.<tour>.<step>` follows the ids in the app's tour list. */
  tour: {
    step: '{current} de {total}',
    skip: 'Pular',
    back: 'Voltar',
    next: 'Próximo',
    done: 'Concluir',
    gotIt: 'Entendi',
    app: {
      home: {
        title: 'Comece pelo Início',
        body: 'Aqui aparece o próximo passo da sua família e o que já ficou pronto.',
      },
      family: {
        title: 'Quem vai com você',
        body: 'Em Família você coloca quem vai junto e responde às perguntas que o Arca usa para avaliar as rotas.',
      },
      compare: {
        title: 'Para onde ir',
        body: 'Em Comparar você dá peso ao que importa para você e vê os países em ordem.',
      },
      vault: {
        title: 'Documentos trancados',
        body: 'O Cofre guarda os seus documentos com uma chave que só existe nos seus dispositivos.',
      },
      settings: {
        title: 'Do seu jeito',
        body: 'Em Configurações você muda as cores, a letra e o menu. Para ver este tour de novo, é lá também, em Ajuda.',
      },
    },
    family: {
      screen: {
        title: 'Comece por aqui',
        body: 'Coloque quem vai com você. Depois responda às perguntas, e o Arca mostra as rotas que servem para a família.',
      },
    },
    compare: {
      screen: {
        title: 'Monte a sua ordem',
        body: 'Ajuste os pesos do que importa para você. A ordem dos países muda junto.',
      },
    },
    vault: {
      screen: {
        title: 'Guarde os documentos aqui',
        body: 'Crie o cofre uma vez e abra com a sua chave de acesso. Depois é só adicionar os documentos.',
      },
    },
    knowledge: {
      screen: {
        title: 'Revise nesta ordem',
        body: 'As regras propostas vêm separadas por país. Comece pelas que diferem das fontes. As que a IA conferiu inteiras dá para ativar de uma vez.',
      },
    },
  },
  notFound: {
    title: 'Página não encontrada',
    home: 'Voltar ao início',
  },
  failure: {
    title: 'Algo deu errado. Recarregue a página para tentar de novo.',
  },
  health: {
    title: 'Status do serviço',
    checking: 'Verificando…',
    status:
      '{status, select, ok {Tudo funcionando} degraded {Funcionando com limitações} other {Status desconhecido}}',
    unreachable: 'Não conseguimos falar com o serviço agora. Tente de novo em instantes.',
    retry: 'Tentar de novo',
  },
  /** Passkey sign-in (spec 0003, R3). Arca has no passwords; accounts come only from invites. */
  signIn: {
    title: 'Entrar',
    lead: 'Use a chave de acesso salva no seu celular ou computador. Não tem senha para lembrar.',
    account: 'Conta',
    accountHint: 'Toque ou clique no campo para ver as chaves de acesso salvas neste dispositivo.',
    button: 'Entrar com chave de acesso',
    waiting: 'Confirme no seu dispositivo para continuar.',
    failure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} refused {Essa chave de acesso não abriu nenhuma conta. Se você criou essa chave há menos de {hours} horas, espere ela passar a valer, ou tente com outra.} limited {Muitas tentativas de entrar por esta conexão. Espere um pouco e tente de novo.} unavailable {Este navegador não aceita chaves de acesso. Abra o Arca em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    inviteOnly: 'Ainda não tem conta? O Arca funciona só por convite. Peça um a quem já usa.',
    closed: 'Por enquanto, o Arca não aceita contas novas nem recuperação de conta.',
    lostAccess: 'Perdeu todas as suas chaves de acesso?',
    recover: 'Recuperar a conta',
  },
  session: {
    signedIn: 'Você entrou como {email}.',
    signIn: 'Entrar',
    kitPending:
      'Falta guardar o seu kit de recuperação. Sem ele, perder todas as chaves de acesso deixa você fora da conta.',
    kitLink: 'Guardar o kit agora',
    unconfirmed:
      'Sua conta está aguardando a confirmação de quem convidou você. Até lá, você não consegue convidar ninguém nem enviar documentos.',
    devices: 'Dispositivos',
    pendingPasskey:
      'Uma chave de acesso nova foi criada na sua conta. Ela passa a valer em {activeFrom}. Se não foi você, cancele agora.',
    pendingLink: 'Ver a chave nova',
    deletionPending:
      'Sua conta será apagada a partir de {dueAt}. Enquanto isso, só dá para cancelar a exclusão.',
    deletionCancel: 'Cancelar a exclusão',
    recoveryPending:
      'Alguém pediu a recuperação da sua conta e criou uma chave de acesso nova. Quando ela passar a valer, este dispositivo é desconectado. Até lá, você só pode ver este aviso e cancelar a recuperação. Se não foi você, cancele agora.',
    recoveryLink: 'Cancelar a recuperação',
  },
  home: {
    greeting: '{part, select, morning {Bom dia.} afternoon {Boa tarde.} other {Boa noite.}}',
    greetingNamed:
      '{part, select, morning {Bom dia, {name}.} afternoon {Boa tarde, {name}.} other {Boa noite, {name}.}}',
    lead: {
      family: 'Comece contando quem vai com você.',
      questions: 'Responda às perguntas para ver as rotas que servem para a sua família.',
      routes: 'As rotas da sua família já podem ser vistas.',
    },
    nextStep: 'Próximo passo',
    next: {
      family: {
        title: 'Começar o caso',
        body: 'Coloque as pessoas da família. Cada uma decide depois quem vê os dados dela.',
        action: 'Começar',
      },
      questions: {
        title: 'Responder às perguntas guiadas',
        body: '{left, plural, =0 {Com as respostas, o Arca compara os destinos e mostra as rotas que servem para vocês.} one {Falta # pergunta. Com as respostas, o Arca compara os destinos e mostra as rotas que servem para vocês.} other {Faltam # perguntas. Com as respostas, o Arca compara os destinos e mostra as rotas que servem para vocês.}}',
        action: 'Continuar',
      },
      routes: {
        title: 'Ver as rotas que servem',
        body: 'As perguntas estão respondidas. Veja quais rotas servem para cada pessoa e o que falta em cada uma.',
        action: 'Ver as rotas',
      },
    },
    stages: {
      label: 'Etapas do caso',
      family: 'Contar sobre a família',
      questions: 'Perguntas guiadas',
      routes: 'Ver as rotas que servem',
      progress: '{answered} de {total}',
      done: '(feita)',
    },
    shortcuts: 'Atalhos',
    vault: {
      title: 'Cofre',
      body: 'Os documentos da família, protegidos no seu dispositivo antes do envio.',
      open: 'Abrir o cofre',
    },
    family: {
      title: 'Família',
      people: '{count, plural, one {pessoa no caso} other {pessoas no caso}}',
      accounts:
        '{count, plural, =0 {Ninguém mais tem conta ainda.} one {Mais 1 pessoa já tem conta.} other {Mais # pessoas já têm conta.}} Convide quem vai junto para cada um cuidar dos próprios dados.',
      empty: 'O caso ainda não começou.',
      invite: 'Convidar alguém',
    },
    rules: {
      title: 'Regras',
      pending: '{count, plural, one {versão proposta} other {versões propostas}}',
      body: 'Nenhuma regra muda sem a sua aprovação.',
      open: 'Revisar',
    },
    signedOut: 'Entre com a sua chave de acesso para continuar.',
  },
  /** Creating the first account (spec 0003, R2): the owner's link request, then the passkey. */
  enroll: {
    request: {
      title: 'Criar a primeira conta',
      lead: 'Esta página é para quem instalou o Arca. Digite o código de cadastro que você gerou e o seu email. Vamos mandar um link para você criar a sua chave de acesso.',
      code: 'Código de cadastro',
      email: 'Email',
      submit: 'Enviar o link',
      sending: 'Enviando…',
      sent: 'Pronto. Abra o email que mandamos e siga o link. Ele vale por 30 minutos.',
      failure:
        '{reason, select, not_found {Esse código não serve. Ou ele está errado, ou o Arca já tem uma conta.} email_unavailable {O Arca ainda não consegue mandar emails. Tente de novo mais tarde.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    register: {
      title: 'Criar sua chave de acesso',
      lead: 'Digite de novo o código de cadastro. Depois, o seu celular ou computador vai pedir para salvar uma chave de acesso para o Arca.',
      code: 'Código de cadastro',
      submit: 'Criar chave de acesso',
      waiting: 'Confirme no seu dispositivo para continuar.',
      failure:
        '{reason, select, expired {Este link não vale mais. Peça um novo.} invalid_code {Esse código não confere. Confira e tente de novo.} cancelled {Não deu para criar a chave de acesso. Tente de novo quando quiser.} refused {Não deu para criar a conta com esta chave de acesso. Se a conta já existe, entre com a sua chave.} unavailable {Este navegador não aceita chaves de acesso. Abra o link em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
      newLink: 'Pedir um novo link',
      signIn: 'Entrar',
    },
  },
  /** Accepting an invite (spec 0003, R2): who sent it, then the passkey. */
  acceptInvite: {
    title: 'Aceitar o convite',
    from: '{email} convidou você para usar o Arca.',
    lead: 'Para entrar, o seu celular ou computador vai salvar uma chave de acesso para o Arca. Não precisa de senha.',
    checking: 'Conferindo o convite…',
    submit: 'Criar chave de acesso',
    waiting: 'Confirme no seu dispositivo para continuar.',
    failure:
      '{reason, select, expired {Este convite não vale mais. Peça um novo a quem convidou você.} cancelled {Não deu para criar a chave de acesso. Tente de novo quando quiser.} refused {Não deu para criar a conta com esta chave de acesso. Se você já tem conta, entre com a sua chave.} unavailable {Este navegador não aceita chaves de acesso. Abra o link em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    noLink: 'Abra o link do email de convite para criar sua conta.',
    checkFailure:
      '{reason, select, limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não conseguimos conferir o convite agora. Tente de novo.}}',
    retry: 'Tentar de novo',
    signIn: 'Entrar',
  },
  /** A link that creates an account, opened in a browser already signed in (spec 0003, R2). */
  linkSession: {
    signedIn:
      'Este navegador já entrou no Arca como {email}. Este link cria outra conta, então saia desta conta primeiro.',
    signOut: 'Sair desta conta',
    signingOut: 'Saindo…',
    failure: 'Não deu para sair agora. Tente de novo.',
  },
  /** Sending invites and deciding on the accounts that accepted them (spec 0003, R2). */
  invites: {
    title: 'Convites',
    lead: 'Convide quem vai planejar a mudança com você. O convite vale por {hours} horas. Quando a pessoa aceitar, você confirma a conta dela aqui.',
    email: 'Email de quem você quer convidar',
    submit: 'Enviar convite',
    sending: 'Enviando…',
    sent: 'Convite enviado para {email}.',
    sendFailure:
      '{reason, select, account_unconfirmed {Sua conta está aguardando a confirmação de quem convidou você, então você não pode convidar ninguém por enquanto.} too_many_invites {Você já tem {max} convites abertos. Espere alguém aceitar ou um convite vencer.} email_unavailable {O Arca ainda não consegue mandar emails. Tente de novo mais tarde.} limited {Você mandou muitos convites hoje. Tente de novo amanhã.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    listTitle: 'Seus convites',
    empty: 'Você ainda não mandou nenhum convite.',
    listFailure: 'Não conseguimos carregar seus convites agora.',
    retry: 'Tentar de novo',
    status:
      '{status, select, open {Esperando a pessoa aceitar, até {expires}} accepted {Aceito. Falta você confirmar} confirmed {Confirmado} other {}}',
    reviewTitle: 'Confirme a conta de {email}',
    reviewLead:
      'Confirme só se este email for mesmo de quem você convidou. Se não reconhecer, recuse: a conta é apagada.',
    noVault:
      'Essa pessoa ainda não criou a chave do cofre. Quando vocês compartilharem um documento pela primeira vez, o Arca pede para vocês conferirem juntos a impressão digital da chave dela.',
    confirm: 'Confirmar conta',
    decline: 'Recusar e apagar a conta',
    waiting: 'Confirme no seu dispositivo para continuar.',
    confirmed: 'Conta de {email} confirmada.',
    declined: 'Conta de {email} apagada.',
    decisionFailure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} not_found {Esse convite não espera mais uma decisão. Atualize a página.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    signIn: 'Entre para ver seus convites.',
    addTitle: 'Adicionar {email} ao caso da família',
    addLead:
      'Assim essa pessoa participa do caso com você. Ela passa a cuidar dos próprios dados e decide quem vê.',
    addAs: 'Quem é essa pessoa?',
    addAsHint:
      'Se você já tinha cadastrado essa pessoa, escolha o nome dela. Os dados passam para ela, e o que você tinha compartilhado deixa de ser compartilhado.',
    addNew: 'Alguém que ainda não está no caso',
    addName: 'Nome dessa pessoa',
    addSubmit: 'Adicionar ao caso',
    adding: 'Adicionando ao caso…',
    inCase: '{email} participa do caso.',
    addFailure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} case_exists {Essa pessoa já participa de outro caso no Arca.} case_limit {O caso já chegou ao limite de pessoas ou de participantes.} not_found {Não deu para adicionar essa pessoa ao caso. Atualize a página e tente de novo.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
  },
  /** The family area (spec 0007, R2): the case's people, who sees what, invites and leaving. */
  family: {
    title: 'Área da família',
    signIn: 'Entre para ver a área da família.',
    loadFailure: 'Não conseguimos carregar a área da família agora.',
    retry: 'Tentar de novo',
    startLead:
      'Comece o caso da sua família. Depois você coloca as outras pessoas, e cada uma decide quem vê os dados dela.',
    lead: 'Estas são as pessoas do caso. Os dados de cada uma só aparecem para quem ela escolher.',
    yourName: 'Seu nome',
    yourNameHint: 'É assim que a família vai ver você no Arca.',
    start: 'Começar o caso',
    saving: 'Salvando…',
    waiting: 'Confirme no seu dispositivo para continuar.',
    failure:
      '{reason, select, not_found {Isso não está mais disponível. Atualize a página.} case_exists {Você já participa de um caso.} case_limit {O caso chegou ao limite: até {people} pessoas, das quais {max} no planejamento.} case_invalid {Isso não combina com o resto do caso. Confira e tente de novo.} cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas alterações em pouco tempo. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    peopleTitle: 'Pessoas do caso',
    peopleCount: '{count, plural, one {# pessoa no caso} other {# pessoas no caso}}',
    summary: {
      label: 'Resumo da família',
      people: '{count, plural, one {# pessoa no caso} other {# pessoas no caso}}',
      members: '{count, plural, one {# entra no planejamento} other {# entram no planejamento}}',
      invites:
        '{count, plural, =0 {Nenhum convite esperando} one {# convite esperando} other {# convites esperando}}',
    },
    nextStep: 'Próximo passo',
    nextQuestionsMine:
      '{count, plural, =0 {As perguntas guiadas montam o seu caso.} other {As perguntas guiadas montam o seu caso e o de {names}.}}',
    nextQuestionsOthers: 'As perguntas guiadas montam o caso de {names}.',
    nextResults: 'Veja as rotas que o Arca encontrou para quem entra no planejamento.',
    sections: {
      label: 'Partes da família',
      people: 'Pessoas',
      relationships: 'Vínculos',
      sharing: 'Quem vê o quê',
      invites: 'Convites',
      case: 'Caso',
      relationshipsHint: 'Para anotar um vínculo, abra a pessoa em Pessoas.',
      sharingLead:
        'Cada pessoa com conta decide quem vê os dados dela. Aqui você escolhe por quem você cuida.',
      change: 'Compartilhamento de {name}',
    },
    kept: 'Você cuida',
    back: 'Voltar para a família',
    close: 'Fechar',
    layout: {
      label: 'Como mostrar a família',
      tree: 'Ver em árvore',
      cards: 'Ver em cartões',
      list: 'Ver em lista',
    },
    tree: {
      members: 'Entram no planejamento',
      outside: 'Fora do planejamento',
      spouse: 'casamento',
      partner: 'união estável',
    },
    questions: 'Responder às perguntas guiadas',
    me: '{name} (você)',
    member: 'Entra no planejamento',
    relative: 'Parente fora do planejamento',
    hasAccount: 'Participante do caso',
    noAccount: 'Sem conta',
    sharedWithMe:
      '{what, select, both {Você vê os dados e as finanças.} profile {Você vê os dados.} finances {Você vê as finanças.} other {Você não vê os dados nem as finanças.}}',
    whoSees: 'Quem vê os dados: {profile}. Quem vê as finanças: {finances}.',
    nobody: 'só você',
    actions: {
      sharing: 'Compartilhamento',
      edit: 'Editar',
      handOver: 'Passar os cuidados',
      invite: 'Convidar',
      remove: 'Remover',
    },
    removeConfirm:
      'Remover {name} apaga do caso as respostas, as finanças e os vínculos dessa pessoa. Não dá para desfazer.',
    removeYes: 'Sim, remover',
    confirmNo: 'Cancelar',
    name: 'Nome',
    save: 'Salvar',
    membership: {
      label: 'Entra no planejamento',
      hint: 'Se desligar, a pessoa fica no caso só como parente, sem rotas próprias.',
    },
    sharing: {
      firstTitle: 'Quem pode ver os dados de {name}?',
      title: 'O que cada pessoa vê de {name}',
      lead: 'Ninguém vê nada até você marcar. Dá para mudar quando quiser.',
      profile: 'Dados pessoais, como estudos, trabalho e idiomas',
      finances: 'Finanças, como renda e bens',
      save: 'Salvar compartilhamento',
    },
    handOver: {
      legend: 'Quem vai cuidar dos dados de {name}?',
      hint: 'Essa pessoa passa a preencher os dados e a decidir quem vê. O que você tinha compartilhado deixa de ser compartilhado.',
      submit: 'Passar os cuidados',
    },
    add: {
      title: 'Adicionar pessoa',
      lead: 'Para crianças e parentes sem conta no Arca. Quem tem conta entra pelo convite.',
      submit: 'Salvar pessoa',
    },
    relation: {
      parentOf: 'Mãe ou pai de {name}',
      childOf: 'Filha ou filho de {name}',
      spouse: 'Casamento com {name}',
      partner: 'União estável com {name}',
    },
    relationships: {
      title: 'Vínculos',
      empty: 'Nenhum vínculo anotado ainda.',
      parent: '{from} é mãe ou pai de {to}',
      spouse: '{from} e {to} são casados',
      partner: '{from} e {to} vivem em união estável',
      remove: 'Remover',
      addTitle: 'Anotar um vínculo de {name}',
      kind: 'Vínculo',
      to: 'Com quem',
      pick: 'Escolha a pessoa',
      choice: {
        parentOf: '{name} é mãe ou pai de',
        childOf: '{name} é filha ou filho de',
        spouse: '{name} é casada ou casado com',
        partner: '{name} vive em união estável com',
      },
      add: 'Anotar vínculo',
      notKept: 'Escolha pelo menos uma pessoa de quem você cuida.',
    },
    invites: {
      title: 'Convites',
      lead: 'Quem tem conta no Arca preenche os próprios dados. Convide pelo email na tela de convites. Quando a pessoa aceitar, confirme a conta e adicione ao caso.',
      status:
        '{status, select, open {Convite enviado, esperando a pessoa aceitar} accepted {Aceito, falta você confirmar} confirmed {Confirmado, falta adicionar ao caso} member {Participa do caso} other {}}',
      link: 'Abrir os convites',
      empty: 'Nenhum convite enviado ainda.',
      loadFailure: 'Não conseguimos carregar os convites agora. Tente de novo daqui a pouco.',
      filter: {
        label: 'Mostrar convites',
        all: 'Todos',
        waiting: 'Esperando',
        member: 'Participantes',
      },
      more: 'Mostrar mais',
      shown: '{shown} de {total}',
    },
    leave: {
      title: 'Sair do caso',
      lead: 'Ao sair, você e as pessoas de quem você cuida saem do caso, com as respostas e as finanças. Se você for a última pessoa com conta, o caso é apagado.',
      confirm:
        'Sair apaga do caso você e as pessoas de quem você cuida, com as respostas e as finanças. Não dá para desfazer.',
      yes: 'Sim, sair do caso',
      submit: 'Sair do caso',
    },
    /** The admin role (ADR-0027): shown and changed only by admins. */
    admin: {
      badge: 'Administrador',
      grant: 'Tornar administrador',
      grantConfirm:
        '{name} vai poder aprovar e recusar as regras que o Arca usa nas análises, e também tornar outras pessoas do caso administradoras ou tirar esse papel delas. Você confirma com a sua chave de acesso.',
      grantYes: 'Sim, tornar administrador',
      remove: 'Tirar o papel de administrador',
      removeConfirm:
        '{name} deixa de ver a área Regras e não aprova mais regras. As decisões que essa pessoa já tomou continuam valendo.',
      removeYes: 'Sim, tirar o papel de administrador',
      failure:
        '{reason, select, not_found {Essa pessoa não está mais no caso. Atualize a página.} not_admin {Você não é mais administrador.} owner_list_admin {Essa pessoa é administradora fixa e não perde o papel pelo app.} step_up_required {A confirmação com a chave de acesso venceu. Tente de novo.} cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas em pouco tempo. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    news: {
      title: 'Novidades na família',
      joined: '{name} entrou no caso.',
      granted:
        '{scope, select, profile {Agora você vê os dados de {name}.} other {Agora você vê as finanças de {name}.}}',
      revoked:
        '{scope, select, profile {Você não vê mais os dados de {name}.} other {Você não vê mais as finanças de {name}.}}',
      decide:
        'Em Compartilhamento, escolha o que a pessoa que entrou pode ver das pessoas de quem você cuida.',
      done: 'Entendi',
    },
  },
  /** The guided questions (spec 0007, R4): one step at a time, "Não sei" always allowed. */
  questions: {
    title: 'Perguntas guiadas',
    lead: 'Responda no seu ritmo. Cada etapa fica salva quando você avança, e “Não sei” sempre vale.',
    signIn: 'Entre para responder às perguntas.',
    noCase: 'Comece o caso na área da família para responder às perguntas.',
    noneKept: 'Você ainda não cuida dos dados de ninguém no caso.',
    loadFailure: 'Não conseguimos carregar as perguntas agora.',
    retry: 'Tentar de novo',
    person: 'De quem são as respostas?',
    stepsTitle: 'Etapas',
    steps: {
      basics: 'Dados básicos',
      studies: 'Estudos e idiomas',
      work: 'Trabalho',
      finances: 'Finanças',
      history: 'Histórico de imigração',
      family: 'Família',
    },
    progress: '{answered} de {total} respondidas',
    next: 'Salvar e continuar',
    save: 'Salvar',
    saved: 'Respostas salvas.',
    back: 'Voltar para a área da família',
    unknown: 'Não sei',
    yes: 'Sim',
    no: 'Não',
    pick: 'Escolha uma opção',
    list: {
      has: 'Sim',
      none: 'Nenhum',
      add: 'Adicionar',
      remove: 'Remover',
      item: 'Item {number}',
    },
    date: {
      year: 'Ano',
      month: 'Mês',
      day: 'Dia',
      anyMonth: 'Não sei o mês',
      anyDay: 'Não sei o dia',
      yearFormat: 'Use os quatro números do ano, como 1985.',
      months:
        '{month, select, 01 {janeiro} 02 {fevereiro} 03 {março} 04 {abril} 05 {maio} 06 {junho} 07 {julho} 08 {agosto} 09 {setembro} 10 {outubro} 11 {novembro} 12 {dezembro} other {}}',
      none: '{field, select, lost {Ainda tem} end {Ainda estão juntos} sold {Ainda tem} other {Nunca}}',
    },
    amount: 'Valor',
    currency: 'Moeda',
    formerCountries: 'Países que não existem mais',
    fields: {
      country: 'País',
      acquired: 'Desde quando',
      lost: 'Até quando',
      basis: 'Como conseguiu',
      language: 'Idioma',
      level: 'Nível',
      sector: 'Área',
      temporary: 'É um trabalho temporário?',
      kind: 'Tipo',
      monthly: 'Quanto por mês',
      sourceCountry: 'País de onde vem',
      value: 'Quanto vale',
      valuedAt: 'Data desse valor',
      liquid: 'É fácil de transformar em dinheiro?',
      sold: 'Quando vendeu',
      share: 'Parte dessa pessoa (%)',
      date: 'Quando',
      start: 'Desde quando',
      end: 'Até quando',
      parentKind: 'Filiação',
      custody: 'Guarda',
      custodyStart: 'Guarda desde quando',
    },
    choice: {
      citizenshipBasis:
        '{value, select, birth {Nascimento} descent {Descendência} naturalization {Naturalização} marriage {Casamento} investment {Investimento} other {Outro jeito}}',
      educationLevel:
        '{value, select, 0 {Educação infantil} 1 {Ensino fundamental, anos iniciais} 2 {Ensino fundamental, anos finais} 3 {Ensino médio} 4 {Curso técnico depois do ensino médio} 5 {Curso superior de curta duração} 6 {Graduação: bacharelado, licenciatura ou tecnólogo} 7 {Mestrado ou especialização} 8 {Doutorado} other {}}',
      languageLevel:
        '{value, select, A1 {A1, iniciante} A2 {A2, básico} B1 {B1, intermediário} B2 {B2, intermediário avançado} C1 {C1, avançado} C2 {C2, domínio pleno} native {Língua materna} other {}}',
      isicSection:
        '{value, select, A {Agropecuária, florestas e pesca} B {Mineração e extração} C {Indústria} D {Eletricidade e gás} E {Água, esgoto e resíduos} F {Construção} G {Comércio e conserto de veículos} H {Transporte, armazenagem e correio} I {Hotelaria e alimentação} J {Informação e comunicação} K {Finanças e seguros} L {Imóveis} M {Atividades profissionais, científicas e técnicas} N {Serviços administrativos} O {Administração pública e defesa} P {Educação} Q {Saúde e assistência social} R {Artes, cultura, esporte e lazer} S {Outros serviços} T {Serviço doméstico} U {Organismos internacionais} other {}}',
      incomeKind:
        '{value, select, active {De trabalho, como salário ou serviços} passive {Sem trabalhar, como aluguel, aposentadoria ou rendimentos} other {}}',
      assetKind:
        '{value, select, cash {Dinheiro em conta} investment {Investimentos} real_estate {Imóvel} business {Empresa ou participação} retirement {Previdência} vehicle {Veículo} other {Outro bem}}',
      immigrationEvent:
        '{value, select, visa_refusal {Visto negado} entry_refusal {Entrada negada na fronteira} overstay {Ficou além do prazo permitido} removal {Deportação} visa_granted {Visto concedido} residence_granted {Residência concedida} other {}}',
      parentKind: '{value, select, biological {Biológica} adoptive {Adotiva} other {}}',
      custody:
        '{value, select, full {Guarda total} shared {Guarda compartilhada} none {Sem guarda} other {}}',
    },
    asked: {
      birthDate: 'Quando {name} nasceu?',
      citizenships: 'Quais cidadanias {name} tem ou já teve?',
      residenceCountry: 'Em que país {name} mora hoje?',
      educationLevel: 'Até onde {name} estudou?',
      studying: '{name} está estudando agora?',
      languages: 'Que idiomas {name} fala?',
      jobOffers: '{name} tem oferta de emprego em outro país?',
      incomes: 'Quanto {name} recebe por mês?',
      dependsOn: '{name} depende do dinheiro de alguém do caso?',
      assets: 'Quais bens {name} tem?',
      allAssets: 'Esses são todos os bens de {name}?',
      immigrationHistory:
        '{name} já teve visto ou residência em algum país, ou problema com imigração?',
      allSpouses: 'Esses são todos os casamentos de {name}, inclusive os que acabaram?',
      allPartners: 'Essas são todas as uniões estáveis de {name}?',
      allChildren: 'Esses são todos os filhos de {name}?',
      allParents: 'Esses são todos os pais de {name}?',
      relationships: 'Detalhes dos vínculos de {name}',
    },
    hint: {
      birthDate: 'Sem o dia, vale só o mês e o ano, ou só o ano.',
      citizenships: 'Conte também uma cidadania que já perdeu.',
      educationLevel: 'Vale o último curso que concluiu.',
      incomes: 'Anote cada fonte de renda separadamente.',
      assets: 'Contas, investimentos, imóveis, empresa, previdência e veículos.',
      immigrationHistory: 'Vistos e residências concedidos também contam.',
      relationships: 'Para incluir ou tirar um vínculo, use a área da família.',
    },
    related: 'Anotados: {names}.',
    relatedNone: 'Nenhum anotado ainda.',
    complete: {
      yes: 'Sim, são todos',
      no: 'Pode haver mais',
    },
    people: {
      some: 'Sim',
      nobody: 'Não depende de ninguém',
    },
    noRelationships: 'Nenhum vínculo anotado ainda.',
    relation: {
      spouse: 'Casamento com {name}',
      partner: 'União estável com {name}',
      parentOf: 'Mãe ou pai de {name}',
      childOf: 'Filha ou filho de {name}',
    },
    failure:
      '{reason, select, case_invalid {Alguma resposta não ficou certa. Confira e tente de novo.} not_found {Isso não está mais disponível. Atualize a página.} case_limit {O caso chegou a um limite. Tire algo antes de incluir mais.} limited {Muitas alterações em pouco tempo. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
  },
  /** The family told in the member's own words, as a draft to review (spec 0008, R4). */
  intake: {
    title: 'Contar com suas palavras',
    open: 'Contar com minhas palavras',
    signIn: 'Entre para contar sobre a sua família.',
    loadFailure: 'Não conseguimos carregar o caso agora.',
    lead: 'Escreva sobre a sua família do seu jeito. O Arca monta um rascunho das respostas, e você confere tudo antes de salvar.',
    privacy:
      'Para montar o rascunho, o texto vai para o Claude, a IA da Anthropic. O Arca não guarda o que você escreve. Antes do envio, os nomes de quem já está no caso, emails e números como CPF e telefone viram marcadores. A Anthropic apaga o texto em até 30 dias, salvo as exceções dos termos dela, e não usa o que você escreve para treinar a IA.',
    tip: 'Para quem ainda não está no caso, escreva “minha esposa” ou “meu filho mais velho” em vez do nome. Assim o nome não sai do Arca.',
    label: 'Sua família, nas suas palavras',
    placeholder:
      'Por exemplo: nasci em 1985 e casei em 2010. Minha filha nasceu em março de 2015. Meu marido tem cidadania italiana.',
    count: '{count, number} de {max, number} caracteres',
    submit: 'Montar rascunho',
    drafting: 'Lendo o seu texto…',
    failure:
      '{reason, select, not_found {Comece o caso na área da família antes de contar com suas palavras.} intake_unavailable {O rascunho por texto não está disponível agora. Você pode seguir pelas perguntas guiadas.} intake_timeout {O rascunho demorou demais. Tente de novo, talvez com um texto mais curto.} intake_unparsable {Não deu para montar um rascunho com esse texto. Tente escrever de outro jeito.} limited {Você já montou muitos rascunhos. Espere um pouco ou tente de novo amanhã.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    reviewLead:
      'Confira o que o Arca entendeu e desmarque o que estiver errado. Nada vai para o caso antes de você salvar.',
    empty:
      'O texto não trouxe nada novo para o caso. Conte com mais detalhes ou siga pelas perguntas guiadas.',
    unnamed:
      '{role, select, self {Pessoa nova (você)} spouse {Pessoa nova (cônjuge)} partner {Pessoa nova (companheiro ou companheira)} child {Pessoa nova (filho ou filha)} parent {Pessoa nova (pai ou mãe)} grandparent {Pessoa nova (avô ou avó)} sibling {Pessoa nova (irmão ou irmã)} other {Pessoa nova}}',
    choice: {
      legend: 'Incluir essa pessoa no caso?',
      keep: 'Sim, é alguém novo',
      drop: 'Não, já está no caso ou o Arca entendeu errado',
    },
    nameHint: 'Como a família chama essa pessoa. O nome fica só no Arca.',
    whole: {
      citizenships: 'Essas são todas as cidadanias de {name}: {list}',
      languages: 'Esses são todos os idiomas de {name}: {list}',
    },
    wholeHint:
      'Se a lista estiver incompleta, deixe desmarcado. Ela fica para as perguntas guiadas.',
    save: 'Salvar no caso',
    needNames: 'Dê um nome a cada pessoa nova para salvar.',
    saveFailure:
      '{reason, select, case_invalid {Alguma coisa não combina com o que o caso já tem. O que já foi salvo continua no caso. Termine pelas perguntas guiadas.} case_limit {O caso chegou a um limite. Tire alguém na área da família e tente de novo.} not_found {Isso não está mais disponível. Atualize a página.} cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas alterações em pouco tempo. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    restart: 'Escrever outro texto',
    toQuestions: 'Ir para as perguntas guiadas',
  },
  /** The case read back in plain sentences, each opening its question (spec 0007, R5). */
  playback: {
    title: 'Resumo do caso',
    show: 'Ver o resumo do caso',
    hide: 'Voltar às perguntas',
    lead: 'É assim que o Arca entendeu o caso. Toque numa frase para corrigir a resposta.',
    loadFailure: 'Não conseguimos carregar o resumo agora.',
    relationships: 'Vínculos',
    assets: 'Bens',
    empty: 'Nada anotado ainda.',
    sentence: {
      profileHidden: 'Os dados pessoais de {person} não foram compartilhados com você.',
      financesHidden: 'As finanças de {person} não foram compartilhadas com você.',
      unanswered: 'Ainda sem resposta: {question}',
      born: 'Nascimento de {person}: {date}{age}.',
      citizenship: 'Cidadania de {person}: {country}{details}.',
      noCitizenship: 'Cidadania de {person}: nenhuma.',
      residence: 'País onde {person} mora: {country}.',
      education: 'Estudos de {person}: {level}.',
      studying: '{person} {studying, select, yes {está} other {não está}} estudando agora.',
      language: 'Idioma de {person}: {language} ({level}).',
      noLanguage: 'Idiomas de {person}: nenhum.',
      jobOffer: 'Oferta de emprego para {person}: {country}, na área de {sector}{temporary}.',
      noJobOffer: 'Ofertas de emprego para {person}: nenhuma.',
      immigrationEvent: 'Imigração de {person}: {event}, {country}{date}.',
      noImmigrationEvent: 'Imigração de {person}: nenhum visto, residência ou problema.',
      dependsOn: '{person} depende do dinheiro de {people}.',
      independent: '{person} não depende do dinheiro de ninguém do caso.',
      recordedInFull:
        '{marker, select, spouses {Todos os casamentos de {person} estão anotados.} partners {Todas as uniões estáveis de {person} estão anotadas.} children {Todos os filhos de {person} estão anotados.} parents {Todos os pais de {person} estão anotados.} other {Todos os bens de {person} estão anotados.}}',
      income:
        'Renda de {person}: {amount} por mês, {income, select, active {de trabalho} other {de aluguel, aposentadoria ou rendimentos}} ({country}).',
      noIncome: 'Renda de {person}: nenhuma.',
      couple:
        '{first} e {second} {couple, select, spouse {são casados} other {vivem em união estável}}{start}.',
      coupleEnded:
        '{first} e {second} {couple, select, spouse {foram casados} other {viveram em união estável}}{start} até {end}.',
      parent: '{parent} é mãe ou pai de {child}{since}{details}.',
      asset: '{asset} de {owners}: {value} em {valuedAt}{liquid}{sold}.',
    },
    part: {
      age: ' ({min, plural, =0 {menos de 1 ano} one {# ano} other {# anos}})',
      ageRange: ' ({min} ou {max, plural, one {# ano} other {# anos}})',
      basis:
        ', {basis, select, birth {por nascimento} descent {por descendência} naturalization {por naturalização} marriage {por casamento} investment {por investimento} other {por outro motivo}}',
      since: ', desde {date}',
      until: ', até {date}',
      in: ', em {date}',
      startSince: ' desde {date}',
      from: ' de {date}',
      custodySince: ', guarda desde {date}',
      temporary: ', temporária',
      parentKind: ', filiação {parentKind, select, biological {biológica} other {adotiva}}',
      custody:
        ', {custody, select, full {guarda total} shared {guarda compartilhada} other {sem guarda}}',
      owner: '{person} ({share}%)',
      sold: ', com venda em {date}',
      liquid:
        '{liquid, select, yes {, fácil de transformar em dinheiro} other {, difícil de transformar em dinheiro}}',
    },
  },
  /** The results screen (spec 0007, R6). */
  results: {
    title: 'Rotas para a família',
    lead: 'O Arca compara as regras de cada rota com o que está anotado no caso, usando as regras em vigor em {date}.',
    open: 'Ver as rotas para a família',
    signIn: 'Entre para ver as rotas para a família.',
    noCase: 'Comece o caso na área da família para ver as rotas.',
    loadFailure: 'Não conseguimos avaliar as rotas agora.',
    tooMany: 'Você abriu esta tela muitas vezes na última hora. Espere um pouco e tente de novo.',
    retry: 'Tentar de novo',
    back: 'Voltar para a área da família',
    empty: 'Ainda não há rotas na base de conhecimento.',
    questionsTitle: 'Perguntas que mudam o resultado',
    questionsLead: 'Responder estas perguntas é o que mais ajuda a definir o resultado das rotas.',
    noQuestions: 'Nenhuma pergunta pendente muda o resultado agora.',
    decides: '{n, plural, one {Pode mudar # resultado} other {Pode mudar # resultados}}',
    answer: 'Responder',
    askKeeper: 'Peça para quem cuida dos dados de {name} responder: {question}',
    otherRoutes: 'Outras rotas',
    unnamedRoute: 'Rota ainda sem versão ativa ({id})',
    principal: '{name} como requerente principal',
    status:
      '{status, select, eligible {Elegível} unavailable {Indisponível} not_eligible {Não elegível} missing_information {Faltam informações} needs_assessment {Depende de critério subjetivo} pending_activation {Versão aguardando ativação} other {Situação desconhecida}}',
    stale:
      'Fonte desatualizada: alguma regra desta rota não foi conferida nos últimos {days} dias e precisa ser checada de novo.',
    closed: 'Rota encerrada: ela não aceita mais pedidos.',
    missingRates:
      '{n, plural, one {Falta a cotação} other {Faltam as cotações}} de {pairs}. O Arca ainda não tem cotações de moeda, então esta comparação fica em aberto.',
    ratePair: '{from} para {to}',
    missingDates: 'Ainda falta definir: {dates}.',
    newerVersion: 'Uma versão nova desta rota vale a partir de {date} e ainda aguarda ativação.',
    goWith: 'Dependentes: {names}',
    mayGoWith: 'Possíveis dependentes: {names}',
    nobodyWith: 'Nenhum dependente nesta rota.',
    unitOpen: 'Pode haver mais gente da família nesta rota que ainda não foi anotada.',
    details: 'Ver requisitos, custos e prazos',
    requirementsTitle: 'Requisitos',
    requirement: '{result, select, yes {Atende} no {Não atende} other {Ainda não dá para saber}}',
    assessmentsTitle: 'Critérios subjetivos',
    assessmentNote: 'Dependem de avaliação, não de um sim ou não.',
    costsTitle: 'Custos',
    cost: '{title}: {amount}',
    costFor: '{title} ({name}): {amount}',
    costMaybe: '(talvez se aplique)',
    amountRange: 'de {min} a {max}',
    amountFrom: 'a partir de {min}',
    amountUpTo: 'até {max}',
    amountUnknown: 'valor ainda indefinido',
    durationsTitle: 'Prazos',
    duration: '{title}: de {min} a {max}',
    source: 'Fonte: {host} · conferida em {date}',
    someone: 'alguém do caso',
    report: {
      open: 'Avisar regra errada',
      title: 'Avisar regra errada',
      legend: 'O que parece errado?',
      reason:
        '{reason, select, outdated {Está desatualizada} wrong_amount {O valor está errado} wrong_condition {A condição está errada} source_mismatch {A fonte não diz isso} other {Outro motivo}}',
      note: 'Quer contar mais? (opcional)',
      noteHint:
        'Até 500 caracteres. Só você vê esta nota; quem revisa as regras vê apenas o motivo.',
      send: 'Enviar aviso',
      sending: 'Enviando…',
      cancel: 'Cancelar',
      sent: 'Aviso enviado. Quem revisa as regras vai conferir esta regra.',
      tooMany: 'Você já mandou muitos avisos hoje. Tente de novo amanhã.',
      failure: 'Não deu para enviar o aviso agora. Tente de novo.',
    },
  },
  /** Comparar destinos (ADR-0026): one adult's own ranking of the countries that have a route. */
  compare: {
    title: 'Comparar destinos',
    lead: 'Dê peso ao que importa para você e veja os países em ordem. Só você vê suas escolhas.',
    signIn: 'Entre para comparar destinos.',
    noCase: 'Comece o caso na área da família para comparar destinos.',
    openFamily: 'Ir para a área da família',
    loadFailure: 'Não conseguimos abrir a comparação agora.',
    tooMany: 'Você abriu esta tela muitas vezes na última hora. Espere um pouco e tente de novo.',
    retry: 'Tentar de novo',
    noVersion:
      'Os dados dos países ainda aguardam ativação. Por enquanto, só contam os critérios próprios que você criar.',
    pendingNewer:
      'Há dados mais novos dos países aguardando ativação. Até lá, a comparação usa os dados atuais.',
    jumpToWeights: 'Ajustar os pesos',
    saving: 'Salvando…',
    saveFailure:
      '{reason, select, limited {Foram muitas mudanças em pouco tempo. Espere um pouco e tente de novo.} changed {Seus critérios mudaram em outra tela. Abrimos a versão mais recente.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu para salvar a última mudança. Tente de novo.}}',
    rankingTitle: 'Seu ranking',
    empty: 'Ainda não há países com rota na base de conhecimento.',
    allHidden: 'Você ocultou todos os países. Mostre algum de novo para ver o ranking.',
    noneRanked:
      'Nenhum país tem nota em pelo menos metade do seu peso ainda. Eles estão em “Poucos dados”, logo abaixo.',
    place: '{rank}º lugar',
    outOf: 'de 10',
    totalLabel: 'nota final {total} de 10',
    noTotal: 'Sem nota',
    coverage: 'Dados conhecidos: {coverage}%',
    routes: 'Ver as rotas',
    hide: 'Ocultar',
    hideLabel: 'Ocultar {country}',
    details: 'Ver as notas',
    zeroLeftOut: 'Critérios com peso 0 não aparecem aqui.',
    noData: 'sem dado',
    notRated: 'sem nota',
    weightOf: 'peso {weight}',
    source: 'Fonte: {url} · conferida em {date}',
    stale: 'Esta fonte foi conferida há mais de {days} dias e precisa ser checada de novo.',
    rating: 'Sua nota',
    ratingFor: 'Sua nota para {criterion} em {country}',
    star: '{n, plural, one {# estrela} other {# estrelas}} de 5',
    clearStars: 'Tirar a nota',
    fewDataTitle: 'Poucos dados',
    fewDataLead:
      'Menos da metade do seu peso tem nota nestes países. Dê estrelas a eles nos seus critérios para que entrem no ranking.',
    hiddenTitle: 'Países ocultos',
    hiddenLead: 'Eles continuam com nota, mas ficam fora do ranking.',
    show: 'Mostrar de novo',
    showLabel: 'Mostrar de novo: {country}',
    weightsTitle: 'Seus pesos',
    weightsLead: '0 deixa o critério de fora. 5 é o que mais importa.',
    measuredTitle: 'Medidos com dados',
    measuredLead: 'A nota vem de dados públicos de cada país.',
    personalTitle: 'Critérios pessoais e próprios',
    personalLead: 'Você dá sua nota, de 1 a 5 estrelas, a cada país em “Ver as notas”.',
    rename: 'Renomear',
    renameLabel: 'Renomear {name}',
    newName: 'Novo nome',
    save: 'Salvar',
    cancel: 'Cancelar',
    remove: 'Apagar',
    removeLabel: 'Apagar {name}',
    removeConfirm: 'Apagar “{name}” e as estrelas que você deu nele?',
    addTitle: 'Criar um critério próprio',
    addLabel: 'Nome do critério',
    addHint: 'Por exemplo: perto da praia.',
    add: 'Criar',
    ownLimit: 'Você já tem {max} critérios próprios. Apague um para criar outro.',
    /** Labels by criterion ID; a criterion without one shows the title in the data. */
    criterion: {
      'cost-of-living': 'Custo de vida',
      safety: 'Segurança',
      healthcare: 'Saúde',
      climate: 'Clima',
      language: 'Idioma',
      schools: 'Escolas',
      jobs: 'Emprego na sua área',
      taxes: 'Impostos',
      'distance-to-brazil': 'Distância do Brasil',
      'brazilian-community': 'Comunidade brasileira',
    },
    /** The value behind an objective score, by indicator ID; without one, the value and the data's unit. */
    reading: {
      'price-level': 'Preços em {value}, com os EUA em 100',
      homicides: '{value} homicídios por 100 mil habitantes',
      'health-coverage': 'Cobertura de saúde em {value} de 100',
    },
    valueUnit: '{value} · {unit}',
    inYear: '{reading} ({year})',
  },
  /** The activation screen (spec 0007, R7), shown to admins only. */
  knowledge: {
    title: 'Tela de ativação',
    /** An owner-list admin's correction requests on a version (ADR-0029). */
    corrections: {
      open: 'Apontar erro',
      formTitle: 'Apontar erro na regra',
      privacy:
        'Uma IA lê este pedido. Não coloque dados pessoais: nada de nomes, documentos ou números da família.',
      note: 'O que está errado?',
      link: 'Link',
      linkHint: 'Endereço completo, começando com https://',
      text: 'Texto colado',
      addLink: 'Adicionar link',
      addText: 'Colar um texto',
      addFile: 'Anexar arquivo',
      fileHint:
        'Arquivo: só PDF, HTML ou texto de até 16 MB, salvo de um site oficial. Nunca um documento pessoal.',
      fileRefused: 'Este arquivo não é aceito: só PDF, HTML ou texto de até 16 MB.',
      fileState:
        '{state, select, sending {Enviando…} ready {Anexado} other {O arquivo não subiu. Remova e anexe de novo.}}',
      removeFile: 'Remover',
      copyOf: 'Este arquivo é cópia de qual página da regra?',
      copyOfHint:
        'Se o site não abrir na verificação independente, a IA lê esta cópia no lugar da página. Salve a página sem entrar em nenhuma conta.',
      notACopy: 'Nenhuma, é só uma pista',
      copyOfPage: 'Cópia da página',
      fileMismatch: 'Um arquivo chegou diferente do que você escolheu. Remova e anexe de novo.',
      fileMissing: 'Um arquivo ainda não terminou de subir. Remova e anexe de novo.',
      send: 'Enviar pedido',
      sending: 'Enviando…',
      cancel: 'Cancelar',
      sent: 'Pedido enviado.',
      tooMany: 'Você já mandou muitos pedidos nas últimas 24 horas. Tente de novo mais tarde.',
      sendFailure: 'Não deu para enviar o pedido agora. Confira os links e tente de novo.',
      alreadyCorrected:
        'Esta versão já tem uma correção ativa. Aponte o erro na versão que corrige esta.',
      title: 'Pedidos de correção',
      loadFailure: 'Não deu para carregar os pedidos de correção agora.',
      state:
        '{state, select, open {Aberto} taken {Em correção} answered {Respondido} other {Fechado}}',
      item: '{kind, select, version {Versão inteira} settings {Configurações da versão} requirement {Requisito: {title}} assessment {Critério subjetivo: {title}} dependent {Dependente: {title}} cost {Custo: {title}} duration {Prazo: {title}} other {Grupo de países: {title}}}',
      filedAt: 'Enviado em {date}',
      sourceKind: '{kind, select, link {Link} file {Arquivo} other {Texto colado}}',
      fileSummary: '{type, select, pdf {PDF} html {HTML} other {Texto}} de {size}',
      fileName: 'pedido-de-correcao-arquivo-{n}',
      download: 'Baixar arquivo',
      downloadFailure: 'Não deu para baixar o arquivo agora. Tente de novo.',
      erased:
        'O prazo de guarda acabou: o texto, os links e os arquivos deste pedido foram apagados.',
      close: 'Fechar pedido',
      closeFailure: 'Não deu para fechar o pedido agora. Tente de novo.',
      answerVersion: 'A sessão de correção propôs a versão {number}.',
      openVersion: 'Abrir a versão {number}',
      answerNoChange: 'A sessão de correção não mudou a regra:',
      copiedFrom: 'Copiado de',
    },
    /** "Pedido de regra nova" (ADR-0029, new routes), for owner-list admins. */
    routeRequests: {
      title: 'Regras novas',
      lead: 'Falta uma regra porque o site oficial não deixa a IA ler? Monte o pedido aqui com as páginas salvas em PDF. A sessão de correção escreve a regra a partir delas e manda para você ativar.',
      open: 'Pedir regra nova',
      formTitle: 'Pedido de regra nova',
      stepCount: 'Passo {n} de {total}',
      stepTitle:
        '{step, select, route {Qual regra falta} pages {Páginas oficiais} passages {Trechos que importam} other {Revisar e enviar}}',
      routeLead:
        'Diga o país e qual visto ou autorização você quer, com o nome que o site oficial usa.',
      country: 'País',
      pickCountry: 'Escolha o país',
      note: 'Qual regra falta, e para quem?',
      pagesLead:
        'Abra cada página oficial que fala dessa regra sem entrar em nenhuma conta. Salve como PDF (Imprimir › Salvar como PDF) e anexe aqui com o endereço da página.',
      knownHosts: 'Sites oficiais que o Arca já conhece para {country}: {hosts}.',
      noKnownHosts:
        'O Arca ainda não tem a lista de sites oficiais de {country}. Use só páginas de órgãos do governo.',
      pageAddress: 'Endereço da página',
      attachCopy: 'Anexar o PDF da página',
      removePage: 'Remover página',
      addPage: '{first, select, true {Adicionar uma página} other {Adicionar outra página}}',
      copyHint:
        'PDF, HTML ou texto de até 16 MB, salvo do site oficial. Nunca um documento pessoal.',
      passagesLead:
        'Cole os trechos de cada assunto abaixo. Assim a sessão acha o ponto certo no PDF. Pule o que não se aplica.',
      topic:
        '{topic, select, requirements {Requisitos} amounts {Valores} deadlines {Prazos} other {Dependentes}}',
      topicHint:
        '{topic, select, requirements {Quem pode pedir e o que precisa comprovar.} amounts {Taxas, renda mínima, investimento, seguro.} deadlines {Validade, tempo de análise, renovação.} other {Quem pode ir junto: cônjuge, filhos, pais.}}',
      passage: 'Trecho colado',
      passagePage: 'De qual página?',
      noPage: 'Não sei ou é de outra página',
      addPassage: 'Colar um trecho',
      removePassage: 'Remover trecho',
      reviewCountry: 'Regra nova para {country}:',
      reviewCounts:
        '{pages, plural, one {# página} other {# páginas}} ({copies, plural, =0 {nenhuma em PDF} other {# em PDF}}) e {passages, plural, =0 {nenhum trecho} one {# trecho} other {# trechos}}.',
      reviewNext:
        'A sessão de correção pega o pedido na próxima manhã. Nada muda para a família até você ativar a regra.',
      next: 'Continuar',
      back: 'Voltar',
      sent: 'Pedido enviado. A sessão de correção pega o pedido amanhã de manhã.',
      sendFailure: 'Não deu para enviar o pedido agora. Confira os endereços e tente de novo.',
      loadFailure: 'Não deu para carregar os pedidos de regra nova agora.',
      answerRoute: 'A sessão de correção escreveu a regra. Falta você ativar.',
      openRoute: 'Abrir a versão proposta',
      answerNoRoute: 'A sessão de correção não escreveu a regra:',
    },
    /** The corrector key in settings (ADR-0029), for owner-list admins. */
    correctorKey: {
      title: 'Chave da sessão de correção',
      lead: 'Uma vez por dia, uma sessão do Claude lê os pedidos de correção abertos e propõe a versão que corrige a regra. Ela usa esta chave para ler e responder os pedidos. Quem tiver a chave não consegue fechar um pedido, mudar uma regra nem ver dados da família.',
      none: 'Nenhuma chave ativa. Sem ela, os pedidos ficam parados.',
      active: 'Chave criada em {created}. Vale até {expires}.',
      create: 'Criar chave',
      replace: 'Criar chave nova',
      replaceHint: 'A chave nova substitui a atual na hora.',
      working: 'Confirmando…',
      shown:
        'Copie a chave agora e cole no ambiente da sessão de correção como ARCA_CORRECTOR_KEY. Ela não aparece de novo.',
      copy: 'Copiar chave',
      copied: 'Copiada.',
      done: 'Já copiei',
      revoke: 'Revogar chave',
      revoked: 'Chave revogada.',
      failure: 'Não deu para mudar a chave agora. Tente de novo.',
      tooMany: 'Muitas mudanças de chave nas últimas 24 horas. Tente mais tarde.',
      loadFailure: 'Não deu para carregar a chave agora.',
      ownerOnly: 'Só alguém da lista de donos cria ou revoga a chave.',
    },
    reports: {
      title: 'Avisos de regra errada',
      lead: 'Pessoas do caso marcaram estes requisitos como possivelmente errados. Pesquise a regra nas fontes antes de encerrar os avisos.',
      none: 'Nenhum aviso aberto.',
      loadFailure: 'Não conseguimos carregar os avisos agora.',
      item: '{title} (versão {number}), requisito {requirement}',
      reason:
        '{reason, select, outdated {desatualizada} wrong_amount {valor errado} wrong_condition {condição errada} source_mismatch {a fonte não diz isso} other {outro motivo}}: {n, plural, one {# aviso} other {# avisos}}',
      close: 'Já pesquisei, encerrar os avisos',
      closeFailure: 'Não deu para encerrar os avisos agora. Tente de novo.',
    },
    lead: 'Aqui você confere cada versão de rota e dos dados que comparam os destinos antes de o app usar. Nada vale antes de você ativar.',
    signIn: 'Entre na sua conta para ver as versões.',
    notAdmin: 'Só um administrador pode abrir esta tela.',
    loadFailure: 'Não deu para carregar as versões agora.',
    retry: 'Tentar de novo',
    settings: {
      intro: 'Você aprova as versões de rota que o Arca usa nas avaliações.',
      open: 'Abrir a tela de ativação',
    },
    proposed: 'Versões propostas',
    /** The proposed versions grouped by country, in the order to review them. */
    review: {
      order:
        'Ordem de revisão: primeiro o que difere das fontes, depois o que a IA conferiu inteiro, por último o que ela não conseguiu conferir.',
      start: 'Comece por aqui',
      need: '{need, select, differs {Tem diferença} ready {Conferida pela IA} unread {Confira você} unchecked {Sem verificação} other {Sem verificação}}',
      needCount: {
        differs: '{n, plural, one {# com diferença} other {# com diferença}}',
        ready: '{n, plural, one {# conferida} other {# conferidas}}',
        unread: '{n, plural, one {# para você conferir} other {# para você conferir}}',
        unchecked: '{n, plural, one {# sem verificação} other {# sem verificação}}',
      },
      versions: '{n, plural, one {# versão} other {# versões}}',
      comparisons: 'Comparar destinos',
      /** What the admin can do about each need. */
      hints: {
        title: 'O que fazer em cada caso',
        differs:
          'A IA achou ao menos um ponto que não bate com a fonte. Abra a versão e leia o trecho marcado. Se a fonte estiver certa, recuse: a regra precisa de correção.',
        ready:
          'Todos os pontos batem com as fontes oficiais. Dá para ativar todas de uma vez em “Conferidas pela IA”, no topo.',
        unread:
          'Nada diverge, mas a IA não conseguiu confirmar alguns pontos nas fontes. Isso não quer dizer que a regra está errada. Cada ponto “Confira você” traz o link oficial e o que procurar lá: confira antes de decidir.',
        unchecked:
          'A IA ainda não leu esta versão. Ela confere as versões sozinha quando você abre esta tela, algumas por dia. Volte mais tarde.',
      },
      filter: {
        country: 'País',
        allCountries: 'Todos os países',
        needs: 'Situação',
        empty: 'Nenhuma versão proposta com esses filtros.',
        clear: 'Limpar filtros',
      },
    },
    noneProposed: 'Nenhuma versão proposta agora.',
    /** Proposed versions no date from today on would use (CONTEXT: superseded version). */
    superseded: {
      title: 'Substituídas, não precisam de decisão',
      lead: 'Uma correção ou uma versão mais nova já ocupa o lugar destas. Enquanto a versão que entrou no lugar delas não for recusada, o Arca não usa nenhuma.',
    },
    others: 'Outras versões',
    versionTitle: '{title} · versão {number}',
    versionMeta: '{country} · em vigor a partir de {date}',
    state:
      '{state, select, active {Versão ativa} rejected {Versão recusada} other {Versão proposta}}',
    back: 'Voltar para a lista',
    closed: 'Rota encerrada',
    corrects: 'Corrige a versão {number}.',
    currency: 'Valores em {currency}.',
    tags: 'Etiquetas',
    hash: 'Código do conteúdo (SHA-256)',
    section: {
      settings: 'Configurações da versão',
      requirements: 'Requisitos',
      assessments: 'Critérios subjetivos',
      dependents: 'Dependentes',
      costs: 'Custos',
      durations: 'Prazos',
      sources: 'Fontes',
      countrySets: 'Grupos de países',
      cases: 'Casos de teste da regra',
      changes: 'O que mudou',
    },
    /** The review of one version, a step per section (spec 0007, R7). */
    wizard: {
      steps: 'Passos da revisão',
      progress: 'Passo {current} de {total}',
      back: 'Voltar',
      next: 'Próximo: {step}',
      previous: 'Passo anterior',
      following: 'Próximo passo',
      decision: 'Decisão',
      count: '{n, plural, =0 {nenhum item} one {# item} other {# itens}}',
    },
    firstVersion: 'Primeira versão desta rota, então não há o que comparar.',
    changesSince: 'Comparada com a versão {number}:',
    noChanges: 'O conteúdo é igual ao da versão {number}.',
    change: '{section}: {details}',
    changeAdded: 'itens novos: {items}',
    changeRemoved: 'itens removidos: {items}',
    changeChanged: 'itens alterados: {items}',
    field: {
      schemaVersion: 'versão do formato',
      routeId: 'rota',
      title: 'nome',
      country: 'país',
      tags: 'etiquetas',
      effectiveFrom: 'início da vigência',
      status: 'situação',
      currency: 'moeda',
      leapDayBirthday: 'aniversário de quem nasceu em 29 de fevereiro',
      leapDayBirthdaySources: 'fontes do aniversário em 29 de fevereiro',
      referenceDates: 'datas de referência',
      closureSources: 'fontes do encerramento',
      countries: 'lista de países',
      formerCountries: 'lista de países extintos',
      officialDomains: 'listas de sites oficiais',
    },
    leapDay:
      '{rule, select, february {Quem nasceu em 29 de fevereiro faz aniversário em 28 de fevereiro nos anos comuns.} march {Quem nasceu em 29 de fevereiro faz aniversário em 1º de março nos anos comuns.} unsettled {Nenhum texto oficial define quando faz aniversário quem nasceu em 29 de fevereiro. Nos anos comuns, entre 28 de fevereiro e 1º de março, a idade dessa pessoa fica em aberto.} other {A versão não diz quando faz aniversário quem nasceu em 29 de fevereiro.}}',
    referenceDates: 'Datas de referência: {dates}',
    closureSources: 'Fontes do encerramento: {sources}',
    pins: 'Arquivos fixados: {pins}',
    pin: '{id} (versão {number})',
    host: 'Site: {host}',
    noHost:
      'Este endereço não aponta para um site simples: tem usuário, porta ou caracteres estranhos. Desconfie antes de abrir.',
    facts: 'Dados lidos: {facts}',
    sourceIds: 'Fontes: {sources}',
    path: 'Caminho a partir do requerente principal: {path}',
    condition: 'Vale quando:',
    at: 'Na data {at}',
    appliesTo:
      '{appliesTo, select, principal {Para o requerente principal} each_dependent {Para cada dependente} other {Para a unidade}}',
    costKind: 'Tipo: {kind}',
    costKinds: {
      fee: 'taxa',
      capital: 'investimento',
    },
    amount: 'Valor:',
    onlyWhen: 'Só quando:',
    durationRange: '{title}: de {min} a {max}',
    duration: {
      year: '{n, plural, one {# ano} other {# anos}}',
      month: '{n, plural, one {# mês} other {# meses}}',
      day: '{n, plural, one {# dia} other {# dias}}',
    },
    countrySet: '{title} (versão {number}): {members}',
    sourceKind: '{kind, select, official {Fonte oficial} other {Fonte secundária}}',
    verifiedAt: 'Conferida em {date}',
    newHost: 'Site novo nesta rota',
    readAddress: 'O Arca lê o texto neste endereço',
    newAddressHost: 'Este endereço fica em um site novo nesta rota',
    case: '{id}: {status}',
    caseStatus:
      '{status, select, unavailable {Indisponível} not_eligible {Não elegível} missing_information {Faltam informações} needs_assessment {Depende de critério subjetivo} other {Elegível}}',
    caseDetails:
      'Regras de {date} · {dependents, plural, =0 {nenhum dependente} one {# dependente} other {# dependentes}} · {possible, plural, =0 {nenhum possível dependente} one {# possível dependente} other {# possíveis dependentes}}',
    caseMissing: 'Faltam: {facts}',
    summary: {
      button: 'Resumir regra',
      pending: 'Lendo a regra…',
      title: 'Resumo feito pela IA',
      watchPoints: 'Pontos de atenção',
      noWatchPoints: 'A IA não apontou pontos de atenção.',
      note: 'A IA pode errar. Use o resumo para ler mais rápido e confira a regra e as fontes antes de ativar ou recusar.',
      failure:
        '{reason, select, summary_unavailable {O resumo não está disponível agora. A regra continua aqui para você ler.} summary_timeout {A IA demorou demais. Tente de novo.} summary_unparsable {A IA não conseguiu montar um resumo desta vez. Tente de novo.} limited {Você pediu muitos resumos. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
      retry: 'Tentar de novo',
    },
    /** The independent check's points, shown beside the rule items they are about (ADR-0027). */
    points: {
      status:
        '{status, select, matches {Bate com a fonte, segundo a IA.} differs {Difere da fonte, segundo a IA.} other {Confira você.}}',
      matches: '{n, plural, one {# bate} other {# batem}}',
      differs: '{n, plural, one {# difere} other {# diferem}}',
      unread: '{n, plural, one {# para você conferir} other {# para você conferir}}',
      checked:
        'A IA comparou {n, plural, one {# ponto} other {# pontos}} desta versão com as fontes oficiais',
      needYou:
        '{n, plural, one {1 ponto difere e precisa de você} other {# pontos diferem e precisam de você}}',
      unconfirmed:
        '{n, plural, one {Nenhum ponto difere. 1 fica para você conferir} other {Nenhum ponto difere. # ficam para você conferir}}',
      allMatch: 'Todos os pontos batem com as fontes',
      note: 'Feita por IA, que pode errar. “Confira você” quer dizer que a IA não conseguiu confirmar o ponto na fonte, não que a regra está errada: o ponto traz o link oficial, quando cita um, e o que procurar lá. O relatório completo fica no passo Decisão.',
      lookAt: 'Onde olhar',
      opensSite: '(abre o site oficial)',
      lookFor: 'O que deve estar escrito lá: {values}',
      handCheck: 'Conferi',
      handCheckNote: 'Fica salvo só neste aparelho e não ativa a versão.',
      quotes: '{n, plural, one {Ver o trecho da fonte} other {Ver os # trechos da fonte}}',
    },
    /** The independent check of a route version against its official pages (ADR-0027). */
    check: {
      title: 'Verificação independente',
      comparisonNote:
        'A verificação independente não lê comparações. Abra as fontes e confira por conta própria antes de decidir.',
      off: 'A verificação independente ainda não está ligada. Abra as fontes e confira por conta própria antes de decidir.',
      listStatus:
        '{status, select, checked {Conferida pela IA} flagged {Conferida em parte} running {Verificando} stale {Verificação vencida} other {Sem verificação}}',
      status:
        '{status, select, running {A IA está lendo as fontes desta versão. Leva alguns minutos, e a tela se atualiza sozinha.} stale {A última verificação não vale mais: a versão, o guia do país ou a IA mudaram, ou ela passou da validade.} other {Esta versão ainda não foi verificada.}}',
      startsOnOpen:
        'As versões propostas são verificadas sozinhas quando você abre a lista de versões, até {max} por dia.',
      loadFailure: 'Não conseguimos carregar a verificação.',
      clean:
        '{n, plural, one {O único item bate} other {Os # itens batem}} com as fontes oficiais.',
      flagged:
        'Itens que batem com as fontes oficiais: {matches} de {total}. Leia com atenção antes de decidir.',
      noItems: 'Esta versão não tem nenhum item com fonte oficial para verificar.',
      scripted:
        'Verificação de teste: nenhuma IA leu as fontes, então ela não vale como verificação.',
      failure:
        '{failure, select, check_timeout {A IA demorou demais para responder.} check_unavailable {A IA estava fora do ar.} check_unparsable {A IA respondeu num formato que o Arca não entende.} other {A verificação falhou.}} Nenhum item foi confirmado. Depois de um dia, ela roda de novo quando você abrir a lista.',
      checkedAt: 'Verificada em {date}',
      guide: 'Guia usado: {country}, versão {number}',
      noGuide: 'Sem guia para este país ({country}): a IA leu as fontes sem orientações extras.',
      kind: '{kind, select, requirement {Requisito} assessment {Critério subjetivo} dependent {Dependente} cost {Custo} duration {Prazo} leapDayBirthday {Aniversário em 29 de fevereiro} closure {Encerramento da rota} countrySet {Grupo de países} other {Item}}',
      itemStatus:
        '{status, select, matches {Bate com a fonte} differs {Diferente da fonte} other {Não deu para conferir}}',
      quote: '{total, plural, one {Trecho da página} other {Trecho {n} de {total}}}',
      page: 'Página',
      readAt: 'O Arca leu o texto neste endereço',
      readFromCopy: 'O site não abriu. A IA leu a cópia anexada a um pedido de correção.',
      note: 'Observação da IA: {note}',
      reason:
        '{reason, select, no_source_cited {Este item não cita nenhuma fonte oficial.} no_page_read {O Arca não conseguiu ler nenhuma página deste item. O motivo de cada uma está em “Páginas com problema”, no fim.} not_answered {A IA não respondeu sobre este item.} model_could_not_check {A IA leu o que recebeu e não confirmou este item.} quote_count {A IA não citou nenhum trecho, ou citou mais de {max}.} url_not_cited {A IA citou uma página que este item não usa.} page_not_read {A página não abriu.} page_cut {Esta página não foi lida inteira, então um trecho que bate não basta.} quote_length {O trecho citado é curto ou longo demais.} quote_not_on_page {O trecho citado não está na página.} echoes_address {O trecho repete o endereço da página, então não prova nada.} value_not_in_quote {O trecho não traz os valores deste item.} other {Não deu para conferir.}}',
      pages: 'Páginas com problema',
      outcome:
        '{outcome, select, read {Lida só em parte: é grande demais, ou a IA não conseguiu escolher os trechos} refused_url {Endereço fora dos sites oficiais} redirect_refused {Redirecionou para fora dos sites oficiais} too_many_redirects {Redirecionou vezes demais} address_refused {Endereço de rede recusado} lookup_failed {Site não encontrado} http_status {O site respondeu com erro {status}} unsupported_type {O site mandou um tipo de arquivo que o Arca não lê, como uma imagem} no_text {A página veio sem texto; é provável que só mostre o conteúdo com JavaScript, que o Arca não roda} pdf_no_text {O PDF não tem texto, só imagens das páginas (digitalizado), e o Arca não lê imagem} pdf_unreadable {O PDF está corrompido ou num formato que o Arca não consegue abrir} too_large {Página grande demais} timeout {O site demorou demais} network {Falha de rede} other {Não deu para ler}}',
      footer:
        'Feita por IA, que pode errar. O Arca confere no código se cada trecho está mesmo na página citada, mas quem decide é você. Um item pode se apoiar em até {max} trechos, e quem diz que eles tratam da mesma regra é a IA. Em páginas muito longas, a IA lê só os trechos que uma IA mais rápida escolheu, então uma mudança escrita em outro ponto da página pode passar batida. A verificação não cobre o que não tem fonte própria, como datas de vigência, moeda e datas de referência.',
    },
    /** The check an admin starts and watches (ADR-0027, "On demand, with progress"). */
    checkRun: {
      button: 'Analisar com IA',
      running: 'Ver a análise em andamento',
      confirmTitle: 'Analisar esta versão com IA?',
      confirmLead:
        'A IA lê de novo as fontes oficiais desta versão e compara item por item, mesmo que já exista uma verificação recente. Leva alguns minutos.',
      cost: 'Cada análise gasta de US$ 0,40 a US$ 0,80 do seu crédito da API.',
      lastCost: 'A última análise desta versão custou {cost} do seu crédito da API.',
      spent:
        '{state, select, running {Gasto até agora: {cost}.} other {Esta análise custou {cost}.}}',
      costUnknown:
        'Não deu para calcular o custo: o Arca não tem o preço de um dos modelos usados, ou a IA não informou quantos tokens gastou.',
      costScripted: 'Esta foi uma análise de teste, sem IA de verdade. Não custou nada.',
      underCent: 'menos de US$ 0,01',
      confirm: 'Analisar agora',
      starting: 'Começando a análise…',
      startFailure:
        '{reason, select, limited {Muitos pedidos seguidos. Espere um pouco e tente de novo.} check_not_started {A análise não conseguiu começar. Ela sai da fila em até 30 minutos, e aí você pode tentar de novo.} check_off {A verificação independente não está ligada aqui, então não há o que analisar.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu para começar a análise. Tente de novo.}}',
      title: 'Análise com IA',
      back: 'Voltar para as versões',
      loadFailure: 'Não conseguimos carregar o andamento da análise.',
      none: 'Esta versão não teve nenhuma análise nas últimas 24 horas.',
      startedAt: 'Começou em {date}',
      leave:
        'Pode sair desta tela. A análise continua, e o botão na versão traz você de volta para cá.',
      now: '{stage, select, reading {Lendo as páginas oficiais: {done} de {total}.} locating {Escolhendo os trechos das páginas longas.} comparing {Comparando a regra com o que as páginas dizem.} other {Preparando a análise.}}',
      state:
        '{state, select, finished {Análise concluída.} failed {A análise parou por um erro e nada foi gravado. Você pode começar outra.} dead {A análise parou no meio e não terminou em 30 minutos. Nada foi gravado. Você pode começar outra.} other {Análise em andamento.}}',
      unknownVersion: 'O Arca não encontrou esta versão para analisar.',
      steps: 'Etapas da análise',
      step: '{step, select, read {Ler as páginas oficiais} locate {Escolher os trechos das páginas longas} compare {Comparar com a regra} other {Montar o relatório}}',
      stepStatus:
        '{status, select, done {Feita} current {Agora} skipped {Não precisou} stopped {Parou aqui} other {Na fila}}',
      readDetail: '{done} de {total, plural, one {# página} other {# páginas}}',
      locateDetail:
        '{n, plural, one {# página longa: a IA lê só os trechos escolhidos.} other {# páginas longas: a IA lê só os trechos escolhidos.}}',
      compareDetail: '{n, plural, one {# item da regra} other {# itens da regra}}',
      comparedItems: 'Itens já comparados',
      awaiting: 'A seguir: {title}',
      left: '{n, plural, one {Falta # item.} other {Faltam # itens.}}',
      pageOutcome: '{outcome, select, reading {Lendo agora} read {Lida} other {Não abriu}}',
      httpStatus: 'O site respondeu com erro.',
      again: 'Analisar de novo',
      result: 'Resultado da análise',
    },
    /** Activating every version the independent check found clean, with one tap (ADR-0027). */
    checkedBatch: {
      title: 'Conferidas pela IA',
      intro:
        '{n, plural, one {Uma versão proposta bate com as fontes oficiais em todos os itens.} other {# versões propostas batem com as fontes oficiais em todos os itens.}}',
      action: '{n, plural, one {Aprovar a versão conferida} other {Aprovar as # conferidas}}',
      lead: '{n, plural, one {A IA conferiu esta versão nas fontes oficiais e não achou diferença. Ao confirmar, ela fica ativa e passa a valer a partir da sua data de vigência:} other {A IA conferiu estas versões nas fontes oficiais e não achou diferença. Ao confirmar, todas ficam ativas de uma vez, e cada uma passa a valer a partir da sua data de vigência:}}',
      oneByOne:
        'As versões marcadas para revisão e os dados da comparação continuam sendo decididos um por um.',
      confirm: '{n, plural, one {Ativar} other {Ativar todas}}',
      waiting: 'Ativando as versões…',
      activated:
        '{n, plural, =0 {Nenhuma versão foi ativada.} one {# versão ativada:} other {# versões ativadas:}}',
      skippedTitle: 'Ficaram de fora',
      skipped:
        '{version}: {reason, select, not_found {o app não tem mais esta versão.} changed {a versão mudou depois que você abriu a tela.} rejected {ela já tinha sido recusada.} already_active {ela já estava ativa.} flagged {a nova verificação não confirmou todos os itens. Abra a versão e decida.} not_admin {você não é mais administrador.} other {a verificação venceu ou ainda não terminou. Abra a versão e decida.}}',
    },
    activate: 'Ativar esta versão',
    reject: 'Recusar esta versão',
    activateLead:
      'Ao ativar, as avaliações passam a usar esta versão sempre que a rota a escolher, a partir de {date}.',
    rejectLead: 'A recusa vale para sempre: esta versão nunca mais será usada.',
    rejectFallback:
      '{current, select, proposed {Hoje a rota escolhe esta versão, que ainda aguarda ativação.} other {Hoje a rota usa esta versão.}} {fallback, select, none {Se recusar, a rota fica sem versão e as avaliações mostram Indisponível.} active {Se recusar, ela volta para a versão {number}, que está ativa.} other {Se recusar, ela passa para a versão {number}, e as avaliações mostram Versão aguardando ativação até você ativá-la.}}',
    confirm: 'Confirmar',
    cancel: 'Agora não',
    waiting: 'Salvando sua decisão…',
    decided: '{kind, select, activate {Versão ativada.} other {Versão recusada.}}',
    rejectedNote: 'Esta versão foi recusada e não volta a ser usada.',
    failure:
      '{reason, select, limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} rejected {Esta versão já foi recusada, e a recusa não pode ser desfeita.} other {Não deu certo desta vez. Tente de novo.}}',
    /** A comparison version: criteria and country data for comparing destinations (ADR-0026). */
    comparison: {
      meta: 'Dados da comparação de destinos',
      firstVersion: 'É a primeira versão destes dados, então não há com o que comparar.',
      criteria: 'Critérios',
      indicators: 'Indicadores dos países',
      kind: '{kind, select, indicator {nota calculada pelo indicador} category {nota por categoria} other {nota dada por cada pessoa}}',
      defaultWeight: 'peso inicial {weight} de 5',
      anchors:
        'Lê {indicator}: {zeroAt} vale nota 0 e {tenAt} vale nota 10. O que fica no meio ganha nota proporcional.',
      tokenScores: 'Lê {indicator}: {scores}.',
      tokenScore: '{token} vale {score}',
      valuesCaption: 'Valores de {title} por país',
      country: 'País',
      value: 'Valor',
      before: 'Antes',
      source: 'Site da fonte',
      valueInYear: '{value} ({year})',
      noPrevious: 'novo',
      removed: 'Perderam o valor nesta versão: {countries}.',
      activateLead:
        'Ao ativar, a comparação de destinos passa a usar estes critérios e valores para todas as pessoas que usam a comparação.',
      rejectFallback:
        '{fallback, select, none {Hoje a comparação usa esta versão. Se recusar, ela fica sem dados de países até você ativar outra.} other {Hoje a comparação usa esta versão. Se recusar, ela volta para a versão {number}.}}',
    },
    factOf: '{fact} {target}',
    target: {
      current: 'da pessoa avaliada',
      principal: 'do requerente principal',
      unit: 'da unidade',
      edge: 'do vínculo',
      firstEdge: 'do primeiro vínculo do caminho',
      lineage: 'do elo da linha de ascendência',
      ancestor: 'do ascendente',
    },
    fact: {
      person: {
        birthDate: 'data de nascimento',
        ageYears: 'idade em anos',
        citizenships: 'cidadanias',
        citizenshipsFromBirth: 'cidadanias desde o nascimento',
        residenceCountry: 'país onde mora',
        educationLevel: 'escolaridade',
        monthlyActiveIncome: 'renda mensal do trabalho',
        monthlyPassiveIncome: 'renda mensal sem trabalho (aluguel, aposentadoria, investimentos)',
        liquidAssets: 'bens fáceis de transformar em dinheiro',
        visaRefusals: 'vistos negados',
        dependsOnPrincipal: 'depende do requerente principal',
        studying: 'está estudando',
        hasSpouse: 'tem cônjuge',
        hasPartner: 'tem companheiro ou companheira',
        temporaryJobOfferSectors: 'setores das ofertas de trabalho temporário',
      },
      unit: {
        liquidAssets: 'soma dos bens fáceis de transformar em dinheiro',
      },
      edge: {
        parentKind: 'tipo de filiação',
        custody: 'guarda',
        start: 'início',
        ageAtStart: 'idade no início',
        custodyStart: 'início da guarda',
        end: 'fim',
        dependsOnLinkedPerson: 'depende da outra pessoa',
      },
      lineage: {
        generation: 'geração',
        edgeKind: 'tipo de filiação',
        childBirthDate: 'nascimento do filho',
        citizenshipsAtChildBirth: 'cidadanias no nascimento do filho',
      },
    },
    collection: {
      unit: {
        members: 'as pessoas da unidade',
        dependents: 'os dependentes da unidade',
      },
      principal: {
        ancestors: 'os ascendentes do requerente principal',
      },
      lineage: {
        links: 'os elos da linha de ascendência',
      },
    },
    step: {
      spouse: 'cônjuge',
      partner: 'companheiro ou companheira',
      child: 'filho ou filha',
      parent: 'pai ou mãe',
    },
    op: {
      bool: '{value, select, true {Sempre vale} other {Nunca vale}}',
      unmodeled: 'Situação que a regra não descreve (fica em aberto)',
      int: '{value}',
      decimal: '{value}',
      money: '{amount}',
      date: '{date}',
      token: '“{value}”',
      tokens: '{values}',
      set: 'grupo de países “{id}”',
      fact: '{fact}',
      eq: 'é igual a',
      ne: 'é diferente de',
      lt: 'é menor que',
      lte: 'é menor ou igual a',
      gt: 'é maior que',
      gte: 'é maior ou igual a',
      in: 'está em',
      intersects: 'tem algum item em comum com',
      within: 'não tem itens fora de',
      all: 'Todas estas valem',
      any: 'Pelo menos uma destas vale',
      not: 'Isto não vale',
      add: 'Soma de',
      sub: 'Diferença entre',
      mul: 'Multiplicado por {by}',
      min: 'O menor entre',
      max: 'O maior entre',
      convert: 'Convertido para {currency}',
      since: 'Já faz pelo menos {duration} desde',
      count: 'Quantidade, entre {over}{generations},',
      some: 'Pelo menos um item, entre {over}{generations},',
      every: 'Cada item, entre {over}{generations},',
      sum: 'Soma, entre {over}{generations},',
    },
    where: 'em que:',
    ofValue: 'do valor:',
    generations: ' (até {generations, plural, one {# geração} other {# gerações}})',
  },
  /** The account's passkeys and the sessions each signed in (spec 0003, R4). */
  devices: {
    title: 'Dispositivos',
    lead: 'Aqui estão as chaves de acesso da sua conta e os dispositivos que entraram com cada uma. Se não reconhecer algum, desconecte.',
    signIn: 'Entre para ver seus dispositivos.',
    addTitle: 'Nova chave de acesso',
    addLead:
      'Crie uma para entrar por outro celular ou computador. Ela só passa a valer {hours} horas depois: se alguém criar uma sem você saber, dá tempo de cancelar.',
    add: 'Adicionar chave de acesso',
    waiting: 'Confirme no seu dispositivo para continuar.',
    done: '{done, select, added {Chave criada. Ela passa a valer daqui a {hours} horas.} sessionRevoked {Dispositivo desconectado.} passkeyRevoked {Chave removida. Os dispositivos que entraram com ela foram desconectados.} pendingCancelled {Chave nova cancelada.} recoveryCancelled {Recuperação cancelada. O código de recuperação deixou de valer, então gere um novo kit de recuperação.} othersRevoked {Os outros dispositivos foram desconectados.} other {}}',
    failure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} not_found {Isso não está mais na sua lista. Atualize a página.} last_active {Esta é a única chave que já vale na sua conta. Crie outra e espere ela valer antes de remover esta.} refused {Não deu para salvar a chave nova. Tente de novo.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    listTitle: 'Suas chaves de acesso',
    listFailure: 'Não conseguimos carregar seus dispositivos agora.',
    retry: 'Tentar de novo',
    passkey: 'Chave de acesso',
    passkeyCreated: 'Chave de acesso criada em {created}',
    thisPasskey: 'Você entrou neste dispositivo com esta chave.',
    pending: 'Chave nova. Passa a valer em {activeFrom}. Se não foi você que criou, cancele agora.',
    sessionsOf: 'Dispositivos que entraram com esta chave',
    sessionDevice: '{browser} · {os}',
    sessionTimes: 'Entrou em {created}. Último uso em {lastUsed}.',
    thisDevice: 'Este dispositivo',
    revokeSession: 'Desconectar este dispositivo',
    revokePasskey: 'Remover esta chave',
    cancelPending: 'Cancelar esta chave',
    recoveryPasskey:
      'Nova chave de acesso (recuperação). Passa a valer em {activeFrom}. Se não foi você, cancele agora.',
    cancelRecovery: 'Cancelar a recuperação',
    restricted:
      'Enquanto a recuperação da conta estiver pendente, você só pode cancelar a chave criada por ela.',
    revokeOthers: 'Desconectar todos os outros dispositivos',
    rotateOffer:
      'A chave de acesso que você removeu pode ter aberto o seu cofre. Troque a chave do cofre e passe os seus documentos para a chave nova.',
    rotateLink: 'Trocar a chave do cofre',
  },
  /** The account part of the recovery kit (spec 0003, R6): shown once, printed or written down. */
  recoveryKit: {
    title: 'Seu kit de recuperação',
    lead: 'Se um dia você perder todas as suas chaves de acesso, este código, junto com um link que mandamos por email, devolve o acesso à sua conta. Ele aparece uma vez só.',
    show: 'Mostrar meu código',
    replace: 'Gerar um novo código',
    replaceLead:
      'O código aparece uma vez só, então não dá para mostrar o mesmo de novo. Gerar um novo faz o anterior parar de valer. Para isso, confirme com a sua chave de acesso.',
    savedLead: 'Seu código de recuperação está guardado. Por segurança, ele não aparece de novo.',
    codeLabel: 'Código de recuperação',
    keep: 'Imprima esta página, anote o código à mão ou salve num gerenciador de senhas diferente do que guarda as suas chaves de acesso. Guarde num lugar seguro.',
    print: 'Imprimir',
    copy: 'Copiar o código',
    copied: 'Copiado',
    copyFailure: 'Não deu para copiar. Anote à mão.',
    download: 'Baixar como arquivo de texto',
    downloadWarning:
      'Um arquivo de texto pode parar numa pasta sincronizada, como iCloud, Google Drive ou OneDrive, e aí o código fica guardado na nuvem. Se puder, prefira imprimir, anotar ou salvar num gerenciador de senhas.',
    downloadAnyway: 'Baixar mesmo assim',
    fileName: 'arca-codigo-de-recuperacao.txt',
    fileText:
      'Código de recuperação do Arca\n\n{code}\n\nUse este código junto com o link de recuperação que o Arca manda por email. Quem tiver o código e o seu email consegue entrar na sua conta, então guarde num lugar seguro.',
    saved: 'Guardei o código num lugar seguro',
    finish: 'Continuar',
    waiting: 'Confirme no seu dispositivo para continuar.',
    signIn: 'Entre para ver o seu kit de recuperação.',
    failure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
  },
  /** The vault (spec 0005, R2): set up, opened with a passkey or the vault recovery secret, closed. */
  vault: {
    title: 'Cofre',
    lead: 'O cofre guarda os seus documentos trancados com uma chave que só existe nos seus dispositivos. Nem o Arca consegue ler o que está lá dentro.',
    signIn: 'Entre para abrir o seu cofre.',
    statusFailure: 'Não conseguimos ver o seu cofre agora. Atualize a página para tentar de novo.',
    setUpLead:
      'Você ainda não tem um cofre. Ao criar, o Arca gera a chave do cofre aqui no seu dispositivo e um segredo de recuperação, que você guarda junto com o kit de recuperação.',
    setUp: 'Criar meu cofre',
    unlockLead: 'O cofre está fechado. Para abrir, confirme com a sua chave de acesso.',
    unlock: 'Abrir o cofre',
    waiting: 'Confirme no seu dispositivo para continuar.',
    secretLead:
      'Neste dispositivo, a sua chave de acesso ainda não abre o cofre. Digite o segredo de recuperação do cofre, o que está no seu kit de recuperação. Você só precisa fazer isso uma vez aqui.',
    secretSubmit: 'Abrir com o segredo',
    resealPending:
      'Seu kit de recuperação mudou e ainda falta um novo segredo de recuperação do cofre. Abra o cofre para criar o novo. Até lá, o segredo antigo continua valendo.',
    resealLead:
      'Crie agora o novo segredo de recuperação do cofre. Quando ele estiver pronto, o segredo antigo deixa de abrir o cofre.',
    reseal: 'Criar o novo segredo',
    resealRotateLead:
      'Como a conta foi recuperada, o melhor é trocar a chave do cofre. Você recebe o novo segredo de recuperação do cofre do mesmo jeito, e a chave antiga para de abrir os seus documentos assim que eles passarem para a nova.',
    resealOnly: 'Só criar o novo segredo',
    opened:
      'O cofre está aberto neste dispositivo. Ele fecha sozinho depois de {minutes} minutos sem uso.',
    lock: 'Fechar o cofre',
    rotateLead:
      'Se você perdeu um dispositivo ou acha que alguém pode ter a chave do cofre, troque a chave. Você recebe um novo segredo de recuperação do cofre, e o antigo deixa de valer. Os seus documentos passam para a chave nova quando você tocar em “Passar para a chave nova”. Os que outras pessoas compartilham com você continuam abrindo com a chave antiga até elas salvarem de novo com a chave nova.',
    rotate: 'Trocar a chave do cofre',
    rotationDue:
      'Uma chave de acesso foi removida ou a conta foi recuperada. Troque a chave do cofre e passe os seus documentos para a chave nova.',
    failure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} wrong_secret {Esse segredo não abre o cofre. Confira e tente de novo.} wrong_identity {A chave aberta não é a do seu cofre atual. Atualize a página e tente de novo.} exists {O seu cofre já foi criado em outro dispositivo. Atualize a página.} changed {O cofre mudou em outro dispositivo. Atualize a página e tente de novo.} has_documents {Não dá para recomeçar o cofre, porque ele já tem documentos que só a chave do cofre atual abre.} rotated_unopened {Antes, abra neste dispositivo a chave antiga do cofre, logo abaixo. Depois tente de novo.} sharing_invalid {A lista de compartilhamento não confere com o seu cofre. Resolva isso antes de trocar a chave.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    /** The open vault's documents (spec 0005, R4); names are sealed and opened on the device. */
    documents: {
      title: 'Documentos',
      add: 'Adicionar documento',
      cannotPick:
        'Este navegador não deixa escolher arquivos. Abra o Arca em um navegador atualizado.',
      working: 'Aguarde um instante…',
      empty:
        'Ainda não há documentos no cofre. Os que você adicionar ficam trancados aqui, e só a chave do cofre abre.',
      listFailure: 'Não conseguimos carregar os documentos agora.',
      retry: 'Tentar de novo',
      details: '{size} · adicionado em {created}',
      sharedWithYou: 'Compartilhado com você',
      sharedWith:
        '{count, plural, one {Compartilhado com 1 pessoa} other {Compartilhado com # pessoas}}',
      unnamed: 'Documento que este cofre não consegue abrir',
      stale:
        '{count, plural, one {1 documento seu ainda usa a chave antiga do cofre.} other {# documentos seus ainda usam a chave antiga do cofre.}}',
      move: 'Passar para a chave nova',
      unopened:
        'Alguns documentos não abriram com a chave atual do cofre. Se a chave foi trocada há pouco, eles ainda abrem com a chave antiga.',
      openRetained: 'Abrir com a chave antiga',
      retainedSecretLead:
        'Neste dispositivo, a sua chave de acesso não abre a chave antiga. Digite o segredo de recuperação do cofre, o do kit mais recente.',
      retainedSecretSubmit: 'Abrir a chave antiga',
      fallbackName: 'documento',
      save: 'Baixar',
      delete: 'Apagar',
      /** Sharing one document (spec 0005, R4): who gets it, each with their key's fingerprint. */
      share: {
        open: 'Compartilhar',
        close: 'Fechar',
        legend: 'Com quem compartilhar “{name}”',
        lead: 'Marque quem pode abrir este documento. Desmarcar tira o acesso. Antes de compartilhar com alguém pela primeira vez, confira com a pessoa, ao vivo ou por telefone, se a impressão digital da chave do cofre dela é a mesma que aparece aqui.',
        fingerprint: 'Impressão digital da chave: {fingerprint}',
        newFingerprint: 'Impressão digital da chave nova: {fingerprint}',
        trust:
          '{trust, select, new {Primeiro compartilhamento com esta pessoa. Confira a impressão digital com ela.} changed {A chave do cofre desta pessoa mudou. Enquanto você não aceitar a chave nova, o compartilhamento continua usando a antiga. Confira a impressão digital nova com ela antes de aceitar.} accepted {Você aceitou a chave nova. Ela passa a valer quando você salvar.} no_vault {Esta pessoa ainda não criou o cofre dela.} other {}}',
        acceptKey: 'Aceitar a chave nova',
        keepPinned: 'Manter a chave antiga',
        unconfirmed:
          '{count, plural, one {O servidor diz que 1 pessoa tem acesso a este documento sem que você tenha confirmado. Ao salvar, só fica quem estiver marcado aqui.} other {O servidor diz que # pessoas têm acesso a este documento sem que você tenha confirmado. Ao salvar, só fica quem estiver marcado aqui.}}',
        summary:
          '{count, plural, =0 {Ao salvar, só você vai conseguir abrir este documento.} one {Ao salvar, você e mais 1 pessoa vão conseguir abrir este documento.} other {Ao salvar, você e mais # pessoas vão conseguir abrir este documento.}}',
        save: 'Salvar',
        noLinks:
          'Você ainda não tem ninguém conectado. Quando alguém que você convidou tiver a conta confirmada, a pessoa aparece aqui.',
        invite: 'Convidar alguém',
        loadFailure: 'Não conseguimos carregar com quem você compartilha agora.',
        invalid:
          'A lista de compartilhamento guardada no servidor não confere com o seu cofre. Por segurança, compartilhar fica desligado até isso ser resolvido.',
        rolledBack:
          'A lista de compartilhamento guardada no servidor é mais antiga do que uma que este dispositivo já viu. Isso pode acontecer depois de uma restauração do servidor. Confira abaixo com quem cada documento está compartilhado antes de seguir.',
        rolledBackList: 'Compartilhamentos nesta lista',
        rolledBackItem: '{name}: {people}',
        rolledBackEmpty: 'Nesta lista, nenhum documento está compartilhado com ninguém.',
        unlinked: 'alguém que não está mais conectado a você',
        confirmState: 'Conferi, pode usar esta lista',
      },
      done: '{done, select, added {Documento guardado no cofre.} saved {Documento baixado neste dispositivo.} deleted {Documento apagado.} shared {Compartilhamento salvo.} confirmed {Lista de compartilhamento confirmada.} moved {Pronto, seus documentos já usam a chave nova.} opened {A chave antiga está aberta neste dispositivo.} other {Pronto.}}',
      failure:
        '{reason, select, too_large {Esse arquivo passa de {maxSize}, o limite de cada documento.} quota {O cofre está cheio. Cabem até {maxDocuments} documentos ou {maxBytes}.} changed {O cofre mudou em outro dispositivo. Atualize a página e tente de novo.} not_opened {Não deu para abrir esse documento. O arquivo guardado não é o que deveria ser.} unconfirmed {Sua conta ainda espera a confirmação de quem convidou você. Depois disso, você pode guardar documentos.} not_shared {O compartilhamento não foi salvo. Alguém pode ter perdido a conexão com você. Atualize a página e tente de novo.} sharing_invalid {Compartilhar está desligado porque a lista de compartilhamento não confere.} nothing_retained {Este cofre não tem chave antiga para abrir.} wrong_secret {Esse segredo não abre a chave antiga. Confira e tente de novo.} cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    /** The vault part of the recovery kit (spec 0003, R6): shown once, after the check. */
    kit: {
      lead: 'Este é o segundo item do seu kit de recuperação. Ele aparece uma vez só.',
      codeLabel: 'Segredo de recuperação do cofre',
      copy: 'Copiar o segredo',
      keep: 'Guarde junto com o código de recuperação da conta, do mesmo jeito: impresso, anotado à mão ou num gerenciador de senhas diferente do que guarda as suas chaves de acesso. Se você perder todas elas, só este segredo abre o cofre.',
      fileName: 'arca-segredo-do-cofre.txt',
      fileText:
        'Segredo de recuperação do cofre do Arca\n\n{code}\n\nEste segredo abre o seu cofre quando nenhuma chave de acesso consegue. Quem tiver o segredo e entrar na sua conta consegue ler os seus documentos, então guarde num lugar seguro.',
      saved: 'Guardei o segredo num lugar seguro',
    },
  },
  /** Account recovery (spec 0003, R6): the emailed link, the recovery code, the new passkey. */
  recover: {
    request: {
      title: 'Recuperar a conta',
      lead: 'Perdeu todas as suas chaves de acesso? Digite o email da sua conta. Vamos mandar um link que, junto com o seu código de recuperação, deixa você criar uma chave nova.',
      email: 'Email',
      submit: 'Enviar o link',
      sending: 'Enviando…',
      sent: 'Se esse email tiver uma conta no Arca, o link já está a caminho. Ele vale por {minutes} minutos.',
      failure:
        '{reason, select, email_unavailable {O Arca ainda não consegue mandar emails. Tente de novo mais tarde.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    code: {
      title: 'Digite o seu código de recuperação',
      lead: 'É o código do seu kit de recuperação, o que você imprimiu ou anotou. Pode digitar com ou sem espaços.',
      label: 'Código de recuperação',
      submit: 'Continuar',
      checking: 'Conferindo o código…',
      failure:
        '{reason, select, expired {Este link não vale mais. Peça um novo.} invalid_code {Esse código não confere. Confira e tente de novo. Depois de alguns erros, a recuperação fica bloqueada por 24 horas.} locked {Muitos códigos errados. A recuperação desta conta ficou bloqueada por 24 horas.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    newLink: 'Pedir um novo link',
    newCode: {
      title: 'Seu novo código de recuperação',
      lead: 'O código que você digitou acabou de ser usado e não vale mais. Guarde este novo antes de continuar: ele aparece uma vez só.',
    },
    passkey: {
      title: 'Crie a sua chave de acesso nova',
      lead: 'O seu celular ou computador vai pedir para salvar uma chave de acesso para o Arca. Ela só passa a valer {hours} horas depois. Até lá, avisamos você por email, e os dispositivos que já estavam na sua conta mostram um aviso e podem cancelar se não foi você.',
      submit: 'Criar chave de acesso',
      waiting: 'Confirme no seu dispositivo para continuar.',
      failure:
        '{reason, select, expired {O tempo para criar a chave acabou, e o código novo deixou de valer. Se ainda tiver a conta aberta em algum dispositivo, gere um novo kit de recuperação por lá.} cancelled {Não deu para criar a chave de acesso. Tente de novo quando quiser.} refused {Não deu para salvar a chave nova. Tente de novo.} unavailable {Este navegador não aceita chaves de acesso. Abra o link em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} closed {O Arca ainda não abriu. Tente de novo mais tarde.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    done: {
      title: 'Chave nova criada',
      lead: 'Ela passa a valer daqui a {hours} horas. Depois disso, entre no Arca com ela. Os dispositivos que já estavam na sua conta ficam limitados até lá e depois são desconectados.',
      signIn: 'Entrar no Arca',
    },
  },
  /** Coarse device families, as sessions record them (spec 0003, R4). */
  device: {
    browser:
      '{browser, select, edge {Edge} samsung_internet {Samsung Internet} opera {Opera} firefox {Firefox} chrome {Chrome} safari {Safari} other {não identificado}}',
    os: '{os, select, ios {iOS} ipados {iPadOS} android {Android} chromeos {ChromeOS} windows {Windows} macos {macOS} linux {Linux} other {não identificado}}',
  },
  /**
   * Security notices by email (spec 0003, R7 and R8): generic text and one link, nothing personal
   * beyond the address it goes to. `when` is already formatted in Brasília time.
   */
  email: {
    link: 'Abrir o Arca: {url}',
    signature: 'Equipe Arca',
    /** The link that opens the first account's registration; it carries a one-time token. */
    enrollment: {
      subject: 'Seu link para criar a conta no Arca',
      body: 'Use o link abaixo para criar sua conta no Arca com uma chave de acesso. Ele vale por 30 minutos e funciona uma vez só. Na página, digite o código de cadastro que você guardou. Se não foi você que pediu, pode ignorar este email.',
      link: 'Criar a conta: {url}',
    },
    /** The link that opens a recovery; it carries a one-time token and is useless without the code. */
    recovery: {
      subject: 'Seu link para recuperar a conta no Arca',
      body: 'Use o link abaixo para recuperar sua conta no Arca. Ele vale por {minutes} minutos e funciona uma vez só. Na página, digite o código de recuperação que você guardou. Se não foi você que pediu, pode ignorar este email: sem o código, o link não abre a sua conta.',
      link: 'Recuperar a conta: {url}',
    },
    /** The link that opens an invite; it carries a one-time token and never names the inviter. */
    invite: {
      subject: 'Você recebeu um convite para o Arca',
      body: 'Uma pessoa que já usa o Arca convidou você para entrar. Use o link abaixo para criar sua conta com uma chave de acesso. Ele vale por {hours} horas e funciona uma vez só. Na página, você vê quem mandou o convite. Se não esperava por isso, pode ignorar este email.',
      link: 'Aceitar o convite: {url}',
    },
    notice: {
      passkey_added: {
        subject: 'Nova chave de acesso na sua conta',
        body: 'Uma nova chave de acesso foi adicionada à sua conta Arca em {when} (horário de Brasília). Ela só começa a funcionar daqui a 24 horas. Se não foi você, cancele essa chave em Dispositivos antes disso.',
      },
      new_sign_in: {
        subject: 'Nova entrada na sua conta',
        body: 'Alguém entrou na sua conta Arca em {when} (horário de Brasília). Navegador: {browser}. Sistema: {os}. É a primeira vez que essa chave de acesso entra por esse navegador ou sistema. Se foi você, não precisa fazer nada. Se não foi, encerre a sessão e remova a chave em Dispositivos.',
      },
      passkey_revoked: {
        subject: 'Uma chave de acesso foi removida',
        body: 'Uma chave de acesso foi removida da sua conta Arca em {when} (horário de Brasília), e as sessões abertas com ela foram encerradas. Se não foi você, entre no Arca e confira seus dispositivos.',
      },
      pending_passkey_cancelled: {
        subject: 'Chave de acesso pendente cancelada',
        body: 'A chave de acesso que ainda esperava as 24 horas para funcionar foi cancelada em {when} (horário de Brasília). Ela não vai funcionar na sua conta.',
      },
      invite_accepted: {
        subject: 'Seu convite foi aceito',
        body: 'Uma pessoa aceitou o seu convite para o Arca em {when} (horário de Brasília). A conta dela fica limitada até você confirmar. Entre no Arca, confira o email da conta em Convites e confirme só se for mesmo quem você convidou.',
      },
      deletion_requested: {
        subject: 'Pedido para excluir sua conta',
        body: 'Recebemos em {when} (horário de Brasília) o pedido para excluir sua conta Arca. Todos os dispositivos foram desconectados. Passados 7 dias, a conta e os dados dela serão apagados. Se mudar de ideia, entre no Arca com sua chave de acesso e cancele antes disso. Se não foi você, entre e cancele agora.',
      },
      deletion_cancelled: {
        subject: 'Exclusão da conta cancelada',
        body: 'O pedido para excluir sua conta Arca foi cancelado em {when} (horário de Brasília). A conta continua como estava. Se não foi você, entre no Arca e confira seus dispositivos.',
      },
      account_erased: {
        subject: 'Sua conta foi excluída',
        body: 'Sua conta Arca e os dados dela foram apagados em {when} (horário de Brasília). Não vamos mais mandar emails sobre esta conta.',
      },
      inactivity_warning: {
        subject: 'Sua conta Arca vai ser apagada por falta de uso',
        body: 'Sua conta Arca está há 3 anos sem nenhum acesso. Por isso, a conta e os dados dela serão apagados em {dueAt} (horário de Brasília), sem volta. Para manter tudo, é só entrar no Arca com sua chave de acesso antes dessa data. Aviso enviado em {when} (horário de Brasília).',
      },
      recovery_kit_regenerated: {
        subject: 'Novo kit de recuperação',
        body: 'Um novo kit de recuperação foi gerado para sua conta Arca em {when} (horário de Brasília). O código de recuperação antigo deixou de valer. Se não foi você, entre no Arca e confira seus dispositivos.',
      },
      recovery_started: {
        subject: 'Pedido de recuperação da sua conta',
        body: 'Alguém pediu para recuperar sua conta Arca em {when} (horário de Brasília). Se foi você, siga o link do outro email que mandamos. Se não foi, sua conta continua segura, porque o pedido não dá acesso sem o seu código de recuperação.',
      },
      recovery_completed: {
        subject: 'Nova chave de acesso criada por recuperação',
        body: 'Uma chave de acesso foi criada pela recuperação da sua conta Arca em {when} (horário de Brasília). Ela começa a funcionar daqui a 24 horas e, até lá, suas sessões abertas só mostram um aviso sobre a recuperação. Se não foi você, cancele a recuperação no Arca com uma chave de acesso sua.',
      },
      recovery_locked: {
        subject: 'Recuperação bloqueada por 24 horas',
        body: 'O código de recuperação da sua conta Arca foi digitado errado várias vezes em {when} (horário de Brasília). Por segurança, a recuperação fica bloqueada pelas próximas 24 horas.',
      },
      corrector_key_changed: {
        subject: 'A chave da sessão de correção mudou',
        body: 'Em {when} (horário de Brasília), alguém da lista de donos criou ou revogou a chave da sessão de correção do Arca. Se não foi você nem alguém que você conhece, entre no Arca, revogue a chave em Configurações e confira os dispositivos.',
      },
      correction_requested: {
        subject: 'Novo pedido de correção de regra',
        body: 'Em {when} (horário de Brasília), alguém da lista de donos mandou um pedido de correção de regra no Arca. Se ninguém da lista mandou, entre no Arca, feche o pedido e confira os dispositivos.',
      },
      admin_role_changed: {
        subject: 'Mudança nos administradores do Arca',
        body: 'Em {when} (horário de Brasília), uma conta ganhou ou perdeu o papel de administrador no Arca. Quem administra aprova as regras usadas nas análises. Se você não esperava por isso, entre no Arca e confira os administradores na área da família.',
      },
      sessions_revoked: {
        subject: 'Suas outras sessões foram encerradas',
        body: 'Todas as outras sessões da sua conta Arca foram encerradas em {when} (horário de Brasília). Só o dispositivo que fez isso continua conectado. Se não foi você, entre no Arca e confira seus dispositivos.',
      },
    },
  },
  /**
   * Security notices on a device (spec 0005, R7): the push carries only the code, and the service
   * worker shows this text, so nothing here may depend on details.
   */
  push: {
    fallback: { title: 'Aviso da sua conta Arca', body: 'Abra o Arca para ver o que mudou.' },
    passkey_added: {
      title: 'Nova chave de acesso na sua conta',
      body: 'Ela só começa a funcionar daqui a 24 horas. Se não foi você, cancele em Dispositivos.',
    },
    new_sign_in: {
      title: 'Nova entrada na sua conta',
      body: 'Alguém entrou na sua conta por um navegador ou sistema novo. Se não foi você, confira seus dispositivos.',
    },
    passkey_revoked: {
      title: 'Uma chave de acesso foi removida',
      body: 'As sessões abertas com ela foram encerradas. Se não foi você, confira seus dispositivos.',
    },
    pending_passkey_cancelled: {
      title: 'Chave de acesso pendente cancelada',
      body: 'A chave de acesso nova, que ainda aguardava as 24 horas, foi cancelada e não vai funcionar.',
    },
    invite_accepted: {
      title: 'Seu convite foi aceito',
      body: 'Confira o email da conta em Convites e confirme só se for mesmo quem você convidou.',
    },
    deletion_requested: {
      title: 'Pedido para excluir sua conta',
      body: 'Daqui a 7 dias, a conta e os dados dela serão apagados. Se não foi você, entre no Arca e cancele agora.',
    },
    deletion_cancelled: {
      title: 'Exclusão da conta cancelada',
      body: 'A conta continua como estava. Se não foi você, confira seus dispositivos.',
    },
    inactivity_warning: {
      title: 'Sua conta Arca vai ser apagada por falta de uso',
      body: 'Para manter a conta, entre no Arca com sua chave de acesso. A data está no email que mandamos.',
    },
    corrector_key_changed: {
      title: 'A chave da sessão de correção mudou',
      body: 'Se não foi você, revogue a chave em Configurações e confira os dispositivos.',
    },
    correction_requested: {
      title: 'Novo pedido de correção de regra',
      body: 'Se ninguém da lista de donos mandou, feche o pedido no Arca e confira os dispositivos.',
    },
    admin_role_changed: {
      title: 'Mudança nos administradores do Arca',
      body: 'Uma conta ganhou ou perdeu o papel de administrador. Se não esperava por isso, confira na área da família.',
    },
    recovery_kit_regenerated: {
      title: 'Novo kit de recuperação',
      body: 'O código de recuperação antigo deixou de valer. Se não foi você, confira seus dispositivos.',
    },
    recovery_started: {
      title: 'Pedido de recuperação da sua conta',
      body: 'Sem o seu código de recuperação, o pedido não abre a conta. Se foi você, siga o link do email.',
    },
    recovery_completed: {
      title: 'Nova chave de acesso criada por recuperação',
      body: 'Ela começa a funcionar daqui a 24 horas. Se não foi você, cancele a recuperação no Arca.',
    },
    recovery_locked: {
      title: 'Recuperação bloqueada por 24 horas',
      body: 'O código de recuperação da sua conta foi digitado errado várias vezes.',
    },
    sessions_revoked: {
      title: 'Suas outras sessões foram encerradas',
      body: 'Só o dispositivo que fez isso continua conectado. Se não foi você, confira seus dispositivos.',
    },
  },
  /** Section names in the account's data export (spec 0004 R8), one per registry entry. */
  dataExport: {
    masked: 'Protegido. Veja no Arca.',
    tables: {
      account: 'Conta',
      signInMethods: 'Formas de entrar',
      sessions: 'Sessões',
      passkeys: 'Chaves de acesso',
      passkeyWaits: 'Chaves de acesso em espera',
      passkeyCapabilities: 'Recursos das chaves de acesso',
      devices: 'Dispositivos',
      passkeyChallenges: 'Pedidos para adicionar chave de acesso',
      recoveryCode: 'Código de recuperação',
      recoveryLinks: 'Links de recuperação',
      recoveryAttempts: 'Tentativas de recuperação',
      stepUps: 'Confirmações com chave de acesso',
      stepUpChallenges: 'Pedidos de confirmação com chave de acesso',
      invites: 'Convites enviados',
      securityHistory: 'Histórico de segurança',
      knowledgeDecisions: 'Decisões sobre regras e dados de comparação (ativações e recusas)',
      adminGrants: 'Quando você virou administrador ou deixou de ser',
      accountLinks: 'Conexões entre contas',
      vaultDocuments: 'Documentos do cofre',
      vaultDocumentsSharedWithYou: 'Documentos compartilhados com você',
      vaultDocumentReplacements: 'Novas versões de documentos ainda não confirmadas',
      vaultDiscardedObjects: 'Arquivos de documentos apagados, aguardando a limpeza diária',
      vaultEnvelopes: 'Envelopes do cofre',
      vaultSharingState: 'Lista de compartilhamento do cofre',
      vaultRecipients: 'Destinatários do cofre',
      notificationChannels: 'Onde você recebe avisos',
      notificationMessages: 'Avisos enviados',
      notificationDeliveries: 'Entregas dos avisos',
      caseMembership: 'Sua participação no caso da família',
      casePeople: 'Pessoas de quem você cuida no caso',
      caseProfiles: 'Dados pessoais das pessoas de quem você cuida',
      caseFinances: 'Dados financeiros das pessoas de quem você cuida',
      caseDependence: 'Quem depende financeiramente de quem',
      caseAssetShares: 'Participação nos bens',
      caseAssets: 'Bens',
      caseRelationships: 'Vínculos familiares',
      caseShares: 'Com quem você compartilhou dados',
      ruleReports: 'Avisos de regra errada que você enviou',
      correctionRequests: 'Pedidos de correção de regra que você enviou',
      correctionSources: 'Links, textos e arquivos dos seus pedidos de correção',
      correctionUploads: 'Arquivos que você anexou a pedidos de correção: tipo, tamanho e data',
      correctionEvents: 'O que aconteceu com seus pedidos de correção',
      correctorKeys: 'Quando você criou ou revogou a chave da sessão de correção',
      comparisonPreferences:
        'Suas escolhas em Comparar destinos: pesos, suas notas, critérios próprios e países ocultos',
    },
  },
  /**
   * Former states (ISO 3166-3), which Intl.DisplayNames does not name. Current countries are
   * named by Intl.DisplayNames, never here.
   */
  formerCountries: {
    AIDJ: 'Território Francês dos Afares e Issas',
    ANHH: 'Antilhas Holandesas',
    BQAQ: 'Território Antártico Britânico',
    BUMM: 'Birmânia',
    BYAA: 'República Socialista Soviética da Bielorrússia',
    CSHH: 'Tchecoslováquia',
    CSXX: 'Sérvia e Montenegro',
    CTKI: 'Ilhas Canton e Enderbury',
    DDDE: 'Alemanha Oriental',
    DYBJ: 'Daomé',
    FQHH: 'Terras Austrais e Antárticas Francesas',
    FXFR: 'França Metropolitana',
    GEHH: 'Ilhas Gilbert e Ellice',
    HVBF: 'Alto Volta',
    JTUM: 'Atol Johnston',
    MIUM: 'Ilhas Midway',
    NHVU: 'Novas Hébridas',
    NQAQ: 'Terra da Rainha Maud',
    NTHH: 'Zona Neutra entre Arábia Saudita e Iraque',
    PCHH: 'Território Fiduciário das Ilhas do Pacífico',
    PUUM: 'Ilhas Menores do Pacífico dos Estados Unidos',
    PZPA: 'Zona do Canal do Panamá',
    RHZW: 'Rodésia do Sul',
    SKIN: 'Sikkim',
    SUHH: 'União Soviética',
    TPTL: 'Timor-Leste (antes de 2002)',
    VDVN: 'Vietnã do Norte',
    WKUM: 'Ilha Wake',
    YDYE: 'Iêmen do Sul',
    YUCS: 'Iugoslávia',
    ZRCD: 'Zaire',
  },
} as const;
