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
      settings: 'Configurações',
    },
  },
  /** The Settings page (spec 0006, R9). Option labels follow the axis identifiers. */
  settings: {
    title: 'Configurações',
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
      '{reason, select, cancelled {Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.} refused {Essa chave de acesso não está ligada a nenhuma conta do Arca. Tente com outra.} limited {Muitas tentativas de entrar por esta conexão. Espere um pouco e tente de novo.} unavailable {Este navegador não aceita chaves de acesso. Abra o Arca em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    inviteOnly: 'Ainda não tem conta? O Arca funciona só por convite. Peça um a quem já usa.',
  },
  session: {
    signedIn: 'Você entrou como {email}.',
    signIn: 'Entrar',
    kitPending:
      'Falta guardar o seu kit de recuperação. Sem ele, perder todas as chaves de acesso deixa você fora da conta.',
    kitLink: 'Guardar o kit agora',
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
        '{reason, select, not_found {Esse código não serve. Ou ele está errado, ou o Arca já tem uma conta.} email_unavailable {O Arca ainda não consegue mandar emails. Tente de novo mais tarde.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
    },
    register: {
      title: 'Criar sua chave de acesso',
      lead: 'Digite de novo o código de cadastro. Depois, o seu celular ou computador vai pedir para salvar uma chave de acesso para o Arca.',
      code: 'Código de cadastro',
      submit: 'Criar chave de acesso',
      waiting: 'Confirme no seu dispositivo para continuar.',
      failure:
        '{reason, select, expired {Este link não vale mais. Peça um novo.} invalid_code {Esse código não confere. Confira e tente de novo.} cancelled {Não deu para criar a chave de acesso. Tente de novo quando quiser.} refused {Não deu para criar a conta com esta chave de acesso. Se a conta já existe, entre com a sua chave.} unavailable {Este navegador não aceita chaves de acesso. Abra o link em um navegador atualizado, como Chrome, Safari, Edge ou Firefox.} limited {Muitas tentativas por esta conexão. Espere um pouco e tente de novo.} unreachable {Não conseguimos falar com o Arca agora. Confira a internet e tente de novo.} other {Não deu certo desta vez. Tente de novo.}}',
      newLink: 'Pedir um novo link',
      signIn: 'Entrar',
    },
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
    /** The link that opens an invite; it carries a one-time token and never names the inviter. */
    invite: {
      subject: 'Você recebeu um convite para o Arca',
      body: 'Uma pessoa que já usa o Arca convidou você para entrar. Use o link abaixo para criar sua conta com uma chave de acesso. Ele vale por 48 horas e funciona uma vez só. Na página, você vê quem mandou o convite. Se não esperava por isso, pode ignorar este email.',
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
