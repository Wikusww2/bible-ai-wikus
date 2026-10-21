import { PDFDocument, PDFHexString, beginText, endText, setFontAndSize, setTextMatrix, showText, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';

/** Portable Unicode PDF generation; fonts are bundled, never fetched from a third party. */
export async function createStudyPdf(title: string, content: string, latinBytes: Uint8Array, hebrewBytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const latin = await pdf.embedFont(latinBytes, { subset: true });
  const hebrew = await pdf.embedFont(hebrewBytes, { subset: true });
  const latinFace = fontkit.create(latinBytes), hebrewFace = fontkit.create(hebrewBytes);
  const segmenter = new Intl.Segmenter('en',{granularity:'grapheme'});
  const bidi = bidiFactory();
  const text = content.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<\/(?:p|div|h[1-6]|li)>/gi,'\n\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  const fontFor = (word: string) => /[\u0590-\u05ff]/.test(word) ? hebrew : latin;
  const clusters=(value:string)=>[...segmenter.segment(value)].map(x=>x.segment);
  const measure=(value:string,pointSize:number)=>clusters(value).reduce((n,c)=>n+fontFor(c).widthOfTextAtSize(c,pointSize),0);
  const maxWidth=483, size=11;
  let page=pdf.addPage([595,842]), y=790;
  let fontKeys=new Map([[latin,page.node.newFontDictionary('Latin',latin.ref)],[hebrew,page.node.newFontDictionary('Hebrew',hebrew.ref)]]);
  const nextPage=()=>{page=pdf.addPage([595,842]);y=790;fontKeys=new Map([[latin,page.node.newFontDictionary('Latin',latin.ref)],[hebrew,page.node.newFontDictionary('Hebrew',hebrew.ref)]]);};
  const line=(words: string[], heading=false)=>{
    if(y<60)nextPage();
    const logical=words.join(' '), rtl=/^[\s\p{P}]*[\u0590-\u05ff]/u.test(logical);
    // Reorder grapheme clusters, never the vowel marks within a Hebrew letter.
    const runs=clusters(logical),proxy=runs.map(c=>c.codePointAt(0)!>65535?'x':c[0]).join('');
    const embedding=bidi.getEmbeddingLevels(proxy,rtl?'rtl':'ltr');
    for(const [start,end] of bidi.getReorderSegments(proxy,embedding))runs.splice(start,end-start+1,...runs.slice(start,end+1).reverse());
    const actualSize=heading?17:size;
    const width=measure(logical,actualSize);
    let x=rtl?595-56-width:56;
    for(const run of runs){
      const font=fontFor(run),face=font===hebrew?hebrewFace:latinFace;
      const layout=face.layout(run),encoded=font.encodeText(run).asString(),scale=actualSize/face.unitsPerEm;
      // pdf-lib does not apply fontkit's mark offsets itself. Position every glyph
      // explicitly so Hebrew niqqud stays attached to its own consonant.
      let advance=0;
      layout.positions.forEach((p:{xOffset:number;yOffset:number;xAdvance:number},i:number)=>{
        page.pushOperators(beginText(),setFontAndSize(fontKeys.get(font)!,actualSize),setTextMatrix(1,0,0,1,x+advance+p.xOffset*scale,y+p.yOffset*scale),showText(PDFHexString.of(encoded.slice(i*4,i*4+4))),endText());
        advance+=p.xAdvance*scale;
      });
      x+=advance;
    }
    y-=heading?29:18;
  };
  for(const [index,paragraph] of [title,...text.split(/\n\s*\n/)].entries()){
    let words: string[]=[];let width=0;
    for(const word of paragraph.replace(/^[#]+\s*/,'').split(/\s+/).filter(Boolean)){
      // Break oversized tokens by grapheme, keeping vowel marks attached.
      const chunks=measure(word,index===0?17:size)>maxWidth ? clusters(word) : [word];
      for(const chunk of chunks){const w=measure(chunk+' ',index===0?17:size);if(width+w>maxWidth&&words.length){line(words,index===0);words=[];width=0;}words.push(chunk);width+=w;}
    }
    if(words.length)line(words,index===0);y-=10;
  }
  pdf.setTitle(title);pdf.setProducer('Bible AI · pdf-lib with bundled Noto fonts');
  return pdf.save();
}
