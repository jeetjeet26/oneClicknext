'use client'
import Link from 'next/link'
import {useAddProperty} from '../AddPropertyProvider'
import {setupDestination} from '@/utils/property-setup/intake'
import {setupPanel,setupPrimary} from '@/components/onboarding/IntakeFields'
export function CompleteStep(){const{formData,createdPropertyId}=useAddProperty();return <section className={setupPanel}><h1 className="text-3xl font-semibold">Property Added!</h1><p>{formData.community.name} setup is saved.</p><p>{formData.contacts.length} internal contacts · {formData.integrations.length} connection plans · {formData.community.intake?.sources.length||0} source references</p><p>Continue with the tasks for your selected products. Source review, provider verification and launch approval each have their own status.</p>{createdPropertyId&&<Link className={setupPrimary} href={setupDestination(createdPropertyId)}>Continue property setup</Link>}</section>}
