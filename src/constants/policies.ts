/**
 * Textos das políticas públicas.
 *
 * Centralizados aqui para serem revisados sem mexer em componente. Duas regras
 * que valem mais que o conteúdo em si:
 *
 *  1. **Nada aqui pode afirmar o que o sistema não faz.** Cada afirmação deste
 *     arquivo foi conferida contra o código: não há campo de e-mail no banco,
 *     não há rastreador de terceiro, a senha usa Argon2id, a sessão é revogada
 *     na hora. Uma política de privacidade que descreve um sistema imaginário é
 *     pior que nenhuma — é declaração falsa sobre tratamento de dado pessoal.
 *
 *  2. **O que depende do negócio fica como `[preencher]`.** Razão social, CNPJ,
 *     endereço, canal do titular e prazo de guarda são fatos que o código não
 *     sabe. Inventá-los criaria compromisso legal que ninguém assumiu.
 *
 * Este texto não substitui revisão jurídica.
 */

export type PolicySlug = "privacidade" | "uso" | "cookies" | "seguranca"

export interface PolicySection {
  heading: string
  /** Parágrafos. Strings simples: nada de HTML vindo daqui. */
  body: string[]
  /** Itens de lista, quando a seção enumera. */
  items?: string[]
}

export interface Policy {
  slug: PolicySlug
  title: string
  /** Frase curta sob o título. */
  summary: string
  sections: PolicySection[]
}

/** Trocar por data real a cada revisão do texto. */
export const POLICIES_UPDATED_AT = "2026-11-12"

/** O que o dono precisa preencher antes de publicar. Aparece como aviso na tela. */
export const POLICY_PLACEHOLDER = "[preencher]"

export const POLICY_ORDER: PolicySlug[] = ["privacidade", "uso", "cookies", "seguranca"]

export const POLICIES: Record<PolicySlug, Policy> = {
  privacidade: {
    slug: "privacidade",
    title: "Política de Privacidade",
    summary: "O que a barbearia guarda sobre você, por quê, e o que você pode pedir.",
    sections: [
      {
        heading: "Quem é responsável",
        body: [
          `O tratamento dos dados é feito por ${POLICY_PLACEHOLDER} (razão social), inscrita no ` +
            `CNPJ ${POLICY_PLACEHOLDER}, com endereço em ${POLICY_PLACEHOLDER}.`,
          `Para falar sobre seus dados — acessar, corrigir, excluir ou tirar dúvidas — use ` +
            `${POLICY_PLACEHOLDER}.`,
        ],
      },
      {
        heading: "O que coletamos",
        body: [
          "Só o necessário para marcar e cumprir um atendimento. Nada além disso é pedido, e " +
            "campo que não existe não pode vazar.",
        ],
        items: [
          "Nome — opcional. Serve para a barbearia saber quem vai atender.",
          "WhatsApp — obrigatório. É como identificamos você e como falamos sobre o seu horário.",
          "Serviço, data e horário escolhidos, e a observação que você escrever (se escrever).",
          "Senha — apenas se você criar conta. Guardada como hash Argon2id; ninguém, nem a " +
            "barbearia, consegue lê-la.",
          "Registros técnicos de segurança, como tentativas de login malsucedidas.",
        ],
      },
      {
        heading: "O que NÃO coletamos",
        body: [
          "Esta lista é tão importante quanto a de cima, e é verificável no código do sistema:",
        ],
        items: [
          "E-mail — o sistema não tem onde guardar.",
          "CPF, RG ou qualquer documento.",
          "Dados de cartão. Quando há pagamento, ele é feito por Pix direto para a conta da " +
            "barbearia; nenhum dado bancário seu passa por este site.",
          "Localização, lista de contatos ou qualquer dado do seu aparelho.",
          "Perfil de navegação: não há rastreador, pixel ou ferramenta de análise de terceiro.",
        ],
      },
      {
        heading: "Com quem compartilhamos",
        body: [
          "Com ninguém para fins de marketing ou publicidade — seus dados não são vendidos nem " +
            "cedidos.",
          "Há dois casos técnicos, e os dois existem para o serviço funcionar:",
        ],
        items: [
          "Hospedagem: os dados ficam em servidor e banco de dados contratados para operar o " +
            "sistema, e são usados só para isso.",
          "WhatsApp: quando VOCÊ clica em um botão para falar com a barbearia, o site abre uma " +
            "conversa com uma mensagem pronta. A partir daí vale a política do WhatsApp, e o " +
            "envio é sempre uma ação sua — nada é enviado sozinho.",
        ],
      },
      {
        heading: "Por quanto tempo guardamos",
        body: [
          `Os registros de atendimento são mantidos por ${POLICY_PLACEHOLDER}, prazo definido ` +
            "pela barbearia conforme a necessidade do negócio e as obrigações legais aplicáveis.",
          "Você pode pedir a exclusão dos seus dados a qualquer momento pelo canal acima. " +
            "Atendimentos já realizados podem precisar ser mantidos por obrigação legal ou " +
            "fiscal, e nesse caso explicamos o motivo.",
        ],
      },
      {
        heading: "Seus direitos",
        body: [
          "A Lei Geral de Proteção de Dados (Lei 13.709/2018) garante que você peça, a qualquer " +
            "momento e sem custo:",
        ],
        items: [
          "confirmação de que tratamos seus dados, e acesso a eles;",
          "correção de dado incompleto ou desatualizado;",
          "anonimização, bloqueio ou eliminação de dado desnecessário ou excessivo;",
          "portabilidade dos dados;",
          "informação sobre com quem compartilhamos;",
          "revogação do consentimento, quando o tratamento se basear nele.",
        ],
      },
    ],
  },

  uso: {
    slug: "uso",
    title: "Termos de Uso",
    summary: "As regras do agendamento, do cancelamento e da convivência.",
    sections: [
      {
        heading: "Como funciona o agendamento",
        body: [
          "Você escolhe serviço, dia e horário entre os que estiverem abertos. O pedido não " +
            "confirma sozinho: a barbearia precisa aprovar.",
          "Enquanto aguarda a decisão, o horário fica segurado para você — não é oferecido a " +
            "outra pessoa. Se o prazo passar sem decisão, o horário volta a ficar disponível.",
        ],
      },
      {
        heading: "Pagamento",
        body: [
          "Quando a barbearia exige pagamento para confirmar, o Pix aparece já na tela do pedido " +
            "e você pode pagar na hora, sem esperar aprovação.",
          "Depois de pagar, avise pelo botão da própria tela. A confirmação do horário só " +
            "acontece quando a barbearia confere o recebimento — o sistema nunca marca um " +
            "pagamento como recebido por conta própria.",
          "Recusa de um pedido não devolve dinheiro automaticamente. Se você pagou e o pedido " +
            "não for aceito, a devolução é tratada diretamente com a barbearia.",
        ],
      },
      {
        heading: "Cancelamento e remarcação",
        body: [
          "Você pode cancelar pelo link do seu agendamento dentro do prazo indicado na própria " +
            "tela. Passado esse prazo, fale com a barbearia — o horário já está reservado para " +
            "você e alguém deixou de usá-lo.",
          "A barbearia pode recusar ou cancelar um pedido, e avisa quando isso acontece.",
        ],
      },
      {
        heading: "Atrasos e não comparecimento",
        body: [
          `Tolerância de atraso: ${POLICY_PLACEHOLDER}. Depois disso o atendimento pode ser ` +
            "encurtado ou remarcado, porque o horário seguinte é de outra pessoa.",
          `Não comparecer sem avisar pode levar a ${POLICY_PLACEHOLDER}.`,
        ],
      },
      {
        heading: "Conduta",
        body: [
          "Pedimos respeito com a equipe e com os outros clientes. A barbearia pode recusar " +
            "atendimento em caso de desrespeito, e pode bloquear o acesso de quem usar o sistema " +
            "para fraude, automação abusiva ou tentativa de prejudicar o serviço.",
          "Os horários oferecidos são para uso real. Reservar em massa, ou com dados de outra " +
            "pessoa, é motivo de bloqueio.",
        ],
      },
    ],
  },

  cookies: {
    slug: "cookies",
    title: "Política de Cookies",
    summary: "Só o estritamente necessário. Nenhum rastreador, nenhum terceiro.",
    sections: [
      {
        heading: "O resumo",
        body: [
          "Este site não usa cookie de publicidade, de rede social nem de análise de audiência. " +
            "Não há Google Analytics, pixel de rede social ou qualquer rastreador de terceiro.",
          "O que existe é o mínimo para o site funcionar: manter você conectado e lembrar do " +
            "pedido que você acabou de fazer.",
        ],
      },
      {
        heading: "O que guardamos no seu navegador",
        body: ["Três coisas, todas necessárias para o serviço funcionar:"],
        items: [
          "Cookie de sessão (quem tem conta): mantém você conectado sem digitar a senha a cada " +
            "página. É httpOnly — o JavaScript do site não consegue lê-lo, o que protege contra " +
            "roubo de sessão.",
          "Link do seu pedido: guardado no navegador para você reencontrar o agendamento ao " +
            "voltar depois, mesmo tendo fechado a aba.",
          "Rascunho do agendamento em andamento: some ao fechar a aba.",
        ],
      },
      {
        heading: "Por que não há banner pedindo permissão para rastrear",
        body: [
          "Porque não há nada a rastrear. A LGPD exige consentimento para tratamento que vai " +
            "além do necessário à prestação do serviço, e é justamente isso que não acontece " +
            "aqui — cada item acima existe para o agendamento funcionar.",
          "O aviso que aparece na primeira visita é de transparência, não um pedido de " +
            "autorização: ele informa o que é guardado e sai do caminho.",
        ],
      },
      {
        heading: "Como apagar",
        body: [
          "Limpar os dados do site pelo seu navegador apaga tudo que foi citado. O efeito é " +
            "perder o acesso rápido ao pedido em andamento e precisar entrar de novo se tiver " +
            "conta. Nenhum dado do seu atendimento é perdido — ele vive no sistema da barbearia, " +
            "não no seu navegador.",
        ],
      },
    ],
  },

  seguranca: {
    slug: "seguranca",
    title: "Segurança",
    summary: "Como protegemos seu acesso e seus dados — sem promessa que não cumprimos.",
    sections: [
      {
        heading: "Sua senha",
        body: [
          "Senhas são guardadas como hash Argon2id, o algoritmo recomendado hoje para esse fim. " +
            "Ninguém consegue recuperar a senha original a partir do que está no banco — nem a " +
            "barbearia, nem quem tivesse acesso indevido ao banco.",
          "Senhas nunca aparecem em registros do sistema: o mecanismo de log remove valores " +
            "sensíveis antes de gravar qualquer coisa.",
        ],
      },
      {
        heading: "Sua sessão",
        body: [
          "Ao trocar a senha, todas as sessões abertas são encerradas no mesmo instante — " +
            "inclusive em outros aparelhos. O mesmo vale se a conta for bloqueada.",
          "O encerramento é imediato: a cada requisição o sistema confere se a sessão continua " +
            "válida, em vez de confiar num token que ainda não expirou.",
          "Se um código de sessão antigo for reapresentado — sinal clássico de roubo —, todas as " +
            "sessões daquela conta são derrubadas por precaução.",
        ],
      },
      {
        heading: "Seus dados em trânsito",
        body: [
          "O acesso ao site é por HTTPS. O tráfego entre o seu aparelho e o sistema é " +
            "criptografado pelo próprio protocolo.",
        ],
      },
      {
        heading: "Seu horário",
        body: [
          "A garantia de que dois clientes não recebem o mesmo horário é feita pelo banco de " +
            "dados, não por uma checagem que poderia falhar sob corrida. Mesmo com dois pedidos " +
            "no mesmo instante, apenas um é aceito.",
        ],
      },
      {
        heading: "Encontrou um problema?",
        body: [
          `Se você identificar uma falha de segurança, avise em ${POLICY_PLACEHOLDER} antes de ` +
            "divulgar. Agradecemos o aviso responsável e damos retorno.",
        ],
      },
      {
        heading: "O que NÃO prometemos",
        body: [
          "Nenhum sistema é inviolável, e dizer o contrário seria desonesto. Não temos " +
            "certificação de segurança, não fazemos auditoria externa periódica e não garantimos " +
            "disponibilidade ininterrupta. O que fazemos está descrito acima, e pode ser cobrado.",
        ],
      },
    ],
  },
}
