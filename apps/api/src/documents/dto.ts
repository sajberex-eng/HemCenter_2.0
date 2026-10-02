import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Trim } from '../common/trim';
import { LOCALES } from '@hemcenter/shared';
import type { Locale } from '@hemcenter/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = /^[\p{L}\p{N}]{1,8}$/u;

export class DocItemDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) text: string;
  @IsOptional() @IsString() @MaxLength(200) responsible?: string;
  @IsOptional() @Matches(DATE) due?: string;
}

export class DocDataDto {
  @IsOptional() @IsString() @MaxLength(4000) preamble?: string;
  @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @IsOptional() @IsString() @MaxLength(300) recipient?: string;
  @IsOptional() @IsString() @MaxLength(300) signer?: string;
  @IsOptional() @IsString() @MaxLength(300) chair?: string;
  @IsOptional() @IsString() @MaxLength(300) secretary?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(300, { each: true }) participants?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(1000, { each: true }) agenda?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(2000, { each: true }) decisions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DocItemDto) items?: DocItemDto[];
}

export class CreateDocumentDto {
  @IsUUID() kindId: string;
  @IsIn(LOCALES) lang: Locale;
  @Trim() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @Matches(DATE) docDate?: string;
  @ValidateNested() @Type(() => DocDataDto) data: DocDataDto;
}

export class UpdateDocumentDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @Matches(DATE) docDate?: string;
  @IsOptional() @ValidateNested() @Type(() => DocDataDto) data?: DocDataDto;
}

export class CreateKindDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(150) nameRu: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(150) nameKk: string;
  @Matches(PREFIX) prefix: string;
}

export class UpdateKindDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(150) nameRu?: string;
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(150) nameKk?: string;
  @IsOptional() @Matches(PREFIX) prefix?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UploadTemplateDto {
  @IsUUID() kindId: string;
  @IsIn(LOCALES) lang: Locale;
}

export class RouteItemDto {
  @IsUUID() approverId: string;
  @IsOptional() @IsBoolean() parallelWithPrevious?: boolean;
}

export class SubmitDto {
  /** Left out when a returned document goes again along its old route. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RouteItemDto) route?: RouteItemDto[];
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class DecisionCommentDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
