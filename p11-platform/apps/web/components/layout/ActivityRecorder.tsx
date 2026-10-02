'use client'
import {useEffect,useRef,useSyncExternalStore} from 'react'
import {usePathname} from 'next/navigation'
import {usePropertyContext} from '@/components/layout/PropertyContext'
import {pageObservation} from '@/utils/actions/catalog'
import {droppedObservations,failedObservations,recordPageObservation,retryObservations,serverObservations,subscribeObservations} from '@/utils/actions/observation-client'
export function ActivityRecorder({actorId}:{actorId:string}) {
 const pathname=usePathname(),{currentProperty,hasLoadedProperties,isSwitchingProperty}=usePropertyContext()
 const episode=useRef<{scope:string;id:string}|null>(null),last=useRef<{key:string;eventId:string}|null>(null)
 const failures=useSyncExternalStore(subscribeObservations,()=>failedObservations(actorId),serverObservations)
 const dropped=useSyncExternalStore(subscribeObservations,()=>droppedObservations(actorId),serverObservations)
 useEffect(()=>{
  if(!hasLoadedProperties||!currentProperty.id||isSwitchingProperty)return
  const page=pageObservation(pathname);if(!page)return
  const scope=`${actorId}/${currentProperty.id}`
  if(episode.current?.scope!==scope)episode.current={scope,id:crypto.randomUUID()}
  const key=`${scope}/${pathname}`
  if(last.current?.key===key)return
  last.current={key,eventId:crypto.randomUUID()}
  recordPageObservation({id:last.current.eventId,episodeId:episode.current.id,propertyId:currentProperty.id,expectedActorId:actorId,path:page.path})
 },[actorId,currentProperty.id,hasLoadedProperties,isSwitchingProperty,pathname])
 return <>{dropped>0&&<p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Some page observations could not be retained while recording was unavailable.</p>}{failures>0?<p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Some page activity has not been recorded. <button className="underline" onClick={()=>retryObservations(actorId)}>Retry recording</button></p>:null}</>
}
