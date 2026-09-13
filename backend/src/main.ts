import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validateJwtSecret } from './common/jwt-secret.util';

async function bootstrap() {
  // Falha rápido, antes de qualquer outra coisa: um JWT_ACCESS_SECRET ausente,
  // curto demais, ou herdado do placeholder de .env.example derrubaria todo o
  // isolamento multi-tenant (qualquer um forja um token de ADMIN de qualquer
  // empresa) sem nenhum outro sinal de erro no boot.
  validateJwtSecret(process.env.JWT_ACCESS_SECRET);

  const app = await NestFactory.create(AppModule);
  // Cabeçalhos de segurança em toda resposta (inclui remover o
  // `X-Powered-By: Express`, que vaza a stack) — aplicado o mais cedo
  // possível, antes de CORS/cookies/guards. CSP desligado de propósito: este
  // backend é uma API JSON pura consumida por um front-end SPA de outra
  // origem, nunca serve HTML renderizado no servidor — o CSP padrão do
  // helmet é pensado pra páginas HTML e não traz benefício aqui, só risco de
  // atrapalhar sem necessidade.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar a aplicação:', err);
  process.exit(1);
});
