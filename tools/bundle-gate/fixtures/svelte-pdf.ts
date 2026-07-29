// Deliberately no framework runtime: the side-effect import is the whole
// test. A `sideEffects: false` in @aspicio/svelte would let a bundler drop this
// line, and the PDF marker would vanish from the output.
import "@aspicio/svelte/formats/pdf";
