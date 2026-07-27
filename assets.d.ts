declare module "*.png?inline" {
  const dataUrl: string;
  export default dataUrl;
}

declare module "*.jpg?inline" {
  const dataUrl: string;
  export default dataUrl;
}

declare module "*.css?raw" {
  const css: string;
  export default css;
}
