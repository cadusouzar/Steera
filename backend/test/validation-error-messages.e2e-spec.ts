import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { translateValidationErrors } from '../src/common/validation-message-translator.util';
import { buildRegisterBody } from './register-body.util';

describe('Mensagens de validação traduzidas (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => new BadRequestException(translateValidationErrors(errors)),
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('devolve message como uma STRING única em português, nunca um array em inglês', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ email: 'not-an-email', password: '123' }))
      .expect(400);

    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).not.toMatch(/must be|should not/i);
    expect(res.body.message).toContain('E-mail deve ser um e-mail válido');
  });
});
