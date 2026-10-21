import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { backend } from './helpers.mjs';

test('PDF artifacts embed fonts and preserve multilingual study content',async()=>{
  const b=await backend();
  const response=await b.call('/api/artifacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Multilingual study',format:'pdf',content:'Greek λόγος and θεός. Hebrew שָׁלוֹם and בְּרֵאשִׁית.\n\nCurly quotes “truth”, em dash —, and normal paragraphs.\n\nשָׁלוֹם עֲלֵיכֶם',idempotencyKey:'pdf-fixture'})});
  assert.equal(response.status,201,await response.clone().text());
  const {artifact}=await response.json();
  const bytes=new Uint8Array(await (await b.call(artifact.url)).arrayBuffer());
  const document=await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(),1);
  assert.equal(document.getTitle(),'Multilingual study');
  assert.ok(bytes.length>10000,'Unicode fonts must be embedded');
  if(process.env.PDF_REVIEW_PATH)await fs.writeFile(process.env.PDF_REVIEW_PATH,bytes);
});
