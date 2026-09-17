import { IsIn } from 'class-validator';
import { CUSTOM_FIELD_ENTITY_KEYS } from '../custom-field-entities';

export class CustomFieldEntityQueryDto {
  @IsIn(CUSTOM_FIELD_ENTITY_KEYS) entity!: string;
}
