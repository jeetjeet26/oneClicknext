'use client'
import {SocialAppSetup} from './SocialAppSetup'
export function PlatformSetupModal({platformId,...props}:{platformId:'linkedin'|'tiktok'|'x';propertyId:string;onClose:()=>void;onConfigured:()=>void}){return <SocialAppSetup {...props} platform={platformId}/>}
