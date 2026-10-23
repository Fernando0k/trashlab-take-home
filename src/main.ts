import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './shared/config/app-config.service';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter';
import { HttpRequestLoggingInterceptor } from './shared/logging/http-request-logging.interceptor';
import { requestContext } from './shared/logging/request-context';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true });
  app.useBodyParser('json', { type: () => true });
  app.use(requestContext);
  app.useSecurityHeaders();
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new HttpRequestLoggingInterceptor());
  const openApiConfig = new DocumentBuilder()
    .setTitle('Two-way QBO invoice sync')
    .setDescription('Internal invoice API and the protected QuickBooks connection bootstrap endpoint.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-api-key' }, 'internalApiKey')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-qbo-setup-key' }, 'qboSetupKey')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApiConfig), {
    useGlobalPrefix: false,
    jsonDocumentUrl: '/docs/openapi.json',
  });
  await app.listen(app.get(AppConfig).app.port);
}
void bootstrap();
