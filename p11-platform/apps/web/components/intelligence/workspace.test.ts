import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({property:{id:'amli-aero',name:'AMLI Aero'}}))
vi.mock('@/components/layout/PropertyContext',()=>({usePropertyContext:()=>({currentProperty:state.property})}))
vi.mock('./InsightsView',()=>({InsightsView:(props:{propertyId:string;propertyName:string})=>React.createElement('p',{'data-property':props.propertyId},props.propertyName+' results')}))
import {IntelligenceWorkspace} from './IntelligenceWorkspace'
import {ReviewedRecordsWorkspace} from './ReviewedRecordsWorkspace'
describe('knowledge and performance ownership',()=>{
  it('opens intelligence on the selected property and omits fact/creative editing tabs',()=>{
    const html=renderToStaticMarkup(React.createElement(IntelligenceWorkspace))
    expect(html).toContain('data-property="amli-aero"')
    expect(html).toContain('Campaign performance')
    expect(html).toContain('Recommendations')
    expect(html).not.toContain('>Property record<')
    expect(html).not.toContain('>Creative direction<')
  })
  it('keeps the knowledge editor free of performance navigation',()=>{
    const html=renderToStaticMarkup(React.createElement(ReviewedRecordsWorkspace,{propertyId:'amli-aero',propertyName:'AMLI Aero',mode:'facts'}))
    expect(html).toContain('Approved community facts')
    expect(html).not.toContain('Intelligence sections')
    expect(html).not.toContain('Campaign performance')
  })
})
