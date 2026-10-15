import {
  MODULE_ID, PUBLIC_DEFAULT, clone, publicState, privateState, escapeHTML as e, safeText,
  validClock, setDateTime, shiftMinutes, nextNight, isNight, isoDate, isoClock,
  crossedEvents, timerProgress, timerRemaining, timerChange, timerCaption, createTimer,
  publicTimer, spotlightRemaining, spotlightChange, uuid
} from './core.js';

let chronos;
const esc = value => e(value);
const fmtDate = iso => new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(iso));
const fmtTime = ms => {const secs = Math.ceil(Math.max(0,ms)/1000); return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;};
const GM_STORAGE = () => `chronos:private:${game.world?.id}:${game.user?.id}`;
const POSITION_STORAGE = () => `chronos:positions:${game.world?.id}:${game.user?.id}`;
const activeGM = () => game.users?.contents?.filter(u=>u.isGM && u.active).sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
const canManage = () => game.user.isGM && (!activeGM() || activeGM().id === game.user.id);
const safeInt = (n,min,max,fallback) => Number.isFinite(Number(n)) ? Math.min(max,Math.max(min,Math.trunc(Number(n)))) : fallback;
const select = (value, current) => value === current ? 'selected' : '';

class ChronosUI {
  constructor() {
    this.state = publicState(game.settings.get(MODULE_ID, 'state'));
    this.secret = this.loadPrivate();
    this.positions = this.loadPositions();
    this.collapsed = false;
    this.tab = 'time';
    this.managerOpen = false;
    this.calendarOpen = false;
    this.viewMonth = isoDate(this.state.iso).slice(0,7);
    this.day = isoDate(this.state.iso);
    this.eventEdit = null;
    this.queue = Promise.resolve();
    this.completed = new Set();
    this.root = document.createElement('div');
    this.root.id = 'chronos-root';
    this.root.innerHTML = '<section id="chronos-hud" class="chronos-window" data-window="hud"></section><section id="chronos-manager" class="chronos-window" data-window="manager" hidden></section><section id="chronos-calendar" class="chronos-window" data-window="calendar" hidden></section><div id="chronos-visual-effect" aria-hidden="true"></div>';
    document.body.append(this.root);
    this.root.addEventListener('click', ev => this.click(ev));
    this.root.addEventListener('submit', ev => this.submit(ev));
    this.root.addEventListener('pointerdown', ev => this.dragStart(ev));
    this.root.addEventListener('change', ev=>this.change(ev));
    this.setPositions();
    this.render();
    this.tickHandle = window.setInterval(()=>this.tick(), 500);
    Hooks.on('updateUser',()=>this.render());
  }
  loadPrivate() {
    if (!game.user.isGM) return privateState();
    try {return privateState(JSON.parse(localStorage.getItem(GM_STORAGE())));} catch {return privateState();}
  }
  savePrivate() {
    if (!game.user.isGM) return;
    try {localStorage.setItem(GM_STORAGE(), JSON.stringify(this.secret));} catch(err) {console.warn('Chronos: сохранение локальных данных GM не удалось',err); ui.notifications?.warn('Хронос: не удалось сохранить закрытые данные в браузере.');}
  }
  loadPositions() {try {return JSON.parse(localStorage.getItem(POSITION_STORAGE())) || {};} catch {return {};}}
  setPositions() {
    for(const [id,initial] of Object.entries({hud:[100,110],manager:[480,110],calendar:[480,150]})) {
      const el = this.root.querySelector(`#chronos-${id}`);
      const [x,y] = this.positions[id] || initial;
      el.style.left = `${Math.min(Math.max(0,x), Math.max(0,innerWidth-52))}px`;
      el.style.top = `${Math.min(Math.max(0,y), Math.max(0,innerHeight-52))}px`;
    }
  }
  dragStart(ev) {
    if(ev.button !== 0 || !ev.target.closest('[data-drag-handle]')) return;
    if(ev.target.closest('button, input, select, textarea, a') && !ev.target.closest('.chronos-dot')) return;
    const el = ev.target.closest('[data-window]');
    if(!el) return;
    const name = el.dataset.window;
    const sx = ev.clientX, sy = ev.clientY, left=parseFloat(el.style.left)||0, top=parseFloat(el.style.top)||0;
    let moved = false;
    const move = mv => {
      if(Math.abs(mv.clientX-sx)+Math.abs(mv.clientY-sy)>5) moved=true;
      const x = Math.min(Math.max(0, left + mv.clientX-sx),Math.max(0,innerWidth-50));
      const y = Math.min(Math.max(0, top + mv.clientY-sy),Math.max(0,innerHeight-46));
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    };
    const end = () => {
      window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',end);
      if(moved) this.suppressClickUntil=Date.now()+350;
      this.positions[name] = [Math.round(parseFloat(el.style.left)),Math.round(parseFloat(el.style.top))];
      try{localStorage.setItem(POSITION_STORAGE(),JSON.stringify(this.positions));}catch{}
    };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',end, {once:true});
  }
  async saveWorld(mutator) {
    if(!canManage()) {ui.notifications?.warn('Хронос: управлять временем может активный мастер.');return;}
    const job=async()=>{
      try {
        // Read the latest persisted state, then serialize updates in this GM client.
        const before=publicState(game.settings.get(MODULE_ID,'state'));
        const next=clone(before);
        mutator(next);
        next.revision = before.revision + 1;
        await game.settings.set(MODULE_ID,'state',next);
        this.state=publicState(next);
        this.render();
        const reached=crossedEvents(before.iso,next.iso,[...next.events,...this.secret.events]);
        if (reached.length) ui.notifications?.info(`Хронос: наступили события — ${reached.map(v=>v.title).join(', ').slice(0,150)}`);
      } catch(err) {console.error('Chronos: сохранение не удалось',err);ui.notifications?.error(`Хронос: ${err.message}`);}
    };
    this.queue=this.queue.then(job,job);
    return this.queue;
  }
  updatePrivate(mutator) {
    if(!canManage()) {ui.notifications?.warn('Хронос: закрытыми записями управляет активный GM.');return;}
    mutator(this.secret);this.savePrivate();this.render();
  }
  changedWorld(newValue) {
    const old=this.state;
    this.state=publicState(newValue);
    if(old && old.revision !== this.state.revision) this.notifyTimerChanges(old.timers,this.state.timers);
    this.render();
  }
  notifyTimerChanges(oldTimers,newTimers) {
    const previous=new Map(oldTimers.map(t=>[t.id,t]));
    for(const timer of newTimers) {
      const old=previous.get(timer.id);
      if(!old) continue;
      const from=timerProgress(old), to=timerProgress(timer);
      if(to<1) this.completed.delete(`complete:${timer.id}:${timer.mode==='real'?timer.endsAt:timer.createdAt}`);
      if(from < .75 && to >= .75 && timer.effect !== 'none') this.effect(timer.effect);
      if(from < 1 && to >= 1) this.alertComplete(timer);
    }
  }
  alertComplete(timer) {
    const key=`complete:${timer.id}:${timer.mode==='real'?timer.endsAt:timer.createdAt}`;
    if(this.completed.has(key)) return;
    this.completed.add(key);
    ui.notifications?.info(`Хронос: завершено «${timer.name}».`);
    if(timer.effect!=='none') this.effect(timer.effect);
  }
  effect(type) {
    const fx=this.root.querySelector('#chronos-visual-effect');
    if(!game.settings.get(MODULE_ID,'reducedMotion')) {
      fx.classList.remove('chronos-fx-active');void fx.offsetWidth;fx.classList.add('chronos-fx-active');
    }
    if(!game.settings.get(MODULE_ID,'sound')) return;
    try{
      const AudioContext=window.AudioContext || window.webkitAudioContext;
      if(!AudioContext)return;
      this.audioContext ||= new AudioContext();
      if(this.audioContext.state==='suspended') void this.audioContext.resume();
      const now=this.audioContext.currentTime;
      const frequencies=type==='heartbeat'?[74,70]:type==='tension'?[240,165]:[620,780];
      frequencies.forEach((freq,i)=>{
        const osc=this.audioContext.createOscillator(), gain=this.audioContext.createGain();
        osc.type=type==='heartbeat'?'sine':'triangle';osc.frequency.value=freq;
        gain.gain.setValueAtTime(.0001,now+i*.21);gain.gain.exponentialRampToValueAtTime(.08,now+i*.21+.02);
        gain.gain.exponentialRampToValueAtTime(.0001,now+i*.21+.18);
        osc.connect(gain);gain.connect(this.audioContext.destination);
        osc.start(now+i*.21);osc.stop(now+i*.21+.19);
      });
    }catch(err){console.warn('Chronos audio',err);}
  }
  render() {
    this.renderHud(); this.renderManager(); this.renderCalendar(); this.tick();
  }
  renderHud() {
    const node=this.root.querySelector('#chronos-hud');
    node.classList.toggle('is-collapsed',this.collapsed);
    const timers=this.state.timers;
    if(this.collapsed){
      node.innerHTML=`<button class="chronos-dot" data-action="expand" title="Хронос: развернуть" aria-label="Развернуть Хронос" data-drag-handle><span class="chronos-clock-icon">◷</span>${timers.length?`<b class="chronos-bubble">${timers.length}</b>`:''}</button>`;
      return;
    }
    const isNightNow=isNight(this.state.iso,this.state.dawn,this.state.dusk);
    node.innerHTML=`
      <div class="chronos-hud-header" data-drag-handle><span class="chronos-logo">◷</span><strong>Хронос</strong><span class="chronos-flex"></span>
        <button data-action="calendar" class="chronos-icon" title="Календарь">▦</button>
        ${game.user.isGM?'<button data-action="manager" class="chronos-icon" title="Управление мастера">⚙</button>':''}
        <button data-action="collapse" class="chronos-icon" title="Свернуть">−</button></div>
      <button class="chronos-time" data-action="calendar" title="Открыть календарь">
        <span class="chronos-main-time">${esc(isoClock(this.state.iso))}</span><span class="chronos-time-meta"><span>${esc(fmtDate(this.state.iso))}</span><span class="chronos-period ${isNightNow?'night':'day'}">${isNightNow?'☾ Ночь':'☀ День'}</span></span>
      </button>
       ${timers.length?`<div class="chronos-public-timers">${timers.map(t=>this.miniTimer(t)).join('')}</div>`:''}`;
  }
  miniTimer(t) {
    const pct=Math.round(timerProgress(t)*100);
    const amount=t.numbers?timerCaption(t):'Без чисел';
    return `<div class="chronos-mini-timer"><div class="chronos-mini-head"><span>${esc(t.name)}</span>${t.numbers?`<small data-timer-caption="${esc(t.id)}">${esc(amount)}</small>`:''}</div><div class="chronos-track"><span data-timer-bar="${esc(t.id)}" style="width:${pct}%"></span></div></div>`;
  }
  managerHeader() {return `<header class="chronos-bar" data-drag-handle><span class="chronos-logo">◷</span><b>Хронос</b><span class="chronos-sub">· панель мастера</span><span class="chronos-flex"></span><button data-action="close-manager" class="chronos-icon">×</button></header>`;}
  renderManager(){
    const node=this.root.querySelector('#chronos-manager');node.hidden=!this.managerOpen || !game.user.isGM;if(node.hidden)return;
    const tabs=[['time','Время'],['events','События'],['timers','Часы угроз'],['spotlight','Спотлайт']];
    const lock=!canManage()?'<p class="chronos-warning">Управление доступно активному мастеру этой игры.</p>':'';
    let body='';
    if(this.tab==='time')body=this.managerTime();
    if(this.tab==='events')body=this.managerEvents();
    if(this.tab==='timers')body=this.managerTimers();
    if(this.tab==='spotlight')body=this.managerSpotlight();
    node.innerHTML=`${this.managerHeader()}<nav class="chronos-tabs">${tabs.map(([id,label])=>`<button data-action="tab" data-value="${id}" class="${id===this.tab?'current':''}">${label}</button>`).join('')}</nav><div class="chronos-manager-body">${lock}${body}</div>`;
  }
  managerTime(){
    const d=isoDate(this.state.iso), h=isoClock(this.state.iso);
    return `<div class="chronos-section-head"><div><small>ТЕКУЩЕЕ ВРЕМЯ</small><h2>${esc(h)} <span class="chronos-dim">· ${esc(fmtDate(this.state.iso))}</span></h2></div></div>
      <div class="chronos-inline-buttons"><button data-action="advance" data-value="60">+1 час</button><button data-action="advance" data-value="1440">+1 день</button><button class="chronos-highlight" data-action="next-night">☾ Следующая ночь</button></div>
      <form data-form="datetime" class="chronos-form"><label>Установить дату<input name="date" type="date" value="${d}" required></label><label>Установить время<input name="time" type="time" value="${h}" required></label><button type="submit" class="chronos-primary">Установить</button></form>
      <div class="chronos-hairline"></div><h3>Смена дня и ночи</h3>
      <form data-form="sun" class="chronos-form three"><label>Рассвет<input name="dawn" type="time" value="${esc(this.state.dawn)}" required></label><label>Закат<input name="dusk" type="time" value="${esc(this.state.dusk)}" required></label><label>Новая ночь<input name="nextNight" type="time" value="${esc(this.state.nextNight)}" required></label><button type="submit" class="chronos-small-primary">Сохранить настройки</button></form>
      <p class="chronos-note">Игровые часы не идут сами по себе. Их меняет мастер; у всех игроков время обновляется одновременно. Кнопка следующей ночи переводит календарь на следующий день.</p>`;
  }
  managerEvents(){
    const all=[...this.state.events.map(x=>({...x,source:'public'})),...this.secret.events.map(x=>({...x,source:'private'}))].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    const edit=this.eventEdit ? all.find(x=>x.id===this.eventEdit.id && x.source===this.eventEdit.source) : null;
    return `<div class="chronos-section-head"><h2>Календарные события</h2><button data-action="calendar" class="chronos-secondary">Открыть календарь ↗</button></div>
      <form data-form="event" class="chronos-form grid2"><label class="full">Название<input name="title" value="${esc(edit?.title||'')}" placeholder="Совет примогенов" maxlength="100" required></label><label>Дата<input name="date" type="date" value="${esc(edit?.date||isoDate(this.state.iso))}" required></label><label>Время <small>необязательно</small><input name="time" type="time" value="${esc(edit?.time||'')}"></label><label class="full">Заметка<textarea name="note" maxlength="400" rows="2" placeholder="Короткое описание">${esc(edit?.note||'')}</textarea></label><label>Видимость<select name="visibility"><option value="public" ${select('public',edit?.source||'public')}>Всем</option><option value="private" ${select('private',edit?.source)}>Только GM</option></select></label><button type="submit" class="chronos-primary">${edit?'Сохранить изменения':'Добавить событие'}</button>${edit?'<button type="button" data-action="cancel-event" class="chronos-secondary">Отменить</button>':''}</form>
      <div class="chronos-hairline"></div><h3>Ближайшие и созданные события</h3><div class="chronos-list">${all.length?all.map(x=>`<div class="chronos-event-row"><span class="chronos-event-marker ${x.source==='private'?'private':''}"></span><div><strong>${esc(x.title)}</strong><small>${esc(x.date)}${x.time?' · '+esc(x.time):' · весь день'} · ${x.source==='private'?'Только GM':'Всем'}</small></div><button data-action="edit-event" data-id="${esc(x.id)}" data-source="${x.source}" title="Изменить">✎</button><button data-action="delete-event" data-id="${esc(x.id)}" data-source="${x.source}" title="Удалить">×</button></div>`).join(''):'<p class="chronos-empty">Событий пока нет.</p>'}</div>`;
  }
  timerRow(t,secret=false){
    const pct=Math.round(timerProgress(t)*100);
    const label=secret?t.name:(this.secret.aliases[t.id]||t.name);
    return `<article class="chronos-timer-card"><div class="chronos-timer-head"><div><strong>${esc(label)}</strong><small>${secret?'Только GM':t.visibility==='anonymous'?'Анонимно для игроков':'Публично'} · ${t.mode==='real'?'Реальное время':t.mode==='steps'?'Ходы':'Шкала'}</small></div><button data-action="delete-timer" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" title="Удалить">×</button></div><div class="chronos-timer-track"><span data-timer-bar="${esc(t.id)}" style="width:${pct}%"></span></div><div class="chronos-timer-actions"><span class="chronos-timer-value" data-timer-caption="${esc(t.id)}">${esc(timerCaption(t))}</span><span class="chronos-flex"></span>${t.mode==='real'?`<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="toggle">${t.running?'Пауза':'▶ Пуск'}</button>`:`<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="minus">−</button><button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="plus">+</button>`}<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="reset">↺</button></div></article>`;
  }
  managerTimers(){
    const all=[...this.state.timers.map(t=>this.timerRow(t)),...this.secret.timers.map(t=>this.timerRow(t,true))];
    return `<h2>Часы событий и угроз</h2><div class="chronos-list chronos-timer-list">${all.length?all.join(''):'<p class="chronos-empty">Пока нет ни одной шкалы.</p>'}</div>
    <div class="chronos-hairline"></div><h3>Создать новые часы</h3>
    <form data-form="timer" class="chronos-form grid2"><label class="full">Название<input name="name" maxlength="80" required placeholder="До рассвета / Прибытие охотников"></label><label>Тип<select name="mode"><option value="steps">По ходам</option><option value="manual">Ручная шкала</option><option value="real">Реальный отсчёт</option></select></label><label>Видимость<select name="visibility"><option value="named">Публичный, с названием</option><option value="anonymous">Публичный, анонимный</option><option value="gm">Только GM</option></select></label><label>Делений (2–20)<input name="max" type="number" min="2" max="20" value="6"></label><label>Минут (1–240)<input name="minutes" type="number" min="1" max="240" value="5"></label><label>Звук/эффект<select name="effect"><option value="none">Нет</option><option value="bell">Колокол</option><option value="heartbeat">Сердцебиение</option><option value="tension">Тревога</option></select></label><label class="chronos-check"><input type="checkbox" name="numbers"> Показывать игрокам числа</label><button type="submit" class="chronos-primary full">Создать часы</button></form>
    <p class="chronos-note">По ходам и ручные шкалы продвигаются только мастером. Реальный отсчёт запускается отдельно.</p>`;
  }
  managerSpotlight(){
    const t=this.secret.spotlight;
    const players=game.users.contents.filter(u=>!u.isGM);
    const options=players.map(u=>`<option value="${esc(u.id)}" ${select(u.id,t?.userId)}>${esc(u.name)}</option>`).join('');
    const remaining=spotlightRemaining(t);
    const current=players.find(u=>u.id===t?.userId);
    return `<div class="chronos-spotlight-top"><span class="chronos-mini-tag">ТОЛЬКО ДЛЯ МАСТЕРА</span><h2>Таймер спотлайта</h2><p>Помогает распределять внимание между игроками. Игроки не видят ни отсчёт, ни выбранного участника.</p></div>
    <div class="chronos-stopwatch"><small>${esc(current?.name || 'Игрок не выбран')}</small><strong data-spotlight-time>${fmtTime(remaining)}</strong><span>${t?.running?'Отсчёт запущен':t?'Пауза / ожидание':'Готов к запуску'}</span></div>
    <form data-form="spotlight" class="chronos-form grid2"><label class="full">Игрок<select name="userId" required>${options||'<option value="">Нет игроков</option>'}</select></label><label>Минут на игрока<input name="minutes" type="number" min="1" max="180" value="${t?Math.round(t.durationMs/60000):15}"></label><button type="submit" class="chronos-primary">Начать заново</button></form>
    ${t?`<div class="chronos-inline-buttons chronos-spotlight-controls"><button data-action="spotlight-action" data-value="toggle">${t.running?'Пауза':'▶ Продолжить'}</button><button data-action="spotlight-action" data-value="plus">+1 минута</button><button data-action="spotlight-action" data-value="reset">Сброс</button><button data-action="spotlight-clear">Завершить</button></div>`:''}
    <p class="chronos-note">Отсчёт реального времени не влияет на игровые часы. Переключение между игроками только вручную. При истечении звучит уведомление у GM, если включён звук.</p>`;
  }
  renderCalendar(){
    const node=this.root.querySelector('#chronos-calendar');node.hidden=!this.calendarOpen;if(node.hidden)return;
    let [year,month]=this.viewMonth.split('-').map(Number);
    const first=new Date(Date.UTC(year,month-1,1));
    const pad=(first.getUTCDay()+6)%7;
    const n=new Date(Date.UTC(year,month,0)).getUTCDate();
    const dateTitle=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    const all=[...this.state.events,...(game.user.isGM?this.secret.events:[])];
    const grid=Array(pad).fill('<span></span>');
    for(let i=1;i<=n;i++) {
      const date=`${year}-${String(month).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
      const has=all.some(v=>v.date===date);
      grid.push(`<button data-action="calendar-day" data-value="${date}" class="${this.day===date?'selected':''} ${date===isoDate(this.state.iso)?'today':''}">${i}${has?'<em>•</em>':''}</button>`);
    }
    const details=all.filter(x=>x.date===this.day).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    node.innerHTML=`<header class="chronos-bar" data-drag-handle><b>▦ Календарь</b><span class="chronos-flex"></span><button class="chronos-icon" data-action="close-calendar">×</button></header>
    <div class="chronos-calendar-content"><div class="chronos-month-nav"><button data-action="month" data-value="-1">‹</button><strong>${esc(dateTitle)}</strong><button data-action="month" data-value="1">›</button></div><div class="chronos-calendar-grid chronos-weekdays">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<span>${x}</span>`).join('')}</div><div class="chronos-calendar-grid">${grid.join('')}</div><div class="chronos-hairline"></div><div class="chronos-calendar-daytitle">${esc(this.day)}</div><div class="chronos-list">${details.length?details.map(v=>`<div class="chronos-day-event"><b>${esc(v.time||'Весь день')} · ${esc(v.title)}</b>${v.note?`<p>${esc(v.note)}</p>`:''}${game.user.isGM&&this.secret.events.some(x=>x.id===v.id)?'<small>🔒 Только мастер</small>':''}</div>`).join(''):'<p class="chronos-empty">В этот день записей нет.</p>'}</div>${game.user.isGM?'<button class="chronos-secondary" data-action="calendar-add">+ Добавить событие</button>':''}</div>`;
  }
  tick(){
    if(!this.root)return;
    const now=Date.now();
    const allTimers=[...this.state.timers,...(game.user.isGM?this.secret.timers:[])];
    for(const t of allTimers){
      const bar=this.root.querySelectorAll(`[data-timer-bar="${CSS.escape(t.id)}"]`);
      bar.forEach(el=>{el.style.width=`${Math.round(timerProgress(t,now)*100)}%`;el.classList.toggle('danger',timerProgress(t,now)>=.75);});
      this.root.querySelectorAll(`[data-timer-caption="${CSS.escape(t.id)}"]`).forEach(el=>{el.textContent=timerCaption(t,now);});
      if(t.mode==='real' && t.running && timerRemaining(t,now)===0) this.alertComplete(t);
    }
    const clock=this.root.querySelector('[data-spotlight-time]');
    if(clock)clock.textContent=fmtTime(spotlightRemaining(this.secret.spotlight,now));
    const spot=this.secret.spotlight;
    if(canManage() && spot?.running && spotlightRemaining(spot,now)===0 && !spot.notified) {
      spot.notified=true;
      this.savePrivate();
      this.effect('bell');
      ui.notifications?.info('Хронос: время спотлайта истекло.');
    }
  }
  click(ev){
    if(Date.now() < (this.suppressClickUntil || 0)) {ev.preventDefault();return;}
    const btn=ev.target.closest('[data-action]'); if(!btn) return;
    const {action, id, source, value}=btn.dataset;
    if(action==='collapse')this.collapsed=true;
    if(action==='expand')this.collapsed=false;
    if(action==='manager'){this.managerOpen=!this.managerOpen;}
    if(action==='close-manager'){this.managerOpen=false;}
    if(action==='calendar'){this.calendarOpen=true;this.viewMonth=isoDate(this.state.iso).slice(0,7);this.day=isoDate(this.state.iso);}
    if(action==='close-calendar'){this.calendarOpen=false;}
    if(action==='tab'){this.tab=value;this.eventEdit=null;}
    if(action==='cancel-event'){this.eventEdit=null;}
    if(action==='advance'){this.saveWorld(s=>s.iso=shiftMinutes(s.iso, Number(value)));return;}
    if(action==='next-night'){this.saveWorld(s=>s.iso=nextNight(s.iso,s.nextNight));return;}
    if(action==='month'){
      const [year,m]=this.viewMonth.split('-').map(Number), d=new Date(Date.UTC(year,m-1+Number(value),1));
      this.viewMonth=d.toISOString().slice(0,7);
    }
    if(action==='calendar-day')this.day=value;
    if(action==='calendar-add'){this.calendarOpen=false;this.managerOpen=true;this.tab='events';this.eventEdit=null;}
    if(action==='edit-event'){this.eventEdit={id,source};this.tab='events';}
    if(action==='delete-event'){
      if(!canManage())return;
      if(!window.confirm('Удалить событие без возможности восстановления?'))return;
      if(source==='public')void this.saveWorld(s=>{s.events=s.events.filter(x=>x.id!==id);});
      else this.updatePrivate(s=>{s.events=s.events.filter(x=>x.id!==id);});
      this.eventEdit=null;return;
    }
    if(action==='delete-timer'){
      if(!canManage())return;
      if(!window.confirm('Удалить эти часы?'))return;
      if(source==='public'){
        void this.saveWorld(s=>{s.timers=s.timers.filter(x=>x.id!==id);});
        void this.updatePrivate(s=>{delete s.aliases[id];});
      }
      else this.updatePrivate(s=>{s.timers=s.timers.filter(x=>x.id!==id);});
      return;
    }
    if(action==='timer-action'){
      if(source==='public')void this.saveWorld(s=>{const idx=s.timers.findIndex(t=>t.id===id);if(idx>=0)s.timers[idx]=timerChange(s.timers[idx],value);});
      else this.updatePrivate(s=>{const idx=s.timers.findIndex(t=>t.id===id);if(idx>=0)s.timers[idx]=timerChange(s.timers[idx],value);});
      return;
    }
    if(action==='spotlight-action'){this.updatePrivate(s=>{if(s.spotlight)s.spotlight=spotlightChange(s.spotlight,value);});return;}
    if(action==='spotlight-clear'){this.updatePrivate(s=>s.spotlight=null);return;}
    this.render();
  }
  change(ev) {
    // Form fields are intentionally not re-rendered when changed.
  }
  submit(ev){
    const form=ev.target.closest('[data-form]');if(!form)return;ev.preventDefault();
    if(!canManage()){ui.notifications?.warn('Хронос: доступно только активному мастеру.');return;}
    const fd=new FormData(form), pick=k=>String(fd.get(k)||'');
    try {
      switch(form.dataset.form){
        case 'datetime': {const iso=setDateTime(pick('date'),pick('time'));void this.saveWorld(s=>s.iso=iso);break;}
        case 'sun': {
          const [dawn,dusk,night]=['dawn','dusk','nextNight'].map(pick);
          if(![dawn,dusk,night].every(validClock))throw new Error('Неверный формат часов');
          void this.saveWorld(s=>{s.dawn=dawn;s.dusk=dusk;s.nextNight=night;});break;
        }
        case 'event': {
          const title=safeText(pick('title'),100), date=pick('date'), time=pick('time'), note=safeText(pick('note'),400), source=pick('visibility');
          if(!title)throw new Error('Нужно название');
          setDateTime(date,time||'00:00');
          const old=this.eventEdit;
          const item={id:old?.id||uuid(),title,date,time,note};
          if(old && old.source!==source){
            if(old.source==='private')this.updatePrivate(s=>s.events=s.events.filter(x=>x.id!==old.id));
            else void this.saveWorld(s=>s.events=s.events.filter(x=>x.id!==old.id));
          }
          if(source==='private')this.updatePrivate(s=>{const idx=s.events.findIndex(x=>x.id===item.id);if(idx<0)s.events.push(item);else s.events[idx]=item;});
          else void this.saveWorld(s=>{const idx=s.events.findIndex(x=>x.id===item.id);if(idx<0)s.events.push(item);else s.events[idx]=item;});
          this.eventEdit=null;this.render();break;
        }
        case 'timer': {
          const name=safeText(pick('name'),80), visibility=pick('visibility');
          if(!name)throw new Error('Нужно название часов');
          if(!['steps','manual','real'].includes(pick('mode')) || !['named','anonymous','gm'].includes(visibility))throw new Error('Недопустимый тип часов');
          const timer=createTimer({name,mode:pick('mode'),visibility,max:safeInt(pick('max'),2,20,6),minutes:safeInt(pick('minutes'),1,240,5),numbers:fd.has('numbers'),effect:pick('effect')});
          if(visibility==='gm')this.updatePrivate(s=>s.timers.push(timer));
          else {
            if(visibility==='anonymous')void this.updatePrivate(s=>{s.aliases[timer.id]=name;});
            void this.saveWorld(s=>s.timers.push(publicTimer(timer)));
          }
          form.reset();break;
        }
        case 'spotlight': {
          const userId=pick('userId'), minutes=safeInt(pick('minutes'),1,180,15);
          if(!game.users.contents.some(x=>x.id===userId&&!x.isGM))throw new Error('Выберите игрока');
          this.updatePrivate(s=>{const durationMs=minutes*60000;s.spotlight={userId,durationMs,remainingMs:durationMs,running:true,endsAt:Date.now()+durationMs,notified:false};});break;
        }
      }
    } catch(err) {ui.notifications?.error(`Хронос: ${err.message}`);}
  }
}

Hooks.once('init',()=>{
  game.settings.register(MODULE_ID,'state',{
    name:'Состояние времени и публичных событий',hint:'Синхронизируемые данные мира. Не сохраняйте здесь секреты мастера.',
    scope:'world',config:false,type:Object,default:clone(PUBLIC_DEFAULT),onChange:value=>chronos?.changedWorld(value)
  });
  game.settings.register(MODULE_ID,'sound',{
    name:'Хронос: звуковые уведомления',hint:'Разрешить короткие сигналы календаря и часов событий в этом браузере.',
    scope:'client',config:true,type:Boolean,default:true
  });
  game.settings.register(MODULE_ID,'reducedMotion',{
    name:'Хронос: уменьшить анимацию',hint:'Отключить подсветку края экрана.',
    scope:'client',config:true,type:Boolean,default:false
  });
});
Hooks.once('ready',()=>{
  chronos=new ChronosUI();
  // Useful when testing in developer console; does not publish private state.
  console.info('Chronos 0.1.0-beta.1 ready. GM controls via the gear icon.');
});
