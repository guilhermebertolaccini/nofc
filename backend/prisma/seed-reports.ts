/**
 * seed-reports.ts
 *
 * Popula o banco com dados realistas para testar os relatórios.
 * Cria: segmentos, operadores, contatos, linhas, conversas e campanhas.
 *
 * Uso:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-reports.ts
 *
 * ATENÇÃO: Executa limpeza de dados anteriores deste seed (identificados
 * pelo prefixo de telefone 5599 em contatos e 5588 em linhas).
 * Não afeta dados reais já existentes.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Horário comercial aleatório: 08h–18h
  d.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const SEGMENT_NAMES = ['Cobrança A', 'Cobrança B', 'Vendas', 'Suporte'];

const OPERATOR_DATA = [
  { name: 'Ana Paula Souza',    email: 'ana.paula@empresa.com',    segment: 'Cobrança A' },
  { name: 'Carlos Eduardo Lima',email: 'carlos.lima@empresa.com',  segment: 'Cobrança A' },
  { name: 'Fernanda Rocha',     email: 'fernanda.rocha@empresa.com',segment: 'Cobrança A' },
  { name: 'Roberto Santos',     email: 'roberto.santos@empresa.com',segment: 'Cobrança B' },
  { name: 'Patricia Alves',     email: 'patricia.alves@empresa.com',segment: 'Cobrança B' },
  { name: 'Marcos Pereira',     email: 'marcos.pereira@empresa.com',segment: 'Cobrança B' },
  { name: 'Juliana Costa',      email: 'juliana.costa@empresa.com', segment: 'Vendas'     },
  { name: 'Diego Ferreira',     email: 'diego.ferreira@empresa.com',segment: 'Vendas'     },
  { name: 'Camila Nunes',       email: 'camila.nunes@empresa.com',  segment: 'Suporte'    },
  { name: 'Rafael Mendes',      email: 'rafael.mendes@empresa.com', segment: 'Suporte'    },
];

// 50 contatos — telefones no padrão 5599XXXXXXXXX (prefixo 5599 = identifica seed)
const CONTACT_DATA: { name: string; cpf: string; contract: string; segment: string }[] = [
  { name: 'João Alves Silva',       cpf: '111.222.333-01', contract: 'CONT-20001', segment: 'Cobrança A' },
  { name: 'Maria Oliveira Santos',  cpf: '111.222.333-02', contract: 'CONT-20002', segment: 'Cobrança A' },
  { name: 'Pedro Costa Ramos',      cpf: '111.222.333-03', contract: 'CONT-20003', segment: 'Cobrança A' },
  { name: 'Luciana Ferreira Lima',  cpf: '111.222.333-04', contract: 'CONT-20004', segment: 'Cobrança A' },
  { name: 'Ricardo Barbosa',        cpf: '111.222.333-05', contract: 'CONT-20005', segment: 'Cobrança A' },
  { name: 'Sandra Moura Azevedo',   cpf: '111.222.333-06', contract: 'CONT-20006', segment: 'Cobrança A' },
  { name: 'Thiago Monteiro',        cpf: '111.222.333-07', contract: 'CONT-20007', segment: 'Cobrança A' },
  { name: 'Beatriz Andrade',        cpf: '111.222.333-08', contract: 'CONT-20008', segment: 'Cobrança A' },
  { name: 'Felipe Carvalho Neto',   cpf: '111.222.333-09', contract: 'CONT-20009', segment: 'Cobrança A' },
  { name: 'Aline Pimentel',         cpf: '111.222.333-10', contract: 'CONT-20010', segment: 'Cobrança A' },
  { name: 'Gustavo Lopes',          cpf: '222.333.444-01', contract: 'CONT-20011', segment: 'Cobrança B' },
  { name: 'Renata Cavalcanti',      cpf: '222.333.444-02', contract: 'CONT-20012', segment: 'Cobrança B' },
  { name: 'Sérgio Nascimento',      cpf: '222.333.444-03', contract: 'CONT-20013', segment: 'Cobrança B' },
  { name: 'Camila Rodrigues',       cpf: '222.333.444-04', contract: 'CONT-20014', segment: 'Cobrança B' },
  { name: 'Fábio Teixeira',         cpf: '222.333.444-05', contract: 'CONT-20015', segment: 'Cobrança B' },
  { name: 'Vanessa Correia',        cpf: '222.333.444-06', contract: 'CONT-20016', segment: 'Cobrança B' },
  { name: 'Leandro Freitas',        cpf: '222.333.444-07', contract: 'CONT-20017', segment: 'Cobrança B' },
  { name: 'Cristina Vieira',        cpf: '222.333.444-08', contract: 'CONT-20018', segment: 'Cobrança B' },
  { name: 'Anderson Mota',          cpf: '222.333.444-09', contract: 'CONT-20019', segment: 'Cobrança B' },
  { name: 'Priscila Fonseca',       cpf: '222.333.444-10', contract: 'CONT-20020', segment: 'Cobrança B' },
  { name: 'Eduardo Campos',         cpf: '333.444.555-01', contract: 'CONT-20021', segment: 'Vendas'     },
  { name: 'Natalia Bastos',         cpf: '333.444.555-02', contract: 'CONT-20022', segment: 'Vendas'     },
  { name: 'Vitor Martins',          cpf: '333.444.555-03', contract: 'CONT-20023', segment: 'Vendas'     },
  { name: 'Larissa Cardoso',        cpf: '333.444.555-04', contract: 'CONT-20024', segment: 'Vendas'     },
  { name: 'Henrique Duarte',        cpf: '333.444.555-05', contract: 'CONT-20025', segment: 'Vendas'     },
  { name: 'Patrícia Borges',        cpf: '333.444.555-06', contract: 'CONT-20026', segment: 'Vendas'     },
  { name: 'Alexandre Castro',       cpf: '333.444.555-07', contract: 'CONT-20027', segment: 'Vendas'     },
  { name: 'Tatiane Guimarães',      cpf: '333.444.555-08', contract: 'CONT-20028', segment: 'Vendas'     },
  { name: 'Rodrigo Pinheiro',       cpf: '333.444.555-09', contract: 'CONT-20029', segment: 'Vendas'     },
  { name: 'Isabela Moreira',        cpf: '333.444.555-10', contract: 'CONT-20030', segment: 'Vendas'     },
  { name: 'Danilo Sousa',           cpf: '444.555.666-01', contract: 'CONT-20031', segment: 'Suporte'    },
  { name: 'Elaine Ribeiro',         cpf: '444.555.666-02', contract: 'CONT-20032', segment: 'Suporte'    },
  { name: 'Marcelo Araujo',         cpf: '444.555.666-03', contract: 'CONT-20033', segment: 'Suporte'    },
  { name: 'Juliana Pires',          cpf: '444.555.666-04', contract: 'CONT-20034', segment: 'Suporte'    },
  { name: 'Bruno Gomes',            cpf: '444.555.666-05', contract: 'CONT-20035', segment: 'Suporte'    },
  { name: 'Andreia Machado',        cpf: '444.555.666-06', contract: 'CONT-20036', segment: 'Suporte'    },
  { name: 'Flávio Cunha',           cpf: '444.555.666-07', contract: 'CONT-20037', segment: 'Suporte'    },
  { name: 'Simone Medeiros',        cpf: '444.555.666-08', contract: 'CONT-20038', segment: 'Suporte'    },
  { name: 'Guilherme Tavares',      cpf: '444.555.666-09', contract: 'CONT-20039', segment: 'Suporte'    },
  { name: 'Debora Sampaio',         cpf: '444.555.666-10', contract: 'CONT-20040', segment: 'Suporte'    },
  // Contatos sem segmento (Cobrança A extra)
  { name: 'Ronaldo Braga',          cpf: '555.666.777-01', contract: 'CONT-20041', segment: 'Cobrança A' },
  { name: 'Cláudia Esteves',        cpf: '555.666.777-02', contract: 'CONT-20042', segment: 'Cobrança A' },
  { name: 'Tiago Rezende',          cpf: '555.666.777-03', contract: 'CONT-20043', segment: 'Cobrança B' },
  { name: 'Monica Paiva',           cpf: '555.666.777-04', contract: 'CONT-20044', segment: 'Cobrança B' },
  { name: 'Nelson Queiroz',         cpf: '555.666.777-05', contract: 'CONT-20045', segment: 'Vendas'     },
  { name: 'Viviane Lacerda',        cpf: '555.666.777-06', contract: 'CONT-20046', segment: 'Vendas'     },
  { name: 'Cesar Augusto Prado',    cpf: '555.666.777-07', contract: 'CONT-20047', segment: 'Suporte'    },
  { name: 'Mariana Figueiredo',     cpf: '555.666.777-08', contract: 'CONT-20048', segment: 'Cobrança A' },
  { name: 'Lucas Batista',          cpf: '555.666.777-09', contract: 'CONT-20049', segment: 'Cobrança B' },
  { name: 'Silvana Corrêa',         cpf: '555.666.777-10', contract: 'CONT-20050', segment: 'Vendas'     },
];

const OPERATOR_MESSAGES = [
  'Bom dia! Aqui é {operator} da Paschoalotto. Gostaria de falar com {name}, por favor.',
  'Olá {name}! Temos um assunto importante referente ao contrato {contract}.',
  'Poderia confirmar seu CPF para que eu possa verificar sua situação?',
  'Temos condições especiais de renegociação disponíveis para o senhor(a).',
  'Posso apresentar uma proposta de acordo com desconto de até 50% nos juros?',
  'O contrato {contract} possui saldo em aberto. Podemos resolver isso hoje?',
  'Existe uma oferta válida até o final do mês. Posso detalhar os valores?',
  'Posso enviar o boleto para o senhor(a) analisar com calma?',
  'A proposta inclui entrada reduzida e parcelamento em até 12x.',
  'Ficou com alguma dúvida sobre as condições apresentadas?',
  'Vou registrar seu interesse e encaminhar para a equipe responsável.',
  'Obrigado pelo contato! Terei o prazer de ajudá-lo(a).',
  'Para darmos continuidade, preciso confirmar alguns dados cadastrais.',
  'Temos diferentes opções de pagamento: à vista, 3x, 6x ou 12x.',
  'O desconto especial está disponível somente até o dia 30.',
];

const CONTACT_MESSAGES = [
  'Sim, pode falar.',
  'Quem é?',
  'Não tenho dinheiro no momento.',
  'Pode me mandar o boleto.',
  'Vou verificar e te retorno em breve.',
  'Não reconheço essa dívida.',
  'Qual é o valor total?',
  'Quando vence?',
  'Pode fazer um desconto maior?',
  'Não tenho interesse agora.',
  'Me manda as condições por escrito.',
  'Tá certo, pode enviar.',
  'Preciso conversar com minha esposa antes.',
  'Quanto ficaria em 6 parcelas?',
  'Esse desconto é somente hoje?',
  'Ok, vou analisar e retorno amanhã.',
  'Já paguei isso, verifique novamente.',
  'Não é minha dívida.',
  'Pode parcelar em mais vezes?',
  'Qual o e-mail para enviar o comprovante?',
];

// Tabulações mais comuns (serão consultadas do banco)
const COMMON_TABULATION_NAMES = [
  'SEM RESPOSTA DO CLIENTE',
  'CLIENTE EM NEGOCIAÇÃO',
  'ACORDO REALIZADO',
  'SEM INTERESSE',
  'PENDENTE CONFIRMAÇÃO DE DADOS',
  'MINUTA DE ACORDO - NEGOCIACAO / ENVIO',
  'RECUSA-SE A NEGOCIAR',
  'BOLETO PAGO',
  'RENEGOCIAÇÃO – INDICACAO',
  'COMPROVANTE',
  'REENVIO BOLETO/OPERAÇÃO',
  'SEM CONDIÇÕES',
  'CONTATO COM TERCEIRO',
  'DUVIDAS',
];

const CAMPAIGN_NAMES = [
  'Campanha Recuperação Janeiro',
  'Campanha Desconto Especial',
  'Campanha Renegociação Fevereiro',
  'Ação Cobrança Ativa',
  'Campanha Oferta Relâmpago',
  'Campanha Black Friday',
  'Campanha Fim de Ano',
  'Campanha Boleto Especial',
  'Ação Retorno Pendentes',
  'Campanha Parcelamento Flex',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🌱 Iniciando seed de relatórios...\n');

  // -------------------------------------------------------------------------
  // 0. Limpeza de dados anteriores deste seed
  // -------------------------------------------------------------------------
  console.log('🧹 Limpando dados anteriores do seed...');

  // Buscar IDs dos contatos deste seed (prefixo 5599)
  const seedContacts = await prisma.contact.findMany({
    where: { phone: { startsWith: '5599' } },
    select: { id: true, phone: true },
  });
  const seedPhones = seedContacts.map((c) => c.phone);

  if (seedPhones.length > 0) {
    await prisma.conversation.deleteMany({
      where: { contactPhone: { in: seedPhones } },
    });
    await prisma.campaign.deleteMany({
      where: { contactPhone: { in: seedPhones } },
    });
    await prisma.contact.deleteMany({
      where: { phone: { startsWith: '5599' } },
    });
  }

  // Buscar linhas deste seed (prefixo 5588)
  const seedLines = await prisma.linesStock.findMany({
    where: { phone: { startsWith: '5588' } },
    select: { id: true },
  });
  const seedLineIds = seedLines.map((l) => l.id);

  if (seedLineIds.length > 0) {
    await prisma.lineOperator.deleteMany({
      where: { lineId: { in: seedLineIds } },
    });
    await prisma.linesStock.deleteMany({
      where: { phone: { startsWith: '5588' } },
    });
  }

  // Remover operadores deste seed (email @empresa.com)
  await prisma.user.deleteMany({
    where: { email: { endsWith: '@empresa.com' } },
  });

  console.log('   ✅ Limpeza concluída.\n');

  // -------------------------------------------------------------------------
  // 1. Segmentos
  // -------------------------------------------------------------------------
  console.log('📦 Criando segmentos...');

  const segmentMap: Record<string, number> = {};

  // Garantir que Padrão existe
  const padraoSeg = await prisma.segment.upsert({
    where: { name: 'Padrão' },
    update: {},
    create: { name: 'Padrão' },
  });
  segmentMap['Padrão'] = padraoSeg.id;

  for (const name of SEGMENT_NAMES) {
    const seg = await prisma.segment.upsert({
      where: { name },
      update: {},
      create: { name, identifier: 'proprietario', allocationEnabled: true },
    });
    segmentMap[name] = seg.id;
  }

  console.log(`   ✅ ${Object.keys(segmentMap).length} segmentos prontos.\n`);

  // -------------------------------------------------------------------------
  // 2. Tabulações (reutilizar existentes ou criar)
  // -------------------------------------------------------------------------
  console.log('🏷️  Carregando tabulações...');

  const allTabulations = await prisma.tabulation.findMany();

  if (allTabulations.length === 0) {
    console.log('   ⚠️  Nenhuma tabulação encontrada. Execute o seed principal primeiro.');
    console.log('      npx prisma db seed');
    process.exit(1);
  }

  const tabulationMap: Record<string, number> = {};
  for (const tab of allTabulations) {
    tabulationMap[tab.name] = tab.id;
  }

  // Lista de IDs que serão usados nas conversas
  const usableTabulationIds = COMMON_TABULATION_NAMES
    .map((name) => tabulationMap[name])
    .filter(Boolean);

  // Fallback: usar qualquer tabulação se as esperadas não existirem
  const tabulationIds =
    usableTabulationIds.length > 0
      ? usableTabulationIds
      : allTabulations.map((t) => t.id);

  console.log(`   ✅ ${allTabulations.length} tabulações disponíveis.\n`);

  // -------------------------------------------------------------------------
  // 3. Operadores
  // -------------------------------------------------------------------------
  console.log('👤 Criando operadores...');

  const operatorPassword = await argon2.hash('operator123');
  const operatorMap: Record<string, { id: number; name: string; segmentId: number }> = {};

  for (const op of OPERATOR_DATA) {
    const user = await prisma.user.create({
      data: {
        name: op.name,
        email: op.email,
        password: operatorPassword,
        role: 'operator',
        segment: segmentMap[op.segment],
        status: 'Offline',
        identifier: 'proprietario',
        isActive: true,
      },
    });
    operatorMap[op.email] = { id: user.id, name: user.name, segmentId: segmentMap[op.segment] };
  }

  console.log(`   ✅ ${OPERATOR_DATA.length} operadores criados (senha: operator123).\n`);

  // -------------------------------------------------------------------------
  // 4. Contatos
  // -------------------------------------------------------------------------
  console.log('📇 Criando contatos...');

  const contactMap: Record<string, { id: number; phone: string; name: string; segmentName: string; segmentId: number; cpf: string; contract: string }> = {};

  for (let i = 0; i < CONTACT_DATA.length; i++) {
    const cd = CONTACT_DATA[i];
    // Telefone: 5599 + zero-padded index (10 digits total after prefix)
    const phone = `5599${String(i + 1).padStart(8, '0')}`;
    const segmentId = segmentMap[cd.segment];

    const contact = await prisma.contact.create({
      data: {
        name: cd.name,
        phone,
        cpf: cd.cpf,
        contract: cd.contract,
        segment: segmentId,
        isCPC: Math.random() > 0.7,
      },
    });

    contactMap[phone] = {
      id: contact.id,
      phone,
      name: cd.name,
      segmentName: cd.segment,
      segmentId,
      cpf: cd.cpf,
      contract: cd.contract,
    };
  }

  console.log(`   ✅ ${CONTACT_DATA.length} contatos criados.\n`);

  // -------------------------------------------------------------------------
  // 5. Linhas (LinesStock)
  // -------------------------------------------------------------------------
  console.log('📱 Criando linhas...');

  const lineData = [
    { phone: '5588000000001', evolutionName: 'linha-cobr-a-1', segment: 'Cobrança A' },
    { phone: '5588000000002', evolutionName: 'linha-cobr-a-2', segment: 'Cobrança A' },
    { phone: '5588000000003', evolutionName: 'linha-cobr-b-1', segment: 'Cobrança B' },
    { phone: '5588000000004', evolutionName: 'linha-cobr-b-2', segment: 'Cobrança B' },
    { phone: '5588000000005', evolutionName: 'linha-vendas-1', segment: 'Vendas'     },
    { phone: '5588000000006', evolutionName: 'linha-vendas-2', segment: 'Vendas'     },
    { phone: '5588000000007', evolutionName: 'linha-suporte-1',segment: 'Suporte'    },
    { phone: '5588000000008', evolutionName: 'linha-suporte-2',segment: 'Suporte'    },
  ];

  const lines: { id: number; segmentName: string }[] = [];

  for (let i = 0; i < lineData.length; i++) {
    const ld = lineData[i];
    const segId = segmentMap[ld.segment];
    const transferDaysAgo = randInt(10, 60);
    const line = await prisma.linesStock.create({
      data: {
        phone: ld.phone,
        realNumber: ld.phone,
        evolutionName: ld.evolutionName,
        lineStatus: 'active',
        segment: segId,
        firstSegmentId: segId,
        firstTransferAt: daysAgo(transferDaysAgo),
        oficial: true,
      },
    });
    lines.push({ id: line.id, segmentName: ld.segment });
  }

  console.log(`   ✅ ${lines.length} linhas criadas.\n`);

  // -------------------------------------------------------------------------
  // 6. LineOperators (vincular operadores às linhas)
  // -------------------------------------------------------------------------
  console.log('🔗 Vinculando operadores às linhas...');

  const operatorsBySegment: Record<string, typeof operatorMap[string][]> = {};
  for (const op of Object.values(operatorMap)) {
    const segName = OPERATOR_DATA.find((o) =>
      segmentMap[o.segment] === op.segmentId
    )?.segment ?? '';
    if (!operatorsBySegment[segName]) operatorsBySegment[segName] = [];
    operatorsBySegment[segName].push(op);
  }

  for (const line of lines) {
    const ops = operatorsBySegment[line.segmentName] ?? [];
    if (ops.length === 0) continue;
    // Atribuir até 2 operadores por linha
    const assigned = pickN(ops, Math.min(2, ops.length));
    for (const op of assigned) {
      await prisma.lineOperator.create({
        data: { lineId: line.id, userId: op.id },
      });
    }
  }

  console.log('   ✅ Operadores vinculados.\n');

  // -------------------------------------------------------------------------
  // 7. Conversas
  //
  // Para cada contato, gera entre 2 e 4 "sessões" espalhadas nos últimos 60 dias.
  // Cada sessão tem 4–8 mensagens alternando operador/contato.
  // A última mensagem da sessão recebe uma tabulação (campo tabulation).
  // -------------------------------------------------------------------------
  console.log('💬 Gerando conversas...');

  const allContacts = Object.values(contactMap);
  let totalConversations = 0;
  const conversationsBatch: any[] = [];

  for (const contact of allContacts) {
    const segName = contact.segmentName;

    // Operadores do mesmo segmento do contato
    const segOps = operatorsBySegment[segName] ?? Object.values(operatorMap);

    // Número de sessões para este contato
    const numSessions = randInt(2, 4);

    // Distribuir sessões em dias distintos nos últimos 60 dias
    const sessionDays = pickN(
      Array.from({ length: 60 }, (_, i) => i + 1),
      numSessions,
    ).sort((a, b) => b - a); // mais antigas primeiro

    for (const dayAgo of sessionDays) {
      const operator = pick(segOps);
      const sessionTabulation = pick(tabulationIds);
      const messagesCount = randInt(4, 8);
      let currentTime = daysAgo(dayAgo);

      for (let msgIdx = 0; msgIdx < messagesCount; msgIdx++) {
        const isLast = msgIdx === messagesCount - 1;
        const isOperatorTurn = msgIdx % 2 === 0; // operador começa

        let message: string;
        if (isOperatorTurn) {
          message = pick(OPERATOR_MESSAGES)
            .replace('{operator}', operator.name)
            .replace('{name}', contact.name)
            .replace('{contract}', contact.contract);
        } else {
          message = pick(CONTACT_MESSAGES);
        }

        currentTime = addMinutes(currentTime, randInt(1, 15));

        conversationsBatch.push({
          contactName: contact.name,
          contactPhone: contact.phone,
          segment: contact.segmentId,
          userName: operator.name,
          userId: operator.id,
          message,
          sender: isOperatorTurn ? 'operator' : 'contact',
          datetime: new Date(currentTime),
          tabulation: isLast ? sessionTabulation : null,
          messageType: 'text',
          isAdminTest: false,
        });

        totalConversations++;
      }
    }
  }

  // Inserir em lotes de 200
  const BATCH_SIZE = 200;
  for (let i = 0; i < conversationsBatch.length; i += BATCH_SIZE) {
    const batch = conversationsBatch.slice(i, i + BATCH_SIZE);
    await prisma.conversation.createMany({ data: batch });
    process.stdout.write(`   📝 ${Math.min(i + BATCH_SIZE, conversationsBatch.length)}/${conversationsBatch.length} mensagens...\r`);
  }

  console.log(`\n   ✅ ${totalConversations} registros de conversa criados.\n`);

  // -------------------------------------------------------------------------
  // 8. Campanhas
  // -------------------------------------------------------------------------
  console.log('📣 Gerando campanhas...');

  const campaignBatch: any[] = [];
  const speeds = ['fast', 'medium', 'slow'];

  for (let i = 0; i < 40; i++) {
    const contact = pick(allContacts);
    const campaignDayAgo = randInt(1, 60);
    const responded = Math.random() > 0.4;

    campaignBatch.push({
      name: pick(CAMPAIGN_NAMES),
      contactName: contact.name,
      contactPhone: contact.phone,
      contactSegment: contact.segmentId,
      dateTime: daysAgo(campaignDayAgo),
      response: responded,
      speed: pick(speeds),
      retryCount: randInt(0, 3),
      useTemplate: false,
      isAdminTest: false,
    });
  }

  await prisma.campaign.createMany({ data: campaignBatch });

  console.log(`   ✅ ${campaignBatch.length} campanhas criadas.\n`);

  // -------------------------------------------------------------------------
  // Resumo final
  // -------------------------------------------------------------------------
  const conversationCount = await prisma.conversation.count({
    where: { contactPhone: { startsWith: '5599' } },
  });
  const contactCount = await prisma.contact.count({
    where: { phone: { startsWith: '5599' } },
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ SEED DE RELATÓRIOS CONCLUÍDO');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📦 Segmentos  : ${Object.keys(segmentMap).length} (${Object.keys(segmentMap).join(', ')})`);
  console.log(`👤 Operadores : ${OPERATOR_DATA.length} (senha: operator123)`);
  console.log(`📇 Contatos   : ${contactCount}`);
  console.log(`📱 Linhas     : ${lines.length}`);
  console.log(`💬 Conversas  : ${conversationCount}`);
  console.log(`📣 Campanhas  : ${campaignBatch.length}`);
  console.log('');
  console.log('📅 Período coberto: últimos 60 dias');
  console.log('🔍 Para testar: filtre pelo segmento e/ou intervalo de datas');
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('\n❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
