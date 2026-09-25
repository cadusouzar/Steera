import React from 'react';
import type { CompanyAddress, CurrentUser } from '../../lib/auth';
import { formatCepInput, formatPhoneInput } from '../../lib/validation';

// "Av. Paulista, 1000 - Sala 10 · Bela Vista, São Paulo/SP · CEP 01310-100" — só com as partes que existem.
function formatAddress(a: CompanyAddress | null): string | null {
  if (!a) return null;
  const line1 = [a.street, a.number].filter(Boolean).join(', ') + (a.complement ? ` - ${a.complement}` : '');
  const cityState = [a.city, a.state].filter(Boolean).join('/');
  const line2 = [a.district, cityState].filter(Boolean).join(', ');
  return [line1, line2, `CEP ${formatCepInput(a.zipCode)}`].filter(Boolean).join(' · ');
}

interface AccountProfileDetailsProps {
  user: CurrentUser | null;
}

// Dados da própria conta, só leitura — compartilhado entre o "Meu Perfil" de dentro do ERP
// (UserProfileDrawer) e a área "Minha conta" do site (/conta), pra nunca mostrarem coisas
// diferentes. Documento sempre mascarado pelo backend (o valor cru nunca chega ao frontend).
const AccountProfileDetails: React.FC<AccountProfileDetailsProps> = ({ user }) => {
  const email = user?.email ?? '';
  // Nome do responsável quando existir (fundador, desde o cadastro ampliado); senão o e-mail.
  const displayName = user?.name?.trim() || email;
  const avatarInitial = displayName.charAt(0).toUpperCase() || '?';
  const roleLabel = user?.role === 'admin' ? 'Administrador' : 'Funcionário';
  const address = formatAddress(user?.companyAddress ?? null);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
        <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-accent border-4 border-background shadow-xl flex items-center justify-center font-heading font-bold text-white text-3xl overflow-hidden shrink-0">
          {avatarInitial}
        </div>
        <div className="flex-1 min-w-0 space-y-1 text-center sm:text-left">
          <h3 className="text-xl font-bold text-foreground break-all">{displayName}</h3>
          <span className="inline-block mt-2 px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-lg uppercase tracking-wider">
            {roleLabel}
          </span>
        </div>
      </div>

      <div className="bg-secondary/20 border border-border/60 rounded-2xl divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span className="text-sm font-medium text-muted">E-mail</span>
          <span className="text-sm font-bold text-foreground text-right break-all">{email}</span>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span className="text-sm font-medium text-muted">Papel</span>
          <span className="text-sm font-bold text-foreground">{roleLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span className="text-sm font-medium text-muted">Empresa</span>
          <span className="text-sm font-bold text-foreground text-right">{user?.companyName ?? '—'}</span>
        </div>
        {user?.legalName && (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium text-muted">{user.personType === 'PF' ? 'Nome completo' : 'Razão social'}</span>
            <span className="text-sm font-bold text-foreground text-right">{user.legalName}</span>
          </div>
        )}
        {user?.tradeName && (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium text-muted">Nome fantasia</span>
            <span className="text-sm font-bold text-foreground text-right">{user.tradeName}</span>
          </div>
        )}
        {user?.companyPhone && (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium text-muted">Telefone</span>
            <span className="text-sm font-bold text-foreground">{formatPhoneInput(user.companyPhone)}</span>
          </div>
        )}
        {address && (
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium text-muted">Endereço</span>
            <span className="text-sm font-bold text-foreground text-right">{address}</span>
          </div>
        )}
        {user?.documentMasked && (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium text-muted">{user.personType === 'PF' ? 'CPF' : 'CNPJ'}</span>
            <span className="text-sm font-bold text-foreground font-mono">{user.documentMasked}</span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted">
        O e-mail é a identidade deste login e não pode ser alterado, nem o CPF/CNPJ da empresa. O seu
        nome e, para administradores, os dados da empresa podem ser editados em "Minha conta", no site.
        Dados de funcionário (nome, CPF, telefone, etc.), quando aplicável, são gerenciados na tela de
        Funcionários.
      </p>
    </div>
  );
};

export default AccountProfileDetails;
