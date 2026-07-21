// Vite's `?raw` suffix imports the built widget as a string (vercel.ts).
declare module "*.html?raw" {
  const text: string;
  export default text;
}
