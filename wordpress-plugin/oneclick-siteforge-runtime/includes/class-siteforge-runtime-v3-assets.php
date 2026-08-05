<?php
/**
 * SiteForge v3 asset preparation adapter with exact v3 identity storage.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_Assets {
	const PREPARATIONS_OPTION = 'oneclick_siteforge_runtime_asset_preparations_v3';

	/** @var SiteForge_Runtime_Assets */
	private $assets;

	public function __construct( SiteForge_Runtime_Assets $assets ) {
		$this->assets = $assets;
	}

	public function prepare( $request ) {
		$input       = SiteForge_Runtime_V3_Validation::asset_request( $request );
		$v2_assets   = array();
		foreach ( $input['assets'] as $item ) {
			$asset = $item['asset'];
			$v2_assets[] = array(
				'assetId'  => $asset['assetId'],
				'sourceUrl'=> $item['source']['sourceUrl'],
				'byteHash' => $asset['byteSha256'],
				'bytes'    => $asset['bytes'],
				'mimeType' => $asset['mimeType'],
				'filename' => $asset['filename'],
				'role'     => $asset['role'],
				'altText'  => $asset['altText'],
				'caption'  => $asset['caption'],
			);
		}
		$identities = array_map(
			static function ( $asset ) {
				unset( $asset['sourceUrl'] );
				return $asset;
			},
			$v2_assets
		);
		usort(
			$identities,
			static function ( $left, $right ) {
				return strcmp( $left['assetId'], $right['assetId'] );
			}
		);
		$manifest_hash = SiteForge_Runtime_Validation::hash( $identities );
		$v2_idempotency = SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 2,
				'scope'                     => 'asset_preparation',
				'siteId'                    => $input['identity']['siteId'],
				'artifactId'                => $input['identity']['artifactId'],
				'artifactContentHash'       => $input['identity']['artifactContentHash'],
				'expectedRemoteContentHash' => null,
				'payloadHash'               => $manifest_hash,
			)
		);
		$prepared = $this->assets->prepare(
			array(
				'contractVersion'     => 2,
				'siteId'             => $input['identity']['siteId'],
				'artifactId'         => $input['identity']['artifactId'],
				'artifactContentHash'=> $input['identity']['artifactContentHash'],
				'assetManifestHash'  => $manifest_hash,
				'idempotencyKey'     => $v2_idempotency,
				'assets'             => $v2_assets,
			)
		);
		$output_assets = array_map(
			static function ( $asset ) {
				return array(
					'assetId'      => $asset['assetId'],
					'byteSha256'   => $asset['byteHash'],
					'attachmentId' => $asset['attachmentId'],
					'url'          => $asset['url'],
					'mimeType'     => $asset['mimeType'],
					'disposition'  => $asset['disposition'],
				);
			},
			$prepared['assets']
		);
		$result = array(
			'contractVersion' => 3,
			'preparationId'   => $prepared['preparationId'],
			'identity'        => $input['identity'],
			'idempotencyKey'  => $input['idempotencyKey'],
			'assets'          => $output_assets,
			'preparedAt'      => $prepared['preparedAt'],
			'_v2PreparationId'=> $prepared['preparationId'],
		);
		$records = get_option( self::PREPARATIONS_OPTION, array() );
		$records = is_array( $records ) ? $records : array();
		$records[ $result['preparationId'] ] = $result;
		update_option( self::PREPARATIONS_OPTION, $records, false );
		unset( $result['_v2PreparationId'] );
		return $result;
	}

	public function get_preparation( $preparation_id ) {
		$records = get_option( self::PREPARATIONS_OPTION, array() );
		return is_array( $records ) && isset( $records[ $preparation_id ] ) ? $records[ $preparation_id ] : null;
	}

	public function rollback_preparation( $preparation_id, $artifact_id ) {
		$record = $this->get_preparation( $preparation_id );
		if ( is_array( $record ) ) {
			$this->assets->rollback_preparation( $preparation_id, $artifact_id );
		}
	}
}
