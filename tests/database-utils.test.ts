import { describe, expect, it } from "vitest";
import { aggregate, matches, sortRows } from "../client/src/features/database/database-utils";
import type { DatabaseColumnSchema, DatabaseRow } from "../shared/database";

const columns: DatabaseColumnSchema[] = [
  { id: "name", name: "Name", type: "text", order: 0 },
  { id: "score", name: "Score", type: "number", order: 1, aggregation: "sum" },
  { id: "tags", name: "Tags", type: "multi-select", order: 2 },
];
const row = (id:string, yamlData:Record<string,unknown>, sortOrder:number):DatabaseRow => ({id,databaseId:"db",fileName:`${id}.md`,path:`db/${id}.md`,yamlData,fileMtime:0,hash:"",sortOrder,createdAt:0,updatedAt:0});
const rows=[row("a",{Name:"Alpha",Score:2,Tags:["red","blue"]},1),row("b",{Name:"Beta",Score:5,Tags:["blue"]},0)];

describe("database view calculations", () => {
  it("evaluates text, number, list, and empty filters", () => {
    expect(matches(rows[0]!,columns,[{columnId:"name",operator:"text-contains",value:"ph"}])).toBe(true);
    expect(matches(rows[1]!,columns,[{columnId:"score",operator:"num-gt",value:3}])).toBe(true);
    expect(matches(rows[0]!,columns,[{columnId:"tags",operator:"list-contains-all",value:["red","blue"]}])).toBe(true);
    expect(matches(rows[0]!,columns,[{columnId:"name",operator:"is-empty"}])).toBe(false);
  });
  it("applies sort priority then manual order", () => {
    expect(sortRows(rows,columns,[{columnId:"score",direction:"desc"}]).map(r=>r.id)).toEqual(["b","a"]);
    expect(sortRows(rows,columns,[]).map(r=>r.id)).toEqual(["b","a"]);
  });
  it("computes column aggregations", () => {
    expect(aggregate(rows,columns[1]!)).toBe("7");
    expect(aggregate(rows,{...columns[1]!,aggregation:"median"})).toBe("3.5");
    expect(aggregate(rows,{...columns[1]!,aggregation:"range"})).toBe("3");
    const dates={id:"dates",name:"Dates",type:"date-range",order:3,aggregation:"date-range-span"} as const;
    expect(aggregate([row("range",{Dates:{start:"2026-09-01",end:"2026-09-11"}},0)],dates)).toBe("10 days");
  });
  it("parses range filter input from the toolbar", () => {
    expect(matches(rows[0]!,columns,[{columnId:"score",operator:"num-between",value:"1, 3"}])).toBe(true);
    expect(matches(rows[0]!,columns,[{columnId:"tags",operator:"list-contains-all",value:"red, blue"}])).toBe(true);
  });
});
