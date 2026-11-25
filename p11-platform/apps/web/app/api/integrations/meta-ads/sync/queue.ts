import { queueAdConnection } from '@/utils/marketvision/queue-ad-connection';
// Compatibility entry point: native/scheduled imports share the qualified daily
// provider readers, persisted report checkpoints and worker leases.
export async function syncMetaAdsConnection(connectionId: string, accountId: string, propertyId: string, daysBack = 7) {
    return queueAdConnection('meta_ads', connectionId, accountId, propertyId, daysBack);
}
