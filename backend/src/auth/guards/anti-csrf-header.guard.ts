import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Convenção simples e bem estabelecida de mitigação de CSRF: um <form> HTML
// cross-site (o vetor clássico de CSRF) não consegue setar cabeçalhos
// customizados, então exigir este aqui em cima de POST /auth/login e
// POST /auth/register barra esse ataque de graça, sem precisar de um token
// CSRF de verdade. Não é proteção contra XSS nem substitui o
// SameSite=Strict do cookie de refresh (ver auth.controller.ts) — é só essa
// camada extra, barata, específica pra forms cross-site. Deliberadamente
// NÃO aplicado a /auth/refresh (já protegido pelo próprio SameSite=Strict,
// e refreshOnce() no frontend dispara automaticamente antes de qualquer
// interação do usuário) nem a /auth/logout (baixo risco, sem valor real).
export const ANTI_CSRF_HEADER_NAME = 'x-requested-with';
export const ANTI_CSRF_HEADER_VALUE = 'XMLHttpRequest';

@Injectable()
export class AntiCsrfHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[ANTI_CSRF_HEADER_NAME];
    if (header !== ANTI_CSRF_HEADER_VALUE) {
      throw new BadRequestException('Requisição inválida: cabeçalho obrigatório ausente ou incorreto');
    }
    return true;
  }
}
