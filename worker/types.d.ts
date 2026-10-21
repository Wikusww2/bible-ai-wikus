declare module 'bidi-js' {
  interface Bidi { getEmbeddingLevels(text:string,direction?:string): unknown; getReorderedString(text:string,embedding:unknown):string; getReorderSegments(text:string,embedding:unknown):Array<[number,number]>; }
  export default function bidiFactory(): Bidi;
}
