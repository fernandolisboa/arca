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
