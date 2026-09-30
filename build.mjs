import path from 'node:path'
import { build } from 'esbuild'
export default async function ({ root, outDir }) {
  const svgImports = { name: 'svg-imports', setup(build) { build.onResolve({ filter: /\.svg\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)) })) } }
  await build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/islandRuntime.ts')], outfile: path.join(outDir, 'assets/island.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', conditions: ['production'], jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', minify: true, logLevel: 'silent', loader: { '.svg': 'text' }, plugins: [svgImports] })
  return { loader: { '.css': 'text', '.svg': 'text' }, plugins: [svgImports], backendOptions: { loader: { '.svg': 'text' }, plugins: [svgImports] } }
}
