import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TimeEventType } from '@prisma/client';
import { CreatePunchDto } from './create-punch.dto';

describe('CreatePunchDto', () => {
  it('rejeita uma latitude fora do intervalo -90..90', async () => {
    const dto = plainToInstance(CreatePunchDto, { type: TimeEventType.CLOCK_IN, latitude: 999, longitude: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejeita uma longitude fora do intervalo -180..180', async () => {
    const dto = plainToInstance(CreatePunchDto, { type: TimeEventType.CLOCK_IN, latitude: 0, longitude: 999 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('aceita uma latitude/longitude válidas', async () => {
    const dto = plainToInstance(CreatePunchDto, { type: TimeEventType.CLOCK_IN, latitude: -23.55, longitude: -46.63 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
