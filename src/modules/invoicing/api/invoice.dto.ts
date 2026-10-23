import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { INVOICE_STATUSES, InvoiceStatus } from '../domain/invoice';
export class InvoiceLineDto {
  @ApiProperty({ maxLength: 4000, example: 'Consulting' })
  @IsString()
  @MaxLength(4000)
  description: string;
  @ApiProperty({ example: '100.00' })
  @IsNumberString()
  amount: string;
  @ApiProperty({ example: '45', description: 'QuickBooks sales-item ID' })
  @IsString()
  qboItemRef: string;
  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsNumberString()
  quantity?: string;
}
export class CreateInvoiceDto {
  @ApiProperty({ maxLength: 64, example: 'INV-1001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  number: string;
  @ApiProperty({ example: '123', description: 'QuickBooks customer ID' })
  @IsString()
  customerRef: string;
  @ApiProperty({ format: 'date', example: '2026-10-16' })
  @IsDateString()
  issueDate: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-11-15' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  currency = 'USD';
  @ApiProperty({ example: '100.00' })
  @IsNumberString()
  total: string;
  @ApiPropertyOptional({ example: '100.00' })
  @IsOptional()
  @IsNumberString()
  balance?: string;
  @ApiProperty({ type: () => InvoiceLineDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}
export class UpdateInvoiceDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-11-15' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
  @ApiPropertyOptional({ example: '123', description: 'QuickBooks customer ID' })
  @IsOptional()
  @IsString()
  customerRef?: string;
  @ApiPropertyOptional({ example: '100.00' })
  @IsOptional()
  @IsNumberString()
  total?: string;
  @ApiPropertyOptional({ example: '100.00' })
  @IsOptional()
  @IsNumberString()
  balance?: string;
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;
  @ApiPropertyOptional({ type: () => InvoiceLineDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}
