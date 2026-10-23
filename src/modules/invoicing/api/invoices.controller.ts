import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateInvoiceDto, UpdateInvoiceDto } from './invoice.dto';
import { InvoicesService } from '../application/invoices.service';
import { InternalApiKeyGuard } from '../../../shared/auth/internal-api-key.guard';
class IdParams {
  @IsUUID() id: string;
}
@Controller('internal/invoices')
@UseGuards(InternalApiKeyGuard)
@ApiTags('Internal invoices')
@ApiSecurity('internalApiKey')
@ApiUnauthorizedResponse({ description: 'Missing or invalid internal API key' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}
  @ApiOperation({ summary: 'Create an internal invoice and queue its sync' })
  @ApiCreatedResponse({ description: 'Invoice created and durable sync job queued' })
  @ApiBadRequestResponse({ description: 'Invalid invoice input' })
  @Post()
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }
  @ApiOperation({ summary: 'Get an internal invoice' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Internal invoice' })
  @Get(':id')
  get(@Param() params: IdParams) {
    return this.invoices.get(params.id);
  }
  @ApiOperation({ summary: 'Update an internal invoice and queue its sync' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Invoice updated and durable sync job queued' })
  @ApiBadRequestResponse({ description: 'Invalid invoice input' })
  @Patch(':id')
  update(@Param() params: IdParams, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(params.id, dto);
  }
}
