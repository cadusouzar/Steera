import { IsString } from 'class-validator';

export class LinkEmployeeDto {
  @IsString() employeeId!: string;
}
