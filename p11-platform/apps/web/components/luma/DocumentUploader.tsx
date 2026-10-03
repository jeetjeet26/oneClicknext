'use client'
import {usePropertyContext} from '../layout/PropertyContext'
import {KnowledgeFilesWorkbench} from '../community/KnowledgeFilesWorkbench'
export function DocumentUploader({onUploadComplete}:{onUploadComplete?:()=>void}){const{currentProperty}=usePropertyContext();return <KnowledgeFilesWorkbench key={currentProperty.id} propertyId={currentProperty.id} onChange={onUploadComplete}/>}
