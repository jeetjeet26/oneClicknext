import {BrandAssetLibrary}from '@/components/brandforge/BrandAssetLibrary'
export default async function BrandAssetsPage({params}:{params:Promise<{propertyId:string}>}){const{propertyId}=await params;return <main className="mx-auto w-full max-w-5xl p-4 sm:p-8"><BrandAssetLibrary key={propertyId} propertyId={propertyId}/></main>}
