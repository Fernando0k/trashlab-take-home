import { Body, Controller, HttpCode, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import { SYNC_ENTITY_TYPE, SYNC_OPERATION, SYNC_SOURCE } from '../../sync-orchestrator/domain/sync-values';
import { SYNC_JOB_PORT, SyncJobPort } from '../../sync-orchestrator/domain/sync-job.port';
import { QboConnectionService } from '../application/qbo-connection.service';
import { QboWebhookGuard } from './qbo-webhook.guard';
import { ApiExcludeController } from '@nestjs/swagger';

type LegacyWebhook = {
  eventNotifications?: Array<{
    realmId: string;
    dataChangeEvent?: { entities?: Array<{ name: string; id: string; operation: string; lastUpdated?: string }> };
  }>;
};

type CloudEventWebhook = {
  id: string;
  type: string;
  intuitentityid: string;
  intuitaccountid: string;
};

type SupportedEvent = {
  eventId: string;
  entityId: string;
  entityType: 'invoice' | 'payment';
  operation: 'delete' | 'upsert';
  realmId: string;
};
type QboWebhook = LegacyWebhook | CloudEventWebhook | CloudEventWebhook[];

const INVOICE_CLOUD_EVENT = /^qbo\.invoice\.(created|updated|deleted|voided)\.v\d+$/i;
const PAYMENT_CLOUD_EVENT = /^qbo\.payment\.(created|updated|deleted|voided)\.v\d+$/i;
@Controller('qbo/webhook')
@ApiExcludeController()
export class QboWebhookController {
  private readonly logger = new Logger(QboWebhookController.name);

  constructor(
    private readonly connections: QboConnectionService,
    @Inject(SYNC_JOB_PORT) private readonly sync: SyncJobPort,
  ) {}
  @Post()
  @HttpCode(200)
  @UseGuards(QboWebhookGuard)
  async receive(@Body() payload: QboWebhook): Promise<{ acknowledged: true }> {
    const realmId = await this.connections.activeRealmId();
    const supportedEvents = this.supportedEvents(payload);
    const events = supportedEvents.filter((event) => event.realmId === realmId);
    if (events.length === 0) {
      this.logger.log({
        event: 'qbo_webhook_ignored',
        reason: supportedEvents.length === 0 ? 'unsupported_or_malformed_event' : 'unconnected_realm',
      });
      return { acknowledged: true };
    }
    for (const event of events) {
      await this.sync.enqueue({
        dedupeKey: `qbo:${event.entityType}:${event.entityId}:${event.eventId}`,
        source: SYNC_SOURCE.QBO,
        entityType: event.entityType === 'invoice' ? SYNC_ENTITY_TYPE.INVOICE : SYNC_ENTITY_TYPE.PAYMENT,
        entityId: event.entityId,
        operation: event.operation === 'delete' ? SYNC_OPERATION.DELETE : SYNC_OPERATION.UPSERT,
        payload: { eventId: event.eventId },
      });
    }
    this.logger.log({ event: 'qbo_webhook_queued', eventCount: events.length });
    return { acknowledged: true };
  }

  private supportedEvents(payload: QboWebhook): SupportedEvent[] {
    if (Array.isArray(payload)) return this.cloudEvents(payload);
    if (this.isCloudEvent(payload)) return this.cloudEvents([payload]);
    return this.legacyEvents(payload);
  }

  private isCloudEvent(payload: QboWebhook): payload is CloudEventWebhook {
    return typeof payload === 'object' && payload !== null && 'type' in payload && 'id' in payload;
  }

  private cloudEvents(events: CloudEventWebhook[]): SupportedEvent[] {
    return events.flatMap((event) => {
      const match = INVOICE_CLOUD_EVENT.exec(event.type) ?? PAYMENT_CLOUD_EVENT.exec(event.type);
      const eventAction = match?.[1];
      if (!eventAction || !event.id || !event.intuitentityid || !event.intuitaccountid) return [];
      const entityType = event.type.toLowerCase().startsWith('qbo.payment.') ? 'payment' : 'invoice';
      return [
        {
          eventId: event.id,
          entityId: event.intuitentityid,
          entityType,
          operation: eventAction.toLowerCase() === 'deleted' ? 'delete' : 'upsert',
          realmId: event.intuitaccountid,
        },
      ];
    });
  }

  private legacyEvents(payload: LegacyWebhook): SupportedEvent[] {
    return (payload.eventNotifications ?? []).flatMap((notification) =>
      (notification.dataChangeEvent?.entities ?? []).flatMap((entity) => {
        if ((entity.name !== 'Invoice' && entity.name !== 'Payment') || !entity.id) return [];
        return [
          {
            eventId: entity.lastUpdated ?? 'unknown',
            entityId: entity.id,
            entityType: entity.name === 'Payment' ? 'payment' : 'invoice',
            operation: entity.operation === 'Delete' ? 'delete' : 'upsert',
            realmId: notification.realmId,
          },
        ];
      }),
    );
  }
}
