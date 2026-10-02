import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { LOCALES, MEETING_STATUSES, RESOLUTION_KINDS } from '@hemcenter/shared';
import type { Locale, MeetingStatus, ResolutionKind } from '@hemcenter/shared';
import { Trim } from '../common/trim';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateMeetingDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(200) subject: string;
  @IsISO8601() startsAt: string;
  @IsOptional() @IsString() @MaxLength(300) place?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() chairId?: string;
  @IsOptional() @IsUUID() secretaryId?: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) participantIds: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @Trim() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(500, { each: true }) agenda?: string[];
}

export class UpdateMeetingDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) subject?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsString() @MaxLength(300) place?: string;
  @IsOptional() @IsIn(MEETING_STATUSES) status?: MeetingStatus;
  @IsOptional() @IsUUID() chairId?: string;
  @IsOptional() @IsUUID() secretaryId?: string;
}

export class ItemDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(500) title: string;
}

export class UpdateItemDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) heard?: string;
}

export class ResolutionDto {
  @IsIn(RESOLUTION_KINDS) kind: ResolutionKind;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) text?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @Matches(DATE) due?: string;
  @IsOptional() @IsUUID() decisionId?: string;
}

export class UpdateResolutionDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(2000) text?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @Matches(DATE) due?: string;
}

export class ProtocolDto {
  @IsIn(LOCALES) lang: Locale;
}
