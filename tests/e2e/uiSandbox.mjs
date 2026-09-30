import assert from 'node:assert/strict'
import path from 'node:path'

export default async function ({ directory }) {
  const root = path.resolve(import.meta.dirname, '../..')
  const screenshot = `${directory}-map.png`
  return {
    assets: { '/assets/island.js': path.join(root, 'runtime/assets/island.js') },
    hostSetup: `
      api.markdown.registerCodeBlockRenderer=(language,render)=>{window.fixtureRenderFence=render;return()=>window.fixtureCloseFence?.()};
      window.fixtureMountFence=()=>{
        const scroller=document.body.appendChild(document.createElement('div'));scroller.id='fence-scroll';
        Object.assign(scroller.style,{position:'fixed',inset:'20px auto auto 20px',width:'600px',height:'320px',overflow:'auto',zIndex:'100'});
        const content=scroller.appendChild(document.createElement('div'));content.style.height='1400px';
        const parent=content.appendChild(document.createElement('div'));parent.id='fence-holder';
        const close=window.fixtureRenderFence('12, 24, 5|light|free',parent,{path:'Habitats.md',meta:null});
        let closed=false;window.fixtureCloseFence=()=>{if(!closed){closed=true;close()}};
      };
      window.fixtureMapResources=[];const originalBackendCall=api.backend.call;api.backend.call=async(name,value)=>{if(name!=='resource')return originalBackendCall(name,value);window.fixtureMapResources.push(value.url);return {bodyBase64:value.url.endsWith('.png')?'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMw7nD5DwAD8AH/p2xYSwAAAABJRU5ErkJggg==':btoa(JSON.stringify({version:8,sources:{meadow:{type:'raster',tiles:['https://fixture.invalid/{z}/{x}/{y}.png'],tileSize:256}},layers:[{id:'meadow',type:'raster',source:'meadow'}]}))}};`,
    entry: `
      import { initRuntime } from ${JSON.stringify(path.join(root, 'src/runtime.ts'))};
      import { createMapEngine } from ${JSON.stringify(path.join(root, 'src/island.ts'))};
      import { resolveSettings } from ${JSON.stringify(path.join(root, 'src/settings.ts'))};
      import { injectStyles } from ${JSON.stringify(path.join(root, 'src/styles.ts'))};
      import { renderMapFence } from ${JSON.stringify(path.join(root, 'src/mapEmbed.ts'))};
      export function register(api){
        initRuntime(api);const R=api.React;const dispose=injectStyles();
        function Map(){const ref=R.useRef(null);const engine=R.useRef(null);R.useEffect(()=>{let disposed=false;const console=ref.current.ownerDocument.defaultView.console;const error=console.error;console.error=(...args)=>{ref.current.dataset.error=args.map(String).join(' ');error.apply(console,args)};void createMapEngine({container:ref.current,settings:resolveSettings({defaultZoom:5}),theme:'light',style:'streets',showControls:false,onReady(){ref.current.dataset.ready='true'},onCameraChange(camera){ref.current.dataset.zoom=String(camera.zoom);ref.current.dataset.moves=String(Number(ref.current.dataset.moves||0)+1)}}).then(value=>{if(disposed)value.destroy();else engine.current=value});return()=>{disposed=true;console.error=error;engine.current?.destroy()}},[]);return R.createElement('div',null,R.createElement('button',{id:'map-zoom',onClick(){engine.current.zoomBy(2)}},'Zoom map'),R.createElement('div',{id:'map-root',ref,style:{width:'600px',height:'250px'}}))}
        api.registerView('fixture.map',Map);
        api.markdown.registerCodeBlockRenderer('map',(code,parent,context)=>{
          parent.dataset.mounts=String(Number(parent.dataset.mounts||0)+1);
          const view=parent.ownerDocument.defaultView;let island;
          Object.defineProperty(view,'valleyMapIsland',{configurable:true,get:()=>island,set(value){island={createMapEngine(...args){const engine=value.createMapEngine(...args);view.fixtureEngine=engine;return engine}}}});
          return renderMapFence(code,parent,api,context.meta??'');
        });
        return dispose;
      }
    `,
    run: `
      let mapFrame;
      for(let i=0;i<300;i++){
        for(const frame of win.webContents.mainFrame.framesInSubtree.filter(f=>f.url.endsWith('/surface.html'))){if(await frame.executeJavaScript('!!document.querySelector("#map-root[data-ready] canvas")')){mapFrame=frame;break}}
        if(mapFrame)break;await wait(20)
      }
      if(!mapFrame)throw Error('Map library did not render the synthetic offline style');
      report.mapRuntime=await mapFrame.executeJavaScript('typeof window.valleyMapIsland?.createMapEngine');
      await mapFrame.executeJavaScript('document.getElementById("map-zoom").click()');
      for(let i=0;i<150;i++){report.mapCamera=await mapFrame.executeJavaScript('(()=>{const root=document.getElementById("map-root");return {zoom:Number(root.dataset.zoom),moves:Number(root.dataset.moves)}})()');if(report.mapCamera.zoom===7&&report.mapCamera.moves>3)break;await wait(20)}
      report.mapResources=await win.webContents.executeJavaScript('window.fixtureMapResources');
      report.mapError=await mapFrame.executeJavaScript('document.getElementById("map-root").dataset.error??null');
      await win.webContents.executeJavaScript('window.fixtureMountFence()');
      let fenceFrame;
      for(let i=0;i<300;i++){
        for(const frame of win.webContents.mainFrame.framesInSubtree.filter(f=>f.url.endsWith('/surface.html'))){if(await frame.executeJavaScript('!!document.querySelector(".map-embed .map-static-snapshot[hidden]")')){fenceFrame=frame;break}}
        if(fenceFrame)break;await wait(20);
      }
      if(!fenceFrame)throw Error('Map code block did not paint in the real sandbox');
      const camera='(()=>({center:window.fixtureEngine.getCenter(),zoom:window.fixtureEngine.getZoom()}))()';
      report.fenceInitialCamera=await fenceFrame.executeJavaScript(camera);
      report.fenceHit=await win.webContents.executeJavaScript('(()=>{const element=document.elementFromPoint(150,150);return {tag:element?.tagName,html:element?.outerHTML.slice(0,500)}})()');
      win.webContents.debugger.attach('1.3');
      await fenceFrame.executeJavaScript('window.fixturePointerEvents=[];for(const type of ["mousedown","mousemove","mouseup"])document.addEventListener(type,event=>window.fixturePointerEvents.push({type,buttons:event.buttons,button:event.button,target:event.target.className}),true)');
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:150,y:150,button:'left',buttons:1,clickCount:1});
      for(let step=1;step<=10;step++){await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:150+step*8,y:150+step*3,button:'left',buttons:1});await wait(16)}
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:230,y:180,button:'left',buttons:0,clickCount:1});
      for(let i=0;i<100;i++){if(await fenceFrame.executeJavaScript('!window.fixtureEngine.map.isMoving()'))break;await wait(20)}
      report.fencePannedCamera=await fenceFrame.executeJavaScript(camera);
      report.fencePointerEvents=await fenceFrame.executeJavaScript('window.fixturePointerEvents');
      const clickZoom=async(selector)=>{
        const frameBounds=await win.webContents.executeJavaScript('(()=>{const rect=document.querySelector("#fence-holder iframe").getBoundingClientRect();return {x:rect.x,y:rect.y}})()');
        const point=await fenceFrame.executeJavaScript('(()=>{const rect=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()');
        for(const type of ['mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:frameBounds.x+point.x,y:frameBounds.y+point.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
      };
      await clickZoom('.map-round-btn[aria-label="Zoom in"]');
      for(let i=0;i<100;i++){report.fenceZoomedCamera=await fenceFrame.executeJavaScript(camera);if(Math.abs(report.fenceZoomedCamera.zoom-report.fencePannedCamera.zoom-1)<0.01&&await fenceFrame.executeJavaScript('!window.fixtureEngine.map.isMoving()'))break;await wait(20)}
      await fenceFrame.executeJavaScript('window.fixtureCanvas=document.querySelector(".maplibregl-canvas")');
      const readFence='(()=>{const parent=document.querySelector(".map-embed"),snapshot=parent.querySelector(".map-static-snapshot"),canvas=snapshot?.querySelector("canvas"),pixels=canvas?.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;return {mounts:Number(parent.dataset.mounts),sameCanvas:window.fixtureCanvas===parent.querySelector(".maplibregl-canvas"),staticVisible:snapshot?.hidden===false,painted:pixels&&Array.from(pixels).some((v,i)=>i%4===3&&v>0)}})()';
      win.webContents.sendInputEvent({type:'mouseWheel',x:150,y:150,deltaX:0,deltaY:-100,canScroll:true});
      for(let i=0;i<100;i++){report.fenceScroll=await win.webContents.executeJavaScript('document.getElementById("fence-scroll").scrollTop');if(report.fenceScroll>0)break;await wait(20)}
      await wait(100);
      report.fencePartial=await fenceFrame.executeJavaScript(readFence);
      report.fenceScrolledCamera=await fenceFrame.executeJavaScript(camera);
      await win.webContents.executeJavaScript('document.getElementById("fence-scroll").scrollTop=700');
      for(let i=0;i<100;i++){report.fenceHidden=await fenceFrame.executeJavaScript(readFence);if(report.fenceHidden.staticVisible)break;await wait(20)}
      await win.webContents.executeJavaScript('document.getElementById("fence-scroll").scrollTop=0');
      for(let i=0;i<100;i++){report.fenceReturned=await fenceFrame.executeJavaScript(readFence);if(!report.fenceReturned.staticVisible&&report.fenceReturned.painted)break;await wait(20)}
      report.fenceReturnedCamera=await fenceFrame.executeJavaScript(camera);
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:250,y:150,button:'left',buttons:1,clickCount:1});
      for(let step=1;step<=8;step++){await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:250-step*8,y:150,button:'left',buttons:1});await wait(16)}
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:186,y:150,button:'left',buttons:0,clickCount:1});
      for(let i=0;i<100;i++){if(await fenceFrame.executeJavaScript('!window.fixtureEngine.map.isMoving()'))break;await wait(20)}
      report.fenceResumedPan=await fenceFrame.executeJavaScript(camera);
      await clickZoom('.map-round-btn[aria-label="Zoom out"]');
      for(let i=0;i<100;i++){report.fenceResumedZoom=await fenceFrame.executeJavaScript(camera);if(Math.abs(report.fenceResumedZoom.zoom-report.fenceInitialCamera.zoom)<0.01&&await fenceFrame.executeJavaScript('!window.fixtureEngine.map.isMoving()'))break;await wait(20)}
      fs.writeFileSync(${JSON.stringify(screenshot)},(await win.webContents.capturePage({x:20,y:20,width:600,height:320})).toPNG());
      win.webContents.debugger.detach();
      await win.webContents.executeJavaScript('window.fixtureCloseFence()');
    `,
    verify(result) {
      assert.equal(result.mapRuntime, 'function')
      assert.equal(result.mapCamera.zoom, 7, 'Map camera animation must finish in the visible surface')
      assert(result.mapCamera.moves > 3, 'Map camera must emit intermediate animation frames')
      assert(result.mapResources.some(url => url.endsWith('.json')), 'Map must decode its JSON style')
      assert(result.mapResources.some(url => url.startsWith('https://fixture.invalid/') && url.endsWith('.png')), 'Map must decode binary raster tiles through the same protocol')
      assert.equal(result.mapError, null)
      assert.notDeepEqual(result.fencePannedCamera.center, result.fenceInitialCamera.center, 'Dragging a code block must pan its map: '+JSON.stringify({events:result.fencePointerEvents,hit:result.fenceHit}))
      assert.equal(Math.round(result.fenceZoomedCamera.zoom-result.fencePannedCamera.zoom), 1, 'The zoom control must change map zoom')
      assert.deepEqual(result.fenceScrolledCamera, result.fenceZoomedCamera, 'Note scrolling must preserve the chosen map camera')
      assert.deepEqual(result.fenceReturnedCamera, result.fenceZoomedCamera, 'Returning maps must retain the chosen camera')
      assert.notDeepEqual(result.fenceResumedPan.center, result.fenceReturnedCamera.center, 'Dragging must still pan after returning from a static snapshot')
      assert.equal(result.fenceResumedZoom.zoom, result.fenceInitialCamera.zoom, 'Zoom controls must work after returning from a static snapshot')
      assert(result.fenceScroll > 0, 'Wheel input over the code block must scroll the note')
      assert.equal(result.fencePartial.mounts, 1, 'Scrolling must not recreate the code block')
      assert.equal(result.fencePartial.sameCanvas, true, 'Partially visible maps must retain their live canvas')
      assert.equal(result.fenceHidden.mounts, 1)
      assert.equal(result.fenceHidden.staticVisible, true)
      assert.equal(result.fenceHidden.painted, true, 'Offscreen maps retain painted pixels')
      assert.equal(result.fenceReturned.mounts, 1)
      assert.equal(result.fenceReturned.staticVisible, false)
      assert.equal(result.fenceReturned.painted, true)
      console.log(`Map scroll screenshot: ${screenshot}`)
    }
  }
}
