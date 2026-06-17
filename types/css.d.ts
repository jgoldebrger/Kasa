/** Side-effect and default CSS imports (e.g. `import './globals.css'`). */
declare module '*.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
