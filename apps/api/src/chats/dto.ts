import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX_LENGTH, MESSAGE_MAX_LENGTH, NOTIFY_MODES } from '@hemcenter/shared';
import type { NotifyMode } from '@hemcenter/shared';

export class CreateDirectDto {
  @IsUUID() userId: string;
}

export class CreateGroupDto {
  @IsString() @MinLength(1) @MaxLength(GROUP_TITLE_MAX_LENGTH) title: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(GROUP_MAX_MEMBERS) @IsUUID(undefined, { each: true }) memberIds: string[];
}

export class UpdateGroupDto {
  @IsString() @MinLength(1) @MaxLength(GROUP_TITLE_MAX_LENGTH) title: string;
}

export class AddMembersDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(GROUP_MAX_MEMBERS) @IsUUID(undefined, { each: true }) userIds: string[];
}

export class NotifyModeDto {
  @IsIn(NOTIFY_MODES) notifyMode: NotifyMode;
}

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(MESSAGE_MAX_LENGTH) body: string;
  @IsOptional() @IsUUID() replyToId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) mentionIds?: string[];
}

export class EditMessageDto {
  @IsString() @MinLength(1) @MaxLength(MESSAGE_MAX_LENGTH) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) mentionIds?: string[];
}

export class MarkReadDto {
  @IsInt() @Min(0) seq: number;
}
