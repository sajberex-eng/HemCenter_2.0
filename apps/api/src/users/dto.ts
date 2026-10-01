import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { LOCALES, ROLES } from '@hemcenter/shared';
import type { Locale, Role } from '@hemcenter/shared';

export class CreateUserDto {
  @IsString() @MinLength(3) @MaxLength(50) @Matches(/^[a-z0-9._-]+$/i) login: string;
  @IsString() @MinLength(2) @MaxLength(200) fullName: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsArray() @ArrayNotEmpty() @IsIn(ROLES, { each: true }) roles: Role[];
  @IsOptional() @IsIn(LOCALES) locale?: Locale;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() positionId?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsIn(ROLES, { each: true }) roles?: Role[];
  @IsOptional() @IsIn(LOCALES) locale?: Locale;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() positionId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
