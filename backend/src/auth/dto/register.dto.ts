import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(1) @MaxLength(255) companyName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
