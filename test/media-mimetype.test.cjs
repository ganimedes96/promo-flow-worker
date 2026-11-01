const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const { Message }=require('whatsapp-web.js');
test('installed SDK forwards the declared MIME so an uncached photo is not treated as octet-stream',async()=>{
 const serialized='false_120363123456789@g.us_TEST';
 const jpeg=Buffer.from([255,216,255,224,...Array(20).fill(0),255,217]);
 const msg={directPath:'/test',type:'image',mimetype:'image/jpeg',mediaData:{mediaStage:'RESOLVED'},mediaKey:'test-key',filehash:'test-hash'};
 let declaredType;
 const window={require:name=>name==='WAWebCollections'?{Msg:{get:id=>{assert.equal(id,serialized);return msg;}}}:{downloadManager:{downloadAndMaybeDecrypt:async options=>{declaredType=options.mimetype;if(options.mimetype!=='image/jpeg')throw new Error('InvalidMediaFileType: application/octet-stream');return jpeg;}}},WWebJS:{arrayBufferToBase64Async:async data=>Buffer.from(data).toString('base64')}};
 const client={pupPage:{evaluate:async(fn,...args)=>vm.runInNewContext(`(${fn.toString()})(...args)`,{window,args,AbortController})}};
 const message=new Message(client,{id:{_serialized:serialized,remote:'120363123456789@g.us',fromMe:false,id:'TEST'},directPath:'/test',type:'image',mimetype:'image/jpeg',t:1793448000,body:''});
 const result=await message.downloadMedia();
 assert.equal(declaredType,'image/jpeg');assert.equal(result.mimetype,'image/jpeg');assert.deepEqual(Buffer.from(result.data,'base64'),jpeg);
});
