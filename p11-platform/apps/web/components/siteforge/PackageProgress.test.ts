import React from 'react'
import { describe,it,expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PackageProgress } from './PackageProgress'
import type { PackageState } from '@/utils/siteforge/packages/contracts'

describe('website generation progress',()=>{
  it.each<[PackageState,number]>([['queued',0],['preparing',1],['starting',2],['generating',2],['packaging',3],['ready',4]])('shows the confirmed stage for %s', (state,step)=>{
    const html=renderToStaticMarkup(React.createElement(PackageProgress,{state}))
    expect(html).toContain(`aria-valuenow="${step}"`)
    expect(html).toContain(`Step ${step+1} of 5`)
    expect(html).toContain('aria-label="Website generation progress"')
  })
  it('does not show false completion for a failed or uncertain build',()=>{
    expect(renderToStaticMarkup(React.createElement(PackageProgress,{state:'failed'}))).not.toContain('progressbar')
    const html=renderToStaticMarkup(React.createElement(PackageProgress,{state:'uncertain'}))
    expect(html).not.toContain('progressbar');expect(html).toContain('Progress paused')
  })
})
