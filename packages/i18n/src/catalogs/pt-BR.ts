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
} as const;
