import { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';
import { DatabaseConfig, DatabaseSecretsConfig } from '../shared/config/configuration';

/**
 * The single Postgres configuration used by both the Nest runtime and TypeORM
 * CLI. Pool settings are per pod; size the value with replica count and the
 * database's connection limit in mind.
 */
export function databaseOptions(config: DatabaseConfig, secrets: DatabaseSecretsConfig): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    url: secrets.url,
    poolSize: config.poolMax,
    connectTimeoutMS: config.connectionTimeoutMs,
    applicationName: config.applicationName,
    extra: {
      statement_timeout: config.statementTimeoutMs,
      idle_in_transaction_session_timeout: config.idleInTransactionTimeoutMs,
    },
  };
}
