import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DatabaseHandle } from '@forgeflow/database';
import type pg from 'pg';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  ClaimedOutboxEvent,
  OutboxHandler,
  OutboxProcessorOptions,
} from '../../common/types/outbox.types.js';
import { outboxBackoffMs, PermanentOutboxError } from '../../common/utils/outbox.util.js';
import {
  GithubReconcileService,
  RECONCILE_INTERVAL_MS,
} from '../github/github-reconcile.service.js';
import { GithubWebhooksService } from '../github/github-webhooks.service.js';
import { OUTBOX_CHANNEL, OutboxService } from './outbox.service.js';

const DEFAULT_OPTIONS: OutboxProcessorOptions = {
  batchSize: 10,
  leaseSeconds: 60,
  maxAttempts: 8,
  maxHoldSeconds: 30 * 60,
};
/** Polling when no NOTIFY arrives (a missed one, or the listener connection down). */
const POLL_INTERVAL_MS = 5_000;
/** Touched on every loop and lease renewal; the container healthcheck checks it is recent. */
export const WORKER_HEARTBEAT_FILE = join(tmpdir(), 'forgeflow-worker.alive');

/**
 * Claims due outbox events of the topics it has handlers for (so several workers can split the
 * topics between them) and hands each to its handler: completed on success,
 * retried with backoff on failure, dead after maxAttempts or on a PermanentOutboxError. The
 * claims of the batch in hand are renewed while it is handled (up to maxHoldSeconds); a claim
 * that no longer belongs to this worker (lease expired, another took over) is left alone.
 */
export class OutboxProcessor {
  constructor(
    private readonly outbox: OutboxService,
    private readonly handlers: ReadonlyMap<string, OutboxHandler>,
    private readonly options: OutboxProcessorOptions = DEFAULT_OPTIONS,
    private readonly logger: Pick<Logger, 'warn' | 'error'> = new Logger(OutboxProcessor.name),
    /** Called after each successful lease renewal (the worker's liveness file). */
    private readonly onRenewed: () => void = () => undefined,
  ) {}

  /** Claims and handles one batch; returns how many events it took. */
  async runOnce(): Promise<number> {
    const events = await this.outbox.claim(
      [...this.handlers.keys()],
      this.options.batchSize,
      this.options.leaseSeconds,
    );
    if (events.length === 0) return 0;
    const held = new Map(events.map((event) => [event.id, event]));
    const stopRenewing = this.keepClaims(held);
    try {
      for (const event of events) {
        await this.handle(event);
        held.delete(event.id);
      }
    } finally {
      stopRenewing();
    }
    return events.length;
  }

  /**
   * Renews the leases of the claims still in `held` every third of a lease, so events waiting
   * behind a slow one, or a long handler, stay this worker's, until maxHoldSeconds after the claim.
   */
  private keepClaims(held: ReadonlyMap<string, ClaimedOutboxEvent>): () => void {
    const until = Date.now() + this.options.maxHoldSeconds * 1000;
    let renewing = false;
    const timer = setInterval(
      () => {
        if (renewing || held.size === 0) return;
        if (Date.now() >= until) {
          clearInterval(timer);
          this.logger.warn(
            { eventIds: [...held.keys()] },
            'Outbox batch held too long; its claims are left to expire',
          );
          return;
        }
        renewing = true;
        this.outbox
          .renew([...held.values()], this.options.leaseSeconds)
          .then(() => this.onRenewed())
          .catch((error: unknown) => {
            this.logger.warn({ err: error }, 'Renewing outbox claims failed');
          })
          .finally(() => {
            renewing = false;
          });
      },
      (this.options.leaseSeconds * 1000) / 3,
    );
    return () => clearInterval(timer);
  }

  private async handle(event: ClaimedOutboxEvent): Promise<void> {
    const handler = this.handlers.get(event.topic);
    try {
      if (!handler) throw new PermanentOutboxError(`No handler for topic "${event.topic}"`);
      await handler(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp =
        error instanceof PermanentOutboxError || event.attempts >= this.options.maxAttempts;
      const retryAt = giveUp ? null : new Date(Date.now() + outboxBackoffMs(event.attempts));
      this.logger.warn(
        { eventId: event.id, topic: event.topic, attempts: event.attempts, err: error },
        giveUp ? 'Outbox event is dead' : 'Outbox event failed; it will be retried',
      );
      if (!(await this.outbox.fail(event, message, retryAt))) {
        this.logger.warn({ eventId: event.id }, 'Outbox claim was lost before failing the event');
      }
      return;
    }
    if (!(await this.outbox.complete(event))) {
      this.logger.warn({ eventId: event.id }, 'Outbox claim was lost before completing the event');
    }
  }
}

/**
 * The worker process's loop (apps/api/src/worker.ts): runs the processor while there is work,
 * then sleeps until a NOTIFY on forgeflow_outbox or the next poll. Stops cleanly on shutdown,
 * finishing the event in hand.
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly processor: OutboxProcessor;
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private listener: pg.PoolClient | undefined;
  private scheduler: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(OutboxService) outbox: OutboxService,
    @Inject(GithubWebhooksService) github: GithubWebhooksService,
    @Inject(GithubReconcileService) private readonly reconcile: GithubReconcileService,
  ) {
    const handlers = new Map<string, OutboxHandler>([
      ['github.webhook', (event) => github.handle(event)],
      ['github.reconcile', (event) => reconcile.handle(event)],
    ]);
    this.processor = new OutboxProcessor(outbox, handlers, DEFAULT_OPTIONS, this.logger, () =>
      this.beat(),
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.listen();
    this.loop = this.run();
    // The GitHub catch-up job for every integration, a minute after start and then regularly.
    const schedule = () => {
      this.reconcile.schedule().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Scheduling the GitHub catch-up job failed');
      });
    };
    const first = setTimeout(() => {
      schedule();
      this.scheduler = setInterval(schedule, RECONCILE_INTERVAL_MS);
    }, 60_000);
    this.scheduler = first;
    this.logger.log('Outbox worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.scheduler);
    clearInterval(this.scheduler);
    this.wake?.();
    await this.loop;
    this.listener?.release();
    this.logger.log('Outbox worker stopped');
  }

  private async run(): Promise<void> {
    while (this.running) {
      let handled = 0;
      try {
        handled = await this.processor.runOnce();
      } catch (error) {
        this.logger.error({ err: error }, 'Claiming outbox events failed');
      }
      await this.beat();
      if (handled === 0 && this.running) await this.sleep(POLL_INTERVAL_MS);
    }
  }

  private async beat(): Promise<void> {
    await writeFile(WORKER_HEARTBEAT_FILE, new Date().toISOString()).catch(() => undefined);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** A dedicated connection LISTENing for new events; polling covers for it if it fails. */
  private async listen(): Promise<void> {
    try {
      this.listener = await this.database.pool.connect();
      this.listener.on('notification', () => this.wake?.());
      this.listener.on('error', (error) => {
        this.logger.warn({ err: error }, 'Outbox listener connection failed; polling only');
      });
      await this.listener.query(`LISTEN ${OUTBOX_CHANNEL}`);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not LISTEN for outbox events; polling only');
    }
  }
}
