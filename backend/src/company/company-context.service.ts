import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Substituto temporário para autenticação real — o projeto ainda não tem
// login/sessão em lugar nenhum (ver DECISOES-TECNICAS.md). Todo service de RH
// pede a este serviço "qual é a empresa atual" em vez de confiar num
// companyId enviado pelo cliente. Quando a autenticação existir de verdade,
// só este método precisa mudar (ler req.user.companyId) — toda query/checagem
// de propriedade nos módulos de RH já está escrita como se a auth fosse real.
@Injectable()
export class CompanyContextService {
  private cachedCompanyId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getCurrentCompanyId(): Promise<string> {
    if (this.cachedCompanyId) return this.cachedCompanyId;

    const existing = await this.prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) {
      this.cachedCompanyId = existing.id;
      return existing.id;
    }

    const created = await this.prisma.company.create({ data: { name: 'Empresa Padrão' } });
    this.cachedCompanyId = created.id;
    return created.id;
  }
}
