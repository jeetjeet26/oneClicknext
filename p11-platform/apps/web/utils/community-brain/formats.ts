/** Versioned intake contract; processing limits are also enforced by the database and isolated worker. */
export const FORMAT_RECIPE='community-file-v1'
const MiB=1024*1024
export const intakeFormats={
  txt:{mime:'text/plain',maxBytes:MiB,lane:'text'},md:{mime:'text/markdown',maxBytes:MiB,lane:'text'},
  csv:{mime:'text/csv',maxBytes:MiB,lane:'table'},
  pdf:{mime:'application/pdf',maxBytes:25*MiB,lane:'document'},
  jpg:{mime:'image/jpeg',maxBytes:20*MiB,lane:'image'},jpeg:{mime:'image/jpeg',maxBytes:20*MiB,lane:'image'},
  png:{mime:'image/png',maxBytes:20*MiB,lane:'image'},webp:{mime:'image/webp',maxBytes:20*MiB,lane:'image'},gif:{mime:'image/gif',maxBytes:20*MiB,lane:'image'},
  svg:{mime:'image/svg+xml',maxBytes:MiB,lane:'logo'},
  woff:{mime:'font/woff',maxBytes:5*MiB,lane:'font'},woff2:{mime:'font/woff2',maxBytes:5*MiB,lane:'font'},ttf:{mime:'font/ttf',maxBytes:5*MiB,lane:'font'},otf:{mime:'font/otf',maxBytes:5*MiB,lane:'font'},
  docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',maxBytes:25*MiB,lane:'document'},
  pptx:{mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',maxBytes:25*MiB,lane:'document'},
  xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',maxBytes:25*MiB,lane:'table'},
  mp4:{mime:'video/mp4',maxBytes:100*MiB,lane:'video'},webm:{mime:'video/webm',maxBytes:100*MiB,lane:'video'},
} as const
export const intakeAccept=Object.keys(intakeFormats).map(extension=>`.${extension}`).join(',')
export function intakeFormat(name:string,size:number) {
  if(!name||name.length>255||/[\u0000-\u001f\u007f/\\]/.test(name))throw new Error('Use a plain file name without control characters or folders.')
  const extension=name.split('.').pop()?.toLowerCase() as keyof typeof intakeFormats
  const spec=intakeFormats[extension]
  if(!spec)throw new Error('This file type is not supported. ZIP, legacy Office, CAD and 3D files need a separately qualified conversion.')
  if(!Number.isSafeInteger(size)||size<1||size>spec.maxBytes)throw new Error(`This file must be between 1 byte and ${spec.maxBytes/MiB} MiB.`)
  return {...spec,extension,recipe:FORMAT_RECIPE}
}
