declare module "foliate-js/*.js";
declare module "*.css";
declare module "*?raw" {
  const content: string;
  export default content;
}
