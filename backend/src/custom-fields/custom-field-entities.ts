export const CUSTOM_FIELD_ENTITIES = {
  client: 'Client',
  role: 'Role',
  employee: 'Employee',
  product: 'Product',
} as const;

export type CustomFieldEntityKey = keyof typeof CUSTOM_FIELD_ENTITIES;
export const CUSTOM_FIELD_ENTITY_KEYS = Object.keys(CUSTOM_FIELD_ENTITIES) as CustomFieldEntityKey[];
