import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(100) login: string;
  @IsString() @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword: string;
  @IsString() @MaxLength(200) newPassword: string;
}

export class AcceptInviteDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MaxLength(200) password: string;
  @IsBoolean() consent: boolean;
}
