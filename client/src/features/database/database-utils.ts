import type { DatabaseColumnSchema, DatabaseFilterCondition, DatabaseRow, DatabaseSortRule } from "@shared/database";

const empty = (v:unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const array = (v:unknown) => Array.isArray(v) ? v.map(String) : empty(v) ? [] : [String(v)];
const queryRange = (v:unknown) => Array.isArray(v)
  ? v.map(String)
  : String(v ?? "").split(",").map((part) => part.trim());
const dateValue = (v:unknown) => typeof v === "string"
  ? v.slice(0, 10)
  : v && typeof v === "object"
    ? String((v as { start?: unknown }).start ?? "").slice(0, 10)
    : "";
export function matches(row:DatabaseRow, columns:DatabaseColumnSchema[], conditions:DatabaseFilterCondition[]) {
  return conditions.every(c => {
    const col=columns.find(x=>x.id===c.columnId); if(!col) return true;
    const v=row.yamlData[col.name], q=c.value;
    switch(c.operator){
      case "is-empty": return empty(v); case "is-not-empty": return !empty(v);
      case "text-equals": return String(v??"")===String(q??""); case "text-not-equals": return String(v??"")!==String(q??"");
      case "text-contains": return String(v??"").toLowerCase().includes(String(q??"").toLowerCase());
      case "text-not-contains": return !String(v??"").toLowerCase().includes(String(q??"").toLowerCase());
      case "text-starts-with": return String(v??"").toLowerCase().startsWith(String(q??"").toLowerCase());
      case "text-ends-with": return String(v??"").toLowerCase().endsWith(String(q??"").toLowerCase());
      case "num-eq": return Number(v)===Number(q); case "num-neq": return Number(v)!==Number(q); case "num-gt": return Number(v)>Number(q);
      case "num-gte": return Number(v)>=Number(q); case "num-lt": return Number(v)<Number(q); case "num-lte": return Number(v)<=Number(q);
      case "num-between": { const a=queryRange(q); return a.length>=2&&Number(v)>=Number(a[0])&&Number(v)<=Number(a[1]); }
      case "bool-checked": return v===true; case "bool-unchecked": return v!==true;
      case "date-on": return dateValue(v)===String(q).slice(0,10); case "date-before": return dateValue(v)<String(q); case "date-after": return dateValue(v)>String(q);
      case "date-between": { const a=queryRange(q); const date=dateValue(v); return a.length>=2&&date>=String(a[0]??"")&&date<=String(a[1]??""); }
      case "date-is-today": return dateValue(v)===new Date().toISOString().slice(0,10);
      case "date-last-n-days": { const delta=Date.now()-new Date(dateValue(v)).getTime(); return delta>=0&&delta<=Number(q)*864e5; }
      case "date-next-n-days": { const delta=new Date(dateValue(v)).getTime()-Date.now(); return delta>=-864e5&&delta<=Number(q)*864e5; }
      case "select-is": return String(v)===String(q); case "select-is-not": return String(v)!==String(q);
      case "list-contains": return array(v).includes(String(q)); case "list-not-contains": return !array(v).includes(String(q));
      case "list-contains-all": return queryRange(q).filter(Boolean).every(x=>array(v).includes(x));
    }
  });
}
function scalar(v:unknown){ if(typeof v==="number")return v;if(typeof v==="boolean")return Number(v);if(v==null)return "";return String(v).toLocaleLowerCase(); }
export function sortRows(rows:DatabaseRow[],columns:DatabaseColumnSchema[],rules:DatabaseSortRule[]){ return [...rows].sort((a,b)=>{ for(const r of rules){ const c=columns.find(x=>x.id===r.columnId); if(!c)continue; const av=scalar(a.yamlData[c.name]),bv=scalar(b.yamlData[c.name]); const n=av<bv?-1:av>bv?1:0;if(n)return r.direction==="asc"?n:-n;} return a.sortOrder-b.sortOrder; }); }
function formatNumber(value:number,column:DatabaseColumnSchema){
  if(!Number.isFinite(value))return "";
  switch(column.numberFormat){case"integer":return Math.round(value).toLocaleString();case"decimal":return value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});case"percent":return `${(value*100).toLocaleString(undefined,{maximumFractionDigits:2})}%`;case"currency-usd":return value.toLocaleString(undefined,{style:"currency",currency:"USD"});case"currency-krw":return value.toLocaleString(undefined,{style:"currency",currency:"KRW"});default:return Number.isInteger(value)?String(value):value.toLocaleString(undefined,{maximumFractionDigits:4});}
}
function dateTimestamps(values:unknown[],range:boolean){const result:number[]=[];for(const value of values){if(range&&value&&typeof value==="object"){for(const part of [(value as any).start,(value as any).end]){const time=Date.parse(String(part??""));if(Number.isFinite(time))result.push(time)}}else{const time=Date.parse(dateValue(value));if(Number.isFinite(time))result.push(time)}}return result;}
export function aggregate(rows:DatabaseRow[],c:DatabaseColumnSchema){
  const vs=rows.map(r=>r.yamlData[c.name]),filled=vs.filter(v=>!empty(v));
  switch(c.aggregation){case"count":return String(rows.length);case"count-empty":return String(vs.length-filled.length);case"count-not-empty":return String(filled.length);case"count-unique":return String(new Set(filled.map(v=>JSON.stringify(v))).size);case"percent-empty":return `${Math.round((vs.length-filled.length)/Math.max(1,vs.length)*100)}%`;case"percent-not-empty":return `${Math.round(filled.length/Math.max(1,vs.length)*100)}%`;}
  if(c.type==="number"||c.type==="boolean"){
    const nums=filled.map(v=>c.type==="boolean"?(v===true?1:0):Number(v)).filter(Number.isFinite);if(!nums.length)return"";
    if(c.type==="boolean"&&c.aggregation==="average")return`${Math.round(nums.reduce((a,b)=>a+b,0)/nums.length*100)}%`;
    const sorted=[...nums].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2),median=sorted.length%2?sorted[mid]!:(sorted[mid-1]!+sorted[mid]!)/2;
    const values:Record<string,number>={sum:nums.reduce((a,b)=>a+b,0),average:nums.reduce((a,b)=>a+b,0)/nums.length,min:sorted[0]!,max:sorted.at(-1)!,median,range:sorted.at(-1)!-sorted[0]!};
    return c.aggregation&&c.aggregation in values?formatNumber(values[c.aggregation]!,c):"";
  }
  if(c.type==="date"||c.type==="date-range"){
    const dates=dateTimestamps(vs,c.type==="date-range");if(!dates.length)return"";const min=Math.min(...dates),max=Math.max(...dates);
    if(c.aggregation==="earliest")return new Date(min).toISOString().slice(0,10);if(c.aggregation==="latest")return new Date(max).toISOString().slice(0,10);if(c.aggregation==="date-range-span")return`${Math.round((max-min)/864e5)} days`;
  }
  return"";
}
