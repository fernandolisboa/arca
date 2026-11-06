/**
 * The pt-BR catalog, in ICU message format. Domain terms use the labels in docs/GLOSSARY.md.
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
      settings: 'Configurações',
    },
  },
  /** The Settings page (spec 0006, R9). Option labels follow the axis identifiers. */
  settings: {
    title: 'Configurações',
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
      confirm: 'Confirmar exclusão',
      cancel: 'Agora não',
      waiting: 'Confirme no seu dispositivo para continuar.',
      done: 'Pedido recebido. A conta será apagada a partir de {dueAt}. Até lá, é só entrar de novo para cancelar.',
      failure:
        '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} tooLate {O prazo para cancelar acabou, e a conta já está sendo apagada.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    appearance: {
      title: 'Aparência',
      intro: 'As mudanças valem na hora e ficam salvas neste aparelho.',
      useDefault: 'Padrão ({value})',
      clearAll: 'Voltar tudo ao padrão',
      cleared: 'Tudo voltou ao padrão.',
      theme: {
        legend: 'Cores',
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
    invites: 'Convidar alguém',
    devices: 'Dispositivos',
    vault: 'Cofre',
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
      legend: 'Essa pessoa entra no planejamento?',
      hint: 'O Arca avalia as rotas de imigração para quem entra no planejamento. Uma avó que fica no Brasil, por exemplo, pode ser só parente.',
      member: 'Sim, entra no planejamento',
      relative: 'Não, é só parente',
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
      submit: 'Adicionar pessoa',
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
      addTitle: 'Anotar um vínculo',
      from: 'Pessoa',
      kind: 'Vínculo',
      to: 'Com quem',
      pick: 'Escolha a pessoa',
      choice: {
        parent: 'é mãe ou pai de',
        spouse: 'é casada ou casado com',
        partner: 'vive em união estável com',
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
    },
    leave: {
      title: 'Sair do caso',
      lead: 'Ao sair, você e as pessoas de quem você cuida saem do caso, com as respostas e as finanças. Se você for a última pessoa com conta, o caso é apagado.',
      confirm:
        'Sair apaga do caso você e as pessoas de quem você cuida, com as respostas e as finanças. Não dá para desfazer.',
      yes: 'Sim, sair do caso',
      submit: 'Sair do caso',
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
  /** The activation screen (spec 0007, R7), shown to approvers only. */
  knowledge: {
    title: 'Tela de ativação',
    lead: 'Aqui você confere cada versão de rota antes de ela entrar nas avaliações. Nenhuma versão vale antes de você ativar.',
    signIn: 'Entre na sua conta para ver as versões.',
    notApprover: 'Só quem aprova as regras pode abrir esta tela.',
    loadFailure: 'Não deu para carregar as versões agora.',
    retry: 'Tentar de novo',
    settings: {
      title: 'Base de conhecimento',
      intro: 'Você aprova as versões de rota que o Arca usa nas avaliações.',
      open: 'Abrir a tela de ativação',
    },
    proposed: 'Versões propostas',
    noneProposed: 'Nenhuma versão proposta agora.',
    others: 'Outras versões',
    versionTitle: '{title} · versão {number}',
    versionMeta: '{country} · em vigor a partir de {date}',
    state: '{state, select, active {Versão ativa} rejected {Recusada} other {Versão proposta}}',
    back: 'Voltar para a lista',
    closed: 'Rota encerrada',
    corrects: 'Corrige a versão {number}.',
    currency: 'Valores em {currency}.',
    hash: 'Código do conteúdo (SHA-256)',
    section: {
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
    empty: 'Nada aqui.',
    firstVersion: 'Primeira versão desta rota, então não há o que comparar.',
    changesSince: 'Comparada com a versão {number}:',
    noChanges: 'O conteúdo é igual ao da versão {number}.',
    change: '{section}: {details}',
    changeAdded: 'novos {items}',
    changeRemoved: 'removidos {items}',
    changeChanged: 'alterados {items}',
    facts: 'Dados lidos: {facts}',
    sourceIds: 'Fontes: {sources}',
    path: 'Caminho a partir do requerente principal: {path}',
    condition: 'Vale quando:',
    at: 'Na data {at}',
    appliesTo:
      '{appliesTo, select, principal {Para o requerente principal} each_dependent {Para cada dependente} other {Para a unidade}}',
    costKind: 'Tipo: {kind}',
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
    case: '{id}: {status}',
    caseStatus:
      '{status, select, unavailable {Indisponível} not_eligible {Não elegível} missing_information {Faltam informações} needs_assessment {Depende de critério subjetivo} other {Elegível}}',
    caseDetails:
      'Regras de {date} · {dependents, plural, =0 {nenhum dependente} one {# dependente} other {# dependentes}} · {possible, plural, =0 {nenhum possível dependente} one {# possível dependente} other {# possíveis dependentes}}',
    caseMissing: 'Faltam: {facts}',
    check: {
      title: 'Verificação independente',
      body: 'A verificação independente ainda não existe. Por enquanto, abra as fontes e confira você mesmo antes de decidir.',
    },
    activate: 'Ativar esta versão',
    reject: 'Recusar esta versão',
    activateLead:
      'Ao ativar, esta versão passa a valer nas avaliações a partir de {date}. Para continuar, confirme com sua chave de acesso.',
    rejectLead:
      'A recusa vale para sempre: esta versão nunca mais será usada. Para continuar, confirme com sua chave de acesso.',
    rejectFallback:
      '{fallback, select, none {Hoje a rota usa esta versão. Se recusar, a rota fica sem versão e as avaliações mostram Indisponível.} active {Hoje a rota usa esta versão. Se recusar, ela volta para a versão {number}, que está ativa.} other {Hoje a rota usa esta versão. Se recusar, ela passa para a versão {number}, e as avaliações mostram Versão aguardando ativação até você ativá-la.}}',
    confirm: 'Confirmar',
    cancel: 'Agora não',
    waiting: 'Confirme no seu dispositivo para continuar.',
    decided: '{kind, select, activate {Versão ativada.} other {Versão recusada.}}',
    rejectedNote: 'Esta versão foi recusada e não volta a ser usada.',
    failure:
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} limited {Muitas tentativas. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} rejected {Esta versão já foi recusada, e a recusa não pode ser desfeita.} other {Não deu certo desta vez. Tente de novo.}}',
    factOf: '{fact} {target}',
    target: {
      current: 'da pessoa avaliada',
      principal: 'do requerente principal',
      unit: 'da unidade',
      edge: 'do vínculo',
      firstEdge: 'do primeiro vínculo do caminho',
      lineage: 'da linha de ascendência',
      ancestor: 'do ascendente',
    },
    fact: {
      person: {
        birthDate: 'data de nascimento',
        ageYears: 'idade em anos',
        citizenships: 'cidadanias',
        residenceCountry: 'país onde mora',
        educationLevel: 'escolaridade',
        monthlyActiveIncome: 'renda mensal do trabalho',
        monthlyPassiveIncome: 'renda mensal sem trabalho (aluguel, aposentadoria, investimentos)',
        liquidAssets: 'bens fáceis de transformar em dinheiro',
        visaRefusals: 'vistos negados',
        dependsOnPrincipal: 'depende do requerente principal',
        studying: 'está estudando',
        hasSpouse: 'tem cônjuge',
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
        citizenshipsAtChildBirth: 'cidadanias quando o filho nasceu',
      },
    },
    collection: {
      unit: {
        members: 'pessoas da unidade',
        dependents: 'dependentes da unidade',
      },
      principal: {
        ancestors: 'ascendentes do requerente principal',
      },
      lineage: {
        links: 'elos da linha de ascendência',
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
      unmodeled: 'Caso que a regra não descreve (fica em aberto)',
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
      all: 'Todas estas valem',
      any: 'Pelo menos uma destas vale',
      not: 'Isto não vale',
      add: 'Soma de',
      sub: 'Diferença entre',
      mul: 'Multiplicado por {by}',
      min: 'O menor entre',
      max: 'O maior entre',
      convert: 'Convertido para {currency}',
      since: 'Já se passaram {duration} desde',
      count: 'Quantas {over}{generations}',
      some: 'Alguma das {over}{generations}',
      every: 'Todas as {over}{generations}',
      sum: 'Soma, entre as {over}{generations}',
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
    keep: 'Imprima esta página ou anote o código à mão, e guarde num lugar seguro, fora do computador.',
    print: 'Imprimir',
    download: 'Baixar como arquivo de texto',
    downloadWarning:
      'Um arquivo de texto pode parar numa pasta sincronizada, como iCloud, Google Drive ou OneDrive, e aí o código fica guardado na nuvem. Se puder, prefira imprimir ou anotar.',
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
      keep: 'Guarde junto com o código de recuperação da conta: impresso ou anotado à mão, num lugar seguro, fora do computador. Se você perder todas as chaves de acesso, só ele abre o cofre.',
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
      knowledgeDecisions: 'Decisões sobre regras (ativações e recusas)',
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
