import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Readiness is deliberately an in-memory startup/shutdown signal. Health
 * probes must not create database traffic or compete for pool connections.
 */
@Injectable()
export class ReadinessService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private ready = false;

  constructor(@InjectDataSource() private readonly database: DataSource) {}

  onApplicationBootstrap(): void {
    this.ready = this.database.isInitialized;
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }
}
