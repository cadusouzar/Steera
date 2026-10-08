import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptInviteDto } from './accept-invite.dto';
import { AcceptLegalDto } from './accept-legal.dto';
import { RegisterDto } from './register.dto';

const MESSAGE = 'Aceite os Termos de uso e a Política de Privacidade para continuar.';

const registerBase = {
  personType: 'PJ', document: '11.222.333/0001-81', legalName: 'Padaria Ltda', tradeName: 'Padaria',
  phone: '(11) 98765-4321', zipCode: '01310-100', street: 'Avenida Paulista', number: '1000',
  district: 'Bela Vista', city: 'São Paulo', state: 'SP', name: 'Carlos', email: 'a@b.com', password: 'senha12345678',
};
const inviteBase = { token: 'x'.repeat(40), password: 'senha12345678' };

describe.each([
  ['RegisterDto', RegisterDto, registerBase],
  ['AcceptInviteDto', AcceptInviteDto, inviteBase],
  ['AcceptLegalDto', AcceptLegalDto, {}],
] as const)('%s.acceptLegal', (_name, cls, base) => {
  const errorsFor = (extra: Record<string, unknown>) =>
    validate(plainToInstance(cls as any, { ...base, ...extra }) as object);

  it('aceita acceptLegal: true', async () => {
    expect(await errorsFor({ acceptLegal: true })).toHaveLength(0);
  });

  it.each([[undefined], [false], ['true']])('recusa acceptLegal = %p com a mensagem do aceite', async (value) => {
    const errors = await errorsFor(value === undefined ? {} : { acceptLegal: value });
    const error = errors.find((e) => e.property === 'acceptLegal');
    expect(error).toBeDefined();
    expect(Object.values(error!.constraints ?? {})).toEqual([MESSAGE]);
  });
});
