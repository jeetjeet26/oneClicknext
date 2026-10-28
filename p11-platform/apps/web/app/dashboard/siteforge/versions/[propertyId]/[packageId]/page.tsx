import { SiteForgePackages } from '@/components/siteforge/SiteForgePackages'

export default async function WebsiteVersionPage({params}:{params:Promise<{propertyId:string;packageId:string}>}) {
  const {propertyId,packageId}=await params
  return <div className="mx-auto w-full max-w-[1800px]"><SiteForgePackages key={`${propertyId}-${packageId}`} propertyId={propertyId} packageId={packageId}/></div>
}
