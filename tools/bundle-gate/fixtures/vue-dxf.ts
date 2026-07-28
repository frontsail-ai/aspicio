// Deliberately no framework runtime: the side-effect import is the whole
// test. A `sideEffects: false` in @aspicio/vue would let a bundler drop this
// line, and the DXF marker would vanish from the output.
import "@aspicio/vue/formats/dxf";
