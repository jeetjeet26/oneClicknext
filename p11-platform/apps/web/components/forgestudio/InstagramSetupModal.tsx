'use client'
import {SocialAppSetup} from './SocialAppSetup'
export function InstagramSetupModal(props:{propertyId:string;onClose:()=>void;onConfigured:()=>void}){return <SocialAppSetup {...props} platform="meta"/>}
