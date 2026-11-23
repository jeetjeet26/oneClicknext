"use client"
import{createContext,useContext,useEffect,type ReactNode}from'react'
import{useTheme}from'@/components/ui/ThemeProvider'
import type{Appearance}from'@/utils/account-settings/contracts'
const ActorContext=createContext('')
export const useAccountActor=()=>useContext(ActorContext)
const TimeZoneContext=createContext('UTC')
export function AccountPreferences({actorId,appearance,timeZone,children}:{actorId:string;appearance:Appearance|null;timeZone:string;children:ReactNode}){
 const{setTheme}=useTheme(),theme=appearance?.theme,accent=appearance?.accentColor
 useEffect(()=>{if(theme)setTheme(theme)},[actorId,theme,setTheme])
 useEffect(()=>{if(accent)document.documentElement.dataset.accent=accent;return()=>{delete document.documentElement.dataset.accent}},[actorId,accent])
 return<ActorContext.Provider value={actorId}><TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider></ActorContext.Provider>
}
export const useAccountTimeZone=()=>useContext(TimeZoneContext)
export function accountDate(value:string,timeZone:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString('en-US',{timeZone})}
