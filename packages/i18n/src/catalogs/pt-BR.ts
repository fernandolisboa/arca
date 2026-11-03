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
