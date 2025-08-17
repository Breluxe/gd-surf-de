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

	/* ---------- Rendering ---------- */
	const content = $("#tabContent");
	const tabs = $$(".tab");
	let activeTab = "buildings";

	function render(){
		$("#credits").textContent = fmt(state.credits);
		$("#cps").textContent = fmt(totalCPS());
		$("#cores").textContent = fmt(state.cores);
		$("#mult").textContent = "x" + state.coreMultiplier.toFixed(2);
		$("#clickPowerLabel").textContent = "+" + fmt(state.clickPower + Math.floor(state.autoClick>0? state.clickPower*0.2 : 0));
		renderStats();
		renderTab(activeTab);
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
			// Gebäude-Panel anzeigen
			let html = '<div class="panel grid">';
			for(const key in state.buildings){
				const b = state.buildings[key];
				const price = nextCost(b);
				html += `<div class="item"><h3>${b.name}</h3><div class="desc">${b.desc}</div><div class="row"><span class="price">${fmt(price)} Credits</span><span class="level">Level ${b.count}</span></div><button class="buy" data-buy="${key}" ${state.credits<price?'disabled':''}>Kaufen</button></div>`;
			}
			html += '</div>';
			content.innerHTML = html;
			bindBuildingButtons();
		} else if (tab==="upgrades"){
			let html = '<div class="panel grid">';
			for(const key in state.upgrades){
				const u = state.upgrades[key];
				html += `<div class="item"><h3>${u.name}</h3><div class="desc">${u.desc}</div><div class="row"><span class="price">${fmt(u.cost)} Credits</span><span class="level">${u.bought?'Gekauft':'Nicht gekauft'}</span></div><button class="buy" data-upgrade="${key}" ${state.credits<u.cost||u.bought?'disabled':''}>Kaufen</button></div>`;
			}
			html += '</div>';
			content.innerHTML = html;
			bindUpgradeButtons();
		} else if (tab==="research"){
			let html = '<div class="panel grid">';
			for(const key in state.research){
				const r = state.research[key];
				html += `<div class="item"><h3>${r.name}</h3><div class="desc">${r.desc}</div><div class="row"><span class="price">${fmt(r.cost)} Credits</span><span class="level">${r.bought?'Gekauft':'Nicht gekauft'}</span></div><button class="buy" data-research="${key}" ${state.credits<r.cost||r.bought?'disabled':''}>Kaufen</button></div>`;
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
		return Math.floor(b.cost * Math.pow(b.scale * prestigeScale, b.count));
	}
	function prestigeGain(){
		// Square root of total earned / 10k
		return Math.floor(Math.sqrt(state.totalEarned/10000));
	}

	/* ---------- Buying ---------- */
	function buyBuilding(key, qty=1){
		const b = state.buildings[key];
		let bought = 0;
		for (let i=0;i<qty;i++){
			const price = nextCost(b);
			if (state.credits >= price){
				state.credits -= price;
				b.count++;
				bought++;
			}
		}
		if (bought>0) render();
	}
	function buyUpgrade(key){
		const u = state.upgrades[key];
		if (u.bought) return;
		if (u.req && !u.req(state)) return;
		if (state.credits < u.cost) return;
		state.credits -= u.cost;
		u.bought = true;
		u.effect && u.effect(state);
		render();
	}
	function buyResearch(key){
		const r = state.research[key];
		if (r.bought || state.credits < r.cost) return;
		state.credits -= r.cost;
		r.bought = true;
		render();
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
	$("#harvestBtn").addEventListener("click", () => {
		const gain = state.clickPower * state.coreMultiplier * (state.overclock.active? 2 : 1);
		spawnFloat(`+${fmt(gain)}`);
		addCredits(gain);
		render();
	});

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
			if (str) Object.assign(state, JSON.parse(str));
		}catch(e){ console.warn("Load failed", e)}
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

	init();
	window.onload = function() {
		if (typeof init === 'function') {
			init();
		}
	};
})();
