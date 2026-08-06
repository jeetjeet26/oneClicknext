/**
 * Exact SHA-256 locks for compatibility surfaces that runtime v3 must not
 * mutate. Updating a digest is an explicit compatibility decision.
 */
export const SITEFORGE_COMPATIBILITY_LOCK_V1 = {
  schemaVersion: 1,
  hashAlgorithm: 'sha256',
  files: {
    'p11-platform/apps/web/fixtures/acacia-regression.v1.ts':
      '2bfbf0c39340f383911e2f2e658679a6d0512cccfd1dcac5d99154d0dfc5be5a',
    'p11-platform/apps/web/utils/siteforge/runtime-contract.ts':
      '65d70c67af87138f0e68e377b46edfe15de5d76ee9e9ad477feb86cd131fba95',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-request.json':
      'b91a24caa6a19b284c9700d8110f98a38c272ef840a6f804e35cc71730deda90',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-result.json':
      '43af7d237d4be2bf2591789343d5ecee638452fd69d98df1dc4711693ad44f8f',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/capabilities.json':
      'a86ff67f9621193057e76b182cf61707a3518e8d35b0312f09902b4906066d0e',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-request.json':
      '485091d745d32f42ac9b22fddc21aad7d360fb1321e61340aa34bcc7efa2153b',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-succeeded.json':
      '89bbe624561b898fa1bcb5da03dee2a84a4e9a9d116026e2f5de70659fc831cb',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/health.json':
      'f0b1011c3278024ba432fd571177d242693e19bf5900e8ec96783dbc7b1fee8b',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-parity-section.json':
      '90355ee93212deedbccdd91b4588846b0608a3f1b1d56231100abea09a74d9af',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-plan-state.json':
      '29c9dfaac2913183e5673f6277a023b2ebd9d3208b9813706483daca5a367d6f',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/stale-remote-error.json':
      'fe78de82e61d6ed18249acc8cdfc2dcda3f7f476853d6c5ce0c176d0d85fd416',
    'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/state.json':
      'cc5555799fd0a6829c4674926af6590b164cf96ff977f068efa09e7e8cc014f4',
    'wordpress-theme/oneclick-siteforge/inc/rest-api.php':
      '0fc30200d32e163d8932042c711f9724daeb797174524f1bcdb5a22a45d9d744',
  },
  groups: {
    acaciaRegressionV1: {
      digest:
        '427c63d05756615c815a6a4116e24f52e4846051e7e68a15a5a2eb7f5af61fb7',
      files: ['p11-platform/apps/web/fixtures/acacia-regression.v1.ts'],
    },
    runtimeV2TypeScriptContractAndFixtures: {
      digest:
        '0ebc3c6c9b8f184644926be1b15274e678e7a4298567fd407f0159681532d69a',
      files: [
        'p11-platform/apps/web/utils/siteforge/runtime-contract.ts',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-request.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-result.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/capabilities.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-request.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-succeeded.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/health.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-parity-section.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-plan-state.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/stale-remote-error.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/state.json',
      ],
    },
    wordpressRuntimeV2Fixtures: {
      digest:
        '4648fdc3729624104b911cbedbecbfe1be1b264cf6309a90c62bbe2b3c3a8da1',
      files: [
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-request.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/asset-preparation-result.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/capabilities.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-request.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/deployment-succeeded.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/health.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-parity-section.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/runtime-plan-state.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/stale-remote-error.json',
        'wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2/state.json',
      ],
    },
    legacyThemeV1ApiContract: {
      digest:
        '272b997539c804f0bde5472092bdf7c89f0fc9860f311201e6ebe5f0af4814c3',
      files: ['wordpress-theme/oneclick-siteforge/inc/rest-api.php'],
    },
  },
} as const
