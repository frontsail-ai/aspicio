# jscad sample fixtures

DXF samples vendored from
[jscad/sample-files](https://github.com/jscad/sample-files/tree/master/dxf/dxf-parser)
(`dxf/dxf-parser`), which imported them from
[bjnortier/dxf](https://github.com/bjnortier/dxf) under the MIT License.

They exercise the headless pipeline end to end (parse → tessellate → SVG)
across a broad entity mix: blocks, splines, hatches, dimensions, texts,
paper-space-free real drawings (`floorplan.dxf`), and edge cases like an
entity-less file (`empty.dxf`) and a header flag dxf-parser rejects
without our lenient retry (`blocks2.dxf`, PARSE-11).

Covered by [jscad-samples.test.ts](../../jscad-samples.test.ts); the MCP
server's PNG path re-uses the same files in
`packages/mcp/tests/render-samples.test.ts`.
