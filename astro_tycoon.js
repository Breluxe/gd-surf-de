// Astro Tycoon Game Logic (ausgelagert)
(() => {
	"use strict";

	/* ---------- Utilities ---------- */
	const $ = (sel, el=document) => el.querySelector(sel);
	const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
	const fmt = n => {
		if (!isFinite(n)) return "∞";
		const abs = Math.abs(n);
		if (abs >= 1e15) return (n/1e15).toFixed(2)+" Qa";
		if (abs >= 1e12) return (n/1e12).toFixed(2)+" Tn";
		if (abs >= 1e9) return (n/1e9).toFixed(2)+" B";
		if (abs >= 1e6) return (n/1e6).toFixed(2)+" M";
		if (abs >= 1e3) return (n/1e3).toFixed(2)+" K";
		return n.toFixed(0);
	};
	const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	const now = () => Date.now();

	/* ---------- Game State ---------- */
	const state = {
		credits: 0,
		totalEarned: 0,
		clickPower: 1,
		priceDiscount: 1,
		coreMultiplier: 1,
		cores: 0,
		prestigeLevel: 0,
		lastTick: now(),
		buildings: {
			spaceport: {name:"Spaceport", base:150, count:0, cost: 4200, scale:1.17, desc:"Interstellare Händler docken an.", prestigeScale:1.0}
		},
		upgrades: {
			turbo: {name:"Auto-Harvester", desc:"+20% CPS & automatisches Klicken", cost: 900, bought:false, effect: s=>{s.autoClick=1}},
		},
		research: {
			bulk: {name:"Massenkauf", desc:"Kaufe x10 Gebäude", cost: 800, bought:false},
		},
		autoClick: 0,
		overclock: {active:false, until:0, cdUntil:0},
		settings: { notation:"short" },
		achievements: {},
		version: 1
	};

	const STORAGE_KEY = "astro_tycoon_save_v1";

// autofire 100/s state
let autoClick100Id = null;
let autoClick100Active = false;

	/* ---------- Rendering ---------- */
	const content = $("#tabContent");
	const tabs = $$(".tab");
	let activeTab = "buildings";

	/* Canonical definitions — UI and effect functions live here so saved JSON can't remove them */
	const DEFINITIONS = {
		buildings: {
			spaceport: {name:"Spaceport", base:150, desc:"Interstellare Händler docken an.", cost:4200, scale:1.17},
			miner: {name:"Astro-Miner", base:30, desc:"Miners extrahieren Stardust.", cost:120, scale:1.14},
			refinery: {name:"Refinery", base:750, desc:"Veredelt Rohstoffe.", cost:5000, scale:1.18}
		},
			upgrades: {
				turbo: {name:"Auto-Harvester", desc:"+20% CPS & automatisches Klicken", cost: 900, effect: s=>{s.autoClick=1}},
				overdrive: {name:"Overdrive Module", desc:"+1 Klickstärke", cost: 2500, effect: s=>{s.clickPower += 1}},
				coreflux: {name:"Coreflux", desc:"Erhöht Core-Multiplikator leicht", cost: 8000, effect: s=>{s.coreMultiplier *= 1.05}},
				optics: {name:"Quantum Optics", desc:"+10% buildings efficiency", cost: 1200, effect: s=>{s.coreMultiplier *= 1.1}},
				automation: {name:"Automation Suite", desc:"+50% Auto-Click", cost: 2200, effect: s=>{s.autoClick = (s.autoClick||0)+1}},
				alloy: {name:"Neon Alloy", desc:"Gebäude kosten leicht weniger", cost: 3400, effect: s=>{s.priceDiscount *= 0.95}},
				fluxCap: {name:"Flux Capacitor", desc:"Kurzzeit-Overclock aktivierbar", cost: 6000, effect: s=>{/* unlocks overclock usage */}},
				quantumBus: {name:"Quantum Bus", desc:"+25% CPS global", cost: 12000, effect: s=>{s.coreMultiplier *= 1.25}},
				sentinel: {name:"Sentinel AI", desc:"Erhöht ClickPower & CPS leicht", cost: 18000, effect: s=>{s.clickPower += 2; s.coreMultiplier *= 1.02}},
				genesis: {name:"Genesis Core", desc:"Großer permanenter Boost", cost: 50000, effect: s=>{s.coreMultiplier *= 1.5}}
			},
		research: {
			bulk: {name:"Massenkauf", desc:"Kaufe x10 Gebäude", cost: 800}
		}
	};

	function render(){
		$("#credits").textContent = fmt(state.credits);
		$("#cps").textContent = fmt(totalCPS());
		$("#cores").textContent = fmt(state.cores);
		$("#mult").textContent = "x" + state.coreMultiplier.toFixed(2);
		$("#clickPowerLabel").textContent = "+" + fmt(state.clickPower + Math.floor(state.autoClick>0? state.clickPower*0.2 : 0));
		renderStats();
		renderTab(activeTab);
		// ensure animated counter sync
		lastDisplayedCredits = Math.floor(state.credits);
		animateCounter(state.credits);
	}

	function renderStats(){
		const s = state;
		const lines = [
			["Prestige Level", s.prestigeLevel],
			["Quantum-Kerne", fmt(s.cores)],
			["Multiplikator", "x"+s.coreMultiplier.toFixed(2)],
			["Total Credits", fmt(s.totalEarned)]
		];
		const el = $("#stats");
		el.innerHTML = lines.map(([a,b])=>`<div class="statline"><div>${a}</div><div>${b}</div></div>`).join("");
	}

	function renderTab(tab){
		activeTab = tab;
		tabs.forEach(t=> t.classList.toggle("active", t.dataset.tab===tab));
		if (tab==="buildings"){
			let html = '<div class="panel grid">';
			for(const key in DEFINITIONS.buildings){
				const def = DEFINITIONS.buildings[key];
				const b = state.buildings[key] || {count:0,cost:def.cost};
				const price = nextCost(Object.assign({}, def, b));
				html += `<div class="item"><h3>${def.name}</h3><div class="desc">${def.desc}</div><div class="row"><span class="price">${fmt(price)} Credits</span><span class="level">Level ${b.count}</span></div><button class="buy" data-buy="${key}" ${state.credits<price?'disabled':''}>Kaufen</button></div>`;
			}
			html += '</div>';
			content.innerHTML = html;
			bindBuildingButtons();
		} else if (tab==="upgrades"){
			let html = '<div class="panel grid">';
			for(const key in DEFINITIONS.upgrades){
				const def = DEFINITIONS.upgrades[key];
				const u = state.upgrades[key] || {bought:false, cost:def.cost};
				html += `<div class="item upgrade"><div class="icon">🔧</div><div style="flex:1"><h3>${def.name} <span class=\"bought-badge\">${u.bought? '✓' : ''}</span></h3><div class=\"desc\">${def.desc}</div></div><div class=\"row\"><span class=\"price\">${fmt(u.cost)} Credits</span><button class=\"buy\" data-upgrade=\"${key}\" ${u.bought||state.credits<u.cost?'disabled':''}>Kaufen</button></div></div>`;
			}
			html += '</div>';
			content.innerHTML = html;
			bindUpgradeButtons();
		} else if (tab==="research"){
			let html = '<div class="panel grid">';
			for(const key in DEFINITIONS.research){
				const def = DEFINITIONS.research[key];
				const r = state.research[key] || {bought:false, cost:def.cost};
				html += `<div class="item"><h3>${def.name}</h3><div class="desc">${def.desc}</div><div class="row"><span class="price">${fmt(r.cost)} Credits</span><span class="level">${r.bought?'Gekauft':'Nicht gekauft'}</span></div><button class="buy" data-research="${key}" ${r.bought||state.credits<r.cost?'disabled':''}>Kaufen</button></div>`;
			}
			html += '</div>';
			content.innerHTML = html;
			bindResearchButtons();
		} else if (tab==="achievements"){
			content.innerHTML = renderAchievements();
		} else if (tab==="settings"){
			content.innerHTML = renderSettings();
			bindSettings();
		}
	}

	function renderAchievements(){
		const list = [
			{name:"Erste Quantum-Kerne", done:state.cores>0},
			{name:"Prestige erreicht", done:state.prestigeLevel>0},
			{name:"100k Credits", done:state.totalEarned>=100000}
		];
		const html = list.map(a=>`<div class="achv ${a.done? "done": ""}"><div class="dot"></div><div>${a.name}</div></div>`).join("");
		return `<div class="panel">${html}</div>`;
	}

	function renderSettings(){
		return `<div class="panel">
			<div>Notation: <select id="notationSel"><option value="short">Kurz</option><option value="long">Lang</option></select></div>
			<button class="btn" id="exportSave">Export Save</button>
			<button class="btn" id="importSave">Import Save</button>
		</div>`;
	}

	/* ---------- Calculations ---------- */
	function buildingCPS(key){
		const b = state.buildings[key];
		const mult = state.coreMultiplier * (state.overclock.active? 2 : 1);
		return b.base * b.count * mult;
	}
	function totalCPS(){
		let cps = Object.keys(state.buildings).reduce((sum,k)=> sum + buildingCPS(k), 0);
		if (state.autoClick) cps += state.clickPower * 0.2 * state.coreMultiplier * (state.overclock.active? 2 : 1);
		return cps;
	}
	function totalBuildings(){
		return Object.values(state.buildings).reduce((a,b)=>a+b.count,0);
	}
	function nextCost(b){
		// Prestige-Preissteigerung
		const prestigeScale = 1 + (state.prestigeLevel * 0.15);
		const discount = state.priceDiscount || 1;
		return Math.floor((b.cost * discount) * Math.pow(b.scale * prestigeScale, b.count));
	}
	function prestigeGain(){
		// Square root of total earned / 10k
		return Math.floor(Math.sqrt(state.totalEarned/10000));
	}

	/* ---------- Buying ---------- */
	function buyBuilding(key, qty=1){
		state.buildings[key] = state.buildings[key] || {count:0};
		const b = state.buildings[key];
		let bought = 0;
		for (let i=0;i<qty;i++){
			const def = DEFINITIONS.buildings[key];
			const price = nextCost(Object.assign({}, def, b));
			if (state.credits >= price){
				state.credits -= price;
				b.count++;
				bought++;
			}
		}
		if (bought>0){ renderStats(); updateButtonStates(); saveGame(); }
	}
	function buyUpgrade(key){
		state.upgrades[key] = state.upgrades[key] || {bought:false};
		const u = state.upgrades[key];
		const def = DEFINITIONS.upgrades[key];
		if (u.bought) return;
		if (u.req && !u.req(state)) return;
		const cost = u.cost || def.cost;
		if (state.credits < cost) return;
		state.credits -= cost;
		u.bought = true;
		// ensure effect exists and apply
		if (def.effect) def.effect(state);
		// add visual class to body to reflect upgrade
		try{ document.body.classList.add('upg-'+key); }catch(e){}
		renderStats(); updateButtonStates(); saveGame();
	}
	function buyResearch(key){
		state.research[key] = state.research[key] || {bought:false};
		const r = state.research[key];
		const def = DEFINITIONS.research[key];
		const cost = r.cost || def.cost;
		if (r.bought || state.credits < cost) return;
		state.credits -= cost;
		r.bought = true;
		renderStats(); updateButtonStates(); saveGame();
	}

	/* ---------- Ticking ---------- */
	function addCredits(x){
		if (x<=0) return;
		state.credits += x;
		state.totalEarned += x;
	}

	function updateButtonStates(){
		// Buildings
		$$('[data-buy]').forEach(btn=>{
			const key = btn.getAttribute('data-buy');
			const b = state.buildings[key];
			if (!b) return;
			const price = nextCost(b);
			btn.disabled = state.credits < price;
		});
		// Upgrades
		$$('[data-upgrade]').forEach(btn=>{
			const key = btn.getAttribute('data-upgrade');
			const u = state.upgrades[key];
			if (!u) return;
			btn.disabled = u.bought || state.credits < u.cost;
		});
		// Research
		$$('[data-research]').forEach(btn=>{
			const key = btn.getAttribute('data-research');
			const r = state.research[key];
			if (!r) return;
			btn.disabled = r.bought || state.credits < r.cost;
		});
	}

	function gameTick(){
		const t = now();
		const dt = clamp((t - state.lastTick)/1000, 0, 60);
		state.lastTick = t;
		addCredits(totalCPS() * dt);
		if (state.autoClick){
			addCredits(state.clickPower * state.coreMultiplier * dt * 0.2);
		}
		if (state.overclock.active && t >= state.overclock.until){
			state.overclock.active = false;
		}
		$("#tickInfo").textContent = `Tick: ${(dt*1000|0)}ms • Prestige möglich: +${fmt(prestigeGain())}`;
		$("#credits").textContent = fmt(state.credits);
		$("#cps").textContent = fmt(totalCPS());
		// update button enabled/disabled state live
		updateButtonStates();
		requestAnimationFrame(gameTick);
	}

	/* ---------- Events ---------- */
	// Harvest action factored so autofire can reuse it
	function doHarvest() {
		const gain = state.clickPower * state.coreMultiplier * (state.overclock.active? 2 : 1);
		// throttle visuals during autofire to avoid DOM thrash
		if (!autoClick100Active || (autoClick100Active && Math.random() < 0.25)) {
			spawnFloat(`+${fmt(gain)}`);
		}
		addCredits(gain);
		// Avoid full render to prevent rebuilding tab DOM and replaying entrance animations.
		// Update only header/stats and button states.
		renderStats();
		updateButtonStates();
	}

	$("#harvestBtn").addEventListener("click", () => doHarvest());

	// autofire 100Hz toggle
	function toggleAutoClick100(){
		if (autoClick100Id){
			clearInterval(autoClick100Id);
			autoClick100Id = null;
			autoClick100Active = false;
		} else {
			autoClick100Active = true;
			const b = $("#autoClick100Btn"); if (b) { b.classList.add('active'); b.textContent = 'Stop Autoklick'; }
			autoClick100Id = setInterval(()=>{ doHarvest(); }, 10);
		}
	}
	const autoBtn = $("#autoClick100Btn"); if (autoBtn) autoBtn.addEventListener('click', toggleAutoClick100);

	function bindTabs(){
		tabs.forEach(t => {
			t.addEventListener("click", () => renderTab(t.dataset.tab));
		});
	}

	function bindBuildingButtons(){
		$$('[data-buy]').forEach(btn => {
			btn.addEventListener("click", () => buyBuilding(btn.getAttribute("data-buy")));
		});
	}
	function bindUpgradeButtons(){
		$$('[data-upgrade]').forEach(btn => {
			btn.addEventListener("click", () => buyUpgrade(btn.getAttribute("data-upgrade")));
		});
	}
	function bindResearchButtons(){
		$$('[data-research]').forEach(btn => {
			btn.addEventListener("click", () => buyResearch(btn.getAttribute("data-research")));
		});
	}

	$("#saveBtn").addEventListener("click", saveGame);
	$("#resetBtn").addEventListener("click", () => {
		if (confirm("Wirklich ALLES löschen?")) {
			localStorage.removeItem(STORAGE_KEY);
			location.reload();
		}
	});
	$("#clearCacheBtn").addEventListener("click", async () => {
        if (!confirm('Cache löschen und Spiel neu starten?')) return;
        try {
            // remove game save
            localStorage.removeItem(STORAGE_KEY);
            // attempt to unregister service workers if any
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const r of regs) await r.unregister();
            }
        } catch(e){ console.warn('Cache clear failed', e) }
        // hydrate defaults then reload to ensure UI rebuilds correctly
        hydrateDefaults();
        location.reload();
    });
	$("#prestigeBtn").addEventListener("click", () => {
		const gain = prestigeGain();
		if (gain<=0) return alert("Sammle mehr Credits für Prestige!");
		if (confirm(`Prestige? Du bekommst ${gain} Quantum-Kerne und setzt Fortschritt zurück.`)){
			doPrestige(gain);
		}
	});

	function bindSettings(){
		const sel = $("#notationSel");
		if (sel) {
			sel.value = state.settings.notation;
			sel.addEventListener("change", e => {
				state.settings.notation = sel.value;
				render();
			});
		}
		const exp = $("#exportSave");
		exp && exp.addEventListener("click", () => {
			navigator.clipboard.writeText(JSON.stringify(state)).then(()=> alert("Save in Zwischenablage kopiert!"));
		});
		const imp = $("#importSave");
		imp && imp.addEventListener("click", async ()=>{
			const str = prompt("Save einfügen:");
			if (str) {
				try {
					Object.assign(state, JSON.parse(str));
					render();
					saveGame();
				} catch(e) { alert("Fehler beim Import!"); }
			}
		});
	}

	/* ---------- Save/Load/Prestige ---------- */
	function saveGame(){
		try{
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		}catch(e){ console.warn("Save failed", e) }
	}
	function loadGame(){
		try{
			const str = localStorage.getItem(STORAGE_KEY);
			if (str) {
				const saved = JSON.parse(str);
				// merge saved minimal properties into state, but keep DEFINITIONS as canonical
				Object.assign(state, saved);
			}
		}catch(e){ console.warn("Load failed", e)}
	}

	// Restore default definitions (functions/effects) after load/reset
	function hydrateDefaults(){
		// ensure structure exists
		state.buildings = state.buildings || {};
		state.upgrades = state.upgrades || {};
		state.research = state.research || {};
		// Merge definitions with saved values (count/bought)
		for(const k in DEFINITIONS.buildings){
			const def = DEFINITIONS.buildings[k];
			state.buildings[k] = Object.assign({count:0, cost:def.cost, scale:def.scale, base:def.base||def.base}, state.buildings[k] || {}, {name:def.name, desc:def.desc});
		}
		for(const k in DEFINITIONS.upgrades){
			const def = DEFINITIONS.upgrades[k];
			state.upgrades[k] = Object.assign({bought:false, cost:def.cost}, state.upgrades[k] || {}, {name:def.name, desc:def.desc});
			// ensure effect function exists
			if (typeof def.effect === 'function') state.upgrades[k].effect = def.effect;
		}
		for(const k in DEFINITIONS.research){
			const def = DEFINITIONS.research[k];
			state.research[k] = Object.assign({bought:false, cost:def.cost}, state.research[k] || {}, {name:def.name, desc:def.desc});
		}
	}

	function doPrestige(gain){
		state.cores += gain;
		state.prestigeLevel++;
		state.coreMultiplier *= (1 + gain * 0.1);
		for (const b of Object.values(state.buildings)){
			b.count = 0;
		}
		for (const u of Object.values(state.upgrades)){
			u.bought = false;
		}
		for (const r of Object.values(state.research)){
			r.bought = false;
		}
		state.credits = 0;
		state.totalEarned = 0;
		state.clickPower = 1;
		state.autoClick = 0;
		state.overclock = {active:false, until:0, cdUntil:0};
		render();
		saveGame();
	}

	/* ---------- Offline Progress ---------- */
	function applyOfflineProgress(){
		const last = state.lastTick || now();
		const t = now();
		let dt = Math.max(0, Math.min(60*60*12, (t - last)/1000));
		const mult = state.research.offline?.bought ? 2 : 1;
		const gain = totalCPS() * dt * mult * 0.5;
		if (gain>0){
			addCredits(gain);
		}
		state.lastTick = t;
	}

	/* ---------- Visuals ---------- */
	function spawnFloat(text){
		const btn = $("#harvestBtn");
		const rect = btn.getBoundingClientRect();
		const el = document.createElement("div");
		el.textContent = text;
		el.style.position="fixed";
		el.style.left = (rect.left + rect.width/2 - 10 + (Math.random()*60-30))+"px";
		el.style.top = (rect.top + 4)+"px";
		el.style.fontWeight="900";
		el.style.pointerEvents="none";
		el.style.textShadow="0 2px 12px rgba(0,0,0,.6)";
		el.style.transition="all .9s cubic-bezier(.42,0,.58,1)";
		el.style.opacity="1";
		el.style.transform="translateY(0) scale(1)";
		el.style.background = "linear-gradient(90deg,#ffd36c,#6cf3ff)";
		el.style.borderRadius = "12px";
		el.style.padding = "4px 10px";
		el.style.zIndex = 9999;
		document.body.appendChild(el);
		requestAnimationFrame(()=>{
			el.style.transform="translateY(-40px) scale(1.1)";
			el.style.opacity = "0";
		});
		setTimeout(()=> el.remove(), 900);
	}

	// starfield
	function starfield(){
		const c = $("#space");
		const ctx = c.getContext("2d");
		let w= c.width= innerWidth, h= c.height= innerHeight;
		let stars = Array.from({length:120},()=>({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.2+0.3,speed:Math.random()*0.2+0.05}));
		function draw(){
			ctx.clearRect(0,0,w,h);
			for(const s of stars){
				ctx.beginPath();
				ctx.arc(s.x,s.y,s.r,0,2*Math.PI);
				ctx.fillStyle = `rgba(108,243,255,${0.5+Math.random()*0.5})`;
				ctx.shadowColor = '#6cf3ff';
				ctx.shadowBlur = 8;
				ctx.fill();
				ctx.shadowBlur = 0;
				s.x += s.speed;
				if(s.x>w) s.x=0;
			}
			requestAnimationFrame(draw);
		}
		draw();
		window.addEventListener('resize',()=>{
			w= c.width= innerWidth;
			h= c.height= innerHeight;
		});
	}

	/* ---------- Overclock action ---------- */
	function tryOverclock(){
		if(state.overclock.active) return;
		if(state.cores<1) return alert("Du brauchst Quantum-Kerne!");
		state.cores--;
		state.overclock.active = true;
		state.overclock.until = now() + 15000;
		render();
	}

	/* ---------- Init ---------- */
	function init(){
		loadGame();
		// restore defaults after loading saved data so functions & missing entries exist
		hydrateDefaults();
		bindTabs();
		bindSettings();
		starfield();
		render();
		applyOfflineProgress();
		setInterval(saveGame, 10000);
		requestAnimationFrame(gameTick);
		// Mark page as ready after initial animations so they won't replay on DOM updates
		setTimeout(()=>{
			document.body.classList.add('ready');
		}, 1400);
	}



	// credit display animation helpers (inside IIFE scope)
	let lastDisplayedCredits = Math.floor(state.credits || 0);
	function animateCounter(target){
		const el = document.getElementById('credits');
		if(!el) return;
		const start = lastDisplayedCredits || 0;
		const end = Math.floor(target);
		const dur = 400;
		const startT = performance.now();
		function step(t){
			const p = Math.min(1,(t-startT)/dur);
			const cur = Math.floor(start + (end-start) * (1 - Math.pow(1-p,3)));
			el.textContent = fmt(cur);
			if(p<1) requestAnimationFrame(step);
			else lastDisplayedCredits = end;
		}
		requestAnimationFrame(step);
	}

	// patch addCredits to trigger pulse (keeps original behavior)
	const _origAddCredits = addCredits;
	addCredits = function(x){
		if (x<=0) return;
		_origAddCredits(x);
		const pill = document.querySelector('.credits-pill');
		if(pill){
			pill.classList.remove('pulse');
			void pill.offsetWidth;
			pill.classList.add('pulse');
		}
		animateCounter(state.credits);
	};

	// cleanup autofire on unload
	window.addEventListener('beforeunload', ()=>{
		if (autoClick100Id) { clearInterval(autoClick100Id); autoClick100Id = null; autoClick100Active = false; }
		saveGame();
	});

	init();
	})();
