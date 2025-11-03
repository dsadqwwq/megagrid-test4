// MEGA GRID — ethers.js version (no viem)
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
    'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js',
    'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js',
    'https://unpkg.com/ethers@5.7.2/dist/ethers.umd.min.js'
  ],'ethers');
  startApp();
})().catch(e=>{alert('Could not load ethers.js: '+e.message)});

async function startApp(){
  const ABI=[
    {"inputs":[{"internalType":"uint256","name":"gridSize_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},
    {"inputs":[],"name":"GRID_SIZE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],"name":"colorOf","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"internalType":"uint32[]","name":"rgbs","type":"uint32[]"}],"name":"colorPixels","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"},{"indexed":false,"internalType":"uint32","name":"rgb","type":"uint32"}],"name":"PixelColored","type":"event"},
    {"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"indexed":false,"internalType":"uint32[]","name":"rgbs","type":"uint32[]"}],"name":"PixelsColored","type":"event"}
  ];

  const statusEl=document.getElementById('status'),canvasWrap=document.getElementById('canvasWrap'),
        connectBtn=document.getElementById('connect'),flushBtn=document.getElementById('flush'),
        modeSel=document.getElementById('mode'),picker=document.getElementById('picker'),
        gridSizeLabel=document.getElementById('gridSizeLabel'),pxSizeInput=document.getElementById('pxSize');
  const rgbIntToHex=r=>(r>>>0)&0xffffff,hexToRgbInt=h=>(h>>>0)&0xffffff;
  let GRID_SIZE=128,PIXEL_SIZE=Number(pxSizeInput.value)||5,buffer=new Map();
  let appCanvas,ctx;
  function setupCanvas(){
    const w=GRID_SIZE*PIXEL_SIZE;appCanvas=document.createElement('canvas');
    appCanvas.width=w;appCanvas.height=w;ctx=appCanvas.getContext('2d');canvasWrap.innerHTML='';canvasWrap.appendChild(appCanvas);
    for(let y=0;y<GRID_SIZE;y++){for(let x=0;x<GRID_SIZE;x++){ctx.fillStyle=((x+y)%2===0)?'#141414':'#101010';ctx.fillRect(x*PIXEL_SIZE,y*PIXEL_SIZE,PIXEL_SIZE,PIXEL_SIZE);}}
    appCanvas.onclick=e=>{const r=appCanvas.getBoundingClientRect(),gx=Math.floor((e.clientX-r.left)/PIXEL_SIZE),gy=Math.floor((e.clientY-r.top)/PIXEL_SIZE);
      const id=gy*GRID_SIZE+gx,hex=(modeSel.value==='picker')?Number('0x'+picker.value.slice(1)):(Math.random()*0xffffff)|0;buffer.set(id,hex);paintLocal(gx,gy,hex);};
  }
  function paintLocal(x,y,hex){ctx.fillStyle='#'+hex.toString(16).padStart(6,'0');ctx.fillRect(x*PIXEL_SIZE,y*PIXEL_SIZE,PIXEL_SIZE,PIXEL_SIZE);}
  const provider=new ethers.providers.JsonRpcProvider(RPC_URL);
  const readContract=new ethers.Contract(CONTRACT_ADDRESS,ABI,provider);
  try{GRID_SIZE=Number(await readContract.GRID_SIZE())||128;}catch(e){console.warn('GRID_SIZE read failed',e.message);}gridSizeLabel.textContent=GRID_SIZE;setupCanvas();
  readContract.on('PixelColored',(id,rgb)=>{id=Number(id);rgb=Number(rgb);paintLocal(id%GRID_SIZE,Math.floor(id/GRID_SIZE),rgbIntToHex(rgb));});
  readContract.on('PixelsColored',(ids,rgbs)=>{ids=ids.map(Number);rgbs=rgbs.map(Number);for(let i=0;i<ids.length;i++){const id=ids[i];paintLocal(id%GRID_SIZE,Math.floor(id/GRID_SIZE),rgbIntToHex(rgbs[i]));}});
  let walletProvider,signer,writeContract;
  connectBtn.onclick=async()=>{
    if(!window.ethereum)return alert('No wallet found');
    let current=await window.ethereum.request({method:'eth_chainId'});
    if(current!==HEX_CHAIN_ID){try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:HEX_CHAIN_ID}]});}
    catch{await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:HEX_CHAIN_ID,chainName:'MegaETH Testnet',nativeCurrency:{name:'MEGA',symbol:'MEGA',decimals:18},rpcUrls:[RPC_URL]}]});}}
    walletProvider=new ethers.providers.Web3Provider(window.ethereum,'any');
    await walletProvider.send('eth_requestAccounts',[]);signer=walletProvider.getSigner();
    writeContract=new ethers.Contract(CONTRACT_ADDRESS,ABI,signer);
    const addr=await signer.getAddress();statusEl.textContent='connected: '+addr.slice(0,6)+'...'+addr.slice(-4);
  };
  flushBtn.onclick=async()=>{
    if(!writeContract)return alert('Connect wallet first');if(buffer.size===0){statusEl.textContent='no changes';return;}
    const ids=[...buffer.keys()],rgbs=[...buffer.values()].map(hexToRgbInt);
    try{statusEl.textContent='sending '+ids.length+' tiles...';const tx=await writeContract.colorPixels(ids,rgbs);
      statusEl.textContent='tx: '+tx.hash.slice(0,10)+'...';buffer.clear();}catch(e){statusEl.textContent='tx failed';console.error(e);}}
  pxSizeInput.onchange=()=>{PIXEL_SIZE=Math.max(2,Math.min(20,Number(pxSizeInput.value)||5));setupCanvas();};
}
