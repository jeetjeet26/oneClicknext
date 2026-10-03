'use client'
import {useEffect,useState} from 'react'
import type {MarketAnalysis} from './analysis'
export function useMarketAnalysis(propertyId:string|undefined,type:string,filters:Record<string,string>={}) {
  const params=new URLSearchParams({propertyId:propertyId??'',type,...filters}).toString()
  const [revision,setRevision]=useState(0)
  const [state,setState]=useState<{key:string;data:MarketAnalysis|null;error:string|null;loading:boolean}>({key:'',data:null,error:null,loading:true})
  const key=`${params}:${revision}`
  useEffect(()=>{
    const controller=new AbortController()
    if(!propertyId)return()=>controller.abort()
    setState({key,data:null,error:null,loading:true})
    void(async()=>{try {
      const response=await fetch(`/api/marketvision/analysis?${params}`,{signal:controller.signal,cache:'no-store'})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||'Market evidence could not be loaded.')
      if(!data.summary||!Array.isArray(data.comparisons)||!Array.isArray(data.trends))throw new Error('The market report is incomplete. Reload to try again.')
      if(!controller.signal.aborted)setState({key,data,error:null,loading:false})
    }catch(error){if(!controller.signal.aborted)setState({key,data:null,error:error instanceof Error?error.message:'Market evidence could not be loaded.',loading:false})}})()
    return()=>controller.abort()
  },[propertyId,params,key])
  const current=state.key===key?state:{data:null,error:null,loading:true}
  return {...current,refresh:()=>setRevision(v=>v+1)}
}
