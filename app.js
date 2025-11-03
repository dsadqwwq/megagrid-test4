// MEGA GRID — self-loading libs with multi-CDN fallback + wallet connect
const { RPC_URL, CHAIN_ID, CONTRACT_ADDRESS } = window.MEGA_GRID_CONFIG;
const HEX_CHAIN_ID = "0x" + CHAIN_ID.toString(16);

async function loadFromAny(urls, globalName){
  if (window[globalName]) return;
  for (const url of urls){
    try{
      await new Promise((res,rej)=>{
        const s=document.createElement('script');s.src=url;s.async=true;s.defer=true;
        s.onload=res;s.onerror=()=>rej(new Error('fail '+url));document.head.appendChild(s);
      });
      if(window[globalName])return;
    }catch(e){console.warn('CDN failed:',e.message)}
  }
  throw new Error(globalName+' could not be loaded');
}

(async()=>{
  await loadFromAny([
    'https://cdn.jsdelivr.net/npm/pixi.js@7/dist/pixi.min.js',
    'https://unpkg.com/pixi.js@7/dist/pixi.min.js'
  ],'PIXI');
  await loadFromAny([
    'https://cdn.jsdelivr.net/npm/viem@2.9.14/dist/viem.umd.min.js',
    'https://unpkg.com/viem@2.9.14/dist/viem.umd.min.js'
  ],'viem');
  startApp();
})().catch(e=>{alert('Could not load library: '+e.message)});

async function startApp(){
  const ABI=[
    { "inputs":[{"internalType":"uint256","name":"gridSize_","type":"uint256"}], "stateMutability":"nonpayable","type":"constructor"},
    { "inputs":[], "name":"GRID_SIZE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view","type":"function"},
    { "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}], "name":"colorOf","outputs":[{"internalType":"uint32","name":"","type":"uint32"}], "stateMutability":"view","type":"function"},
    { "inputs":[{"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"internalType":"uint32[]","name":"rgbs","type":"uint32[]"}], "name":"colorPixels","outputs":[], "stateMutability":"nonpayable","type":"function"}
  ];
  const statusEl=document.getElementById('status'),canvasWrap=document.getElementById('canvasWrap'),
        connectBtn=document.getElementById('connect'),flushBtn=document.getElementById('flush'),
        modeSel=document.getElementById('mode'),picker=document.getElementById('picker'),
        gridSizeLabel=document.getElementById('gridSizeLabel'),pxSizeInput=document.getElementById('pxSize');
  const rgbIntToHex=r=>(r>>>0)&0xffffff,hexToRgbInt=h=>(h>>>0)&0xffffff;
  let GRID_SIZE=128,PIXEL_SIZE=Number(pxSizeInput.value)||5,buffer=new Map();
  let app,stageGraphics;
  function setupPixi(){
    const w=GRID_SIZE*PIXEL_SIZE,h=w;
    app=new PIXI.Application({width:w,height:h,background:'#0b0b0b'});
    canvasWrap.innerHTML='';canvasWrap.appendChild(app.view);
    stageGraphics=new PIXI.Graphics();app.stage.addChild(stageGraphics);
  }
  function paintLocal(x,y,hex){stageGraphics.beginFill(hex);stageGraphics.drawRect(x*PIXEL_SIZE,y*PIXEL_SIZE,PIXEL_SIZE,PIXEL_SIZE);stageGraphics.endFill()}
  const {createPublicClient,http}=viem;
  const publicClient=createPublicClient({transport:http(RPC_URL),chain:{id:CHAIN_ID}});
  setupPixi();
  connectBtn.onclick=async()=>{
    if(!window.ethereum)return alert('No wallet');
    const target=HEX_CHAIN_ID;let cur=await window.ethereum.request({method:'eth_chainId'});
    if(cur!==target)await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]}).catch(async()=>{
      await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:target,chainName:'MegaETH Testnet',nativeCurrency:{name:'MEGA',symbol:'MEGA',decimals:18},rpcUrls:[RPC_URL]}]})
    });
    const [addr]=await window.ethereum.request({method:'eth_requestAccounts'});
    const {createWalletClient,custom}=viem;
    walletClient=createWalletClient({chain:{id:CHAIN_ID},transport:custom(window.ethereum)});
    statusEl.textContent='connected '+addr.slice(0,6)+'...'+addr.slice(-4);
  };
  canvasWrap.onclick=e=>{
    const r=canvasWrap.getBoundingClientRect(),gx=Math.floor((e.clientX-r.left)/PIXEL_SIZE),gy=Math.floor((e.clientY-r.top)/PIXEL_SIZE);
    const id=gy*GRID_SIZE+gx,hex=(modeSel.value==='picker')?Number('0x'+picker.value.slice(1)):(Math.random()*0xffffff)|0;
    buffer.set(id,hex);paintLocal(gx,gy,hex);
  };
  flushBtn.onclick=async()=>{
    if(!walletClient)return alert('connect wallet first');
    const ids=[...buffer.keys()],rgbs=[...buffer.values()].map(hexToRgbInt);
    const tx=await walletClient.writeContract({account:(await walletClient.requestAddresses())[0],address:CONTRACT_ADDRESS,abi:ABI,functionName:'colorPixels',args:[ids,rgbs]});
    statusEl.textContent='tx '+tx.slice(0,10)+'...';buffer.clear();
  };
}
