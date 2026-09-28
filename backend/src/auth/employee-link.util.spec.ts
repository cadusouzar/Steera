import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertEmployeeLinkable,
  canSelfLinkEmployee,
  saveEmployeeLink,
  SELF_LINK_DENIED_MESSAGE,
} from './employee-link.util';

describe('canSelfLinkEmployee', () => {
  it('permite quando o login não tem permissão nenhuma (nada a ampliar)', () => {
    expect(canSelfLinkEmployee({})).toBe(true);
    expect(canSelfLinkEmployee(undefined)).toBe(true);
  });

  it('permite quando todas as permissões são sem alcance (null)', () => {
    expect(canSelfLinkEmployee({ 'ponto.registrar': null, 'dashboard.ver': null })).toBe(true);
  });

  it('permite quando toda permissão com alcance é EMPRESA', () => {
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'EMPRESA', 'ponto.registrar': null })).toBe(true);
  });

  it('recusa quando pelo menos uma permissão tem alcance restrito (EQUIPE)', () => {
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'EQUIPE', 'ponto.registrar': null })).toBe(false);
  });

  it('recusa com alcance PROPRIO ou DEPARTAMENTO misturado com EMPRESA', () => {
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'EMPRESA', 'pagamentos.gerenciar': 'PROPRIO' })).toBe(false);
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'DEPARTAMENTO' })).toBe(false);
  });

  // Ruling F1b (28/09/2026): gerenciar usuários não é mais exceção — vincular qualquer login a
  // uma ficha escolhe a raiz de alcance dele, então só quem tem tudo em EMPRESA vincula.
  it('recusa alcance restrito mesmo quando o login gerencia usuários (usuarios.gerenciar)', () => {
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'EQUIPE', 'usuarios.gerenciar': null })).toBe(false);
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'PROPRIO', 'usuarios.gerenciar': 'EMPRESA' })).toBe(false);
  });

  it('permite quem gerencia usuários com todo alcance EMPRESA', () => {
    expect(canSelfLinkEmployee({ 'funcionarios.ver': 'EMPRESA', 'usuarios.gerenciar': null })).toBe(true);
  });

  it('a mensagem de recusa é o texto da spec', () => {
    expect(SELF_LINK_DENIED_MESSAGE).toBe(
      'Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular.',
    );
  });
});

describe('assertEmployeeLinkable', () => {
  function makePrisma(employee: unknown, existingLogin: unknown) {
    return {
      employee: { findFirst: jest.fn().mockResolvedValue(employee) },
      user: { findUnique: jest.fn().mockResolvedValue(existingLogin) },
    } as any;
  }

  it('recusa funcionário de outra empresa / inexistente', async () => {
    const prisma = makePrisma(null, null);
    await expect(assertEmployeeLinkable(prisma, 'c1', 'e1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', companyId: 'c1' } });
  });

  it('recusa funcionário que já tem login', async () => {
    const prisma = makePrisma({ id: 'e1', status: 'ACTIVE' }, { id: 'u9' });
    await expect(assertEmployeeLinkable(prisma, 'c1', 'e1')).rejects.toThrow('Este funcionário já possui um login vinculado');
  });

  it('recusa funcionário inativo só quando requireActive', async () => {
    const prisma = makePrisma({ id: 'e1', status: 'INACTIVE' }, null);
    await expect(assertEmployeeLinkable(prisma, 'c1', 'e1', { requireActive: true })).rejects.toThrow(
      'Funcionário inativo não pode ser vinculado a um login',
    );
    await expect(assertEmployeeLinkable(prisma, 'c1', 'e1')).resolves.toBeUndefined();
  });
});

describe('saveEmployeeLink', () => {
  it('mapeia P2002 pra 409 amigável', async () => {
    const prisma = {
      user: {
        updateMany: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['employeeId'] },
          }),
        ),
        findUniqueOrThrow: jest.fn(),
      },
    } as any;
    await expect(saveEmployeeLink(prisma, 'u1', 'e1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('só grava se o login ainda não tem vínculo (filtro atômico employeeId: null)', async () => {
    const prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as any;
    await expect(saveEmployeeLink(prisma, 'u1', 'e1')).resolves.toBeUndefined();
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', employeeId: null }, data: { employeeId: 'e1' } });
  });

  it('corrida perdida (outro vínculo gravado antes) vira 400, sem sobrescrever', async () => {
    const prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } } as any;
    await expect(saveEmployeeLink(prisma, 'u1', 'e1')).rejects.toThrow('Este login já está vinculado a um funcionário');
  });
});
