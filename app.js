(function(){
  "use strict";

  /* =========================================================
     STORAGE LAYER (Firebase Realtime Database)
     All players' phones read/write the same three paths in one
     shared database: game/state, game/players, game/round.
     firebase-config.js (loaded before this file) sets up `firebase`.
  ========================================================= */

  const db = firebase.database();

  async function fbGet(path){
    try{
      const snap = await db.ref(path).get();
      return snap.exists() ? snap.val() : null;
    }catch(e){
      console.error('firebase get failed', path, e);
      flashError('Connection hiccup — check your internet and try again.');
      return null;
    }
  }
  async function fbSet(path, value){
    try{
      await db.ref(path).set(value);
      return true;
    }catch(e){
      console.error('firebase set failed', path, e);
      flashError('Connection hiccup — please try that again.');
      return false;
    }
  }

  function flashError(msg){
    let el = document.getElementById('errBanner');
    if(!el){
      el = document.createElement('div');
      el.id = 'errBanner';
      el.className = 'err-banner';
      document.getElementById('wrap').prepend(el);
    }
    el.textContent = msg;
    clearTimeout(flashError._t);
    flashError._t = setTimeout(()=>{ if(el) el.remove(); }, 4000);
  }

  const CODE_NAMES = [
    "Alfred","Cecil","Reginald","Bertram","Percival","Wilfred","Edmund","Clarence","Herbert","Sidney",
    "Mildred","Beatrice","Ethel","Winifred","Agnes","Constance","Gladys","Doris","Florence","Enid",
    "Cornelius","Barnaby","Horace","Leonard","Ambrose"
  ];

  function uid(){ return 'p_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  function defaultState(){
    return {
      phase: 'lobby',
      round: 1,
      started: false,
      detectiveActive: false,
      detectiveId: null,
      winner: null,
      log: [],
      discussionStartedAt: null
    };
  }

  function defaultRound(){
    return {
      mafiaChat: [],
      mafiaVotes: {},
      doctorSave: { targets: [] },
      detectiveCheck: {},
      dayVotes: {},
      dayTieCandidates: null,
      extraSaveUnlocked: false,
      dagger: null
    };
  }

  /* ---------- Personal (per-device) identity — kept in this browser only ---------- */
  async function getMyRole(){ return localStorage.getItem('me:appRole'); }
  async function setMyRole(r){ localStorage.setItem('me:appRole', r); }
  async function getMyPlayerId(){ return localStorage.getItem('me:playerId'); }
  async function setMyPlayerId(id){ localStorage.setItem('me:playerId', id); }

  /* ---------- Core data access (shared across every phone) ---------- */
  async function getState(){ return (await fbGet('game/state')) || defaultState(); }
  async function setState(s){ return fbSet('game/state', s); }
  async function getPlayers(){ return (await fbGet('game/players')) || []; }
  async function setPlayers(p){ return fbSet('game/players', p); }
  async function getRound(){ return (await fbGet('game/round')) || defaultRound(); }
  async function setRound(r){ return fbSet('game/round', r); }
  // helper to safely mutate the round object: reads latest, applies fn, writes once
  async function updateRound(fn){
    const r = await getRound();
    fn(r);
    await setRound(r);
    return r;
  }

  function alive(players){ return players.filter(p=>p.alive); }
  function aliveMafia(players){ return alive(players).filter(p=>p.role==='mafia'); }
  function aliveNonMafia(players){ return alive(players).filter(p=>p.role!=='mafia'); }
  function aliveVillagers(players){ return alive(players).filter(p=>p.role==='villager'); }

  function randomUnusedName(players){
    const used = new Set(players.map(p=>p.codeName));
    const pool = CODE_NAMES.filter(n=>!used.has(n));
    const src = pool.length ? pool : CODE_NAMES;
    return src[Math.floor(Math.random()*src.length)];
  }

  function pushLog(state, text){
    state.log = state.log || [];
    state.log.push({ text, ts: Date.now(), round: state.round });
  }

  /* ---------- App shell / router ---------- */
  const appEl = document.getElementById('app');
  let pollTimer = null;

  function render(html){ appEl.innerHTML = html; }
  function q(sel){ return appEl.querySelector(sel); }
  function qa(sel){ return Array.from(appEl.querySelectorAll(sel)); }

  function startPolling(fn){
    stopPolling();
    fn();
    pollTimer = setInterval(fn, 2500);
  }
  function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  boot();

  async function boot(){
    const role = await getMyRole();
    if(role === 'narrator'){ return runNarrator(); }
    if(role === 'player'){ return runPlayer(); }
    return renderLanding();
  }

  function renderLanding(){
    render(`
      <div class="brand">
        <div class="eyebrow">A Night of Shadows &amp; Suspicion</div>
        <h1>THE UNDERWORLD</h1>
        <div class="sub">a Mafia parlour game, 1920s style</div>
      </div>
      <div class="cheetah-rule"></div>
      <div class="card stack">
        <p class="muted center">Share this same link with everyone at the party. Choose how you're joining tonight.</p>
        <button id="btnPlayer">Enter as a Guest</button>
        <button id="btnNarrator" class="secondary">Enter as the Narrator</button>
      </div>
    `);
    q('#btnPlayer').onclick = async ()=>{ await setMyRole('player'); runPlayer(); };
    q('#btnNarrator').onclick = async ()=>{ await setMyRole('narrator'); runNarrator(); };
  }

  /* =========================================================
     PLAYER FLOW
  ========================================================= */
  async function runPlayer(){
    const myId = await getMyPlayerId();
    if(!myId){ return renderJoinScreen(); }
    const players = await getPlayers();
    const me = players.find(p=>p.id===myId);
    if(!me){ return renderJoinScreen(); }
    startPolling(()=>renderPlayerState(myId));
  }

  function renderJoinScreen(){
    render(`
      <div class="brand">
        <div class="eyebrow">Welcome to</div>
        <h1>THE UNDERWORLD</h1>
      </div>
      <div class="cheetah-rule"></div>
      <div class="card stack">
        <h2>Step Into the Shadows</h2>
        <p class="muted">Give your name below. The house will assign you a code name for the evening &mdash; nobody outside these walls need know who you really are.</p>
        <input type="text" id="nameInput" placeholder="Your real name" maxlength="30">
        <button id="joinBtn">Join the Game</button>
        <button class="back-link" id="backBtn" style="width:auto;display:block;margin-top:8px;">&larr; not a guest? go back</button>
      </div>
    `);
    q('#backBtn').onclick = async ()=>{ stopPolling(); await setMyRole(''); renderLanding(); };
    q('#joinBtn').onclick = async ()=>{
      const name = q('#nameInput').value.trim();
      if(!name){ q('#nameInput').focus(); return; }
      q('#joinBtn').disabled = true;
      q('#joinBtn').textContent = 'Joining…';
      const state = await getState();
      if(state.started){
        render(`<div class="card center"><h2>The game has already begun</h2><p class="muted">Ask the narrator for the next round, or come back for the next game.</p></div>`);
        return;
      }
      const players = await getPlayers();
      const id = uid();
      const codeName = randomUnusedName(players);
      players.push({ id, realName:name, codeName, role:null, alive:true, joinedAt: Date.now() });
      const result = await setPlayers(players);
      if(!result){
        q('#joinBtn').disabled = false;
        q('#joinBtn').textContent = 'Join the Game';
        return;
      }
      await setMyPlayerId(id);
      runPlayer();
    };
  }

  async function renderPlayerState(myId){
    const [state, players] = await Promise.all([getState(), getPlayers()]);
    const me = players.find(p=>p.id===myId);
    if(!me){ stopPolling(); return renderJoinScreen(); }

    if(state.phase === 'game_over'){
      stopPolling();
      return renderGameOver(state, players, me);
    }

    if(!state.started){
      return render(`
        <div class="brand"><div class="eyebrow">You are known tonight as</div><h1>${esc(me.codeName)}</h1></div>
        <div class="cheetah-rule"></div>
        <div class="card center">
          <p>Standing by while the narrator gathers everyone in.</p>
          <p class="muted">Once the house is full, roles will be dealt.</p>
        </div>
      `);
    }

    if(!me.alive){
      return renderEliminated(state, players, me);
    }

    switch(state.phase){
      case 'night_mafia': return renderNightMafia(state, players, me);
      case 'night_doctor': return renderNightDoctor(state, players, me);
      case 'night_detective': return renderNightDetective(state, players, me);
      case 'night_reveal': return renderNightReveal(state, players, me);
      case 'day_discussion': return renderDayDiscussion(state, players, me);
      case 'day_vote': return renderDayVote(state, players, me);
      case 'day_reveal': return renderDayReveal(state, players, me);
      default: return renderRoleCard(state, players, me);
    }
  }

  function roleLabel(role){
    return { mafia:'Mafia', doctor:'Doctor', detective:'Detective', villager:'Villager' }[role] || role;
  }
  function roleFlavor(role){
    return {
      mafia:"You move in shadow. Each night, you and your fellow wolves choose who won't see morning.",
      doctor:"You carry the medicine bag. Each night, you may shield one soul from harm.",
      detective:"Your instincts sharpened when the town grew thin. Each night, you may learn the truth of one soul.",
      villager:"You are an honest citizen with no power but your voice and your vote. Trust carefully."
    }[role] || '';
  }

  function renderRoleCard(state, players, me){
    let mafiaList = '';
    if(me.role === 'mafia'){
      const fellows = players.filter(p=>p.role==='mafia' && p.id!==me.id).map(p=>p.codeName);
      mafiaList = fellows.length ? `<p class="muted">Your fellow Mafia tonight: <b>${fellows.map(esc).join(', ')}</b></p>` : '';
    }
    render(`
      <div class="brand"><div class="eyebrow">${esc(me.codeName)}</div><h1>Round ${state.round}</h1></div>
      <div class="cheetah-rule"></div>
      <div class="role-badge ${me.role}">
        <div class="role-name">${roleLabel(me.role)}</div>
        <p class="muted">${roleFlavor(me.role)}</p>
      </div>
      ${mafiaList}
      <div class="card center"><p class="muted">Waiting on the narrator to begin the night…</p></div>
    `);
  }

  function pickerList(candidates){
    return candidates.map(p=>`<button class="choice-btn" data-id="${p.id}">${esc(p.codeName)}</button>`).join('');
  }

  function renderNightMafia(state, players, me){
    if(me.role !== 'mafia'){
      return render(`
        <div class="brand"><div class="eyebrow">Round ${state.round}</div><h1>The city sleeps…</h1></div>
        <div class="cheetah-rule"></div>
        <div class="card center"><p class="muted">Close your eyes. Say nothing. Wait for the dawn.</p></div>
      `);
    }
    renderMafiaPhase(state, players, me);
  }

  async function renderMafiaPhase(state, players, me){
    const round = await getRound();
    const chatLines = round.mafiaChat || [];
    const voteMap = round.mafiaVotes || {};
    const targets = alive(players).filter(p=>p.role!=='mafia');
    const myVote = voteMap[me.id];
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round} &middot; Night</div><h1>The Family Convenes</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        <h3>Whisper Among Wolves</h3>
        <div class="chat-box" id="chatBox">
          ${chatLines.map(c=>`<div class="chat-line"><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`).join('') || '<span class="muted">No words yet…</span>'}
        </div>
        <div class="row">
          <input type="text" id="chatInput" placeholder="Say something to the family…" maxlength="120">
          <button id="sendBtn" style="width:auto;flex:0 0 90px;">Send</button>
        </div>
      </div>
      <div class="card">
        <h3>Choose Who Won't See Morning</h3>
        <div id="targetList">${pickerList(targets)}</div>
        ${myVote ? `<p class="muted center">Your choice is locked in: <b>${esc((players.find(p=>p.id===myVote)||{}).codeName||'')}</b></p>` : ''}
      </div>
    `);
    q('#chatBox').scrollTop = q('#chatBox').scrollHeight;
    q('#sendBtn').onclick = async ()=>{
      const val = q('#chatInput').value.trim();
      if(!val) return;
      q('#chatInput').value='';
      await updateRound(r=>{
        r.mafiaChat = r.mafiaChat || [];
        r.mafiaChat.push({ name: me.codeName, text: val, ts: Date.now() });
        if(r.mafiaChat.length > 40) r.mafiaChat = r.mafiaChat.slice(-40);
      });
    };
    qa('#targetList .choice-btn').forEach(btn=>{
      if(myVote) btn.disabled = true;
      if(btn.dataset.id === myVote) btn.classList.add('selected');
      btn.onclick = async ()=>{
        await updateRound(r=>{
          r.mafiaVotes = r.mafiaVotes || {};
          r.mafiaVotes[me.id] = btn.dataset.id;
        });
      };
    });
  }

  async function renderNightDoctor(state, players, me){
    if(me.role !== 'doctor'){
      return render(`
        <div class="brand"><div class="eyebrow">Round ${state.round}</div><h1>The city sleeps…</h1></div>
        <div class="cheetah-rule"></div>
        <div class="card center"><p class="muted">The doctor is making their rounds. Stay still.</p></div>
      `);
    }
    const round = await getRound();
    const maxPicks = round.extraSaveUnlocked ? 2 : 1;
    const save = round.doctorSave || { targets: [] };
    const candidates = alive(players);
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round} &middot; Night</div><h1>Make Your Rounds</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        <h3>${maxPicks===2 ? 'Tend to Two Souls Tonight' : 'Tend to One Soul Tonight'}</h3>
        ${maxPicks===2 ? '<p class="muted">Word on the street bought you an extra dose tonight.</p>' : ''}
        <div id="saveList">${pickerList(candidates)}</div>
        <p class="muted center" id="saveStatus"></p>
      </div>
    `);
    function refreshSelected(targets){
      qa('#saveList .choice-btn').forEach(b=>{
        b.classList.toggle('selected', targets.includes(b.dataset.id));
      });
      q('#saveStatus').textContent = targets.length ? `Protecting: ${targets.map(id=>(players.find(p=>p.id===id)||{}).codeName).join(', ')}` : '';
    }
    refreshSelected(save.targets);
    qa('#saveList .choice-btn').forEach(btn=>{
      btn.onclick = async ()=>{
        const r = await updateRound(r=>{
          r.doctorSave = r.doctorSave || { targets: [] };
          const idx = r.doctorSave.targets.indexOf(btn.dataset.id);
          if(idx>=0){ r.doctorSave.targets.splice(idx,1); }
          else{
            if(r.doctorSave.targets.length >= maxPicks){ r.doctorSave.targets.shift(); }
            r.doctorSave.targets.push(btn.dataset.id);
          }
        });
        refreshSelected(r.doctorSave.targets);
      };
    });
  }

  async function renderNightDetective(state, players, me){
    if(!state.detectiveId || me.id !== state.detectiveId){
      return render(`
        <div class="brand"><div class="eyebrow">Round ${state.round}</div><h1>The city sleeps…</h1></div>
        <div class="cheetah-rule"></div>
        <div class="card center"><p class="muted">Someone new is watching from the shadows tonight.</p></div>
      `);
    }
    const round = await getRound();
    const check = round.detectiveCheck || {};
    const mine = check[me.id];
    const candidates = alive(players).filter(p=>p.id!==me.id);
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round} &middot; Night</div><h1>You See Clearly Now</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        <h3>Investigate One Soul</h3>
        <div id="detList">${pickerList(candidates)}</div>
        ${mine ? `<p class="center" style="margin-top:14px;"><b>${esc((players.find(p=>p.id===mine.targetId)||{}).codeName)}</b> is ${mine.result === 'mafia' ? '<span style="color:var(--blood-bright)">Mafia.</span>' : '<span style="color:var(--good)">not Mafia.</span>'}</p>` : ''}
      </div>
    `);
    qa('#detList .choice-btn').forEach(btn=>{
      if(mine) btn.disabled = true;
      btn.onclick = async ()=>{
        const target = players.find(p=>p.id===btn.dataset.id);
        const result = target.role === 'mafia' ? 'mafia' : 'clean';
        await updateRound(r=>{
          r.detectiveCheck = r.detectiveCheck || {};
          r.detectiveCheck[me.id] = { targetId: target.id, result };
        });
        renderNightDetective(state, players, me);
      };
    });
  }

  function renderNightReveal(state, players, me){
    const recent = (state.log||[]).filter(l=>l.round===state.round);
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round}</div><h1>Dawn Breaks</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        ${recent.length ? recent.map(l=>`<div class="log-item">${esc(l.text)}</div>`).join('') : '<p class="muted center">Waiting for the narrator to speak…</p>'}
      </div>
    `);
  }

  function renderDayDiscussion(state, players, me){
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round} &middot; Day</div><h1>The Town Talks</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card center">
        <p>Speak your suspicions aloud. The narrator will call for the vote.</p>
      </div>
    `);
  }

  async function renderDayVote(state, players, me){
    const round = await getRound();
    const votes = round.dayVotes || {};
    const tieList = round.dayTieCandidates || null;
    let candidates = alive(players);
    if(tieList && tieList.length){ candidates = candidates.filter(p=>tieList.includes(p.id)); }
    const myVote = votes[me.id];
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round} &middot; Day</div><h1>${tieList ? 'A Tie — Vote Again' : 'Cast Your Vote'}</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        <h3>Who Do You Accuse?</h3>
        <div id="voteList">${pickerList(candidates)}</div>
        ${myVote ? `<p class="muted center">You voted: <b>${esc((players.find(p=>p.id===myVote)||{}).codeName||'')}</b></p>` : ''}
      </div>
    `);
    qa('#voteList .choice-btn').forEach(btn=>{
      if(myVote) btn.disabled = true;
      if(btn.dataset.id===myVote) btn.classList.add('selected');
      btn.onclick = async ()=>{
        await updateRound(r=>{
          r.dayVotes = r.dayVotes || {};
          r.dayVotes[me.id] = btn.dataset.id;
        });
      };
    });
  }

  function renderDayReveal(state, players, me){
    const recent = (state.log||[]).filter(l=>l.round===state.round);
    render(`
      <div class="brand"><div class="eyebrow">Round ${state.round}</div><h1>The Verdict</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        ${recent.length ? recent.map(l=>`<div class="log-item">${esc(l.text)}</div>`).join('') : '<p class="muted center">Waiting on the narrator…</p>'}
      </div>
    `);
  }

  function renderGameOver(state, players, me){
    render(`
      <div class="brand"><div class="eyebrow">The Night Is Over</div><h1>${state.winner === 'mafia' ? 'The Mafia Wins' : 'The Town Wins'}</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card">
        <h3>Final Roster</h3>
        ${players.map(p=>`<div class="roster-row"><span>${esc(p.codeName)}</span><span class="pill ${p.alive?'alive':'dead'}">${roleLabel(p.role)}</span></div>`).join('')}
      </div>
    `);
  }

  /* ---- Eliminated player: side puzzle game ---- */
  function renderEliminated(state, players, me){
    render(`
      <div class="brand"><div class="eyebrow">${esc(me.codeName)}</div><h1>You Have Fallen</h1></div>
      <div class="cheetah-rule"></div>
      <div class="card center">
        <p class="muted">You're out of the main game, but the night isn't done with you yet.</p>
        <p>Solve <b>10 sums</b> to earn a favor for your old side.</p>
        <button id="startPuzzle">Take the Challenge</button>
      </div>
    `);
    q('#startPuzzle').onclick = ()=>runPuzzle(state, players, me);
  }

  function genQuestion(){
    const a = Math.floor(Math.random()*18)+2;
    const b = Math.floor(Math.random()*18)+1;
    const op = Math.random()<0.5 ? '+' : '-';
    const hi = Math.max(a,b), lo = Math.min(a,b);
    const answer = op==='+' ? a+b : hi-lo;
    return { text: op==='+' ? `${a} + ${b}` : `${hi} - ${lo}`, answer };
  }

  function runPuzzle(state, players, me){
    let idx = 0, correct = 0;
    const total = 10;
    let questions = Array.from({length: total}, genQuestion);

    function draw(){
      const qq = questions[idx];
      render(`
        <div class="brand"><div class="eyebrow">Question ${idx+1} of ${total}</div><h1>Solve It</h1></div>
        <div class="cheetah-rule"></div>
        <div class="card center">
          <div class="puzzle-q">${qq.text} = ?</div>
          <input type="text" id="ansInput" inputmode="numeric" placeholder="Your answer" autofocus>
          <button id="ansBtn">Submit</button>
        </div>
      `);
      q('#ansInput').focus();
      const submit = ()=>{
        const val = parseInt(q('#ansInput').value, 10);
        if(val === qq.answer) correct++;
        idx++;
        if(idx>=total){ finish(); } else { draw(); }
      };
      q('#ansBtn').onclick = submit;
      q('#ansInput').onkeydown = (e)=>{ if(e.key==='Enter') submit(); };
    }

    async function finish(){
      const success = correct >= total;
      if(!success){
        render(`
          <div class="brand"><h1>Not Quite</h1></div>
          <div class="cheetah-rule"></div>
          <div class="card center">
            <p>You got ${correct} of ${total} right. No favor earned this time.</p>
            <button id="doneBtn">Back to Waiting</button>
          </div>
        `);
        q('#doneBtn').onclick = ()=>runPlayer();
        return;
      }
      if(me.role === 'mafia'){
        const targets = alive(players);
        render(`
          <div class="brand"><h1>A Favor Granted</h1></div>
          <div class="cheetah-rule"></div>
          <div class="card">
            <h3>Hand Someone a Dagger</h3>
            <p class="muted">Whoever you choose will have their vote count twice next round.</p>
            <div id="daggerList">${pickerList(targets)}</div>
          </div>
        `);
        qa('#daggerList .choice-btn').forEach(btn=>{
          btn.onclick = async ()=>{
            await updateRound(r=>{ r.dagger = btn.dataset.id; });
            render(`<div class="card center"><h2>Done</h2><p class="muted">The dagger has been passed.</p></div>`);
            setTimeout(()=>runPlayer(), 1400);
          };
        });
      } else {
        await updateRound(r=>{ r.extraSaveUnlocked = true; });
        render(`
          <div class="brand"><h1>A Favor Granted</h1></div>
          <div class="cheetah-rule"></div>
          <div class="card center">
            <p>Word has reached the doctor. An extra dose will be ready next round.</p>
            <button id="doneBtn">Back to Waiting</button>
          </div>
        `);
        q('#doneBtn').onclick = ()=>runPlayer();
      }
    }

    draw();
  }

  /* =========================================================
     NARRATOR FLOW
  ========================================================= */
  async function runNarrator(){
    startPolling(renderNarratorState);
  }

  async function renderNarratorState(){
    const [state, players] = await Promise.all([getState(), getPlayers()]);

    if(state.phase === 'game_over'){
      stopPolling();
      return renderNarratorGameOver(state, players);
    }

    if(!state.started){
      renderNarratorLobby(state, players);
      appendNarratorResetControl();
      return;
    }

    switch(state.phase){
      case 'night_mafia': await renderNarratorMafia(state, players); break;
      case 'night_doctor': await renderNarratorDoctor(state, players); break;
      case 'night_detective': await renderNarratorDetective(state, players); break;
      case 'night_reveal': renderNarratorNightReveal(state, players); break;
      case 'day_discussion': renderNarratorDiscussion(state, players); break;
      case 'day_vote': await renderNarratorDayVote(state, players); break;
      case 'day_reveal': renderNarratorDayReveal(state, players); break;
      default: renderNarratorLobby(state, players);
    }
    appendNarratorResetControl();
  }

  function appendNarratorResetControl(){
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    div.style.marginTop = '4px';
    div.innerHTML = `<button id="resetGameLink" class="back-link" style="width:auto;">Reset Entire Game</button>`;
    appEl.appendChild(div);
    div.querySelector('#resetGameLink').onclick = async ()=>{
      if(!confirm('Reset the whole game? This clears every player and all progress.')) return;
      await setPlayers([]);
      await setRound(defaultRound());
      await setState(defaultState());
      runNarrator();
    };
  }

  function narratorHeader(subtitle){
    return `<div class="brand"><div class="eyebrow">Narrator's Desk</div><h1>${subtitle}</h1></div><div class="cheetah-rule"></div>`;
  }

  function rosterList(players, statusFn){
    return players.map(p=>`
      <div class="roster-row">
        <span>${esc(p.codeName)} <span class="muted">(${esc(p.realName)})</span></span>
        ${statusFn ? statusFn(p) : ''}
      </div>
    `).join('') || '<p class="muted">No one has joined yet.</p>';
  }

  function renderNarratorLobby(state, players){
    const link = location.href.split('#')[0];
    render(`
      ${narratorHeader('The House Fills Up')}
      <div class="card">
        <p class="muted">Send this link to your guests on WhatsApp:</p>
        <div class="link-box">${esc(link)}</div>
        <h3>Guests Joined (${players.length})</h3>
        ${rosterList(players, ()=> `<span class="pill waiting">ready</span>`)}
      </div>
      <div class="card">
        <button id="startBtn" ${players.length<5?'disabled':''}>Start the Game &amp; Deal Roles</button>
        ${players.length<5 ? '<p class="muted center">Need at least 5 guests to start.</p>' : ''}
      </div>
    `);
    const btn = q('#startBtn');
    if(btn) btn.onclick = async ()=>{
      btn.disabled = true; btn.textContent = 'Dealing…';
      await dealRolesAndStart(players);
    };
  }

  async function dealRolesAndStart(players){
    const n = players.length;
    const mafiaCount = Math.max(2, Math.round(n/5));
    const shuffled = [...players].sort(()=>Math.random()-0.5);
    shuffled.forEach((p,i)=>{
      if(i < mafiaCount) p.role = 'mafia';
      else if(i === mafiaCount) p.role = 'doctor';
      else p.role = 'villager';
      p.alive = true;
    });
    const state = defaultState();
    state.started = true;
    state.phase = 'night_mafia';
    state.round = 1;
    // Sequential writes (not parallel) to avoid overloading the storage backend
    await setPlayers(shuffled);
    await setRound(defaultRound());
    await setState(state);
    renderNarratorState();
  }

  async function renderNarratorMafia(state, players){
    const mafias = alive(players).filter(p=>p.role==='mafia');
    const round = await getRound();
    const votes = round.mafiaVotes || {};
    const doneCount = mafias.filter(p=>votes[p.id]).length;
    const allDone = doneCount === mafias.length && mafias.length>0;
    render(`
      ${narratorHeader('Round '+state.round+' — Mafia Are Deciding')}
      <div class="card">
        <p class="muted">"Everyone, close your eyes. Mafia — open yours and choose."</p>
        <h3>Who Has Voted (${doneCount}/${mafias.length})</h3>
        ${mafias.map(p=>`<div class="roster-row"><span>${esc(p.codeName)}</span><span class="pill ${votes[p.id]?'alive':'waiting'}">${votes[p.id]?'voted':'thinking…'}</span></div>`).join('')}
      </div>
      <div class="card">
        <button id="contBtn" ${allDone?'':'disabled'}>Mafia Close Your Eyes — Continue</button>
      </div>
    `);
    const btn = q('#contBtn');
    if(btn && allDone) btn.onclick = async ()=>{
      btn.disabled = true;
      const s = await getState();
      s.phase = 'night_doctor';
      await setState(s);
      renderNarratorState();
    };
  }

  async function renderNarratorDoctor(state, players){
    const doctor = alive(players).find(p=>p.role==='doctor');
    const round = await getRound();
    const save = round.doctorSave || {targets:[]};
    const done = !doctor || save.targets.length>0;
    render(`
      ${narratorHeader('Round '+state.round+' — Doctor Is Deciding')}
      <div class="card">
        <p class="muted">"Doctor, open your eyes and choose."</p>
        ${doctor ? `<div class="roster-row"><span>${esc(doctor.codeName)}</span><span class="pill ${done?'alive':'waiting'}">${done?'decided':'deciding…'}</span></div>` : '<p class="muted">No doctor remains alive.</p>'}
      </div>
      <div class="card">
        <button id="contBtn" ${done?'':'disabled'}>Doctor Close Your Eyes — Continue</button>
      </div>
    `);
    const btn = q('#contBtn');
    if(btn && done) btn.onclick = async ()=>{
      btn.disabled = true;
      const s = await getState();
      if(s.detectiveActive){
        s.phase = 'night_detective';
        await setState(s);
        renderNarratorState();
      } else {
        await resolveNight(s, players);
      }
    };
  }

  async function renderNarratorDetective(state, players){
    const det = players.find(p=>p.id===state.detectiveId && p.alive);
    const round = await getRound();
    const check = round.detectiveCheck || {};
    const done = !det || !!check[det.id];
    render(`
      ${narratorHeader('Round '+state.round+' — Detective Is Watching')}
      <div class="card">
        <p class="muted">"Detective, open your eyes and choose."</p>
        ${det ? `<div class="roster-row"><span>${esc(det.codeName)}</span><span class="pill ${done?'alive':'waiting'}">${done?'decided':'deciding…'}</span></div>` : '<p class="muted">No detective active.</p>'}
      </div>
      <div class="card">
        <button id="contBtn" ${done?'':'disabled'}>Detective Close Your Eyes — Reveal Dawn</button>
      </div>
    `);
    const btn = q('#contBtn');
    if(btn && done) btn.onclick = async ()=>{
      btn.disabled = true;
      const s = await getState();
      await resolveNight(s, players);
    };
  }

  async function resolveNight(state, players){
    const round = await getRound();
    const votes = round.mafiaVotes || {};
    const save = round.doctorSave || {targets:[]};
    const order = Object.entries(votes);
    let killedId = null;
    if(order.length){ killedId = order[0][1]; }
    const saved = killedId && save.targets.includes(killedId);

    if(killedId && !saved){
      const victim = players.find(p=>p.id===killedId);
      if(victim){
        victim.alive = false;
        pushLog(state, `${victim.codeName} kicked the bucket.`);
      }
    } else if(killedId && saved){
      pushLog(state, `Someone was marked for death last night, but the doctor's medicine held. No one was lost.`);
    } else {
      pushLog(state, `A quiet night. No one was harmed.`);
    }

    await setPlayers(players);
    await checkDetectiveTrigger(state, players);
    const winner = checkWin(players);
    if(winner){
      state.winner = winner;
      state.phase = 'game_over';
      await setState(state);
      renderNarratorState();
      return;
    }
    state.phase = 'night_reveal';
    await setState(state);
    await setRound(defaultRound());
    renderNarratorState();
  }

  async function checkDetectiveTrigger(state, players){
    if(state.detectiveActive) return;
    const villagers = aliveVillagers(players);
    if(villagers.length <= 6 && villagers.length > 0){
      const chosen = villagers[Math.floor(Math.random()*villagers.length)];
      chosen.role = 'detective';
      state.detectiveActive = true;
      state.detectiveId = chosen.id;
      pushLog(state, `From the frightened crowd, ${chosen.codeName} discovers a sharper mind for the truth.`);
      await setPlayers(players);
    }
  }

  function checkWin(players){
    const m = aliveMafia(players).length;
    const t = aliveNonMafia(players).length;
    if(m === 0) return 'town';
    if(m >= t) return 'mafia';
    return null;
  }

  function renderNarratorNightReveal(state, players){
    const recent = (state.log||[]).filter(l=>l.round===state.round);
    render(`
      ${narratorHeader('Round '+state.round+' — Dawn')}
      <div class="card">
        <p class="muted">Announce this to the table:</p>
        ${recent.map(l=>`<div class="log-item">${esc(l.text)}</div>`).join('')}
      </div>
      <div class="card">
        <button id="contBtn">Begin the Day — Open Discussion</button>
      </div>
    `);
    q('#contBtn').onclick = async ()=>{
      const s = await getState();
      s.phase = 'day_discussion';
      s.discussionStartedAt = Date.now();
      await setState(s);
      renderNarratorState();
    };
  }

  function renderNarratorDiscussion(state, players){
    render(`
      ${narratorHeader('Round '+state.round+' — Discussion')}
      <div class="card center">
        <p class="muted">Let the table talk as long as they like.</p>
      </div>
      <div class="card">
        <button id="contBtn">Call the Vote</button>
      </div>
    `);
    q('#contBtn').onclick = async ()=>{
      const s = await getState();
      s.phase = 'day_vote';
      await setState(s);
      await updateRound(r=>{ r.dayVotes = {}; r.dayTieCandidates = null; });
      renderNarratorState();
    };
  }

  async function renderNarratorDayVote(state, players){
    const round = await getRound();
    const tieList = round.dayTieCandidates || null;
    const votes = round.dayVotes || {};
    const voters = alive(players);
    const doneCount = voters.filter(p=>votes[p.id]).length;
    const allDone = doneCount === voters.length && voters.length>0;
    render(`
      ${narratorHeader(tieList ? 'A Tie — Revote' : 'Round '+state.round+' — The Vote')}
      <div class="card">
        <h3>Who Has Voted (${doneCount}/${voters.length})</h3>
        ${voters.map(p=>`<div class="roster-row"><span>${esc(p.codeName)}</span><span class="pill ${votes[p.id]?'alive':'waiting'}">${votes[p.id]?'voted':'deciding…'}</span></div>`).join('')}
      </div>
      <div class="card">
        <button id="contBtn" ${allDone?'':'disabled'}>Reveal the Verdict</button>
      </div>
    `);
    const btn = q('#contBtn');
    if(btn && allDone) btn.onclick = async ()=>{
      btn.disabled = true;
      await resolveDayVote(players);
    };
  }

  async function resolveDayVote(players){
    const round = await getRound();
    const votes = round.dayVotes || {};
    const dagger = round.dagger;
    const tally = {};
    Object.entries(votes).forEach(([voterId, targetId])=>{
      const weight = (dagger && voterId === dagger) ? 2 : 1;
      tally[targetId] = (tally[targetId]||0) + weight;
    });
    let max = 0;
    Object.values(tally).forEach(v=>{ if(v>max) max=v; });
    const topIds = Object.keys(tally).filter(id=>tally[id]===max);

    const state = await getState();

    if(topIds.length > 1){
      await updateRound(r=>{ r.dayTieCandidates = topIds; r.dayVotes = {}; });
      renderNarratorState();
      return;
    }

    const lynchedId = topIds[0];
    const victim = players.find(p=>p.id===lynchedId);
    if(victim){
      victim.alive = false;
      if(victim.role === 'mafia'){
        pushLog(state, `${victim.codeName} was indeed the mafia.`);
      } else {
        pushLog(state, `Alas! ${victim.codeName} is not the mafia.`);
      }
    }
    await setPlayers(players);
    await checkDetectiveTrigger(state, players);

    const winner = checkWin(players);
    if(winner){
      state.winner = winner;
      state.phase = 'game_over';
      await setState(state);
      renderNarratorState();
      return;
    }
    state.phase = 'day_reveal';
    await setState(state);
    await updateRound(r=>{ r.dayTieCandidates = null; r.dagger = null; r.dayVotes = {}; });
    renderNarratorState();
  }

  function renderNarratorDayReveal(state, players){
    const recent = (state.log||[]).filter(l=>l.round===state.round);
    render(`
      ${narratorHeader('Round '+state.round+' — Verdict')}
      <div class="card">
        ${recent.map(l=>`<div class="log-item">${esc(l.text)}</div>`).join('')}
      </div>
      <div class="card">
        <button id="contBtn">Nightfall — Begin Round ${state.round+1}</button>
      </div>
    `);
    q('#contBtn').onclick = async ()=>{
      const s = await getState();
      s.round += 1;
      s.phase = 'night_mafia';
      await setState(s);
      await setRound(defaultRound());
      renderNarratorState();
    };
  }

  function renderNarratorGameOver(state, players){
    render(`
      ${narratorHeader(state.winner==='mafia' ? 'The Mafia Wins' : 'The Town Wins')}
      <div class="card">
        <h3>Final Roster</h3>
        ${players.map(p=>`<div class="roster-row"><span>${esc(p.codeName)} <span class="muted">(${esc(p.realName)})</span></span><span class="pill ${p.alive?'alive':'dead'}">${roleLabel(p.role)}</span></div>`).join('')}
      </div>
      <div class="card">
        <button id="resetBtn" class="danger">Start a Brand New Game</button>
      </div>
    `);
    q('#resetBtn').onclick = async ()=>{
      await setPlayers([]);
      await setRound(defaultRound());
      await setState(defaultState());
      runNarrator();
    };
  }

})();
