import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

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
