'use strict';
const $=id=>document.getElementById(id);
let imageData='',filename='',current=null,busy=false;
const controls=['gameLimit','mode','style','grid','budget','size','alpha','background','threshold','trim','frame','removeBackground','backgroundTolerance','detail','maxColors'];
function status(message,kind=''){ $('status').textContent=message; $('status').className='status '+kind; }
function options(){return {detail:+$('detail').value,maxColors:+$('maxColors').value,removeBackground:$('removeBackground').checked,backgroundTolerance:+$('backgroundTolerance').value,gameLimit:+$('gameLimit').value,mode:$('mode').value,style:$('style').value,grid:+$('grid').value,budget:+$('budget').value,size:+$('size').value,alpha:$('alpha').value,background:$('background').value,threshold:+$('threshold').value,trim:$('trim').checked};}
function available(enabled){ for(const id of ['copy','save','savePng']) $(id).disabled=!enabled; $('saveCutout').disabled=!enabled||!current?.cutout; }
async function load(file){
 if(busy)return;
 if(file.size>40*1024*1024){status('Choose an image smaller than 40 MB.','error');return;}
 resetPreview(); filename=file.name; imageData=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
 $('fileline').textContent=filename+' · '+(file.size/1024).toFixed(1)+' KB'; $('frame').value=1; current=null; available(false); $('convert').disabled=false; await run();
}
async function run(){
 if(!imageData||busy)return;
 busy=true;controls.forEach(id=>$(id).disabled=true);$('drop').disabled=true;available(false);$('convert').disabled=true;$('convert').textContent='Finding the best fit…';status('Converting locally. Detailed artwork can take a few seconds.');
 try{
  const response=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':document.querySelector('meta[name="local-token"]').content},body:JSON.stringify({image:imageData,name:filename,frame:Math.max(0,+$('frame').value-1),options:options()})});
  const result=await response.json(); if(!response.ok)throw Error(result.error||'Conversion failed.');current=result;
  $('empty').hidden=true; $('source').hidden=false;$('result').hidden=false;
  $('source').src=result.source; $('result').dataset.vector=String(!!result.previewSvg); $('wipeResult').dataset.vector=String(!!result.previewSvg);$('result').src=result.previewSvg||result.result;$('wipeSource').src=result.target;$('wipeResult').src=result.previewSvg||result.result;
  $('code').value=result.code;$('shapes').textContent=result.shapes.toLocaleString();$('shapeLimit').textContent='SHAPES / '+$('gameLimit').value;$('chars').textContent=result.characters.toLocaleString();$('quality').textContent=result.exactGrid?'Exact grid':result.rmse+' / 255';
  $('frameLabel').hidden=result.meta.frames<=1;$('frame').max=Math.min(500,result.meta.frames);$('frame').value=result.meta.frame+1;
  const shapeTypes=result.types||{rect:result.shapes};
  const notes=[Object.entries(shapeTypes).map(([kind,count])=>`${count} ${kind}`).join(', ')+'.',`${result.meta.format} · ${result.meta.width} × ${result.meta.height} · ${result.method} · ${result.grid.join(' × ')} px grid.`];
  if(result.traceGrid && result.traceGrid.some((n,i)=>n!==result.grid[i]))notes.push('Outline resolution reduced to '+result.traceGrid.join(' × ')+' to fit the shape budget.');
  if(result.resized)notes.push('Resized from '+result.originalGrid.join(' × ')+' px.');
  if(result.exactGrid)notes.push('Every prepared grid pixel is preserved.');else notes.push('Colour error '+result.rmse+' / 255 (lower is better).');
  notes.push(...result.meta.notes);status(notes.join(' '),result.compatible?'':'warn');
  $('compatibility').textContent=result.compatible?`✓ Within the game’s ${$('gameLimit').value}-shape limit. Paste into Skin Studio’s Text editor. Cutout edges use the alpha threshold; scaling and rotation can soften edges.`:`⚠ ${result.shapes.toLocaleString()} shapes: this exact export exceeds the selected ${$('gameLimit').value}-shape limit and cannot be pasted into the current game. Choose Game-ready to make a compatible version.`;
  if(!result.gameCompatible && +$('gameLimit').value>255) $('compatibility').textContent=$('gameLimit').value+'-shape export: current Flowrix (128) and Petalwild (255) cannot import this many shapes. Select their target to generate a compatible version.';
  $('compatibility').style.color=result.compatible?'#5a8054':'#a06d28';available(true);
 }catch(error){status(error.message,'error'); current=null;available(false);$('code').value='';}
 finally{busy=false;controls.forEach(id=>$(id).disabled=false);$('budget').disabled=$('mode').value==='exact';$('drop').disabled=false;$('convert').disabled=!imageData;$('convert').innerHTML='Make my skin <span>↗</span>';}
}
$('drop').onclick=()=>$('file').click();$('file').onchange=()=>{$('file').files[0]&&load($('file').files[0]);};
for(const event of ['dragenter','dragover'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('drag');});
for(const event of ['dragleave','drop'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.remove('drag');});
$('drop').addEventListener('drop',e=>{if(e.dataTransfer.files[0])load(e.dataTransfer.files[0]);});
document.addEventListener('paste',e=>{const file=[...e.clipboardData.items].find(x=>x.kind==='file'&&x.type.startsWith('image/'));if(file){e.preventDefault();load(file.getAsFile());}});
$('convert').onclick=run;
controls.forEach(id=>$(id).addEventListener('change',()=>{if(imageData){status('Settings changed. Click “Make my skin” to update the export.');available(false);}if(id==='gameLimit') $('budget').value=$('gameLimit').value; if(id==='budget' && +$('budget').value>+$('gameLimit').value) $('gameLimit').value=$('budget').value; if(id==='removeBackground' && $('removeBackground').checked) $('alpha').value='cutout'; if(id==='style' && ['polygon','vector'].includes($('style').value)) $('mode').value='game'; if(id==='mode' && $('mode').value==='exact') $('style').value='pixel'; $('budget').disabled=$('mode').value==='exact';}));
$('backgroundTolerance').oninput=()=>$('backgroundToleranceValue').textContent=$('backgroundTolerance').value;
$('threshold').oninput=()=>$('thresholdValue').textContent=$('threshold').value;
$('pixels').onchange=()=>document.querySelector('.previewcard').classList.toggle('smooth',!$('pixels').checked);
$('side').onclick=()=>{$('comparison').hidden=false;$('wipeview').hidden=true;$('side').classList.add('selected');$('wipe').classList.remove('selected');};
$('wipe').onclick=()=>{$('comparison').hidden=true;$('wipeview').hidden=false;$('wipe').classList.add('selected');$('side').classList.remove('selected');};
$('wipeRange').oninput=()=>{const value=$('wipeRange').value;$('wipeClip').style.clipPath=`inset(0 ${100-value}% 0 0)`;$('wipeLine').style.left=value+'%';};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(current.code);$('copy').textContent='Copied ✓';setTimeout(()=>$('copy').innerHTML='Copy skin code <span>⧉</span>',1700);}catch{$('code').focus();$('code').select();status('Code selected. Press Command+C (or Ctrl+C) to copy.');}};
function download(href,ext){const a=document.createElement('a');a.href=href;a.download=(filename.replace(/\.[^.]+$/,'')||'my-skin')+ext;a.click();}
$('save').onclick=()=>{const url=URL.createObjectURL(new Blob([current.code+'\n'],{type:'text/plain'}));download(url,'.skin.txt');setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('saveCutout').onclick=()=>download(current.cutout,'.transparent.png');
$('savePng').onclick=()=>download(current.previewPng||current.result,'.skin.png');
$('demo').onclick=()=>{const c=document.createElement('canvas');c.width=c.height=24;const x=c.getContext('2d');
 for(let y=0;y<24;y++)for(let i=0;i<24;i++){const d=Math.hypot(i-11.5,y-11.5);if(d<10){x.fillStyle=d>8.5?'#c9a446':'#ffe365';x.fillRect(i,y,1,1);}}
 x.fillStyle='#253b32';x.fillRect(7,8,2,5);x.fillRect(15,8,2,5);x.fillRect(10,15,4,1);x.fillRect(9,14,1,1);x.fillRect(14,14,1,1);x.fillStyle='#efa073';x.fillRect(5,13,3,1);x.fillRect(16,13,3,1);
 c.toBlob(b=>load(new File([b],'sunny-pixel-flower.png',{type:'image/png'})));
};

let previewZoom=1,previewX=0,previewY=0,previewDrag=null;
function paintPreview(){
 for(const id of ['source','result','wipeSource','wipeResult']) $(id).style.transform=`translate(${previewX}px,${previewY}px) scale(${previewZoom})`;
 $('zoomReset').textContent=Math.round(previewZoom*100)+'%';
}
function resetPreview(){previewZoom=1;previewX=previewY=0;paintPreview();}
$('zoomReset').onclick=resetPreview;
$('zoomIn').onclick=()=>{previewZoom=Math.min(8,previewZoom*1.5);paintPreview();};
$('zoomOut').onclick=()=>{previewZoom=Math.max(1,previewZoom/1.5);if(previewZoom===1)previewX=previewY=0;paintPreview();};
for(const el of document.querySelectorAll('.pane,#wipeview')){
 el.addEventListener('pointerdown',e=>{if(previewZoom<=1||e.target.id==='wipeRange')return;previewDrag={x:e.clientX,y:e.clientY,panX:previewX,panY:previewY};el.setPointerCapture(e.pointerId);e.preventDefault();});
 el.addEventListener('pointermove',e=>{if(!previewDrag)return;previewX=Math.max(-800,Math.min(800,previewDrag.panX+e.clientX-previewDrag.x));previewY=Math.max(-800,Math.min(800,previewDrag.panY+e.clientY-previewDrag.y));paintPreview();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,()=>previewDrag=null);
}
