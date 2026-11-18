// The Host runtime provides these packages; this repo only needs their shape
// for `tsc --checkJs` and does not bundle them.
declare module '@deepseek-ai/schemastery' {
  const z: any
  export default z
}
