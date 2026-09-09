import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (!(exception instanceof HttpException)) {
      // Unexpected error: nothing else logs it, so this is the only trace we get.
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `Erro não tratado em ${request.method} ${request.url}: ${message}`,
        stack,
      );

      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const statusCode = exception.getStatus();
    const rawMessage = exception.getResponse();

    const errorPayload =
      typeof rawMessage === 'string'
        ? { statusCode, message: rawMessage }
        : { statusCode, ...(rawMessage as Record<string, unknown>) };

    response.status(statusCode).json({
      ...errorPayload,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
