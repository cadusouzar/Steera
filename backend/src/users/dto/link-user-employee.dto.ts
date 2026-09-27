import { IsNotEmpty, IsString } from 'class-validator';

// PATCH /companies/me/users/:id/employee — ficha de funcionário a vincular ao login alvo.
export class LinkUserEmployeeDto {
  @IsString() @IsNotEmpty() employeeId!: string;
}
