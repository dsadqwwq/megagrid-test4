// MEGA GRID Tiles — clickable selection + batch (ethers.js)
// Improvements:
// - Wallet connect robustness & clear status/errors
// - Hover highlight persists for 1 second after moving the mouse away
const C = window.MEGA_GRID_CONFIG;
const HEX_CHAIN_ID = "0x" + C.CHAIN_ID.toString(16);

async function loadEthers(){
  if (window.ethers) return;
  const urls = [
    "https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js",
    "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js",
    "https://unpkg.com/ethers@5.7.2/dist/ethers.umd.min.js"
  ];
  for (const u of urls){
    try{
      await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=u; s.async=true; s.defer=true; s.onload=res; s.onerror=()=>rej(); document.head.appendChild(s); });
      if (window.ethers) return;
    }catch{}
  }
  alert("Could not load ethers.js (CDN blocked).");
}

const TILE_ABI = [
  {"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ownerOfIfMinted","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"GRID_SIZE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"listings","outputs":[{"internalType":"address","name":"seller","type":"address"},{"internalType":"uint256","name":"price","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"claim","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"},{"internalType":"uint256","name":"priceWei","type":"uint256"}],"name":"listForSale","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"cancelListing","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"buy","outputs":[],"stateMutability":"payable","type":"function"}
];

let provider, signer, tileRead, tileWrite;
let GRID_SIZE = 316; // default until read
let PIXEL = 2;

const els = {
  grid: document.getElementById("grid"),
  wrap: document.getElementById("canvasWrap"),
  pxSize: document.getElementById("pxSize"),
  connect: document.getElementById("connect"),
  status: document.getElementById("status"),
  resetView: document.getElementById("resetView"),
  clearSelection: document.getElementById("clearSelection"),
  selCount: document.getElementById("selCount"),
  // sidebar
  tileTitle: document.getElementById("tileTitle"),
  tid: document.getElementById("tid"),
  coords: document.getElementById("coords"),
  owner: document.getElementById("owner"),
  statusTile: document.getElementById("statusTile"),
  price: document.getElementById("price"),
  // actions
  claimBtn: document.getElementById("claimBtn"),
  buyBtn: document.getElementById("buyBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  listBtn: document.getElementById("listBtn"),
  listPrice: document.getElementById("listPrice"),
  // batch
  batchCount: document.getElementById("batchCount"),
  batchList: document.getElementById("batchList"),
  runBatch: document.getElementById("runBatch"),
  clearBatch: document.getElementById("clearBatch"),
};

// --- Selection state ---
const selected = new Set(); // up to 10 selected tiles

function updateSelCount(){
  els.selCount.textContent = selected.size ? `Selected: ${selected.size}` : "";
}

function toggleSelect(id, x, y){
  if (selected.has(id)){ selected.delete(id); redrawTile(x, y); }
  else {
    if (selected.size >= 10) { alert("You can select at most 10 tiles at once."); return; }
    selected.add(id); drawSelect(x, y);
  }
  updateSelCount();
}

function clearSelection(){
  if (!selected.size) return;
  selected.forEach(id => { const y = Math.floor(id / GRID_SIZE), x = id % GRID_SIZE; redrawTile(x, y); });
  selected.clear();
  updateSelCount();
}

const batch = []; // up to 10 actions

function pushBatch(itemOrItems){
  const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  for (const item of items){
    if (batch.length >= 10) { alert("Batch is full (max 10)."); break; }
    batch.push(item);
    const li = document.createElement("li");
    let line = `${item.type.toUpperCase()} tile #${item.tokenId}`;
    if (item.priceWei != null) { try { line += ` @ ${ethers.utils.formatEther(item.priceWei)} ETH`; } catch{} }
    li.textContent = line;
    els.batchList.appendChild(li);
  }
  els.batchCount.textContent = `(${batch.length}/10)`;
}

async function runBatch(){
  if (!signer) return alert("Connect wallet first.");
  let processed = 0;
  while (batch.length && processed < 10){
    const item = batch.shift();
    try{
      if (item.type === "claim"){
        const tx = await tileWrite.claim(item.tokenId);
        await tx.wait();
      } else if (item.type === "list"){
        const tx = await tileWrite.listForSale(item.tokenId, item.priceWei);
        await tx.wait();
      } else if (item.type === "buy"){
        const tx = await tileWrite.buy(item.tokenId, { value: item.priceWei });
        await tx.wait();
      } else if (item.type === "cancel"){
        const tx = await tileWrite.cancelListing(item.tokenId);
        await tx.wait();
      }
    }catch(e){ console.error("batch action failed", e); }
    processed++;
    els.batchList.removeChild(els.batchList.firstChild);
    els.batchCount.textContent = `(${batch.length}/10)`;
  }
}

function clearBatch(){
  batch.length = 0;
  els.batchList.innerHTML = "";
  els.batchCount.textContent = "(0/10)";
}

function fmtAddr(a){ if (!a || a === ethers.constants.AddressZero) return "—"; return a.slice(0,6) + "…" + a.slice(-4); }
function fmtWei(w){ try{ return ethers.utils.formatEther(w) + " ETH"; }catch{ return "—"; } }

// Canvas rendering
let ctx;
let hover = { x:-1, y:-1, id:-1 };
const retainTimers = new Map(); // id -> timeout

function setupCanvas(){
  const W = GRID_SIZE * PIXEL;
  els.grid.width = W; els.grid.height = W;
  els.grid.style.width = W + "px";
  els.grid.style.height = W + "px";
  ctx = els.grid.getContext("2d");
  // draw checkerboard
  for (let y=0;y<GRID_SIZE;y++){
    for (let x=0;x<GRID_SIZE;x++){
      ctx.fillStyle = ((x+y)%2===0) ? "#141414" : "#101010";
      ctx.fillRect(x*PIXEL, y*PIXEL, PIXEL, PIXEL);
    }
  }
  redrawSelections();
}

function baseFill(x, y){
  ctx.fillStyle = ((x+y)%2===0) ? "#141414" : "#101010";
  ctx.fillRect(x*PIXEL, y*PIXEL, PIXEL, PIXEL);
}

function redrawTile(x, y){
  baseFill(x, y);
  const id = y*GRID_SIZE + x;
  if (selected.has(id)) {
    ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1;
    ctx.strokeRect(x*PIXEL+0.5, y*PIXEL+0.5, PIXEL-1, PIXEL-1);
  }
}

function drawHover(x, y){
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
  ctx.strokeRect(x*PIXEL+0.5, y*PIXEL+0.5, PIXEL-1, PIXEL-1);
}

function drawSelect(x, y){
  ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1;
  ctx.strokeRect(x*PIXEL+0.5, y*PIXEL+0.5, PIXEL-1, PIXEL-1);
}

function redrawSelections(){
  selected.forEach(id => { const y = Math.floor(id / GRID_SIZE), x = id % GRID_SIZE; drawSelect(x, y); });
}

let hoverDebounce = 0;
els.grid.addEventListener("mousemove", (e)=>{
  const r = els.grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / PIXEL);
  const y = Math.floor((e.clientY - r.top) / PIXEL);
  if (x === hover.x && y === hover.y) return;

  // retain previous hover for 1s
  if (hover.x >= 0){
    const prev = { x: hover.x, y: hover.y, id: hover.id };
    // clear any existing timer for that id
    if (retainTimers.has(prev.id)) { clearTimeout(retainTimers.get(prev.id)); }
    retainTimers.set(prev.id, setTimeout(()=>{
      // when timeout elapses, only clear if not selected and not current hover
      const cur = hover.id;
      if (!selected.has(prev.id) && prev.id !== cur){
        redrawTile(prev.x, prev.y);
      }
      retainTimers.delete(prev.id);
    }, 1000));
  }

  hover = { x, y, id: y*GRID_SIZE + x };
  // draw hover border (doesn't erase base)
  drawHover(x, y);

  clearTimeout(hoverDebounce);
  hoverDebounce = setTimeout(()=> loadTileMeta(hover.id, x, y), 120);
});

els.grid.addEventListener("mouseleave", ()=>{
  // start retain timer for the last hover
  if (hover.x >= 0){
    const prev = { x: hover.x, y: hover.y, id: hover.id };
    if (retainTimers.has(prev.id)) { clearTimeout(retainTimers.get(prev.id)); }
    retainTimers.set(prev.id, setTimeout(()=>{
      if (!selected.has(prev.id)){ redrawTile(prev.x, prev.y); }
      retainTimers.delete(prev.id);
    }, 1000));
  }
  hover = {x:-1,y:-1,id:-1};
  els.tileTitle.textContent = "Hover a tile";
  els.tid.textContent = "—"; els.coords.textContent="—"; els.owner.textContent="—"; els.statusTile.textContent="—"; els.price.textContent="—";
});

// Click to toggle selection
els.grid.addEventListener("click", (e)=>{
  const r = els.grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / PIXEL);
  const y = Math.floor((e.clientY - r.top) / PIXEL);
  if (x<0 || y<0 || x>=GRID_SIZE || y>=GRID_SIZE) return;
  const id = y*GRID_SIZE + x;
  toggleSelect(id, x, y);
});

async function loadTileMeta(tokenId, x, y){
  els.tileTitle.textContent = `Tile #${tokenId}`;
  els.tid.textContent = tokenId;
  els.coords.textContent = `(${x}, ${y})`;
  try{
    const [owner, listing] = await Promise.all([
      tileRead.ownerOfIfMinted(tokenId),
      tileRead.listings(tokenId)
    ]);
    els.owner.textContent = owner && owner !== ethers.constants.AddressZero ? owner.slice(0,6)+"…"+owner.slice(-4) : "—";
    if (!owner || owner === ethers.constants.AddressZero){
      els.statusTile.textContent = "Unclaimed";
      els.price.textContent = "—";
      showPanel("claim");
    } else if (listing.seller && listing.seller !== ethers.constants.AddressZero){
      els.statusTile.textContent = "Listed";
      els.price.textContent = ethers.utils.formatEther(listing.price) + " ETH";
      showPanel("buy", listing, owner);
    } else {
      els.statusTile.textContent = "Owned";
      els.price.textContent = "—";
      showPanel("list", null, owner);
    }
  }catch(e){
    console.warn("meta load", e);
  }
}

function showPanel(which, listing=null, owner=null){
  document.getElementById("claimBox").style.display = (which==="claim") ? "block" : "none";
  document.getElementById("listBox").style.display = (which==="list") ? "block" : "none";
  document.getElementById("buyBox").style.display   = (which==="buy")   ? "block" : "none";

  const targets = selected.size ? Array.from(selected) : (hover.id>=0 ? [hover.id] : []);
  function limitTargets(arr){ const room = 10 - batch.length; return arr.slice(0, Math.max(0, room)); }

  if (which==="buy" && listing){
    els.buyBtn.onclick = () => { const ids = limitTargets(targets); if (!ids.length) return; pushBatch(ids.map(id => ({ type:"buy", tokenId:id, priceWei: listing.price }))); };
    els.cancelBtn.onclick = () => { const ids = limitTargets(targets); if (!ids.length) return; pushBatch(ids.map(id => ({ type:"cancel", tokenId:id }))); };
  }
  if (which==="claim"){
    els.claimBtn.onclick = () => { const ids = limitTargets(targets); if (!ids.length) return; pushBatch(ids.map(id => ({ type:"claim", tokenId:id }))); };
  }
  if (which==="list"){
    els.listBtn.onclick = () => {
      const v = (els.listPrice.value || "0").trim();
      let priceWei; try { priceWei = ethers.utils.parseEther(v); } catch { return alert("Bad price"); }
      const ids = limitTargets(targets); if (!ids.length) return;
      pushBatch(ids.map(id => ({ type:"list", tokenId:id, priceWei })));
    };
  }
}

function setStatus(t){ els.status.textContent = t; }

async function connect(){
  try{
    if (!window.ethereum) {
      setStatus("No wallet found — install MetaMask");
      alert("No wallet found. Install MetaMask or disable Brave Shields for this site.");
      return;
    }
    let chain = await window.ethereum.request({ method:"eth_chainId" }).catch(()=>null);
    if (chain !== HEX_CHAIN_ID){
      try { await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: HEX_CHAIN_ID }] }); }
      catch {
        await window.ethereum.request({ method:"wallet_addEthereumChain", params:[{
          chainId: HEX_CHAIN_ID, chainName: "MegaETH Testnet",
          nativeCurrency: { name:"MEGA", symbol:"MEGA", decimals:18 },
          rpcUrls: [C.RPC_URL], blockExplorerUrls: []
        }]});
      }
    }
    const web3 = new ethers.providers.Web3Provider(window.ethereum, "any");
    await web3.send("eth_requestAccounts", []);
    signer = web3.getSigner();
    provider = web3; // use same for reads after connect
    tileWrite = new ethers.Contract(C.TILES_ADDRESS, TILE_ABI, signer);
    tileRead  = new ethers.Contract(C.TILES_ADDRESS, TILE_ABI, provider);
    const addr = await signer.getAddress();
    setStatus("connected " + addr.slice(0,6) + "…" + addr.slice(-4));

    // react to account/chain changes
    if (window.ethereum && window.ethereum.on){
      window.ethereum.on("accountsChanged", (accs)=>{ if (accs && accs[0]) setStatus("connected " + accs[0].slice(0,6)+"…"+accs[0].slice(-4)); });
      window.ethereum.on("chainChanged", ()=>window.location.reload());
    }
  }catch(e){
    console.error("connect", e);
    setStatus("connect failed");
    alert("Wallet connection failed. See console for details.");
  }
}

function setupRead(){
  provider = new ethers.providers.JsonRpcProvider(C.RPC_URL);
  tileRead = new ethers.Contract(C.TILES_ADDRESS, TILE_ABI, provider);
}

function subscribeEvents(){
  tileRead.on("Transfer", (from, to, tokenId)=>{
    if (hover.id === Number(tokenId)) {
      loadTileMeta(hover.id, hover.x, hover.y);
    }
  });
}

async function init(){
  await loadEthers();
  setupRead();
  try { GRID_SIZE = Number(await tileRead.GRID_SIZE()) || GRID_SIZE; } catch {}
  PIXEL = Math.max(1, Math.min(12, Number(document.getElementById("pxSize").value) || 2));
  setupCanvas();
  subscribeEvents();

  els.pxSize.addEventListener("change", ()=>{ PIXEL = Math.max(1, Math.min(12, Number(els.pxSize.value) || 2)); setupCanvas(); });
  els.connect.addEventListener("click", connect);
  els.resetView.addEventListener("click", setupCanvas);
  els.clearSelection.addEventListener("click", clearSelection);
  els.runBatch.addEventListener("click", runBatch);
  els.clearBatch.addEventListener("click", clearBatch);
}

init();
