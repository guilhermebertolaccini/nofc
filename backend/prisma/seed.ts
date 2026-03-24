import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Criar segmento padrão
  const segment = await prisma.segment.upsert({
    where: { name: 'Padrão' },
    update: {},
    create: {
      name: 'Padrão',
    },
  });

  console.log('✅ Segmento criado:', segment.name);

  // Criar tabulações
  const tabulationData = [
    { name: 'DUVIDAS', isCPC: false },
    { name: 'ENTREGA AMIGAVEL - INDICACAO', isCPC: true },
    { name: 'ENTREGA AMIGAVEL - NAO ATENDE AOS CRITERIOS', isCPC: false },
    { name: 'GEROU ACORDO DISCADOR', isCPC: true },
    { name: 'MINUTA DE ACORDO - NEGOCIACAO / ENVIO', isCPC: true },
    { name: 'NÚMERO COMERCIAL', isCPC: false },
    { name: 'OFERTA MIX', isCPC: false },
    { name: 'PENDENTE CONFIRMAÇÃO DE DADOS', isCPC: false },
    { name: 'PROBLEMA NO BEM - BUSCA/APREENSAO', isCPC: false },
    { name: 'RECLAMAÇÃO', isCPC: false },
    { name: 'RECUSA CONFIRMAR CPF/NOME', isCPC: false },
    { name: 'DISPARO AUTOMATICO - WHATSAPP', isCPC: false },
    { name: 'ACORDO REALIZADO', isCPC: true },
    { name: 'AGUARDANDO LIBERACAO DO JURIDICO', isCPC: false },
    { name: 'BAIXADO', isCPC: true },
    { name: 'BOLETO PAGO', isCPC: true },
    { name: 'CLIENTE ALEGA PAGAMENTO', isCPC: false },
    { name: 'CLIENTE COM AÇÃO CONTRÁRIA', isCPC: false },
    { name: 'CLIENTE EM NEGOCIAÇÃO', isCPC: false },
    { name: 'COMPROVANTE', isCPC: false },
    { name: 'CONTATO COM TERCEIRO', isCPC: false },
    { name: 'RECUSA-SE A NEGOCIAR', isCPC: false },
    { name: 'REENVIO BOLETO/OPERAÇÃO', isCPC: false },
    { name: 'RENEG - EM AVALIACAO', isCPC: false },
    { name: 'RENEGOCIAÇÃO – INDICACAO', isCPC: true },
    { name: 'SEM CONDIÇÕES', isCPC: false },
    { name: 'SEM INTERESSE', isCPC: false },
    { name: 'SEM RESPOSTA DO CLIENTE', isCPC: false },
    { name: 'TESTE', isCPC: false },
    { name: 'DESCONHECE O CLIENTE', isCPC: false },
    { name: 'DESCONHECE A DIVIDA', isCPC: false },
  ];

  const tabulations = await Promise.all(
    tabulationData.map((tab, index) =>
      prisma.tabulation.upsert({
        where: { id: index + 1 },
        update: {
          name: tab.name,
          isCPC: tab.isCPC,
        },
        create: {
          name: tab.name,
          isCPC: tab.isCPC,
        },
      })
    )
  );

  console.log('✅ Tabulações criadas:', tabulations.length);

  // Criar usuário admin
  const adminPassword = await argon2.hash('admin123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@tatica.internal' },
    update: {
      password: adminPassword,
      name: 'Admin',
      role: 'admin',
      status: 'Offline',
    },
    create: {
      name: 'Admin',
      email: 'admin@tatica.internal',
      password: adminPassword,
      role: 'admin',
      status: 'Offline',
    },
  });

  console.log('✅ Admin criado:', admin.email);

  // Criar usuário supervisor
  const supervisorPassword = await argon2.hash('supervisor123');
  const supervisor = await prisma.user.upsert({
    where: { email: 'supervisor@tatica.internal' },
    update: {
      password: supervisorPassword,
      name: 'Supervisor',
      role: 'supervisor',
      segment: segment.id,
      status: 'Offline',
    },
    create: {
      name: 'Supervisor',
      email: 'supervisor@tatica.internal',
      password: supervisorPassword,
      role: 'supervisor',
      segment: segment.id,
      status: 'Offline',
    },
  });

  console.log('✅ Supervisor criado:', supervisor.email);

  // Criar usuário operator
  const operatorPassword = await argon2.hash('operator123');
  const operator = await prisma.user.upsert({
    where: { email: 'operator@tatica.internal' },
    update: {
      password: operatorPassword,
      name: 'Operador',
      role: 'operator',
      segment: segment.id,
      status: 'Offline',
    },
    create: {
      name: 'Operador',
      email: 'operator@tatica.internal',
      password: operatorPassword,
      role: 'operator',
      segment: segment.id,
      status: 'Offline',
    },
  });

  console.log('✅ Operator criado:', operator.email, '| senha: operator123');

  // Criar Evolution de exemplo
  const evolution = await prisma.evolution.upsert({
    where: { evolutionName: 'Evolution01' },
    update: {},
    create: {
      evolutionName: 'Evolution01',
      evolutionUrl: 'http://localhost:8080',
      evolutionKey: 'sua-chave-aqui',
    },
  });

  console.log('✅ Evolution criada:', evolution.evolutionName);

  // Criar Tags de exemplo
  const tags = await Promise.all([
    prisma.tag.upsert({
      where: { name: 'emp1' },
      update: {},
      create: {
        name: 'emp1',
        description: 'Tag de exemplo para carteira 1',
        segment: segment.id,
      },
    }),
    prisma.tag.upsert({
      where: { name: 'emp2' },
      update: {},
      create: {
        name: 'emp2',
        description: 'Tag de exemplo para carteira 2',
        segment: segment.id,
      },
    }),
  ]);

  console.log('✅ Tags criadas:', tags.length);

  console.log('✅ Seed concluído com sucesso!');
  console.log('\n📋 Dados criados:');
  console.log('👥 Usuários:');
  console.log('   Admin:      admin@tatica.internal | admin123');
  console.log('   Supervisor: supervisor@tatica.internal | supervisor123');
  console.log('   Operator:   operator@tatica.internal | operator123');
  console.log('\n📡 Evolution:');
  console.log('   Nome: Evolution01');
  console.log('   URL: http://localhost:8080');
  console.log('   ⚠️  Lembre-se de atualizar a URL e chave da Evolution!');
  console.log('\n🏷️  Tags:');
  console.log('   emp1, emp2');
  console.log('\n📊 Tabulações:');
  console.log(`   ${tabulations.length} tabulações criadas`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
