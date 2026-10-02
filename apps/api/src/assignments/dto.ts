import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/trim';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAssignmentDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) text: string;
  @IsUUID() responsibleId: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) coResponsibleIds?: string[];
  /** Defaults to the person giving the assignment. */
  @IsOptional() @IsUUID() controllerId?: string;
  @Matches(DATE) dueDate: string;
}

export class ReportDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(4000) text: string;
}

export class ReviewDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class DueRequestDto {
  @Matches(DATE) newDue: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason: string;
}

export class RemoveDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason: string;
}
