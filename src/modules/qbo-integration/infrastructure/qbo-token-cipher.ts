import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../../../shared/config/app-config.service';

@Injectable()
export class QboTokenCipher {
  private readonly key: Buffer;
  constructor(config: AppConfig) {
    this.key = Buffer.from(config.secrets.qbo.tokenEncryptionKey, 'base64');
  }
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
  }
  decrypt(value: string): string {
    const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted QBO token');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
