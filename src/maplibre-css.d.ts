// esbuild loads `.css` as text (loader configured in tooling/build/build-plugins.mjs),
// so this import resolves to the stylesheet's source string. Declared narrowly
// for the exact specifier to avoid clashing with Vite's generic `*.css` typing.
declare module 'maplibre-gl/dist/maplibre-gl.css' {
  const css: string
  export default css
}

declare module '*.svg?raw' { const svg: string; export default svg }
