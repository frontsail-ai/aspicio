// wrangler's `[[rules]] type = "Text"` turns .html imports into strings.
declare module "*.html" {
  const text: string;
  export default text;
}
