import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import {
  createFsStorage,
  createGcsStorage,
  type GcsServiceAccount,
  type ObjectStorage,
} from '@mio/storage';
import { CONFIG, ConfigModule } from './config.module.js';
import type { ApiConfig } from './config.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** WP-24: the storage seam. GCS when a bucket is configured (D1: GCP),
 * the filesystem otherwise - dev and tests never need cloud
 * credentials, and the pipeline logic cannot tell the difference. */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): ObjectStorage => {
        if (config.gcsBucket !== null && config.gcsKeyFile !== null) {
          const account = JSON.parse(readFileSync(config.gcsKeyFile, 'utf8')) as GcsServiceAccount;
          return createGcsStorage({ bucket: config.gcsBucket, account });
        }
        return createFsStorage(config.storageDir);
      },
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
