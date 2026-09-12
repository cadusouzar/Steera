import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(1) companyName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
