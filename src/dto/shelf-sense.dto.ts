import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { TaskActionTypes } from '../types/shelf-sense.types';

export class TaskActionDto {
  @IsString()
  @IsNotEmpty()
  task_id: string;

  @IsEnum(TaskActionTypes)
  action: TaskActionTypes;

  @IsString()
  @IsOptional()
  comment?: string;
}

export class GroupIdParamDto {
  @IsString()
  @IsNotEmpty()
  group_id: string;
}

export class ErrorTypeParamDto {
  @IsString()
  @IsNotEmpty()
  error_type: string;
}

export class MerchGroupIdParamDto {
  @IsString()
  @IsNotEmpty()
  merch_group_id: string;
}
