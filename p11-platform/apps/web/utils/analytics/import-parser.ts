import {createHash} from 'node:crypto'
import {factAccountId} from './marketing-fact'
export type ImportInput={filename:string;csvContent:string;platform:'google_ads'|'meta_ads';sourceAccountId:string;campaignName:string;campaignId?:string;currencyCode:'USD';startDate?:string;endDate?:string}
export type ImportRow={date?:string;campaign_id:string;campaign_name:string;impressions?:number;clicks?:number;spend?:number;conversions?:number;dimension_key?:string;dimension_value?:string;date_range_start?:string;date_range_end?:string;metrics?:Record<string,string|number>}
export type ImportPreview={kind:'daily'|'dimension';reportType:string;sourceAccountId:string;platform:ImportInput['platform'];currencyCode:'USD';rows:ImportRow[];dateRange:{start:string;end:string};totals:{impressions:number;clicks:number;spend:number;conversions:number};coverage:{records:number;inputRows:number;skipped:Array<{row:number;reason:string}>;metricColumns:Record<string,string>};parserVersion:string;warnings:string[]}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
// Changes to parsing behavior require a new version; exact original text and the derived preview are retained together.
export const IMPORT_PARSER_VERSION='marketing-csv-reviewed-v1'
export function csvRecords(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false
 const field=()=>{row.push(cell.trim());cell='';closed=false}
 const record=()=>{field();if(row.some(v=>v!==''))rows.push(row);row=[]}
 text=text.replace(/^\uFEFF/,'')
 for(let i=0;i<text.length;i++){
  const char=text[i]
  if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=char;continue}
  if(char==='"'){if(cell.trim()||closed)throw new Error('A CSV quote is misplaced. Export the file again.');cell='';quoted=true}
  else if(char===',')field()
  else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;record()}
  else if(closed&&!/\s/.test(char))throw new Error('CSV text follows a closed quote. Export the file again.')
  else if(!closed)cell+=char
 }
 if(quoted)throw new Error('The CSV ends inside a quoted field.')
 if(cell||closed||row.length)record()
 return rows
}
const normalize=(s:string)=>s.toLowerCase().trim().replaceAll('_',' ').replace(/\s+/g,' ')
export function csvDate(value:string):string{
 let date=value.trim();const match=date.replace(/^[A-Za-z]+,\s*/,'').match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/)
 if(match){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase())+1;date=`${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1900-01-01'||date>'2199-12-31'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error(`Invalid reporting date: ${value}`)
 return date
}
function metric(value:string,label:string,whole=false):number{
 const raw=value.trim().replace(/^\$/,'')
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw))throw new Error(`${label} must contain a complete numeric value. Missing or invalid values are not zero.`)
 const number=Number(raw.replaceAll(',',''))
 if(!Number.isFinite(number)||number<0||(whole?!Number.isSafeInteger(number):number>=(label==='spend'?1e8:1e15)))throw new Error(`${label} is outside the supported reporting range.`)
 return number
}
const aliases={impressions:['impressions','impr.'],clicks:['clicks','link clicks'],spend:['cost','spend','amount spent','amount spent (usd)','cost (usd)'],conversions:['conversions','results']}
const dates=['date','date start','reporting starts','day']
export function buildImportPreview(input:ImportInput):ImportPreview{
 if(Buffer.byteLength(input.csvContent,'utf8')>8*1024*1024)throw new Error('Each CSV must be at most 8 MB.')
 const sourceAccountId=factAccountId(input.platform,input.sourceAccountId),all=csvRecords(input.csvContent)
 const headerIndex=all.findIndex((row,i)=>i<5&&row.some(v=>['clicks','impressions','impr.','cost','spend','amount spent','amount spent (usd)','link clicks'].includes(normalize(v))))
 if(headerIndex<0)throw new Error('Find a supported daily or dimension export with reporting metric columns.')
 const headers=all[headerIndex],keys=headers.map(normalize),rows=all.slice(headerIndex+1)
 if(new Set(keys).size!==keys.length)throw new Error('The CSV has duplicate column names.')
 if(!rows.length||rows.length>5000)throw new Error('Choose a file containing between 1 and 5,000 complete rows.')
 if(rows.some(row=>row.length!==headers.length))throw new Error('CSV rows have different numbers of fields. Export the file again.')
 const index=(names:string[])=>keys.findIndex(k=>names.includes(k)),dateIndex=index(dates),campaignIndex=index(['campaign id']),campaignNameIndex=index(['campaign','campaign name']),accountIndex=index(['account id','customer id']),currencyIndex=index(['currency','currency code'])
 const metricIndices=Object.fromEntries(Object.entries(aliases).map(([key,values])=>[key,index(values)])),metricColumns=Object.fromEntries(Object.entries(metricIndices).filter(([,i])=>i>=0).map(([key,i])=>[key,headers[i]]))
 const daily=dateIndex>=0&&rows.some(row=>/^\d{4}-\d{2}-\d{2}$|^[A-Za-z]+,?\s/.test(row[dateIndex]))
 const dimensionChoices:[string,string[]][]=[['keywords',['search keyword','keyword']],['search_terms',['search','search term']],['demographics',['gender','age range']],['devices',['device']],['locations',['location name','country']],['day_hour',['day of week','day','hour']],['auction_insights',['advertiser name','display url domain']],['networks',['network']]]
 const dimension=dimensionChoices.find(([,names])=>index(names)>=0)
 if(!daily&&!dimension)throw new Error('Campaign summaries cannot update daily performance. Choose a daily or supported dimension export.')
 if(daily&&Object.values(metricIndices).some(i=>i<0))throw new Error('Daily imports require impressions, clicks, spend/cost and conversions/results columns. Missing columns are not zero.')
 const dimensionIndices=!daily?[...dimension![1], 'ad group id','ad group','ad set id','ad set name','match type'].filter(k=>keys.includes(k)).map(k=>keys.indexOf(k)):[]
 let range:{start:string;end:string}|null=null
 if(!daily){
  const match=input.filename.match(/(\d{4})[.-](\d{2})[.-](\d{2})[_-](\d{4})[.-](\d{2})[.-](\d{2})/)
  const start=input.startDate||(match?`${match[1]}-${match[2]}-${match[3]}`:null),end=input.endDate||(match?`${match[4]}-${match[5]}-${match[6]}`:null)
  if(!start||!end)throw new Error('Dimension reports need their actual reporting start and end dates.')
  range={start:csvDate(start),end:csvDate(end)};if(range.start>range.end)throw new Error('The reporting end date precedes the start date.')
 }
 const parsed:ImportRow[]=[],seen=new Set<string>(),skipped:Array<{row:number;reason:string}>=[],totals={impressions:0,clicks:0,spend:0,conversions:0}
 for(const[rowNumber,row]of rows.entries()){
  if(row.some((v,i)=>(i===dateIndex||i===campaignNameIndex||i===dimensionIndices[0])&&/^total(?::|$)/i.test(v))){skipped.push({row:headerIndex+rowNumber+2,reason:'Export total row; excluded from detail sums.'});continue}
  if(accountIndex>=0&&factAccountId(input.platform,row[accountIndex])!==sourceAccountId)throw new Error(`Row ${rowNumber+1} belongs to a different ad account.`)
  if(currencyIndex>=0&&row[currencyIndex]!=='USD')throw new Error(`Row ${rowNumber+1} does not report USD.`)
  const campaignId=(campaignIndex>=0?row[campaignIndex]:input.campaignId)?.trim()
  if(!campaignId||campaignId.length>150)throw new Error('Provide the actual campaign ID when the export does not contain campaign IDs. Names are not campaign identities.')
  const campaignName=campaignNameIndex>=0?row[campaignNameIndex]:input.campaignName
  const values:Record<string,number>={};for(const[key,i]of Object.entries(metricIndices))if(i>=0){values[key]=metric(row[i],key,key==='impressions'||key==='clicks');totals[key as keyof typeof totals]+=values[key]}
  if(daily&&Math.round(values.spend*100)/100!==values.spend)throw new Error('Daily spend supports at most two decimal places. The saved amount must match the preview exactly.')
  let record:ImportRow
  if(daily){const date=csvDate(row[dateIndex]);const endIndex=index(['date stop','reporting ends']);if(endIndex>=0&&csvDate(row[endIndex])!==date)throw new Error('This export groups multiple dates. Export daily rows to update daily performance.');record={date,campaign_id:campaignId,campaign_name:campaignName,...values};if(!range)range={start:date,end:date};else{if(date<range.start)range.start=date;if(date>range.end)range.end=date}}
  else{const parts=dimensionIndices.map(i=>row[i]);if(parts.every(v=>!v))throw new Error(`Row ${rowNumber+1} has no dimension value.`);record={campaign_id:campaignId,campaign_name:campaignName,dimension_key:dimensionIndices.map(i=>keys[i]).join(' + '),dimension_value:parts.length===1?parts[0]:JSON.stringify(parts),date_range_start:range!.start,date_range_end:range!.end,metrics:{...Object.fromEntries(headers.map((key,i)=>[key,row[i]])),...values}}}
  const identity=JSON.stringify([record.date,record.campaign_id,record.dimension_key,record.dimension_value,record.date_range_start,record.date_range_end]);if(seen.has(identity))throw new Error(`More than one row has the same reporting identity (row ${rowNumber+1}). Export without extra unrepresented breakdowns.`);seen.add(identity);parsed.push(record)
 }
 if(!parsed.length||!range)throw new Error('The export has no individual records to import.')
 if(Buffer.byteLength(JSON.stringify(parsed),'utf8')>12*1024*1024)throw new Error('The parsed report exceeds the supported size. Split the export by period.')
 return{kind:daily?'daily':'dimension',reportType:daily?'time_series':dimension![0],sourceAccountId,platform:input.platform,currencyCode:'USD',rows:parsed,dateRange:range,totals,coverage:{records:parsed.length,inputRows:rows.length,skipped,metricColumns},parserVersion:IMPORT_PARSER_VERSION,warnings:skipped.length?[`${skipped.length} total row(s) are retained in the original but excluded from imported detail.`]:[]}
}
export const csvOriginalHash=(input:ImportInput)=>digest(JSON.stringify(input))
