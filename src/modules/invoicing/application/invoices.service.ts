import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InternalInvoiceEntity } from '../infrastructure/persistence/internal-invoice.entity';
import {
  applyQboSnapshot,
  newInternalInvoiceFromQbo,
  toInternalInvoiceSnapshot,
} from '../infrastructure/persistence/internal-invoice.mapper';
import { SYNC_JOB_PORT, SyncJobPort } from '../../sync-orchestrator/domain/sync-job.port';
import { InvoiceSnapshot } from '../domain/invoice';
import { CreateInvoiceDto, UpdateInvoiceDto } from '../api/invoice.dto';
import { PUBLIC_ERROR_CODE } from '../../../shared/errors/application-error';

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(InternalInvoiceEntity) private readonly invoices: Repository<InternalInvoiceEntity>,
    @Inject(SYNC_JOB_PORT) private readonly sync: SyncJobPort,
    private readonly db: DataSource,
  ) {}
  async create(dto: CreateInvoiceDto): Promise<InternalInvoiceEntity> {
    try {
      return await this.db.transaction(async (manager) => {
        const invoice = await manager.save(
          InternalInvoiceEntity,
          manager.create(InternalInvoiceEntity, {
            ...dto,
            balance: dto.balance ?? dto.total,
            status: 'OPEN',
            lines: dto.lines,
          }),
        );
        await this.sync.enqueueInTransaction(manager, {
          dedupeKey: `internal:invoice:${invoice.id}:v${invoice.version}`,
          source: 'internal',
          entityType: 'invoice',
          entityId: invoice.id,
          operation: 'upsert',
          payload: { version: invoice.version },
        });
        return invoice;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ errorCode: PUBLIC_ERROR_CODE.INVOICE_NUMBER_ALREADY_EXISTS });
      }
      throw error;
    }
  }
  async update(id: string, dto: UpdateInvoiceDto): Promise<InternalInvoiceEntity> {
    return this.db.transaction(async (manager) => {
      const invoice = await manager.findOneBy(InternalInvoiceEntity, { id });
      if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
      if (invoice.status === 'VOID' || invoice.status === 'DELETED') {
        throw new ConflictException('A terminal invoice cannot be edited');
      }
      const balance =
        dto.total === undefined || dto.balance !== undefined
          ? dto.balance
          : balanceAfterTotalChange(invoice, dto.total);
      Object.assign(invoice, dto, { ...(balance === undefined ? {} : { balance }), version: invoice.version + 1 });
      const saved = await manager.save(InternalInvoiceEntity, invoice);
      await this.sync.enqueueInTransaction(manager, {
        dedupeKey: `internal:invoice:${saved.id}:v${saved.version}`,
        source: 'internal',
        entityType: 'invoice',
        entityId: saved.id,
        operation: saved.status === 'DELETED' ? 'delete' : saved.status === 'VOID' ? 'void' : 'upsert',
        payload: { version: saved.version },
      });
      return saved;
    });
  }
  async get(id: string): Promise<InternalInvoiceEntity> {
    const invoice = await this.invoices.findOneBy({ id });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }
  async getSnapshot(id: string): Promise<InvoiceSnapshot> {
    return toInternalInvoiceSnapshot(await this.get(id));
  }
  async findSnapshotByNumber(number: string): Promise<InvoiceSnapshot | null> {
    const invoice = await this.invoices.findOneBy({ number });
    return invoice ? toInternalInvoiceSnapshot(invoice) : null;
  }
  async upsertFromQbo(qbo: InvoiceSnapshot, existing?: InvoiceSnapshot): Promise<InvoiceSnapshot> {
    return this.upsertFromQboWithRepository(this.invoices, qbo, existing);
  }
  async upsertFromQboInTransaction(
    manager: EntityManager,
    qbo: InvoiceSnapshot,
    existing?: InvoiceSnapshot,
  ): Promise<InvoiceSnapshot> {
    return this.upsertFromQboWithRepository(manager.getRepository(InternalInvoiceEntity), qbo, existing);
  }
  async markDeletedFromQboInTransaction(manager: EntityManager, existing: InvoiceSnapshot): Promise<InvoiceSnapshot> {
    const invoices = manager.getRepository(InternalInvoiceEntity);
    const invoice = await invoices.findOneByOrFail({ id: existing.externalId });
    if (invoice.status !== 'DELETED') {
      invoice.status = 'DELETED';
      invoice.version += 1;
    }
    return toInternalInvoiceSnapshot(await invoices.save(invoice));
  }
  private async upsertFromQboWithRepository(
    invoices: Repository<InternalInvoiceEntity>,
    qbo: InvoiceSnapshot,
    existing?: InvoiceSnapshot,
  ): Promise<InvoiceSnapshot> {
    const invoice = existing
      ? await invoices.findOneByOrFail({ id: existing.externalId })
      : invoices.create(newInternalInvoiceFromQbo(qbo));
    const saved = await invoices.save(existing ? applyQboSnapshot(invoice, qbo) : invoice);
    return toInternalInvoiceSnapshot(saved);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === POSTGRES_UNIQUE_VIOLATION_CODE
  );
}

function balanceAfterTotalChange(invoice: InternalInvoiceEntity, newTotal: string): string {
  const paid = currencyCents(invoice.total) - currencyCents(invoice.balance);
  const remaining = currencyCents(newTotal) - paid;
  if (remaining < 0n) {
    throw new ConflictException('Invoice total cannot be lower than the amount already paid');
  }
  return formatCurrencyCents(remaining);
}

function currencyCents(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Invoice monetary values must have no more than two decimal places');
  const whole = match[1];
  if (whole === undefined) throw new Error('Invoice monetary values must include a whole-number component');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function formatCurrencyCents(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
