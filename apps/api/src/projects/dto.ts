import { Type } from 'class-transformer';
import { Trim } from '../common/trim';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DECISION_ANSWERS, PROJECT_STATUSES, TASK_STATUSES, TEXT_MAX_LENGTH, TITLE_MAX_LENGTH } from '@hemcenter/shared';
import type { DecisionAnswer, ProjectStatus, TaskStatus } from '@hemcenter/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MemberInputDto {
  @IsUUID() userId: string;
  @IsInt() @Min(0) @Max(100) allocation: number;
  @IsOptional() @IsString() @MaxLength(100) roleTitle?: string;
}

export class CreateProjectDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) name: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX_LENGTH) goal?: string;
  @IsOptional() @Matches(DATE) startDate?: string;
  @IsOptional() @Matches(DATE) endDate?: string;
  /** Defaults to the person creating the project. */
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() curatorId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => MemberInputDto) members?: MemberInputDto[];
}

export class UpdateProjectDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) name?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX_LENGTH) goal?: string;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
  @IsOptional() @Matches(DATE) startDate?: string;
  @IsOptional() @Matches(DATE) endDate?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() curatorId?: string;
}

export class SetMemberDto {
  @IsInt() @Min(0) @Max(100) allocation: number;
  @IsOptional() @IsString() @MaxLength(100) roleTitle?: string;
}

export class CreateMilestoneDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) title: string;
  @Matches(DATE) dueDate: string;
}

export class UpdateMilestoneDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) title?: string;
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsOptional() done?: boolean;
}

export class CreateTaskDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) title: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX_LENGTH) description?: string;
  /** Required: a task always has exactly one responsible person. */
  @IsUUID() assigneeId: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) coAssigneeIds?: string[];
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsOptional() @IsUUID() projectId?: string;
}

export class UpdateTaskDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(TITLE_MAX_LENGTH) title?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX_LENGTH) description?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) coAssigneeIds?: string[];
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: TaskStatus;
}

export class CreateDecisionDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(TEXT_MAX_LENGTH) text: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) addresseeIds: string[];
}

export class AnswerDecisionDto {
  @IsIn(DECISION_ANSWERS) answer: DecisionAnswer;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX_LENGTH) comment?: string;
}
