import { Global, Module } from '@nestjs/common';
import { PooledHttpClient } from './pooled-http.client';

@Global()
@Module({
  providers: [PooledHttpClient],
  exports: [PooledHttpClient],
})
export class HttpModule {}
