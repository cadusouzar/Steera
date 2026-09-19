import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsEnum(['ADMIN', 'EMPLOYEE']) role!: 'ADMIN' | 'EMPLOYEE';
  @IsOptional() @IsString() employeeId?: string; // obrigatório na prática quando role=EMPLOYEE, checado no service
  @IsString() profileId!: string;
}
