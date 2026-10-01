import React, { useEffect, useState } from 'react';
import { CustomFieldDefinition, CustomFieldEntity, listActiveCustomFields } from '../lib/api';
import { parseDefaultForDisplay, renderTypedInput } from '../lib/customFieldRendering';

interface Props {
  entity: CustomFieldEntity;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

const CustomFieldsFormSection: React.FC<Props> = ({ entity, values, onChange }) => {
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    listActiveCustomFields(entity)
      .then((result) => { if (!cancelled) setFields(result); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [entity]);

  if (isLoading || fields.length === 0) return null;

  const setField = (columnName: string, value: unknown) => {
    onChange({ ...values, [columnName]: value });
  };

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h4 className="text-[14px] font-semibold text-foreground mb-4">Campos personalizados</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {fields.map((field) => {
          // Só entra em jogo quando o campo nunca foi tocado (`values[columnName] === undefined`) —
          // pré-preenche com o `defaultValue` configurado pro campo, pra quem estiver criando um
          // registro ver o padrão em vez de um campo vazio. Se a pessoa não mexer, o campo continua
          // ausente do payload e o backend aplica o mesmo default na escrita (ver
          // `CustomFieldValuesService.resolveValuesForCreate`) — nunca é escrito aqui, só exibido.
          const rawValue = values[field.columnName];
          const value = rawValue !== undefined ? rawValue : parseDefaultForDisplay(field);
          return (
            <div key={field.id} className={needsFullWidth(field.type) ? 'md:col-span-2' : undefined}>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">
                {field.displayName}{field.required && <span className="text-danger" aria-hidden="true"> *</span>}
              </label>
              {field.description && <p className="text-[12px] text-muted mb-1.5">{field.description}</p>}
              {renderTypedInput(field.type, field.configuration?.options, value, (v) => setField(field.columnName, v))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Campos que se beneficiam de mais espaço horizontal (texto longo, ou várias opções de múltipla
// escolha que podem quebrar linha) ocupam a largura toda em vez de disputar a coluna com o vizinho.
function needsFullWidth(type: CustomFieldDefinition['type']): boolean {
  return type === 'LONG_TEXT' || type === 'MULTI_SELECT';
}

export default CustomFieldsFormSection;
