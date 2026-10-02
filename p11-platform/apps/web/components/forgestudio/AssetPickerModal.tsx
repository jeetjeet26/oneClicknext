'use client'
import {AssetGallery} from './AssetGallery'
import type {LibraryAsset} from '@/utils/forgestudio/asset-library'
export function AssetPickerModal({propertyId,onClose,onSelect,filterType='all',title='Select asset'}:{propertyId:string;onClose:()=>void;onSelect:(asset:LibraryAsset)=>void;filterType?:'image'|'video'|'all';title?:string;selectedAssetId?:string}){
 return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 sm:p-8"><div className="mx-auto max-w-5xl space-y-4 rounded-2xl bg-white p-5 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close asset picker" className="rounded border px-3 py-2" onClick={onClose}>Close</button></div><AssetGallery key={propertyId} propertyId={propertyId} filterType={filterType} selectionMode onSelectAsset={onSelect}/></div></div>
}
