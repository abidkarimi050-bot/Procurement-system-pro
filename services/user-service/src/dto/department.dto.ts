import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsUUID()
  @IsOptional()
  parent_id?: string;

  @IsUUID()
  @IsOptional()
  manager_id?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  cost_center?: string;

  @IsUUID()
  @IsNotEmpty()
  created_by: string;
}

export class UpdateDepartmentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsUUID()
  @IsOptional()
  parent_id?: string;

  @IsUUID()
  @IsOptional()
  manager_id?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  cost_center?: string;

  @IsUUID()
  @IsOptional()
  updated_by?: string;
}
