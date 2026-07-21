// wrangler's `[[rules]] type = "Text"` turns .html imports into strings.
declare module "*.html" {
  const text: string;
  export default text;
}

// Vite's `?raw` suffix does the same for the Vercel bundle (vercel.ts).
declare module "*.html?raw" {
  const text: string;
  export default text;
}
