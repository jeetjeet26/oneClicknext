'use client'
import Link from 'next/link'
type Property={id:string;name:string;address:{street?:string;city?:string;state?:string;zip?:string}|null;property_type?:string;unit_count?:number;website_url?:string}
type Props={isOpen:boolean;onClose:()=>void;onSuccess?:(property:Property)=>void;existingProperties?:Property[]}
export function AddCommunityModal({isOpen,onClose}:Props){if(!isOpen)return null;return <div role="dialog" aria-modal="true" aria-label="Add property" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section className="max-w-md rounded-xl bg-white p-6 text-slate-900"><h2 className="text-xl font-semibold">Add a property</h2><p className="mt-3 text-sm text-slate-600">Use the guided property setup to review details, optionally copy a template, and recover an interrupted creation.</p><div className="mt-5 flex gap-3"><Link href="/dashboard/properties/new" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Open property setup</Link><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2">Close</button></div></section></div>}
export const AddPropertyModal=AddCommunityModal
