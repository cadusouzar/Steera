import { Mail } from 'lucide-react';
import type { BillingContact } from '../../lib/api';

interface BillingContactsProps {
  contacts: BillingContact[];
}

// Quem gerencia a assinatura (27/09/2026): lista de contatos mostrada pra quem NÃO pode mudar o
// plano — na aba Assinatura (AccountSubscriptionDetails) e na oferta de upgrade (PlanUpgradeModal).
// "Nome — e-mail" (ou só o e-mail, quando o login não tem nome), com link mailto.
const BillingContacts = ({ contacts }: BillingContactsProps) => {
  if (contacts.length === 0) {
    return <p className="text-sm text-muted">Nenhum login ativo gerencia a assinatura no momento.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {contacts.map((contact) => (
        <li key={contact.email} className="flex items-start gap-2 text-sm text-foreground min-w-0">
          <Mail size={14} className="text-primary mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {contact.name && <span className="font-medium">{contact.name} — </span>}
            <a href={`mailto:${contact.email}`} className="text-primary hover:underline break-all">
              {contact.email}
            </a>
          </span>
        </li>
      ))}
    </ul>
  );
};

export default BillingContacts;
