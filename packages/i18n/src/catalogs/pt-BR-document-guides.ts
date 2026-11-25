/** What a document guide entry says, in the screen's language (ADR-0039). */
export interface DocumentGuideWording {
  readonly office: string;
  readonly request: string;
  /** Only where the sources say how the apostille is obtained. */
  readonly apostille?: string;
}

const apostille =
  'Em cartório credenciado para apostilar. Os cartórios de notas e de registro das capitais apostilam, salvo os que a corregedoria local dispensou; no interior, nem todo cartório apostila. Se o documento só tiver assinatura digital, o tabelião precisa conseguir conferir a autenticidade dele.';

/**
 * The document guides' wording (ADR-0039), keyed by issuing country and document kind, apart from
 * the main catalog: it carries costs and deadlines the reviewed file's sources back, so a change
 * here goes to the same reviewers and changes the guide file's `wordingSha256`.
 */
export const documentGuide: Readonly<
  Record<string, Readonly<Record<string, DocumentGuideWording>>>
> = {
  BR: {
    birth_certificate: {
      office: 'Cartório de Registro Civil',
      request:
        'Peça a certidão no cartório onde o nascimento foi registrado ou, em versão eletrônica, em qualquer cartório, pelo Sistema Eletrônico dos Registros Públicos (Serp). A lei dá até 5 dias para a entrega. A primeira certidão de nascimento é gratuita; as outras são gratuitas para quem é reconhecidamente pobre.',
      apostille,
    },
    court_records: {
      office: 'Justiça Federal, pelo Sistema de Certidão Unificada',
      request:
        'Escolha o tipo de certidão (criminal, cível ou eleitoral) e os Tribunais Regionais Federais, da 1ª à 5ª Região, e informe o CPF e o e-mail. A certidão negativa sai na hora, para baixar; se houver registro, ela chega só por e-mail, em até seis horas.',
      apostille,
    },
    fund_transfer_records: {
      office: 'Banco Central, pelo Registrato',
      request:
        'Gere no Meu BC, com conta gov.br prata ou ouro e verificação em duas etapas, o Relatório de Câmbio e Transferências Internacionais. Ele mostra as compras e vendas de moeda estrangeira e as transferências internacionais que você fez. É de graça e fica pronto em até 2 dias úteis. O Banco Central não tem cópia dos contratos de câmbio: peça à instituição que fez a operação.',
    },
    marriage_certificate: {
      office: 'Cartório de Registro Civil',
      request:
        'Peça a certidão no cartório onde o casamento foi registrado ou, em versão eletrônica, em qualquer cartório, pelo Serp. A lei dá até 5 dias para a entrega.',
      apostille,
    },
    passport: {
      office: 'Polícia Federal',
      request:
        'Preencha o formulário no gov.br, pague a taxa de R$ 257,25 e agende o atendimento presencial, obrigatório até para quem tem menos de 18 anos. Depois do atendimento, o passaporte fica pronto em geral de 6 a 10 dias úteis, no mesmo posto. Este serviço é para quem está no Brasil.',
    },
    police_certificate: {
      office: 'Polícia Federal',
      request:
        'Emita pela internet, na hora e de graça. A certidão sai só em português e vale 90 dias. Com homônimo ou divergência no CPF, o sistema gera um protocolo para levar a uma unidade da Polícia Federal, e a certidão fica pronta em até 15 dias. Ela não reúne todos os registros das Justiças Estaduais, que emitem as próprias certidões.',
      apostille,
    },
    tax_return: {
      office: 'Receita Federal',
      request:
        'Baixe as cópias das declarações em PDF no Portal de Serviços, com conta gov.br prata ou ouro, na hora. As cópias de GFIP se pedem pelo chat; as de Dacon, DMED, Dimob, PER/DCOMP, LCDPR e da declaração de imposto de renda da pessoa física anterior a 2008, por processo. As outras que não dá para baixar se pedem em atendimento presencial agendado, menos a declaração da pessoa física e o recibo dela. O prazo estimado é de até 30 dias. Vale para declarações de pessoa física e de empresa; para as de empresa, quem pede precisa estar no quadro de sócios e administradores do CNPJ.',
    },
    vaccination_record: {
      office: 'Ministério da Saúde, pelo Meu SUS Digital',
      request:
        'Emita a carteira de vacinação digital no Meu SUS Digital, na web ou no aplicativo, com o histórico das vacinas já aplicadas.',
    },
  },
};
