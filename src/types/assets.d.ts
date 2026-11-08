/** Vite handles these; TypeScript needs to be told they resolve. */
declare module '*.css';
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
