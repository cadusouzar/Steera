import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// Tabela do kit (01/10/2026): cabeçalho em cinza no tamanho normal (sem caixa alta), separadores
// finos, hover suave, rolagem horizontal no celular. Composição simples, cada tela monta as colunas.

export const Table = ({ children, className = '', minWidth }: { children: ReactNode; className?: string; minWidth?: number }) => (
  <div className={`relative w-full overflow-x-auto ${className}`}>
    <table className="w-full text-left border-collapse text-[14px]" style={minWidth ? { minWidth } : undefined}>
      {children}
    </table>
  </div>
);

export const THead = ({ children }: { children: ReactNode }) => (
  <thead className="border-b border-border">{children}</thead>
);

type Align = 'left' | 'right' | 'center';
const alignClass = (align: Align = 'left') => (align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left');

export const TH = ({ children, align, className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) => (
  <th scope="col" className={`relative h-11 px-3 sm:px-5 font-medium text-[13px] text-muted whitespace-nowrap ${alignClass(align)} ${className}`} {...rest}>
    {children}
  </th>
);

export const TBody = ({ children }: { children: ReactNode }) => (
  <tbody className="divide-y divide-border">{children}</tbody>
);

export const TR = ({ children, className = '', interactive = false, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) => (
  <tr className={`transition-colors duration-150 ${interactive ? 'cursor-pointer hover:bg-secondary/70' : 'hover:bg-secondary/40'} ${className}`} {...rest}>
    {children}
  </tr>
);

export const TD = ({ children, align, className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) => (
  <td className={`px-3 sm:px-5 py-3.5 text-foreground align-middle ${alignClass(align)} ${className}`} {...rest}>
    {children}
  </td>
);
