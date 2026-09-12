import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class CompanyContextService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  async getCurrentCompanyId(): Promise<string> {
    // `req.user` é populado pelo JwtAuthGuard (ver AuthModule) — nunca aceito
    // de nenhum campo enviado pelo cliente.
    const user = (this.request as any).user;
    if (!user?.companyId) {
      throw new Error('CompanyContextService chamado fora de uma requisição autenticada');
    }
    return user.companyId;
  }
}
