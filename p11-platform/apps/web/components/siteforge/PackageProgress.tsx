import type { PackageState } from '@/utils/siteforge/packages/contracts'

const stages=['Queued','Prepare sources','Create website','Review & package','Ready']
const steps:Record<PackageState,number|null>={queued:0,preparing:1,starting:2,generating:2,packaging:3,ready:4,failed:null,uncertain:null}
const details:Partial<Record<PackageState,string>>={
  queued:'Your request is saved and waiting to start.',
  preparing:'Gathering approved property information, images and floorplans.',
  starting:'Sending the prepared sources to Astra.',
  generating:'Astra is designing, building and checking previews. This stage can take several minutes.',
  packaging:'Checking the finished files and reviewing the design. Any required design repair happens here.',
  ready:'The website package is ready for your review.',
}

export function PackageProgress({state}:{state:PackageState}) {
  const step=steps[state]
  if(step===null)return state==='uncertain'?<p className="mt-3 text-sm text-amber-800">Progress paused while the build status is confirmed.</p>:null
  return <div className="my-4 rounded-xl border border-violet-100 bg-violet-50/50 p-4">
    <p aria-live="polite" className="text-sm font-medium text-gray-900">Step {step+1} of {stages.length} · {stages[step]}</p>
    <div role="progressbar" aria-label="Website generation progress" aria-valuemin={0} aria-valuemax={stages.length-1} aria-valuenow={step} aria-valuetext={`Step ${step+1} of ${stages.length}: ${stages[step]}`} className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100">
      <div className="h-full rounded-full bg-violet-600 transition-[width] duration-500 motion-reduce:transition-none" style={{width:`${step/(stages.length-1)*100}%`}}/>
    </div>
    <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {stages.map((label,index)=><li key={label} aria-current={index===step?'step':undefined} className={index<=step?'font-medium text-violet-900':'text-gray-500'}><span aria-hidden="true">{index<step?'✓':index+1}. </span>{label}</li>)}
    </ol>
    <p className="mt-3 text-sm text-gray-600">{details[state]}</p>
    {state!=='ready'?<p className="mt-1 text-xs text-gray-500">Progress reflects completed stages, not elapsed time. Updates automatically.</p>:null}
  </div>
}
