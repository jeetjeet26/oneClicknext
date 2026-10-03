'use client'
import {useParams}from 'next/navigation'
import {PropertySetupEditor}from '@/components/community/PropertySetupEditor'
export default function EditPropertyPage(){const{id}=useParams<{id:string}>();return <PropertySetupEditor key={id} propertyId={id}/> }
